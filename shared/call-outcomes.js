// نتیجه‌ی تماس با یک کلیک (فرم ثبت تماس در CRM و اپ گوشی).
// کد در دیتابیس ذخیره می‌شود؛ برچسب فقط برای نمایش است، پس عوض کردن برچسب داده‌ها را خراب نمی‌کند.
const CALL_OUTCOMES = [
  { code: 'price_inquiry', label: 'فقط استعلام قیمت' },
  { code: 'price_objection', label: 'اعتراض به قیمت' },
  { code: 'order', label: 'سفارش داد' },
  { code: 'out_of_stock', label: 'محصول ناموجود خواست' },
  { code: 'callback', label: 'قرار تماس دوباره' },
  { code: 'cooperation', label: 'درخواست همکاری' },
  { code: 'support', label: 'پیگیری سفارش / پشتیبانی' },
  { code: 'irrelevant', label: 'نامرتبط' },
];
const OUTCOME_LABEL = Object.fromEntries(CALL_OUTCOMES.map((o) => [o.code, o.label]));

// ساعت کاری پاسخ به تماس (وقت تهران). بی‌پاسخ‌های بیرون از این بازه صبح روز کاری بعد باید پیگیری شوند.
const WORK_HOURS = { start: 10, end: 19 };

// نتیجه‌ای که کارشناس خودش به منو افزوده با پیشوند x: ذخیره می‌شود (مثلاً x:گارانتی خواست)
const isCustom = (x) => /^x:[^,]{1,40}$/.test(x);
function outcomeLabel(code) {
  return OUTCOME_LABEL[code] || (isCustom(code) ? code.slice(2) : code);
}

function parseOutcomes(v) {
  const list = Array.isArray(v) ? v : String(v || '').split(',');
  const out = [];
  let len = 0;
  [...new Set(list.map((x) => String(x).trim()).filter((x) => OUTCOME_LABEL[x] || isCustom(x)))].forEach((x) => {
    if (len + x.length + 1 > 190) return; // ستون outcomes حداکثر ۱۹۱ نویسه است
    len += x.length + 1;
    out.push(x);
  });
  return out;
}

function tehranHour(date) {
  return Number(new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Tehran', hour: 'numeric', hourCycle: 'h23' }).format(date));
}

function isAfterHours(date) {
  const h = tehranHour(date);
  return h < WORK_HOURS.start || h >= WORK_HOURS.end;
}


// دلیل‌های «ثبت نشد» — کارشناس از منوی کشویی انتخاب می‌کند («سایر» متن آزاد می‌گیرد)
const DISMISS_REASONS = [
  { code: 'wrong_number', label: 'اشتباه گرفته شده' },
  { code: 'spam', label: 'تبلیغاتی / مزاحم' },
  { code: 'internal', label: 'همکار داخلی' },
  { code: 'unrelated', label: 'بی‌ربط به فروش' },
  { code: 'duplicate', label: 'تکراری' },
  { code: 'no_talk', label: 'قطع شد / صحبتی انجام نشد' },
  { code: 'other', label: 'سایر' },
];

module.exports = { CALL_OUTCOMES, OUTCOME_LABEL, outcomeLabel, DISMISS_REASONS, WORK_HOURS, parseOutcomes, isAfterHours };
