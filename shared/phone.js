// یکسان‌سازی شماره تلفن — یک جا برای همه‌ی برنامه (سرنخ‌ها، باشگاه، تماس‌های گوشی).
//
// هدف: یک شماره با هر شکل نوشتن، یک رشته‌ی ثابت شود تا تطبیق و تشخیص تکراری کار کند.
//   +989141234567 / 00989141234567 / 989141234567 / 9141234567 / 0914 123 4567 / ۰۹۱۴۱۲۳۴۵۶۷
//   → 09141234567
// شماره‌های ثابت (۰۴۱…) و کوتاه (۱۱۰، ۰۴۱۶۱۰۵…) خراب نمی‌شوند؛ فقط ارقام و پیشوند ۹۸ یکدست می‌شوند.

// ارقام فارسی (۰-۹) و عربی (٠-٩) → انگلیسی
function toEnDigits(s) {
  return String(s === undefined || s === null ? '' : s)
    .replace(/[۰-۹]/g, (d) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d)))
    .replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)));
}

function normalizePhone(v) {
  let s = toEnDigits(v).trim();
  if (!s) return '';
  // فقط ارقام و یک + ابتدایی می‌ماند (فاصله، خط تیره، پرانتز، نقطه حذف می‌شوند)
  const plus = s.startsWith('+');
  s = s.replace(/\D/g, '');
  if (plus || s.startsWith('0098')) {
    if (s.startsWith('0098')) s = s.slice(4);
    else if (s.startsWith('98')) s = s.slice(2);
    return s ? '0' + s.replace(/^0+/, '') : '';
  }
  // ۹۸ + شماره‌ی ۱۰ رقمی (موبایل یا ثابت) بدون +
  if (s.startsWith('98') && s.length === 12) return '0' + s.slice(2);
  // موبایل بدون صفر اول (اکسل صفر را حذف می‌کند)
  if (/^9\d{9}$/.test(s)) return '0' + s;
  return s;
}

// شماره «قابل تماس» است؟ (برای کنار گذاشتن مقدارهایی مثل «11» یا «1159» در فایل‌های حسابداری)
function isPlausiblePhone(v) {
  const n = normalizePhone(v);
  return n.length >= 8;
}

module.exports = { normalizePhone, toEnDigits, isPlausiblePhone };
