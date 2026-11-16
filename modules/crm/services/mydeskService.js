// «کارهای من» — روال ساده‌ی CRM نمونه (تصمیم کاربر، ۱۴۰۵/۰۸/۰۹):
// یک صف برای کارشناس (تماس بی‌پاسخ، تماس ثبت‌نشده، لید فرم همکاری/وردست، پیگیری سررسیدشده)
// و یک اقدام مشترک: «چه شد؟» + توضیح + «بعدش؟» (پیگیری با تاریخ / خرید کرد / بستن با دلیل).
// هیچ مشتری‌ای بدون قدم بعدی نمی‌ماند؛ شمارنده‌ی «بدون قدم بعدی» تورِ ایمنی است.
const { prisma } = require('../../../shared/prisma');
const { can } = require('../../../shared/permissions');
const leadService = require('./leadService');
const callService = require('./callService');
const kycService = require('./kycService');
const auditService = require('./auditService');
const fileService = require('./customerFileService');
const Jalali = require('../../../shared/jalali');
const Cycle = require('../../../shared/purchase-cycle');

const DAY = 86400000;
const UNANSWERED = ['MISSED', 'REJECTED'];
const CLOSED = 'فروش ناموفق';
const WON = 'فروش موفق';

// «چه شد؟» — چهار دکمه‌ی بزرگ؛ هر کدام به نتیجه‌ی تماس موجود وصل است
const RESULTS = [
  { code: 'price', label: 'قیمت دادم', outcome: 'price_inquiry', days: 3 },
  { code: 'order', label: 'سفارش داد', outcome: 'order', days: 1 },
  { code: 'noanswer', label: 'جواب نداد', outcome: 'callback', days: 1 },
  { code: 'irrelevant', label: 'بی‌ربط بود', outcome: 'irrelevant', days: 0 },
];
const RESULT = Object.fromEntries(RESULTS.map((r) => [r.code, r]));

function fail(status, message) {
  const e = new Error(message);
  e.status = status;
  return e;
}
function endOfToday() {
  const d = new Date();
  d.setHours(23, 59, 59, 999);
  return d;
}
function atTen(days) {
  const d = new Date(Date.now() + Number(days || 0) * DAY);
  d.setHours(10, 0, 0, 0);
  return d;
}

const LEAD_SELECT = {
  id: true, customerName: true, phone: true, city: true, shopName: true, jobType: true, kycStatus: true,
  ownerId: true, status: true, channel: true, tags: true, nextFollowUpDate: true, nextFollowUpNote: true,
  firstPurchaseAt: true, owner: { select: { fullName: true } },
  kycReason: true, kycSubmittedAt: true, kycReviewedAt: true, createdAt: true, _count: { select: { kycDocuments: true } },
};

function sourceLabel(lead) {
  const ch = String(lead.channel || '');
  const tags = Array.isArray(lead.tags) ? lead.tags : [];
  if (tags.includes('وردست') || /وردست/.test(ch)) return 'وردست';
  if (/فرم/.test(ch)) return 'فرم همکاری سایت';
  return ch || 'پرونده';
}

