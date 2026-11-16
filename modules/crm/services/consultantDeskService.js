// «میز کار مشاور»: همه‌ی تماس‌ها، فرم‌های همکاری سایت و لیدهای وردست در یک فهرست، با منبع، زمان انتظار،
// وضعیت رسیدگی و اطلاعات مشتری؛ کارشناس روی هر ردیف کار لازم را انجام می‌دهد.
const { prisma } = require('../../../shared/prisma');
const { callOut, CALL_INCLUDE } = require('./callService');
const leadService = require('./leadService');
const fileService = require('./customerFileService');
const D = require('../../../shared/consultant-desk');

const LEAD_SELECT = { id: true, customerName: true, phone: true, city: true, shopName: true, jobType: true, kycStatus: true, kycReviewedAt: true, ownerId: true, tags: true, channel: true, supportGroupPlatform: true, createdAt: true, owner: { select: { fullName: true } } };

async function feed(user, query) {
  const q = query || {};
  const days = Math.min(Math.max(Number(q.days) || 3, 1), 30);
  const since = new Date(Date.now() - days * 86400000);
  const queue = await leadService.queueUser();
  const [calls, intakes] = await Promise.all([
    prisma.callLog.findMany({ where: { startedAt: { gte: since } }, include: CALL_INCLUDE, orderBy: { startedAt: 'desc' }, take: 1500 }),
    prisma.leadAudit.findMany({ where: { action: { in: ['intake', 'intake_vardast'] }, createdAt: { gte: since } }, orderBy: { createdAt: 'desc' }, take: 1000, include: { lead: { select: LEAD_SELECT } } }),
  ]);
  // اطلاعات مشتری هر شماره (برای تماس‌ها)
  const phones = [...new Set(calls.map((c) => c.phoneNormalized).filter((p) => p && p !== 'unknown'))];
  const leadsByPhone = new Map((phones.length ? await prisma.lead.findMany({ where: { phone: { in: phones } }, select: LEAD_SELECT }) : []).map((l) => [l.phone, l]));

  // «رسیدگی شد» فرم‌ها و لیدها: intake_done، یا «ثبت نتیجه» (desk_done) از تب وردست / کارهای من
  const intakeLeadIds = [...new Set(intakes.map((a) => a.leadId))];
  const doneRows = intakeLeadIds.length ? await prisma.leadAudit.findMany({ where: { action: { in: ['intake_done', 'desk_done'] }, leadId: { in: intakeLeadIds } }, orderBy: { createdAt: 'asc' } }) : [];
  const names = await require('./auditService').userNames(doneRows.map((d) => d.userId));
  const doneMap = {};
  doneRows.forEach((d) => { doneMap[d.leadId] = { at: d.createdAt.getTime(), by: names.get(d.userId) || '', note: d.summary || '' }; });
  const rows = D.buildRows(
    calls.map((c) => Object.assign(callOut(c), { logStatus: c.logStatus, callbackDone: c.callbackDone })),
    intakes.filter((a) => a.lead && !(a.action === 'intake' && require('./kycService').isRepeatOfApproved(a))).map((a) => ({ id: a.id, at: a.createdAt.getTime(), summary: a.summary || '', lead: a.lead, action: a.action, leadCreatedAt: a.lead.createdAt ? a.lead.createdAt.getTime() : null })),
    leadsByPhone,
    queue.id,
    doneMap
  );
  const leads = [];
  rows.forEach((r) => { if (r.leadId && !leads.some((l) => l.id === r.leadId)) leads.push({ id: r.leadId, phone: r.phone, supportGroupPlatform: r.supportGroup }); });
  const badges = await fileService.badgesFor(user, leads);
  rows.forEach((r) => { const b = badges[r.leadId]; if (b) Object.assign(r, { prefersCalls: b.prefersCalls, presence: b.presence }); });

  const stats = D.stats(rows);
  const visible = D.filter(rows, q.kind || 'all', q.q || '', q.status || '');
  return { rows: visible.slice(0, 400), total: visible.length, stats, days, lateMinutes: D.LATE_MINUTES };
}

// «رسیدگی شد» برای فرم همکاری یا لید وردست — به نام همان کارشناس در سابقه‌ی پرونده
async function markIntakeDone(user, leadId, note) {
  await leadService.getOwnedLead(user, leadId);
  // «رسیدگی شد» بدون نوشتن اقدام ممکن نیست — لید بی‌سابقه گم نشود
  const done = String(note || '').trim();
  if (!done) {
    const e = new Error('اقدامی که انجام دادید را انتخاب و ثبت کنید');
    e.status = 400;
    throw e;
  }
  await require('./auditService').log(leadId, user.id, 'intake_done', done.slice(0, 190));
  return { ok: true };
}

module.exports = { feed, markIntakeDone };
