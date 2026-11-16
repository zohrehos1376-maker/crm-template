// فهرست‌های ثابت «میز کار مشاور» CRM نمونه. کدها در دیتابیس ذخیره می‌شوند؛
// برچسب‌ها فقط برای نمایش‌اند، پس عوض کردن برچسب داده‌های قبلی را خراب نمی‌کند.

// موضوع‌های آماده‌ی وظیفه
const TASK_TOPICS = [
  { code: 'quote', label: 'پیگیری قیمت و پیش‌فاکتور' },
  { code: 'part_check', label: 'بررسی قطعه‌ی درخواستی' },
  { code: 'delivery', label: 'هماهنگی ارسال و تحویل بار' },
  { code: 'payment', label: 'پیگیری واریزی و تسویه حساب' },
  { code: 'return', label: 'پیگیری مرجوعی و گارانتی' },
  { code: 'tech', label: 'مشاوره‌ی فنی و مشخصات کالا' },
  { code: 'periodic', label: 'تماس دوره‌ای و حفظ ارتباط' },
  { code: 'callback', label: 'تماس برگشتی' },
  { code: 'manager_followup', label: 'پیگیری به درخواست مدیر فروش' },
  { code: 'other', label: 'سایر' },
];

// گزارش مشاور به مدیر فروش
const REPORT_KINDS = [
  { code: 'no_purchase', label: 'علت عدم خرید' },
  { code: 'competitor_price', label: 'گزارش قیمت رقبا' },
  { code: 'out_of_stock', label: 'درخواست کالای ناموجود' },
  { code: 'complaint', label: 'شکایت و نارضایتی' },
];
const NO_PURCHASE_REASONS = [
  { code: 'price', label: 'قیمت' },
  { code: 'stock', label: 'ناموجودی' },
  { code: 'later', label: 'خرید در آینده' },
  { code: 'quality', label: 'کیفیت' },
  { code: 'other', label: 'سایر' },
];

// احراز هویت همکار
// فروش به مشتری احراز‌نشده بسته نیست، هشدار است — ولی دلیلش اجباری است (docs/lead-stages-plan.md)
const UNVERIFIED_SALE_REASONS = [
  'با قیمت آزاد می‌فروشیم، نه قیمت همکاری',
  'مشتری قدیمی و شناخته‌شده است',
  'مدارکش در راه است',
];

const KYC_STATUSES = [
  { code: 'none', label: 'احراز نشده' },
  { code: 'awaiting', label: 'منتظر مدارک' },
  { code: 'pending', label: 'منتظر تأیید کارشناس' },
  { code: 'approved', label: 'احراز شده' },
  { code: 'rejected', label: 'مدارک رد شده' },
];

// برچسب کارهای «سابقه‌ی تغییرات پرونده»
const AUDIT_ACTIONS = {
  created: 'ایجاد پرونده',
  updated: 'اصلاح مشخصات',
  owner_changed: 'تغییر مسئول پرونده',
  claimed: 'برداشتن از صف',
  call_logged: 'ثبت تماس',
  followup: 'ثبت پیگیری',
  followup_edited: 'اصلاح پیگیری',
  named: 'ثبت نام برای شماره‌ی خام',
  task_created: 'ایجاد وظیفه',
  task_done: 'انجام وظیفه',
  task_reopened: 'بازگشایی وظیفه',
  report: 'گزارش به مدیر فروش',
  report_resolved: 'رسیدگی مدیر به گزارش',
  sms: 'ارسال پیامک',
  kyc_link: 'ارسال لینک احراز',
  kyc_remind: 'یادآوری تکمیل مشخصات',
  kyc_submitted: 'دریافت فرم و مدارک احراز',
  kyc_approved: 'تأیید مدارک',
  kyc_rejected: 'رد مدارک',
  kyc_reopened: 'لغو تأیید و بازگشایی',
  kyc_reject_notified: 'اطلاع رد احراز به مشتری',
  manager_followup: 'درخواست پیگیری مدیر فروش',
  first_purchase: 'اولین خرید مشتری',
  purchase: 'خرید تازه',
  purchase_deleted: 'فروش حذف‌شده',
  record_edited: 'ویرایش سابقه',
  intake: 'ورود از فرم سایت',
  intake_repeat: 'فرم تکراری سایت (از قبل احرازشده)',
  intake_vardast: 'ورود از وردست (اینستاگرام / تلگرام)',
  support_group: 'تعیین گروه پشتیبان',
  intake_done: 'رسیدگی به فرم / لید',
  desk_done: 'ثبت نتیجه‌ی تماس / پیگیری',
  intake_files_skipped: 'فایل ناخوانا از فرم سایت',
  kyc_doc_removed: 'حذف عکس نامربوط از مدارک',
  follow_stopped: 'توقف پیگیری با دلیل',
  follow_resumed: 'شروع دوباره‌ی پیگیری',
  note: 'یادداشت',
  followup_moved: 'تغییر پیگیری بعدی',
  followup_removed: 'حذف پیگیری بعدی',
  sale_unverified: 'فروش به مشتری احراز‌نشده',
};

