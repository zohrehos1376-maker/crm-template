// گزارش اقدامات مشاوران: خلاصه‌ی هر نفر در بازه + فهرست کامل کارها (از سابقه‌ی پرونده‌ها) با خروجی اکسل
const { prisma } = require('../../../shared/prisma');
const CustomerStage = require('../../../shared/customer-stage');
const { AUDIT_ACTIONS, TASK_TOPICS, labelOf } = require('../../../shared/workdesk');
const audit = require('./auditService');
const { buildWorkbookXlsx } = require('../../../shared/xlsx');
const Jalali = require('../../../shared/jalali');

function range(q) {
  const to = q && q.to ? new Date(Number(q.to)) : new Date();
  const from = q && q.from ? new Date(Number(q.from)) : new Date(to.getTime() - 7 * 86400000);
  return { gte: from, lte: to };
}

async function summary(q) {
  const r = range(q);
  const userWhere = q && q.userId ? { id: String(q.userId) } : { isActive: true, username: { not: '__queue__' } };
  const users = await prisma.user.findMany({ where: userWhere, select: { id: true, fullName: true }, orderBy: { fullName: 'asc' } });
  const ids = users.map((u) => u.id);
  const by = (rows, key) => new Map(rows.map((x) => [x[key], x._count._all]));
  const [calls, answered, audits, tasks, reports, kycOk, kycNo, smsRows] = await Promise.all([
    prisma.callLog.groupBy({ by: ['operatorUserId'], where: { operatorUserId: { in: ids }, logStatus: 'LOGGED', startedAt: r }, _count: { _all: true } }),
    prisma.callLog.groupBy({ by: ['operatorUserId'], where: { operatorUserId: { in: ids }, direction: { in: ['INCOMING', 'OUTGOING'] }, durationSec: { gt: 0 }, startedAt: r }, _count: { _all: true } }),
    prisma.leadAudit.groupBy({ by: ['userId'], where: { userId: { in: ids }, createdAt: r }, _count: { _all: true } }),
    prisma.leadTask.groupBy({ by: ['doneBy'], where: { doneBy: { in: ids }, doneAt: r }, _count: { _all: true } }),
    prisma.salesReport.groupBy({ by: ['createdBy'], where: { createdBy: { in: ids }, createdAt: r }, _count: { _all: true } }),
    prisma.leadAudit.groupBy({ by: ['userId'], where: { userId: { in: ids }, action: 'kyc_approved', createdAt: r }, _count: { _all: true } }),
    prisma.leadAudit.groupBy({ by: ['userId'], where: { userId: { in: ids }, action: 'kyc_rejected', createdAt: r }, _count: { _all: true } }),
    prisma.smsLog.groupBy({ by: ['userId'], where: { userId: { in: ids }, createdAt: r }, _count: { _all: true } }),
  ]);
  const m = { calls: by(calls, 'operatorUserId'), answered: by(answered, 'operatorUserId'), audits: by(audits, 'userId'), tasks: by(tasks, 'doneBy'), reports: by(reports, 'createdBy'), kycOk: by(kycOk, 'userId'), kycNo: by(kycNo, 'userId'), sms: by(smsRows, 'userId') };
  return users
    .map((u) => ({
      userId: u.id,
      name: u.fullName,
      callsLogged: m.calls.get(u.id) || 0,
      callsAnswered: m.answered.get(u.id) || 0,
      actions: m.audits.get(u.id) || 0,
      tasksDone: m.tasks.get(u.id) || 0,
      reports: m.reports.get(u.id) || 0,
      kycApproved: m.kycOk.get(u.id) || 0,
      kycRejected: m.kycNo.get(u.id) || 0,
      sms: m.sms.get(u.id) || 0,
    }))
    .filter((x) => q && q.userId ? true : x.actions || x.callsLogged || x.callsAnswered);
}

async function log(q) {
  const where = { createdAt: range(q), userId: q && q.userId ? String(q.userId) : { not: null } };
  const rows = await prisma.leadAudit.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: Math.min(Number(q && q.limit) || 500, 5000),
    include: { lead: { select: { customerName: true, phone: true } } },
  });
  const names = await audit.userNames(rows.map((r) => r.userId));
  return rows.map((r) => Object.assign(audit.auditOut(r, names), { leadId: r.leadId, leadName: r.lead ? r.lead.customerName || '' : '', phone: r.lead ? r.lead.phone : '' }));
}

async function excel(q) {
  const rows = await log(Object.assign({}, q, { limit: 5000 }));
  const fmt = (ms) => Jalali.formatDate(new Date(ms)) + ' ' + new Date(ms).toLocaleTimeString('fa-IR', { timeZone: 'Asia/Tehran', hour: '2-digit', minute: '2-digit' });
  return buildWorkbookXlsx(
    'اقدامات مشاوران',
    ['زمان', 'مشاور', 'اقدام', 'مشتری', 'شماره', 'توضیح'],
    rows.map((r) => [
      fmt(r.createdAt),
      r.userName,
      AUDIT_ACTIONS[r.action] || r.action,
      r.leadName,
      r.phone,
      [r.summary].concat(r.changes.map((c) => c.label + ': ' + c.from + ' ← ' + c.to)).filter(Boolean).join(' | '),
    ])
  );
}