async function feed(user, query) {
  const q = query || {};
  const days = Math.min(Math.max(Number(q.days) || 7, 1), 30);
  const since = new Date(Date.now() - days * DAY);
  const all = can(user, 'all_leads');
  const queue = await leadService.queueUser();
  // مسئول پرونده حذف شده — همه فرم‌های همکاری و پیگیری‌ها برای همه کارشناسان نمایش داده می‌شود
  const mineCall = all ? {} : { OR: [{ operatorUserId: user.id }, { leadId: null }] };
  const mineLead = {};

  const [calls, intakes, dueLeads, doneRows] = await Promise.all([
    prisma.callLog.findMany({
      where: {
        AND: [mineCall, { startedAt: { gte: since } }, {
          OR: [
            { direction: { in: UNANSWERED }, callbackDone: false },
            { direction: { in: ['INCOMING', 'OUTGOING'] }, logStatus: 'UNLOGGED' },
          ],
        }],
      },
      orderBy: { startedAt: 'desc' },
      take: 300,
      // همان داده‌ی کارت تب «تماس‌ها» (خط، کارشناس، پرونده) تا همان کارت و فرم اینجا هم کشیده شود
      include: Object.assign({}, callService.CALL_INCLUDE, { lead: { select: LEAD_SELECT } }),
    }),
    prisma.leadAudit.findMany({
      where: { action: { in: ['intake', 'intake_vardast'] }, createdAt: { gte: new Date(Date.now() - 30 * DAY) }, lead: mineLead },
      orderBy: { createdAt: 'desc' },
      take: 300,
      include: { lead: { select: LEAD_SELECT } },
    }),
    prisma.lead.findMany({
      where: { AND: [mineLead, { nextFollowUpDate: { lte: endOfToday() }, status: { notIn: [CLOSED] } }] },
      orderBy: { nextFollowUpDate: 'asc' },
      take: 200,
      select: LEAD_SELECT,
    }),
    prisma.leadAudit.findMany({
      where: { action: { in: ['desk_done'] }, userId: user.id, createdAt: { gte: new Date(Date.now() - DAY) } },
      orderBy: { createdAt: 'desc' },
      take: 20,
      include: { lead: { select: LEAD_SELECT } },
    }),
  ]);

  // لیدی که اقدامش ثبت شده دیگر در صف نیست (یا تاریخ پیگیری گرفته یا بسته شده)
  // تأیید یا رد احراز هم یعنی به فرم رسیدگی شده (کار بعدی‌اش، تماس یادآوری، خودش در صف می‌آید)
  const intakeIds = [...new Set(intakes.map((a) => a.leadId))];
  const handled = new Map();
  if (intakeIds.length) {
    const rows = await prisma.leadAudit.findMany({
      where: { leadId: { in: intakeIds }, action: { in: ['desk_done', 'intake_done', 'kyc_approved', 'kyc_rejected'] } },
      orderBy: { createdAt: 'asc' },
      select: { leadId: true, createdAt: true },
    });
    rows.forEach((r) => handled.set(r.leadId, r.createdAt.getTime()));
  }

  // مدارک کارت‌های فرم همکاری با یک پرس‌وجو، نه یک درخواست جدا برای هر کارت
  const intakeDocs = await kycService.docsByLead([...new Set(intakes.filter((a) => a.lead && a.lead._count && a.lead._count.kycDocuments).map((a) => a.leadId))]);

  const rows = [];
  const push = (r) => { if (!rows.some((x) => x.id === r.id)) rows.push(r); };
  // فرم همکاری/وردستی که همین‌جا با کارت کامل (شهر، رسته، مدارک) نشان داده می‌شود، دوباره
  // به‌شکل کارت ساده‌ی «پیگیری» (فقط یک خط متن) تکرار نشود — همان یک کارت کافی است.
  const intakeLeadIds = new Set();
  const leadBits = (lead) => (lead ? {
    leadId: lead.id, name: lead.customerName || '', city: lead.city || '', shop: lead.shopName || '',
    kyc: lead.kycStatus || 'none', owner: lead.ownerId === queue.id ? '' : (lead.owner ? lead.owner.fullName : ''),
  } : { leadId: null, name: '', city: '', shop: '', kyc: 'none', owner: '' });

  calls.forEach((c) => {
    const missed = UNANSWERED.includes(c.direction);
    push(Object.assign(leadBits(c.lead), {
      id: 'call-' + c.id, kind: 'call', callId: c.id, at: c.startedAt.getTime(),
      phone: c.phoneNormalized, tone: missed ? 'danger' : 'warn',
      label: missed ? 'تماس بی‌پاسخ' : c.direction === 'OUTGOING' ? 'تماس خروجی ثبت‌نشده' : 'تماس ثبت‌نشده',
      name: (c.lead && c.lead.customerName) || c.callerName || '',
      text: c.note || '',
      call: Object.assign(callService.callOut(c), { logStatus: c.logStatus, callbackDone: c.callbackDone }),
    }));
  });
  intakes.forEach((a) => {
    if (!a.lead) return;
    const done = handled.get(a.leadId);
    if (done && done >= a.createdAt.getTime()) return;
    // فرم همکاری‌ای که احرازش تأیید/رد شده دیگر کاری ندارد (کار بعدی = تماس یادآوری، جدا می‌آید).
    // مدارک تازه وضعیت را به «در انتظار بررسی» برمی‌گرداند، پس فرم دوباره دیده می‌شود.
    // لید وردست فقط وقتی کنار می‌رود که بررسی بعد از رسیدنش انجام شده باشد (پیام تازه = فرصت فروش).
    const reviewed = ['approved', 'rejected'].includes(a.lead.kycStatus);
    if (reviewed && a.action === 'intake') return;
    if (reviewed && a.lead.kycReviewedAt && a.lead.kycReviewedAt >= a.createdAt) return;
    if (a.lead.status === CLOSED) return;
    const l = a.lead;
    const at = a.createdAt.getTime();
    intakeLeadIds.add(l.id);
    push(Object.assign(leadBits(l), {
      id: 'intake-' + a.id, kind: 'intake', src: a.action === 'intake_vardast' ? 'vardast' : 'form', at, phone: l.phone,
      tone: 'accent', label: a.action === 'intake_vardast' ? 'وردست' : 'فرم همکاری سایت', text: a.summary || '',
      job: l.jobType || '', existing: l.createdAt.getTime() < at - 60000,
      // همان شکل ردیف تب «فرم‌های همکاری» (kyc-desk) تا همان کارت و دکمه‌ها اینجا هم کشیده شود
      kycLead: {
        id: l.id, name: l.customerName || '', phone: l.phone, shopName: l.shopName || '', city: l.city || '', jobType: l.jobType || '',
        kycStatus: l.kycStatus, kycReason: l.kycReason || '', submittedAt: l.kycSubmittedAt ? l.kycSubmittedAt.getTime() : null,
        receivedAt: at, documents: l._count ? l._count.kycDocuments : 0, docs: intakeDocs.get(l.id) || [], existing: l.createdAt.getTime() < at - 60000,
      },
    }));
  });
  dueLeads.forEach((l) => {
    if (intakeLeadIds.has(l.id)) return;
    push(Object.assign(leadBits(l), {
      id: 'followup-' + l.id, kind: 'followup', at: l.nextFollowUpDate.getTime(), phone: l.phone,
      tone: l.nextFollowUpDate.getTime() < Date.now() - DAY ? 'danger' : 'warn',
      label: l.nextFollowUpDate.getTime() < new Date().setHours(0, 0, 0, 0) ? 'پیگیری عقب‌افتاده' : 'پیگیری امروز',
      text: l.nextFollowUpNote || '',
    }));
  });

  // ترتیب: عقب‌افتاده‌ها (قرمز) ← فرم/وردست تازه ← پیگیری امروز ← تماس‌های ثبت‌نشده؛ داخل هر گروه تازه‌ترین بالا
  const RANK = (r) => (r.tone === 'danger' ? 0 : r.kind === 'intake' ? 1 : r.kind === 'followup' ? 2 : 3);
  rows.sort((a, b) => RANK(a) - RANK(b) || b.at - a.at);

  const done = doneRows.filter((d) => d.lead).map((d) => Object.assign(leadBits(d.lead), {
    id: 'done-' + d.id, kind: 'done', at: d.createdAt.getTime(), phone: d.lead.phone, tone: 'ok',
    label: 'انجام شد', text: d.summary || '',
    nextAt: d.lead.nextFollowUpDate ? d.lead.nextFollowUpDate.getTime() : null,
    next: d.lead.firstPurchaseAt ? 'خرید کرد' : d.lead.status === CLOSED ? 'بسته شد' : d.lead.nextFollowUpDate ? 'پیگیری' : '',
  }));

  const todo = rows.length;
  const overdue = rows.filter((r) => r.tone === 'danger').length;

  // تورِ ایمنی: پرونده‌ی باز بدون قدم بعدی (نه تاریخ پیگیری، نه خرید، نه بسته‌شده)
  const noNextWhere = {
    AND: [all ? { ownerId: { not: queue.id } } : { ownerId: user.id },
      { nextFollowUpDate: null, firstPurchaseAt: null, status: { notIn: [CLOSED, WON] } }],
  };
  const noNext = await prisma.lead.count({ where: noNextWhere });

  // نمای «بدون قدم بعدی»: همین پرونده‌ها در همین فهرست، با همان دکمه‌ی «رسیدگی»
  if (String(q.view || '') === 'nonext') {
    const leads = await prisma.lead.findMany({ where: noNextWhere, orderBy: { updatedAt: 'desc' }, take: 200, select: LEAD_SELECT });
    rows.length = 0;
    leads.forEach((l) => rows.push(Object.assign(leadBits(l), {
      id: 'lead-' + l.id, kind: 'lead', at: l.nextFollowUpDate ? l.nextFollowUpDate.getTime() : Date.now(),
      phone: l.phone, tone: 'warn', label: 'بدون قدم بعدی', text: sourceLabel(l),
    })));
  }

  // چه کسی همین حالا پرونده‌ی این مشتری را باز کرده است
  const leadsForBadge = [];
  rows.concat(done).forEach((r) => { if (r.leadId && !leadsForBadge.some((l) => l.id === r.leadId)) leadsForBadge.push({ id: r.leadId, phone: r.phone }); });
  const badges = await fileService.badgesFor(user, leadsForBadge);
  rows.concat(done).forEach((r) => { const b = badges[r.leadId]; if (b && b.presence) r.presence = b.presence; });

  const text = String(q.q || '').trim().toLowerCase();
  const match = (r) => !text || [r.name, r.phone, r.city, r.shop, r.text].join(' ').toLowerCase().includes(text);
  const visible = rows.filter(match);
  return {
    rows: visible.slice(0, 1000),
    total: visible.length,
    done: done.filter(match).slice(0, 10),
    results: RESULTS.map((r) => ({ code: r.code, label: r.label, days: r.days })),
    view: String(q.view || ''),
    counts: { todo, overdue, noNext },
    days,
  };
}

