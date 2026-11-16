'use strict';
/**
 * چرخه‌ی پیگیری بعد از خرید (طرح مورد تأیید کاربر، ۱۴۰۵/۰۸/۱۲ — docs/lead-stages-plan.md)
 *
 *   خرید کرد → ۲ روز بعد: پیگیری ارسال
 *            → ۵ تا ۷ روز بعد (پیشنهاد ۶): پیگیری سفارش جدید
 *            → هر ۲ هفته یک‌بار: پیگیری دوره‌ای (بی‌پایان، تا خرید بعدی)
 *
 * هر خرید تازه چرخه را از اول (۲ روز) شروع می‌کند.
 * فاصله‌ها برای همه‌ی مشتری‌ها یکی است؛ ریتم خرید خودِ مشتری فاصله را عوض نمی‌کند.
 * هر کارشناسی که آزاد باشد زنگ می‌زند (پرونده قفل یک نفر نیست).
 */

var STEPS = [
  { code: 'ship',     days: 2,  note: 'پیگیری ارسال: بار رسید؟ سالم بود؟', next: 'reorder' },
  { code: 'reorder',  days: 6,  note: 'پیگیری سفارش جدید',                  next: 'periodic' },
  { code: 'periodic', days: 14, note: 'پیگیری دوره‌ای',                      next: 'periodic' }
];

var BY_CODE = STEPS.reduce(function (m, s) { m[s.code] = s; return m; }, {});
var FIRST = 'ship';

/** ساعت ۱۰ صبح روزِ n روز بعد — همان قرار بقیه‌ی برنامه */
function dueAt(days, from) {
  var d = from ? new Date(from) : new Date();
  d.setDate(d.getDate() + days);
  d.setHours(10, 0, 0, 0);
  return d;
}

function isStep(code) {
  return !!BY_CODE[code];
}

/** برچسب فارسی قدم (برای نمایش) */
function noteOf(code) {
  return BY_CODE[code] ? BY_CODE[code].note : '';
}

/**
 * داده‌ی آپدیت Lead برای شروع چرخه (بعد از ثبت خرید).
 * { purchaseFollowStep, nextFollowUpDate, nextFollowUpNote }
 */
function start(at) {
  var s = BY_CODE[FIRST];
  return {
    purchaseFollowStep: s.code,
    nextFollowUpDate: dueAt(s.days, at),
    nextFollowUpNote: s.note
  };
}

/**
 * داده‌ی آپدیت Lead برای «این پیگیری انجام شد، بعدی را بگذار».
 * اگر مشتری در چرخه نباشد null برمی‌گرداند (یعنی رفتار قبلی سر جایش بماند).
 */
function advance(currentStep, at) {
  var cur = BY_CODE[currentStep];
  if (!cur) return null;
  var nx = BY_CODE[cur.next];
  return {
    purchaseFollowStep: nx.code,
    nextFollowUpDate: dueAt(nx.days, at),
    nextFollowUpNote: nx.note
  };
}

module.exports = {
  STEPS: STEPS, FIRST: FIRST,
  isStep: isStep, noteOf: noteOf, start: start, advance: advance, dueAt: dueAt
};
