// گزارش مشاور به مدیر فروش (علت عدم خرید، قیمت رقبا، کالای ناموجود، شکایت) و رسیدگی مدیر — جدول sales_reports
const { prisma } = require('../../../shared/prisma');
const { can } = require('../../../shared/permissions');
const { normalizePhone } = require('../../../shared/phone');
const { REPORT_KINDS, NO_PURCHASE_REASONS, labelOf } = require('../../../shared/workdesk');
const audit = require('./auditService');

function fail(status, message) {
  const e = new Error(message);
  e.status = status;
  return e;
}

const txt = (v, n) => String(v === undefined || v === null ? '' : v).trim().slice(0, n);
const num = (v) => {
  const n = Number(String(v || '').replace(/[^0-9]/g, ''));
  return n > 0 ? n : null;
};

// فقط فیلدهای مجاز هر نوع گزارش ذخیره می‌شوند
function cleanDetails(kind, d) {
  d = d || {};
  if (kind === 'no_purchase') {
    return { reason: NO_PURCHASE_REASONS.some((r) => r.code === d.reason) ? d.reason : 'other', product: txt(d.product, 191) };
  }
  if (kind === 'competitor_price') {
    return { product: txt(d.product, 191), ourPrice: num(d.ourPrice), competitor: txt(d.competitor, 120), competitorPrice: num(d.competitorPrice) };
  }
  if (kind === 'out_of_stock') return { product: txt(d.product, 191), quantity: num(d.quantity) };
  if (kind === 'complaint') return { subject: txt(d.subject, 191) };
  return {};
}

function reportOut(r, names) {
  let details = {};
  try {
    details = r.details ? JSON.parse(r.details) : {};
  } catch (e) {
    details = {};
  }
  return {
    id: r.id,
    leadId: r.leadId,
    leadName: r.lead ? r.lead.customerName || '' : '',
    phone: r.phone,
    kind: r.kind,
    kindLabel: labelOf(REPORT_KINDS, r.kind),
    details,
    reasonLabel: details.reason ? labelOf(NO_PURCHASE_REASONS, details.reason) : '',
    note: r.note || '',
    status: r.status,
    resolution: r.resolution || '',
    createdBy: r.createdBy,
    createdByName: names.get(r.createdBy) || '',
    reviewedByName: names.get(r.reviewedBy) || '',
    reviewedAt: r.reviewedAt ? r.reviewedAt.getTime() : null,
    createdAt: r.createdAt.getTime(),
  };
}

async function out(rows) {
  const names = await audit.userNames(rows.flatMap((r) => [r.createdBy, r.reviewedBy]));
  return rows.map((r) => reportOut(r, names));
}

const INCLUDE = { lead: { select: { customerName: true } } };

async function create(user, body) {
  const b = body || {};
  if (!REPORT_KINDS.some((k) => k.code === b.kind)) throw fail(400, 'نوع گزارش را انتخاب کنید');
  let leadId = null;
  let phone = normalizePhone(b.phone) || '';
  if (b.leadId) {
    const lead = await prisma.lead.findUnique({ where: { id: String(b.leadId) } });
    if (!lead || (!can(user, 'all_leads') && lead.ownerId !== user.id)) throw fail(404, 'مشتری پیدا نشد');
    leadId = lead.id;
    phone = lead.phone;
  }
  if (!phone) throw fail(400, 'برای ثبت گزارش، شماره‌ی مشتری لازم است');
  const details = cleanDetails(b.kind, b.details);
  if (b.kind === 'competitor_price' && !details.product) throw fail(400, 'کالا / مدل را بنویسید');
  if (b.kind === 'out_of_stock' && !details.product) throw fail(400, 'کالای درخواستی را بنویسید');
  const row = await prisma.salesReport.create({
    data: { leadId, phone, kind: b.kind, details: JSON.stringify(details), note: txt(b.note, 4000) || null, createdBy: user.id },
    include: INCLUDE,
  });
  await audit.log(leadId, user.id, 'report', labelOf(REPORT_KINDS, b.kind) + (details.product ? ': ' + details.product : ''));
  return (await out([row]))[0];
}

// مدیر فروش (دسترسی sales_reports) همه را می‌بیند؛ کارشناس فقط گزارش‌های خودش و پاسخ مدیر را
async function list(user, q) {
  q = q || {};
  const where = {};
  if (!can(user, 'sales_reports')) where.createdBy = user.id;
  else if (q.createdBy) where.createdBy = String(q.createdBy);
  else if (q.branchId) {
    const members = await prisma.user.findMany({ where: { branchId: String(q.branchId) }, select: { id: true } });
    where.createdBy = { in: members.map((m) => m.id) };
  }
  if (q.kind) where.kind = String(q.kind);
  if (q.status === 'open' || q.status === 'resolved') where.status = q.status;
  if (q.leadId) where.leadId = String(q.leadId);
  const from = q.from ? new Date(Number(q.from)) : null;
  const to = q.to ? new Date(Number(q.to)) : null;
  if (from || to) where.createdAt = Object.assign({}, from ? { gte: from } : {}, to ? { lte: to } : {});
  const rows = await prisma.salesReport.findMany({ where, include: INCLUDE, orderBy: { createdAt: 'desc' }, take: 500 });
  const open = await prisma.salesReport.count({ where: Object.assign({}, where, { status: 'open' }) });
  return { reports: await out(rows), open };
}

async function resolve(user, id, resolution) {
  if (!can(user, 'sales_reports')) throw fail(403, 'رسیدگی فقط با دسترسی «گزارش‌های مشاوران»');
  const text = txt(resolution, 4000);
  if (!text) throw fail(400, 'نتیجه‌ی رسیدگی را بنویسید');
  const r = await prisma.salesReport.findUnique({ where: { id } });
  if (!r) throw fail(404, 'گزارش پیدا نشد');
  const row = await prisma.salesReport.update({
    where: { id },
    data: { status: 'resolved', resolution: text, reviewedBy: user.id, reviewedAt: new Date() },
    include: INCLUDE,
  });
  await audit.log(r.leadId, user.id, 'report_resolved', text);
  return (await out([row]))[0];
}

module.exports = { create, list, resolve };
