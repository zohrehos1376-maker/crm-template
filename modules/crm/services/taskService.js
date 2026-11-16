// وظیفه‌های مستقل روی مشتری (موضوع آماده + موعد + مسئول) — جدول lead_tasks
const { prisma } = require('../../../shared/prisma');
const { can } = require('../../../shared/permissions');
const { TASK_TOPICS, labelOf } = require('../../../shared/workdesk');
const leadService = require('./leadService');
const audit = require('./auditService');

function fail(status, message) {
  const e = new Error(message);
  e.status = status;
  return e;
}

function taskOut(t, names) {
  return {
    id: t.id,
    leadId: t.leadId,
    leadName: t.lead ? t.lead.customerName || '' : '',
    leadPhone: t.lead ? t.lead.phone : '',
    topic: t.topic,
    topicLabel: labelOf(TASK_TOPICS, t.topic),
    note: t.note || '',
    dueAt: t.dueAt.getTime(),
    status: t.status,
    overdue: t.status === 'open' && t.dueAt < new Date(),
    assigneeId: t.assigneeId,
    assigneeName: names.get(t.assigneeId) || '',
    createdByName: names.get(t.createdBy) || '',
    doneAt: t.doneAt ? t.doneAt.getTime() : null,
    createdAt: t.createdAt.getTime(),
  };
}

async function out(rows) {
  const names = await audit.userNames(rows.flatMap((r) => [r.assigneeId, r.createdBy]));
  return rows.map((r) => taskOut(r, names));
}

const INCLUDE = { lead: { select: { customerName: true, phone: true } } };

async function create(user, leadId, body) {
  const lead = await leadService.getOwnedLead(user, leadId);
  const b = body || {};
  if (!TASK_TOPICS.some((t) => t.code === b.topic)) throw fail(400, 'موضوع وظیفه را انتخاب کنید');
  const dueAt = new Date(Number(b.dueAt) || b.dueAt);
  if (isNaN(dueAt.getTime())) throw fail(400, 'موعد وظیفه را انتخاب کنید');
  let assigneeId = user.id;
  if (b.assigneeId && b.assigneeId !== user.id) {
    if (!can(user, 'all_leads')) throw fail(403, 'وظیفه برای دیگران فقط با دسترسی «همه‌ی مشتری‌ها»');
    const a = await prisma.user.findFirst({ where: { id: String(b.assigneeId), isActive: true } });
    if (!a) throw fail(400, 'مسئول وظیفه نامعتبر است');
    assigneeId = a.id;
  }
  const row = await prisma.leadTask.create({
    data: { leadId: lead.id, assigneeId, createdBy: user.id, topic: b.topic, note: String(b.note || '').trim().slice(0, 2000) || null, dueAt },
    include: INCLUDE,
  });
  await audit.log(lead.id, user.id, 'task_created', labelOf(TASK_TOPICS, b.topic));
  return (await out([row]))[0];
}

async function listForLead(user, leadId) {
  await leadService.getOwnedLead(user, leadId);
  return out(await prisma.leadTask.findMany({ where: { leadId }, include: INCLUDE, orderBy: [{ status: 'desc' }, { dueAt: 'asc' }] }));
}

// کارتابل وظیفه‌ها: کارشناس فقط مال خودش؛ مدیر همه یا یک نفر
async function list(user, q) {
  const where = {};
  if (!can(user, 'all_leads')) where.assigneeId = user.id;
  else if (q && q.assigneeId) where.assigneeId = String(q.assigneeId);
  const status = (q && q.status) || 'open';
  if (status === 'open' || status === 'done') where.status = status;
  if (status === 'overdue') Object.assign(where, { status: 'open', dueAt: { lt: new Date() } });
  return out(await prisma.leadTask.findMany({ where, include: INCLUDE, orderBy: { dueAt: status === 'done' ? 'desc' : 'asc' }, take: 300 }));
}

async function setStatus(user, id, done) {
  const t = await prisma.leadTask.findUnique({ where: { id } });
  if (!t) throw fail(404, 'وظیفه پیدا نشد');
  if (t.assigneeId !== user.id && !can(user, 'all_leads')) throw fail(404, 'وظیفه پیدا نشد');
  const row = await prisma.leadTask.update({
    where: { id },
    data: done ? { status: 'done', doneAt: new Date(), doneBy: user.id } : { status: 'open', doneAt: null, doneBy: null },
    include: INCLUDE,
  });
  await audit.log(t.leadId, user.id, done ? 'task_done' : 'task_reopened', labelOf(TASK_TOPICS, t.topic));
  return (await out([row]))[0];
}

async function counts(user) {
  const where = can(user, 'all_leads') ? {} : { assigneeId: user.id };
  const [open, overdue] = await Promise.all([
    prisma.leadTask.count({ where: Object.assign({ status: 'open' }, where) }),
    prisma.leadTask.count({ where: Object.assign({ status: 'open', dueAt: { lt: new Date() } }, where) }),
  ]);
  return { open, overdue };
}

module.exports = { create, listForLead, list, setStatus, counts };
