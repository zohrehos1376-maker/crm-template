// «آمار کار کارشناسان» — شمارش واقعی کارها، روزبه‌روز و برای هر کارشناس (بدون نمره و رتبه).
// جمع‌زدن در shared/rep-stats.js است؛ این‌جا فقط ردیف‌های خام بازه خوانده می‌شود.
const { prisma } = require('../../../shared/prisma');
const S = require('../../../shared/rep-stats');
const { startOfTodayTehran } = require('../../../shared/consultant-desk');
const { parseOutcomes } = require('../../../shared/call-outcomes');
const { UNCONFIRMED_MARK } = require('../lib/followup-marks');

const DAY = 86400000;
const UNANSWERED = ['MISSED', 'REJECTED'];

function toMs(v, fallback) {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

// نام‌گذاری شماره‌ی خام: «اصلاح مشخصات» که نام را از خالی به چیزی عوض کرده، یا ثبت نام موقع ثبت تماس
function isNaming(a) {
  if (a.action === 'named') return true;
  try {
    return (JSON.parse(a.changes || '[]') || []).some((c) => c.field === 'customerName' && c.from === '—');
  } catch (e) {
    return false;
  }
}

async function daily(q) {
  const now = Date.now();
  const from = startOfTodayTehran(toMs(q && q.from, now));
  const to = Math.max(from + 1, toMs(q && q.to, now));
  const range = { gte: new Date(from), lte: new Date(to) };

  const [users, calls, followups, audits, kycAudits, pendingKyc, oldestPending] = await Promise.all([
    prisma.user.findMany({ select: { id: true, fullName: true, isActive: true } }),
    prisma.callLog.findMany({
      where: { startedAt: range },
      select: {
        operatorUserId: true, startedAt: true, direction: true, durationSec: true, logStatus: true, outcomes: true, callbackDone: true,
        productNote: true, note: true, leadId: true, phoneNormalized: true, callerName: true, lead: { select: { customerName: true } },
      },
    }),
    prisma.followup.findMany({ where: { createdAt: range, NOT: { content: { contains: UNCONFIRMED_MARK } } }, select: { userId: true, createdAt: true } }),
    prisma.leadAudit.findMany({
      where: { createdAt: range, OR: [{ action: 'named' }, { action: 'updated', changes: { contains: '"customerName"' } }] },
      select: { userId: true, createdAt: true, action: true, changes: true },
    }),
    prisma.leadAudit.findMany({
      where: { createdAt: range, action: { in: ['kyc_approved', 'kyc_rejected'] } },
      orderBy: { createdAt: 'desc' },
      select: { userId: true, createdAt: true, action: true, leadId: true, lead: { select: { customerName: true, phone: true, kycSubmittedAt: true } } },
    }),
    prisma.lead.count({ where: { kycStatus: 'pending' } }),
    prisma.lead.findFirst({ where: { kycStatus: 'pending', kycSubmittedAt: { not: null } }, orderBy: { kycSubmittedAt: 'asc' }, select: { kycSubmittedAt: true } }),
  ]);

  const names = new Map(users.map((u) => [u.id, u.fullName]));
  const callRows = calls.map((c) => ({
    userId: c.operatorUserId, at: c.startedAt.getTime(), direction: c.direction, durationSec: c.durationSec,
    logStatus: c.logStatus, outcomes: parseOutcomes(c.outcomes), callbackDone: c.callbackDone,
  }));
  const kycRows = kycAudits.map((a) => {
    const sub = a.lead && a.lead.kycSubmittedAt ? a.lead.kycSubmittedAt.getTime() : null;
    const at = a.createdAt.getTime();
    return {
      userId: a.userId, at, approved: a.action === 'kyc_approved',
      waitMs: sub && sub <= at ? at - sub : 0, hasWait: !!(sub && sub <= at),
      leadId: a.leadId, customer: (a.lead && a.lead.customerName) || '', phone: (a.lead && a.lead.phone) || '', submittedAt: sub,
    };
  });

  const stats = S.build({
    calls: callRows,
    followups: followups.map((f) => ({ userId: f.userId, at: f.createdAt.getTime() })),
    named: audits.filter(isNaming).map((a) => ({ userId: a.userId, at: a.createdAt.getTime() })),
    // مدت انتظار فقط وقتی معلوم است (تاریخ ارسال مدرک قبل از تأیید) در میانگین می‌آید
    kyc: kycRows.map((k) => ({ userId: k.userId, at: k.at, approved: k.approved, waitMs: k.approved && k.hasWait ? k.waitMs : 0 })),
  });
  const named = (list) => {
    list.forEach((r) => { r.name = names.get(r.userId) || 'نامشخص'; });
    list.sort((a, b) => a.name.localeCompare(b.name, 'fa'));
  };
  stats.days.forEach((d) => named(d.reps));
  named(stats.reps);
  // تعداد تأییدهایی که مدت انتظارشان معلوم است — مخرج میانگین
  const waitCount = {};
  for (const k of kycRows) if (k.approved && k.hasWait && k.userId) waitCount[k.userId] = (waitCount[k.userId] || 0) + 1;
  stats.reps.forEach((r) => { r.kycWaitCount = waitCount[r.userId] || 0; });
  stats.total.kycWaitCount = Object.values(waitCount).reduce((a, b) => a + b, 0);

  const answered = calls.filter((c) => !UNANSWERED.includes(c.direction));
  const customer = (c) => (c.lead && c.lead.customerName) || c.callerName || '';
  const listOf = (code) => answered
    .filter((c) => parseOutcomes(c.outcomes).includes(code))
    .sort((a, b) => b.startedAt - a.startedAt)
    .map((c) => ({ at: c.startedAt.getTime(), leadId: c.leadId, customer: customer(c), phone: c.phoneNormalized, product: c.productNote || '', note: c.note || '', by: names.get(c.operatorUserId) || '' }));

  return {
    from,
    to,
    days: stats.days,
    reps: stats.reps,
    total: stats.total,
    lists: {
      outOfStock: listOf('out_of_stock'),
      objections: listOf('price_objection'),
      kyc: kycRows.map((k) => Object.assign(k, { by: names.get(k.userId) || '' })),
    },
    kycNow: { pending: pendingKyc, oldestSince: oldestPending && oldestPending.kycSubmittedAt ? oldestPending.kycSubmittedAt.getTime() : null },
  };
}

module.exports = { daily, DAY };
