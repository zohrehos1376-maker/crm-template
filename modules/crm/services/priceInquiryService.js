// روال مشتریِ «فقط قیمت پرسید» — تصمیم در shared/price-inquiry.js
//   ۳ بار در یک روز → همان روز یادآوری؛ ۳ بار در روزهای مختلف → فردا تماس عارضه‌یابی
// جایی صدا زده می‌شود که تماسی با نتیجه‌ی «فقط استعلام قیمت» ثبت شده باشد.
const { prisma } = require('../../../shared/prisma');
const PI = require('../../../shared/price-inquiry');
const { startOfTodayTehran } = require('../../../shared/consultant-desk');
const audit = require('./auditService');

const CLOSED = ['فروش ناموفق'];
// بی‌پاسخ/قطع‌شده هیچ‌وقت خودش نباید شمرده شود: وقتی کارشناس تماس برگشتی را «استعلام قیمت» می‌زند،
// callService.logLinkedCalls همان نتیجه را روی بی‌پاسخ‌های قبلیِ همین شماره هم کپی می‌کند (تا دوباره
// «باید زنگ زد» نمانند) — اگر این‌ها هم شمرده شوند، یک تماسِ واقعی به‌اندازه‌ی تعداد بی‌پاسخ‌هایش شمرده می‌شود.
const UNANSWERED = ['MISSED', 'REJECTED'];

function inquiryWhere(phone, since) {
  const w = { phoneNormalized: phone, outcomes: { contains: 'price_inquiry' }, direction: { notIn: UNANSWERED } };
  if (since) w.startedAt = { gte: since };
  return w;
}

async function countInquiries(phone, since) {
  if (!phone || phone === 'unknown') return 0;
  return prisma.callLog.count({ where: inquiryWhere(phone, since) });
}

// همه‌ی استعلام‌های یک شماره، روزبه‌روز — برای پرونده‌ی مشتری
async function history(phone) {
  if (!phone || phone === 'unknown') return { total: 0, days: [] };
  const rows = await prisma.callLog.findMany({
    where: inquiryWhere(phone),
    orderBy: { startedAt: 'desc' },
    take: 500,
    select: { id: true, startedAt: true, note: true, productNote: true, operator: { select: { fullName: true } } },
  });
  const calls = rows.map((r) => ({ id: r.id, at: r.startedAt.getTime(), note: r.note || '', productNote: r.productNote || '', operatorName: r.operator ? r.operator.fullName : '' }));
  return { total: calls.length, days: PI.groupByDay(calls) };
}

// opts.explicitNext = کارشناس خودش تاریخ گذاشته → تاریخ او دست نمی‌خورد
async function apply(leadId, phone, userId, opts) {
  if (!leadId) return null;
  const lead = await prisma.lead.findUnique({
    where: { id: leadId },
    select: { id: true, customerName: true, phone: true, status: true, firstPurchaseAt: true },
  });
  if (!lead) return null;
  const p = phone || lead.phone;
  const [count, todayCount] = await Promise.all([countInquiries(p), countInquiries(p, new Date(startOfTodayTehran()))]);
  const d = PI.decide(count, { todayCount, purchased: !!lead.firstPurchaseAt, closed: CLOSED.includes(lead.status) });
  const out = { count, todayCount, sms: null, followUp: null };

  if (d.followUp && !(opts && opts.explicitNext)) {
    await prisma.lead.update({
      where: { id: lead.id },
      data: { nextFollowUpDate: d.followUp.date, nextFollowUpNote: d.followUp.note, updatedAt: new Date() },
    });
    out.followUp = d.followUp;
    await audit.log(lead.id, userId, 'followup', d.followUp.note);
  }
  return out;
}

module.exports = { apply, countInquiries, history };
