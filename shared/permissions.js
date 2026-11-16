// سطح دسترسی کاربران — مدیر همه‌ی دسترسی‌ها را دارد؛ برای هر کارشناس می‌شود دسترسی‌های اضافه را
// یکی‌یکی روشن یا خاموش کرد (ستون users.permissions، فهرستی از کلیدهای زیر با کاما).
const PERMISSIONS = [
  { key: 'dashboard', label: 'داشبورد مدیریتی', desc: 'آمار امروز کل تیم، هشدارها و نمودارها' },
  { key: 'analytics', label: 'گزارشات و آمار فروش', desc: 'داشبورد فروش، گروه‌بندی مشتریان، هشدار ریزش، مشتریان برتر، مشتریان جدید و کیفیت داده (لیست تماس هفته برای همه باز است)' },
  { key: 'performance', label: 'آمار کار کارشناسان', desc: 'آمار روزبه‌روز کارهای هر کارشناس و فروش ثبت‌شده‌ی هر کارشناس در آمار فروش' },
  { key: 'calls_admin', label: 'گزارش تماس‌ها و خطوط تلفن', desc: 'گزارش کامل تماس‌ها، تعریف خط و وصل کردن گوشی' },
  { key: 'demand', label: 'محصولات ناموجود درخواستی', desc: 'گزارش قطعه‌هایی که خواسته شده ولی موجود نبوده' },
  { key: 'sales_reports', label: 'گزارش‌های مشاوران (مدیر فروش)', desc: 'دیدن همه‌ی گزارش‌های علت عدم خرید، قیمت رقبا، کالای ناموجود و شکایت، و رسیدگی به آن‌ها' },
  { key: 'kyc_review', label: 'تأیید و رد مدارک احراز', desc: 'بررسی مدارک همکاران، تأیید، رد و بازگشایی پرونده' },
  { key: 'kyc_send', label: 'ارسال لینک احراز', desc: 'فرستادن پیامک لینک احراز و یادآوری تکمیل مشخصات' },
  { key: 'sms_send', label: 'ارسال پیامک', desc: 'فرستادن پیامک با الگوهای آماده به مشتری' },
  { key: 'scripts_admin', label: 'مدیریت جمله‌های آماده و الگوهای پیامک', desc: 'افزودن، ویرایش و غیرفعال کردن متن‌ها' },
  { key: 'activity_report', label: 'گزارش اقدامات مشاوران', desc: 'دیدن همه‌ی کارهای ثبت‌شده‌ی هر مشاور و خروجی اکسل' },
  { key: 'leads_admin', label: 'ادغام سرنخ‌های تکراری', desc: 'پیدا کردن و یکی کردن مشتری‌های تکراری' },
  { key: 'settings', label: 'تنظیمات', desc: 'پیام‌های آماده، کانال‌ها، شعبه‌ها و پشتیبان' },
  { key: 'no_rank', label: 'خارج از رتبه‌بندی فروش', desc: 'برای کسی که کارشناس فروش نیست (مثلاً مدیر CRM یا پشتیبان): در جدول امتیازات و گزارش‌های فروش نمی‌آید' },
  { key: 'users', label: 'مدیریت کاربران', desc: 'ساخت کارشناس، تغییر رمز و فعال/غیرفعال کردن (تعیین دسترسی فقط با مدیر)' },
];
const KEYS = PERMISSIONS.map((p) => p.key);

function parsePermissions(raw) {
  return String(raw || '')
    .split(',')
    .map((s) => s.trim())
    .filter((k) => KEYS.includes(k));
}

function cleanPermissions(list) {
  const arr = Array.isArray(list) ? list : String(list || '').split(',');
  return KEYS.filter((k) => arr.map((s) => String(s).trim()).includes(k));
}

// user: خروجی toUserOut (role + permissions)
function can(user, key) {
  if (!user) return false;
  if (user.role === 'manager') return true;
  // CRM نمونه: هیچ مشتری مختص یک کارشناس نیست — همه‌ی کارشناسان همه‌ی مشتری‌ها، تماس‌ها و پیگیری‌ها را
  // می‌بینند، روی آن‌ها کار می‌کنند و می‌توانند کار به همکار ارجاع دهند.
  if (key === 'all_leads') return true;
  return Array.isArray(user.permissions) && user.permissions.includes(key);
}

module.exports = { PERMISSIONS, KEYS, parsePermissions, cleanPermissions, can };
