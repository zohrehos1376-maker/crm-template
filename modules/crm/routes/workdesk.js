// «میز کار مشاور» CRM نمونه: سابقه‌ی پرونده، وظیفه‌ها، گزارش به مدیر فروش، جمله‌های آماده،
// پیامک، احراز هویت همکار، صف بدون مسئول و گزارش اقدامات مشاوران.
const express = require('express');
const { requireAuth, requirePerm } = require('../../core/middleware/auth');
const { asyncRoute } = require('../../../shared/async');
const { can } = require('../../../shared/permissions');
const W = require('../../../shared/workdesk');
const { CALL_OUTCOMES } = require('../../../shared/call-outcomes');
const { prisma } = require('../../../shared/prisma');
const leadService = require('../services/leadService');
const auditService = require('../services/auditService');
const taskService = require('../services/taskService');
const reportService = require('../services/salesReportService');
const scriptService = require('../services/scriptService');
const kycService = require('../services/kycService');
const activityService = require('../services/activityService');
const fileService = require('../services/customerFileService');
const deskService = require('../services/consultantDeskService');
const myDesk = require('../services/mydeskService');
const smsService = require('../../core/services/smsService');

const router = express.Router();
router.use(requireAuth);

const ok = (fn) => asyncRoute(async (req, res) => res.json(await fn(req)));

router.get('/options', ok(async () => ({
  taskTopics: W.TASK_TOPICS,
  reportKinds: W.REPORT_KINDS,
  noPurchaseReasons: W.NO_PURCHASE_REASONS,
  kycStatuses: W.KYC_STATUSES,
  unverifiedSaleReasons: W.UNVERIFIED_SALE_REASONS,
  callOutcomes: CALL_OUTCOMES,
  smsConfigured: await smsService.configured(),
})));

// شمارنده‌های «میز کار امروز»
router.get('/today', ok(async (req) => {
  const u = req.user;
  const all = can(u, 'all_leads');
  const mine = all ? {} : { OR: [{ operatorUserId: u.id }, { lead: { ownerId: u.id } }, { leadId: null }] };
  const q = await leadService.queueUser();
  const [unlogged, missed, tasks, queue, kyc, reports] = await Promise.all([
    prisma.callLog.count({ where: Object.assign({ logStatus: 'UNLOGGED', direction: { in: ['INCOMING', 'OUTGOING'] } }, mine) }),
    prisma.callLog.count({ where: Object.assign({ direction: { in: ['MISSED', 'REJECTED'] }, callbackDone: false }, mine) }),
    taskService.counts(u),
    prisma.lead.count({ where: { ownerId: q.id } }),
    prisma.lead.count({ where: Object.assign({ kycStatus: 'pending' }, all || can(u, 'kyc_review') ? {} : { ownerId: u.id }) }),
    can(u, 'sales_reports') ? prisma.salesReport.count({ where: { status: 'open' } }) : prisma.salesReport.count({ where: { createdBy: u.id, status: 'resolved', reviewedAt: { gte: new Date(Date.now() - 3 * 86400000) } } }),
  ]);
  return { unlogged, missed, tasksOpen: tasks.open, tasksOverdue: tasks.overdue, queue, kycPending: kyc, reports, reportsMode: can(u, 'sales_reports') ? 'open' : 'answered' };
}));

// «منتظر پاسخ»: تماس‌های بی‌پاسخی که هنوز کسی تماس نگرفته + مشتری‌های تازه‌ی فرم سایت و وردست
// که هنوز در صف بدون مسئول‌اند (۷ روز اخیر). زمان هر کدام برای قرمز شدن بعد از ۳۰ دقیقه.
router.get('/waiting', ok(async () => {
  const since = new Date(Date.now() - 7 * 86400000);
  const q = await leadService.queueUser();
  const [missed, queued] = await Promise.all([
    prisma.callLog.findMany({
      where: { direction: { in: ['MISSED', 'REJECTED'] }, callbackDone: false, startedAt: { gte: since } },
      orderBy: { startedAt: 'asc' }, take: 200,
      include: { lead: { select: { id: true, customerName: true } } },
    }),
    prisma.lead.findMany({ where: { ownerId: q.id, createdAt: { gte: since } }, orderBy: { createdAt: 'asc' }, take: 200, select: { id: true, customerName: true, phone: true, channel: true, createdAt: true } }),
  ]);
  // از هر شماره فقط قدیمی‌ترین تماس بی‌پاسخ (بقیه در شمارش همان ردیف)
  const byPhone = new Map();
  missed.forEach((c) => {
    const cur = byPhone.get(c.phoneNormalized);
    if (cur) cur.count++;
    else byPhone.set(c.phoneNormalized, { type: 'missed', id: c.id, phone: c.phoneNormalized, leadId: c.leadId, name: c.lead ? c.lead.customerName : (c.callerName || ''), at: c.startedAt.getTime(), count: 1 });
  });
  const items = [...byPhone.values()].concat(queued.map((l) => ({ type: 'queue', id: l.id, leadId: l.id, phone: l.phone, name: l.customerName, channel: l.channel || '', at: l.createdAt.getTime() })));
  return { items: items.sort((a, b) => a.at - b.at), lateMinutes: 30 };
}));

