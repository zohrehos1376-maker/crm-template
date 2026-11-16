// ستون‌های اکسل «ورود مشتریان» — هم فایل نمونه، هم ورود، هم خروجی انتقال از CRM قدیمی از همین‌ها استفاده می‌کنند.
const CUSTOMER_HEADERS = ['نام مشتری', 'تلفن', 'شهر', 'فروشگاه / تعمیرگاه', 'نوع مشتری', 'وضعیت احراز', 'منبع', 'توضیحات'];

const KYC_LABELS = { none: 'احراز نشده', awaiting: 'منتظر مدارک', pending: 'منتظر تأیید', approved: 'تأیید شده', rejected: 'رد شده' };

const norm = (s) => String(s || '').replace(/[\s‌‏‎]+/g, '').replace(/ي/g, 'ی').replace(/ك/g, 'ک').toLowerCase();

// برچسب فارسی یا کد انگلیسی وضعیت احراز → کد CRM؛ خالی یعنی «دست نزن»
function kycFromLabel(v) {
  const n = norm(v);
  if (!n) return null;
  for (const [code, label] of Object.entries(KYC_LABELS)) if (n === norm(label) || n === code) return code;
  if (/تایید|تأیید/.test(n) && /منتظر/.test(n)) return 'pending';
  if (/تایید|تأیید|verified|approved/.test(n)) return 'approved';
  if (/رد|reject/.test(n)) return 'rejected';
  if (/مدرک|مدارک|waiting/.test(n)) return 'awaiting';
  if (/نشده|بدون|none/.test(n)) return 'none';
  return undefined; // نامعتبر
}

const JOB_TYPES = ['تعمیرکار', 'قطعه‌فروش', 'تعمیرکار و قطعه‌فروش', 'مصرف‌کننده', 'سایر'];
function jobFromText(v) {
  const s = String(v || '');
  if (!s.trim()) return null;
  const r = /تعمیر/.test(s), p = /قطعه/.test(s);
  if (r && p) return 'تعمیرکار و قطعه‌فروش';
  if (r) return 'تعمیرکار';
  if (p) return 'قطعه‌فروش';
  if (/مصرف/.test(s)) return 'مصرف‌کننده';
  return 'سایر';
}

module.exports = { CUSTOMER_HEADERS, KYC_LABELS, kycFromLabel, jobFromText, JOB_TYPES, norm };