// برچسب فیلدها برای نمایش تغییرات (قبلی ← جدید)
const FIELD_LABELS = {
  customerName: 'نام',
  phone: 'شماره',
  shopName: 'فروشگاه',
  city: 'شهر',
  jobType: 'نوع مشتری',
  channel: 'منبع ورود',
  status: 'مرحله',
  notes: 'توضیحات',
  paymentTerms: 'پرداخت',
  deliveryType: 'ارسال',
  nationalId: 'کد ملی',
  alvarCode: 'کد آلور',
  ownerId: 'مسئول پرونده',
  tags: 'برچسب‌ها',
  // تاریخ پیگیری بعدی عمداً نیست: خود پیگیری‌ها جدا در سابقه می‌آیند و جابه‌جایی تاریخ سابقه نمی‌خواهد
};

// متن‌های پیش‌فرض (اولین اجرا؛ بعد از پنل قابل ویرایش‌اند)
const DEFAULT_SCRIPTS = [
  { title: 'خوشامد تماس', body: 'سلام، وقت بخیر. CRM نمونه هستم، در خدمتم. مدل گوشی و قطعه‌ای که لازم دارید را بفرمایید.' },
  { title: 'اعلام قیمت', body: 'قیمت امروز این قطعه {قیمت} تومان است. موجودی محدود است؛ اگر بخواهید همین الان برایتان رزرو می‌کنم.' },
  { title: 'پاسخ به اعتراض قیمت', body: 'قطعه‌های ما اورجینال و با گارانتی تعویض است. با تفاوت کیفیت، در عمل هزینه‌ی مرجوعی و دوباره‌کاری شما کمتر می‌شود.' },
  { title: 'دعوت به همکاری', body: 'برای دریافت لیست قیمت همکاری، فرم احراز را تکمیل کنید؛ بعد از تأیید، قیمت ویژه‌ی همکار برایتان فعال می‌شود.' },
];
const DEFAULT_SMS = [
  { topic: 'kyc_link', title: 'لینک احراز همکاری', body: '{نام} عزیز، برای فعال شدن قیمت همکاری CRM نمونه، مشخصات و مدارک را از این لینک بفرستید:\n{لینک}' },
  { topic: 'kyc_remind', title: 'یادآوری تکمیل مشخصات', body: '{نام} عزیز، فرم احراز همکاری CRM نمونه هنوز تکمیل نشده است:\n{لینک}' },
  { topic: 'kyc_rejected', title: 'رد مدارک و لینک اصلاح', body: '{نام} عزیز، مدارک شما نیاز به اصلاح دارد: {دلیل}\nلطفاً از این لینک دوباره بفرستید:\n{لینک}' },
  { topic: 'kyc_approved', title: 'تأیید همکاری', body: '{نام} عزیز، همکاری شما با CRM نمونه تأیید شد. لیست قیمت همکاری برایتان فعال است.' },
  { topic: 'price_list', title: 'ارسال لیست قیمت', body: '{نام} عزیز، لیست قیمت روز CRM نمونه: https://crm.example.com' },
  // دومین بار که مشتری فقط قیمت پرسید، یادآوری در فهرست کارهای کارشناس می‌نشیند (shared/price-inquiry.js)؛ خودِ پیامک دیگر خودکار فرستاده نمی‌شود
  { topic: 'price_inquiry_2', title: 'پیگیری استعلام دوم قیمت', body: '{نام} عزیز، قیمت روز CRM نمونه را خدمت‌تان فرستادیم. برای ثبت سفارش و قیمت همکاری در خدمتیم: https://crm.example.com' },
  { topic: 'order_ready', title: 'آماده بودن سفارش', body: '{نام} عزیز، سفارش شما آماده‌ی ارسال است. CRM نمونه' },
];

const labelOf = (list, code) => (list.find((x) => x.code === code) || {}).label || code || '';

module.exports = {
  TASK_TOPICS,
  REPORT_KINDS,
  NO_PURCHASE_REASONS,
  KYC_STATUSES,
  UNVERIFIED_SALE_REASONS,
  AUDIT_ACTIONS,
  FIELD_LABELS,
  DEFAULT_SCRIPTS,
  DEFAULT_SMS,
  labelOf,
};