// نمای زنده: الان کدام خط با کدام شماره در حال مکالمه است
// فرم‌های همکاری سایت: وضعیت آخرین خواندن، و «دریافت فرم‌های تازه» (فرم تکراری دوباره ثبت نمی‌شود)
router.get('/site-forms', ok(() => require('../services/siteFormService').status()));
router.post('/site-forms/pull', ok(() => require('../services/siteFormService').pull()));
router.get('/live-calls', ok(() => require('../services/liveCallService').list()));
router.post('/live-calls/draft', ok((req) => require('../services/liveCallService').saveDraft(req.user, req.body || {})));
router.post('/live-calls/claim', ok((req) => require('../services/liveCallService').claim(req.user, req.body || {})));

// پخش زنده (SSE): به‌محض وصل/قطع شدن تماس، همان لحظه به مرورگر می‌رسد
router.get('/live-stream', (req, res) => {
  const live = require('../services/liveCallService');
  res.set({
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.flushHeaders();
  let closed = false;
  const send = async () => {
    if (closed) return;
    try {
      const d = await live.list();
      res.write('data: ' + JSON.stringify(d) + String.fromCharCode(10,10));
    } catch (e) { /* اتصال قطع شده */ }
  };
  const onChange = () => { send(); };
  live.bus.on('change', onChange);
  const beat = setInterval(() => { if (!closed) res.write(': ping' + String.fromCharCode(10,10)); }, 25000);
  send();
  req.on('close', () => { closed = true; clearInterval(beat); live.bus.off('change', onChange); });
});

// «کارهای من» (روال ساده): یک صف + یک اقدام مشترک
router.get('/mydesk', ok((req) => myDesk.feed(req.user, req.query)));
router.post('/mydesk/act', ok((req) => myDesk.act(req.user, req.body || {})));

// «میز کار مشاور»: همه‌ی تماس‌ها، فرم‌های همکاری و لیدهای وردست در یک فهرست
router.get('/desk', ok((req) => deskService.feed(req.user, req.query)));
router.post('/leads/:id/intake-done', ok((req) => deskService.markIntakeDone(req.user, req.params.id, req.body && req.body.note)));

// ---------- پرونده‌ی مشتری: سابقه‌ی یک‌جا، گروه پشتیبان، ترجیح تماس، در حال کار توسط ----------
router.get('/leads/:id/file', ok((req) => fileService.info(req.user, req.params.id)));
router.get('/leads/:id/timeline', ok(async (req) => ({ items: await fileService.timeline(req.user, req.params.id) })));
router.delete('/leads/:id/sales/:itemId', ok((req) => fileService.deleteSale(req.user, req.params.id, req.params.itemId, req.body && req.body.reason)));
router.patch('/leads/:id/timeline/:itemId', ok((req) => fileService.editTimelineItem(req.user, req.params.id, req.params.itemId, req.body)));
router.get('/leads/:id/price-inquiries', ok(async (req) => {
  const lead = await leadService.getOwnedLead(req.user, req.params.id);
  return require('../services/priceInquiryService').history(lead.phone);
}));
router.put('/leads/:id/support-group', ok((req) => fileService.updateSupportGroup(req.user, req.params.id, req.body)));
router.post('/leads/:id/presence', ok(async (req) => ({ presence: fileService.setPresence(req.user, req.params.id, req.body && req.body.action) })));
router.delete('/leads/:id/presence', ok(async (req) => { fileService.clearPresence(req.user, req.params.id); return { ok: true }; }));
// مرحله‌ی مشتری: بستن پله‌ی «رد شد» و ثبت اولین خرید
router.post('/leads/:id/reject-notified', ok((req) => fileService.markRejectNotified(req.user, req.params.id, req.body && req.body.how)));
router.post('/leads/:id/stop-followup', ok((req) => fileService.stopFollowUp(req.user, req.params.id, req.body && req.body.reason)));
router.delete('/leads/:id/notes/:noteId', ok((req) => fileService.deleteNote(req.user, req.params.id, req.params.noteId)));
router.post('/leads/:id/notes', ok((req) => fileService.addNote(req.user, req.params.id, req.body && req.body.text)));
router.post('/leads/:id/next-followup', ok((req) => fileService.setNextFollowUp(req.user, req.params.id, req.body)));
router.post('/leads/:id/resume-followup', ok((req) => fileService.resumeFollowUp(req.user, req.params.id, req.body && req.body.note)));
router.post('/leads/:id/purchased', ok((req) => fileService.markPurchased(req.user, req.params.id, req.body && req.body.saleReason, req.body && req.body.sale)));
router.post('/badges', ok(async (req) => {
  const ids = (Array.isArray(req.body && req.body.ids) ? req.body.ids : []).map(String).slice(0, 500);
  const leads = ids.length ? await prisma.lead.findMany({ where: { id: { in: ids } }, select: { id: true, phone: true, supportGroupPlatform: true } }) : [];
  return { badges: await fileService.badgesFor(req.user, leads) };
}));

// فهرست کارکنان فعال (برای تعیین مسئول، مسئول وظیفه و فیلتر گزارش‌ها)
router.get('/staff', ok(async () => ({
  staff: await prisma.user.findMany({ where: { isActive: true, username: { not: '__queue__' } }, select: { id: true, fullName: true }, orderBy: { fullName: 'asc' } }),
})));

// ---------- پرونده ----------
router.get('/leads/:id/audits', ok(async (req) => {
  await leadService.getOwnedLead(req.user, req.params.id);
  return { audits: await auditService.listForLead(req.params.id) };
}));
router.get('/leads/:id/tasks', ok(async (req) => ({ tasks: await taskService.listForLead(req.user, req.params.id) })));
router.post('/leads/:id/tasks', ok(async (req) => ({ task: await taskService.create(req.user, req.params.id, req.body) })));
router.post('/leads/:id/claim', ok(async (req) => ({ lead: await leadService.claimLead(req.user, req.params.id) })));
router.post('/leads/:id/assign', ok(async (req) => ({ lead: await leadService.assignLead(req.user, req.params.id, req.body && req.body.ownerId, req.body && req.body.reason) })));

router.get('/leads/:id/sms', ok(async (req) => {
  await leadService.getOwnedLead(req.user, req.params.id);
  return { sms: await smsService.listForLead(req.params.id), configured: await smsService.configured() };
}));
router.post('/leads/:id/sms', requirePerm('sms_send'), ok(async (req) => {
  const lead = await leadService.getOwnedLead(req.user, req.params.id);
  const b = req.body || {};
  const r = await smsService.send({ phone: lead.phone, body: b.body, leadId: lead.id, userId: req.user.id, topic: b.topic || null });
  await auditService.log(lead.id, req.user.id, 'sms', (b.title || b.topic || 'پیامک') + (r.status === 'manual' ? ' (دستی)' : r.status === 'failed' ? ' (ناموفق)' : ''));
  return r;
}));

// ---------- احراز هویت همکار ----------
router.get('/nav-counts', ok((req) => kycService.newArrivals(req.query)));
router.get('/kyc', ok(async (req) => kycService.queue(req.user, req.query.status, { offset: req.query.offset, limit: req.query.limit, q: req.query.q })));
router.get('/leads/:id/kyc/documents', ok(async (req) => {
  const r = await kycService.documents(req.user, req.params.id);
  return { documents: r.docs, linkSent: r.linkSent };
}));
router.delete('/kyc/documents/:docId', ok(async (req) => kycService.removeDocument(req.user, req.params.docId)));
router.get('/kyc/documents/:docId', asyncRoute(async (req, res) => {
  // ?thumb=1 ← نسخه‌ی کوچک برای نمایش در صفحه؛ بدون آن، عکس اصلی (کلیک روی عکس)
  const thumb = req.query.thumb === '1';
  const f = thumb ? await kycService.documentThumb(req.user, req.params.docId) : await kycService.documentFile(req.user, req.params.docId);
  // نسخه‌ی کوچک تا یک ساعت در حافظه‌ی مرورگر می‌ماند (فقط برای همین کاربر) تا با هر بار باز شدن دوباره دانلود نشود
  res.set('Cache-Control', thumb ? 'private, max-age=3600' : 'private, no-store');
  res.type(f.mime).sendFile(f.path);
}));
router.post('/leads/:id/kyc/link', ok((req) => kycService.sendLink(req.user, req.params.id, req, req.body)));
router.post('/leads/:id/kyc/remind', ok((req) => kycService.remind(req.user, req.params.id, req, req.body)));
router.post('/leads/:id/kyc/sms-preview', ok((req) => kycService.smsPreview(req.user, req.params.id, req.body && req.body.action, req.body && req.body.reason)));
router.post('/leads/:id/kyc/approve', ok((req) => kycService.approve(req.user, req.params.id, req.body)));
router.post('/leads/:id/kyc/reject', ok((req) => kycService.reject(req.user, req.params.id, req.body && req.body.reason, req, req.body)));
router.post('/leads/:id/kyc/reopen', ok((req) => kycService.reopen(req.user, req.params.id, req.body && req.body.reason)));

// ---------- وظیفه‌ها ----------
router.get('/tasks', ok(async (req) => ({ tasks: await taskService.list(req.user, req.query) })));
router.patch('/tasks/:id', ok(async (req) => ({ task: await taskService.setStatus(req.user, req.params.id, !!(req.body && req.body.done)) })));

// ---------- گزارش به مدیر فروش ----------
router.get('/sales-reports', ok((req) => reportService.list(req.user, req.query)));
router.post('/sales-reports', ok(async (req) => ({ report: await reportService.create(req.user, req.body) })));
router.post('/sales-reports/:id/resolve', ok(async (req) => ({ report: await reportService.resolve(req.user, req.params.id, req.body && req.body.resolution) })));

// ---------- جمله‌های آماده و الگوهای پیامک ----------
router.get('/scripts', ok(async (req) => ({ scripts: await scriptService.list(req.query.kind || 'script', !(req.query.all && can(req.user, 'scripts_admin'))) })));
router.get('/choices', ok(async () => ({ choices: await scriptService.listChoices() })));
router.post('/choices', ok(async (req) => ({ choice: await scriptService.addChoice(req.user, req.body && req.body.key, req.body && req.body.label) })));
router.post('/scripts/quick', ok(async (req) => ({ script: await scriptService.quickAdd(req.user, req.body && req.body.kind, req.body) })));
router.post('/scripts', requirePerm('scripts_admin'), ok(async (req) => ({ script: await scriptService.create(req.user, req.body && req.body.kind, req.body) })));
router.put('/scripts/:id', requirePerm('scripts_admin'), ok(async (req) => ({ script: await scriptService.update(req.user, req.params.id, req.body) })));

// ---------- صف بدون مسئول ----------
router.get('/queue', ok(async () => ({ leads: await leadService.listQueue() })));

// ---------- اتصال وردست (تنظیمات) ----------
router.get('/vardast', requirePerm('settings'), ok(async (req) => ({
  configured: require('../services/vardastService').configured(),
  url: (process.env.PUBLIC_BASE_URL ? process.env.PUBLIC_BASE_URL.replace(/\/+$/, '') : req.protocol + '://' + req.get('host')) + '/api/v1/public/vardast',
  events: await require('../services/vardastService').recent(),
})));

// ---------- میز کار مدیر فروش ----------
router.get('/manager', requirePerm('sales_reports'), ok((req) => activityService.managerDesk(req.query)));

// ---------- گزارش اقدامات مشاوران ----------
router.get('/activity/summary', requirePerm('activity_report'), ok(async (req) => ({ rows: await activityService.summary(req.query) })));
router.get('/activity/log', requirePerm('activity_report'), ok(async (req) => ({ rows: await activityService.log(req.query) })));
router.get('/activity/excel', requirePerm('activity_report'), asyncRoute(async (req, res) => {
  const buf = await activityService.excel(req.query);
  res.set('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.set('Content-Disposition', "attachment; filename*=UTF-8''" + encodeURIComponent('اقدامات-مشاوران.xlsx'));
  res.send(buf);
}));

module.exports = router;
