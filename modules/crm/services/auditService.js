// سابقه‌ی تغییرات پرونده‌ی مشتری — تنها جایی که جدول lead_audits نوشته/خوانده می‌شود.
// ثبت سابقه هیچ‌وقت نباید کار اصلی را خراب کند؛ پس خطایش فقط در لاگ سرور می‌آید.
const { prisma } = require('../../../shared/prisma');
const { AUDIT_ACTIONS, FIELD_LABELS } = require('../../../shared/workdesk');

function show(v) {
  if (v === null || v === undefined || v === '') return '—';
  if (v instanceof Date) return v.toISOString();
  if (Array.isArray(v)) return v.join('، ') || '—';
  return String(v);
}

// تفاوت دو نسخه‌ی پرونده، فقط روی فیلدهای قابل نمایش
function diff(before, after, nameOf) {
  const out = [];
  for (const field of Object.keys(FIELD_LABELS)) {
    if (!(field in after)) continue;
    let a = before ? before[field] : undefined;
    let b = after[field];
    if (field === 'ownerId' && nameOf) {
      a = nameOf(a);
      b = nameOf(b);
    }
    if (show(a) !== show(b)) out.push({ field, label: FIELD_LABELS[field], from: show(a), to: show(b) });
  }
  return out;
}

async function log(leadId, userId, action, summary, changes) {
  if (!leadId) return;
  try {
    await prisma.leadAudit.create({
      data: {
        leadId,
        userId: userId || null,
        action,
        summary: summary ? String(summary).slice(0, 190) : null,
        changes: changes && changes.length ? JSON.stringify(changes) : null,
      },
    });
  } catch (e) {
    console.error('[audit]', e.message);
  }
}

async function userNames(ids) {
  const list = [...new Set(ids.filter(Boolean))];
  if (!list.length) return new Map();
  const rows = await prisma.user.findMany({ where: { id: { in: list } }, select: { id: true, fullName: true } });
  return new Map(rows.map((u) => [u.id, u.fullName]));
}

function auditOut(r, names) {
  let changes = [];
  try {
    changes = r.changes ? JSON.parse(r.changes) : [];
  } catch (e) {
    changes = [];
  }
  return {
    id: r.id,
    action: r.action,
    actionLabel: AUDIT_ACTIONS[r.action] || r.action,
    summary: r.summary || '',
    changes,
    userId: r.userId,
    userName: names.get(r.userId) || 'سیستم',
    createdAt: r.createdAt.getTime(),
  };
}

async function listForLead(leadId) {
  const rows = await prisma.leadAudit.findMany({ where: { leadId }, orderBy: { createdAt: 'desc' }, take: 300 });
  const names = await userNames(rows.map((r) => r.userId));
  return rows.map((r) => auditOut(r, names));
}

module.exports = { log, diff, listForLead, userNames, auditOut };