// میز کار مدیر فروش: کارت‌های بازه، عملکرد تیم، ورودی‌های احراز، نزدیک‌ترین وظیفه‌های باز
async function managerDesk(q) {
  const r = range(q);
  const userFilter = q && q.userId ? String(q.userId) : null;
  const branchId = q && q.branchId ? String(q.branchId) : null;
  const users = await prisma.user.findMany({
    where: Object.assign({ isActive: true, username: { not: '__queue__' } }, userFilter ? { id: userFilter } : {}, branchId ? { branchId } : {}),
    select: { id: true, fullName: true },
    orderBy: { fullName: 'asc' },
  });
  const ids = users.map((u) => u.id);
  const now = new Date();
  const by = (rows, key) => new Map(rows.map((x) => [x[key], x._count._all]));
  const [calls, followups, reports, overdue, kycOk] = await Promise.all([
    prisma.callLog.groupBy({ by: ['operatorUserId'], where: { operatorUserId: { in: ids }, logStatus: 'LOGGED', startedAt: r }, _count: { _all: true } }),
    prisma.followup.groupBy({ by: ['userId'], where: { userId: { in: ids }, followupDate: r }, _count: { _all: true } }),
    prisma.salesReport.groupBy({ by: ['createdBy'], where: { createdBy: { in: ids }, createdAt: r }, _count: { _all: true } }),
    prisma.leadTask.groupBy({ by: ['assigneeId'], where: { assigneeId: { in: ids }, status: 'open', dueAt: { lt: now } }, _count: { _all: true } }),
    prisma.leadAudit.groupBy({ by: ['userId'], where: { userId: { in: ids }, action: 'kyc_approved', createdAt: r }, _count: { _all: true } }),
  ]);
  const m = { calls: by(calls, 'operatorUserId'), followups: by(followups, 'userId'), reports: by(reports, 'createdBy'), overdue: by(overdue, 'assigneeId'), kycOk: by(kycOk, 'userId') };
  const team = users
    .map((u) => ({ userId: u.id, name: u.fullName, calls: m.calls.get(u.id) || 0, followups: m.followups.get(u.id) || 0, reports: m.reports.get(u.id) || 0, overdue: m.overdue.get(u.id) || 0, kycApproved: m.kycOk.get(u.id) || 0 }))
    .filter((x) => userFilter || x.calls || x.followups || x.reports || x.overdue || x.kycApproved)
    .sort((a, b) => b.reports - a.reports || b.calls - a.calls);
  const sum = (k) => team.reduce((t, x) => t + x[k], 0);
  const [reportsOpen, kycPending, kycForms, kycLinks, nextTasks] = await Promise.all([
    prisma.salesReport.count({ where: { status: 'open' } }),
    prisma.lead.count({ where: { kycStatus: 'pending' } }),
    prisma.lead.count({ where: { kycSubmittedAt: { not: null } } }),
    prisma.leadAudit.count({ where: { action: { in: ['kyc_link', 'kyc_remind', 'kyc_rejected'] } } }),
    prisma.leadTask.findMany({
      where: Object.assign({ status: 'open' }, userFilter || branchId ? { assigneeId: { in: ids } } : {}),
      orderBy: { dueAt: 'asc' },
      take: 12,
      include: { lead: { select: { customerName: true, phone: true } } },
    }),
  ]);
  const names = await audit.userNames(nextTasks.map((t) => t.assigneeId));
  // قیف فروش: چند همکار به هر پله رسیده (shared/customer-stage.js).
  // «غیرفعال» شمارش تجمعی را عوض نمی‌کند، پس آخرین فعالیت اینجا لازم نیست.
  const stageRows = await prisma.lead.findMany({
    where: branchId ? { branchId } : {},
    select: { kycStatus: true, kycRejectNotifiedAt: true, firstPurchaseAt: true, purchaseFollowStep: true, jobType: true, shopName: true },
  });
  return {
    funnel: CustomerStage.funnel(stageRows),
    kpis: { calls: sum('calls'), followups: sum('followups'), reports: sum('reports'), reportsOpen, overdue: sum('overdue') },
    kyc: { pending: kycPending, forms: kycForms, links: kycLinks },
    team,
    nextTasks: nextTasks.map((t) => ({
      id: t.id, leadId: t.leadId, leadName: t.lead ? t.lead.customerName || '' : '', leadPhone: t.lead ? t.lead.phone : '',
      topic: t.topic, topicLabel: labelOf(TASK_TOPICS, t.topic),
      note: t.note || '', dueAt: t.dueAt.getTime(), status: t.status, overdue: t.dueAt < now, assigneeId: t.assigneeId, assigneeName: names.get(t.assigneeId) || '',
    })),
    checkedAt: Date.now(),
  };
}

module.exports = { summary, log, excel, managerDesk };
