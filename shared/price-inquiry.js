// روال مشتریِ «فقط قیمت پرسید» (تصمیم کاربر، ۱۴۰۵/۰۸/۱۷ — هیچ پیامکی بدون تأیید کارشناس نمی‌رود):
//   ۳ بار یا بیشتر در یک روز → همان روز یادآوری در فهرست کارهای کارشناس
//   ۳ بار یا بیشتر در روزهای مختلف → فردا تماس «عارضه‌یابی» (ساعتش مهم نیست، همان روز انجام شود)
//   یادآوری «لیست قیمت بفرستید» در استعلام دوم حذف شد.
// مشتری‌ای که خرید کرده از این روال بیرون است؛ چرخه‌ی بعد از خرید را دارد (shared/purchase-cycle.js).
const { startOfTodayTehran } = require('./consultant-desk');
const { toFaDigits } = require('./jalali');

const SAME_DAY_AT = 3;
const DIAGNOSE_AT = 3;
const DIAGNOSE_NOTE = 'عارضه‌یابی: چرا خرید نکرد؟ (۳ بار استعلام قیمت)';
const sameDayNote = (n) => 'امروز ' + toFaDigits(String(n)) + ' بار قیمت پرسید — همین امروز پیگیری کنید';

// فردا — بدون ساعت مشخص؛ از اول روز در فهرست کارها می‌نشیند و تا پایان روز وقت دارد
function tomorrow(from) {
  const d = from ? new Date(from) : new Date();
  d.setDate(d.getDate() + 1);
  d.setHours(0, 0, 0, 0);
  return d;
}

function today(from) {
  const d = from ? new Date(from) : new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

// count = همه‌ی تماس‌های «فقط استعلام قیمت» این شماره؛ opts.todayCount = همان‌هایی که امروز بوده‌اند
function decide(count, opts) {
  const o = opts || {};
  const n = Number(count) || 0;
  const t = Number(o.todayCount) || 0;
  if (o.purchased || o.closed) return { followUp: null };
  if (t >= SAME_DAY_AT) return { followUp: { date: today(o.now), note: sameDayNote(t) } };
  if (n >= DIAGNOSE_AT) return { followUp: { date: tomorrow(o.now), note: DIAGNOSE_NOTE } };
  return { followUp: null };
}

// استعلام‌ها روزبه‌روز (روز به وقت تهران)، جدیدترین روز اول
function groupByDay(calls) {
  const days = new Map();
  for (const c of calls) {
    const key = startOfTodayTehran(c.at);
    if (!days.has(key)) days.set(key, { day: key, count: 0, calls: [] });
    const d = days.get(key);
    d.count++;
    d.calls.push(c);
  }
  return [...days.values()]
    .sort((a, b) => b.day - a.day)
    .map((d) => Object.assign(d, { calls: d.calls.sort((a, b) => a.at - b.at) }));
}

module.exports = { SAME_DAY_AT, DIAGNOSE_AT, DIAGNOSE_NOTE, sameDayNote, decide, groupByDay, tomorrow, today };