// قدم بعدی را روی پرونده می‌نشاند (یا پرونده را می‌بندد) — هیچ مشتری بدون قدم بعدی نمی‌ماند
async function applyNext(leadId, user, body, resultLabel) {
  if (!leadId) return '';
  const next = String(body.next || '');
  const note = String(body.note || '').trim();
  if (next === 'bought') {
    const lead = await prisma.lead.findUnique({ where: { id: leadId }, select: { firstPurchaseAt: true, kycStatus: true } });
    const at = new Date();
    // مشتری احراز‌نشده: فروش ثبت می‌شود ولی دلیلش اجباری است (docs/lead-stages-plan.md)
    if (lead && lead.kycStatus !== 'approved') {
      const why = String(body.saleReason || note || '').trim();
      if (why.length < 3) throw fail(400, 'این مشتری احراز نشده است؛ دلیل ثبت فروش را بنویسید');
      await auditService.log(leadId, user.id, 'sale_unverified', 'فروش به مشتری احراز‌نشده — ' + why.slice(0, 160), null);
    }
    // خرید = شروع دوباره‌ی چرخه‌ی پیگیری (۲ روز بعد پیگیری ارسال)، نه خالی شدن قدم بعدی
    await prisma.lead.update({
      where: { id: leadId },
      data: Object.assign({
        firstPurchaseAt: (lead && lead.firstPurchaseAt) || at, lastPurchaseAt: at,
        status: WON, cancelReason: null, updatedAt: at,
      }, Cycle.start(at)),
    });
    return 'خرید کرد';
  }
  if (next === 'close') {
    const why = note || String(body.closeReason || '').trim();
    if (!why) throw fail(400, 'دلیل بستن پرونده را بنویسید');
    await prisma.lead.update({
      where: { id: leadId },
      data: { status: CLOSED, cancelReason: why.slice(0, 500), nextFollowUpDate: null, nextFollowUpNote: null, purchaseFollowStep: null, updatedAt: new Date() },
    });
    return 'بسته شد';
  }
  const days = Math.min(Math.max(Number(body.days != null ? body.days : 3), 0), 120);
  const when = atTen(days);
  await prisma.lead.update({
    where: { id: leadId },
    data: {
      nextFollowUpDate: when,
      nextFollowUpNote: (note || resultLabel || 'پیگیری').slice(0, 190),
      updatedAt: new Date(),
    },
  });
  return 'پیگیری بعدی ' + Jalali.formatDate(when);
}

// یک اقدام برای همه‌ی ردیف‌ها
async function act(user, body) {
  const b = body || {};
  const res = RESULT[String(b.result || '')];
  if (!res) throw fail(400, 'اول بگویید چه شد');
  if (!['followup', 'bought', 'close'].includes(String(b.next || ''))) throw fail(400, 'قدم بعدی را انتخاب کنید');
  const note = String(b.note || '').trim();
  let leadId = b.leadId ? String(b.leadId) : null;
  let priceInquiry = null;

  if (b.callId) {
    const call = await callService.getCall(user, String(b.callId));
    if (res.code === 'irrelevant' && !call.leadId) {
      // تماس بی‌ربط: پرونده ساخته نمی‌شود، ولی دلیلش ثبت می‌شود
      await callService.markDismissed(user, call.id, true, note || res.label);
      return { ok: true, message: 'ثبت شد — پرونده ساخته نشد' };
    }
    const logged = await callService.logCall(call.id, {
      operatorUserId: user.id,
      callerName: String(b.name || call.callerName || call.leadName || '').trim(),
      note: note || res.label,
      outcomes: [res.outcome],
      followUpAt: '',
    }, { defaultOperatorId: user.id, explicitNext: true });
    leadId = logged.call && logged.call.leadId;
    priceInquiry = logged.priceInquiry || null;
  } else if (!leadId) {
    throw fail(400, 'ردیف نامعتبر است');
  } else {
    await leadService.getOwnedLead(user, leadId);
  }

  let nextText = await applyNext(leadId, user, b, res.label);
  // «قیمت دادم» + سومین استعلام: قدم بعدی به تماس عارضه‌یابیِ فردا تغییر می‌کند
  if (res.code === 'price' && b.next === 'followup' && b.days == null && leadId) {
    const pi = await require('./priceInquiryService').apply(leadId, null, user.id, { skipSms: true }).catch(() => null);
    if (pi && pi.followUp) nextText = 'پیگیری بعدی ' + Jalali.formatDate(pi.followUp.date) + ' — عارضه‌یابی';
  }
  await auditService.log(leadId, user.id, 'desk_done', [res.label, note, nextText].filter(Boolean).join(' — ').slice(0, 190));
  const smsNote = priceInquiry && priceInquiry.sms ? ' + پیامک لیست قیمت' + (priceInquiry.sms === 'manual' ? ' (دستی)' : priceInquiry.sms === 'failed' ? ' (ناموفق)' : '') : '';
  return { ok: true, message: 'ثبت شد — ' + (nextText || 'قدم بعدی گذاشته شد') + smsNote };
}

module.exports = { feed, act, RESULTS };
