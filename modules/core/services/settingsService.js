// تنظیمات مشترک برنامه.
//
// فعلاً فقط «پیام‌های آماده» را نگه می‌دارد، ولی جدول کلید/مقدار است تا
// تنظیمات بعدی هم بدون تغییر ساختار جدول اضافه شوند.
const { prisma } = require('../../../shared/prisma');

const MESSAGES_KEY = 'messages';

// جای‌گذارها: هنگام کپی کردن پیام، این‌ها با اطلاعات واقعی سرنخ جایگزین می‌شوند.
// عمداً فارسی‌اند تا کاربر بدون دانستن انگلیسی بتواند متن را ویرایش کند.
const PLACEHOLDERS = ['{نام}', '{کارشناس}', '{محصول}', '{یادداشت}', '{لینک}', '{شماره}'];

// متن‌های پیش‌فرض. اگر کاربر چیزی ذخیره نکرده باشد، همین‌ها استفاده می‌شوند،
// و دکمه‌ی «بازگشت به پیش‌فرض» هم به همین‌ها برمی‌گردد.
const DEFAULTS = {
  phone: '',
  channelLink: '',
  welcome: [
    '{نام} عزیز، سلام.',
    'از تماس شما با CRM نمونه سپاسگزاریم.',
    'درخواست شما برای «{محصول}» ثبت شد.',
    'کارشناس شما: {کارشناس}',
    'به‌زودی برای ارائه اطلاعات با شما تماس می‌گیریم.',
  ].join('\n'),
  reminder: [
    '{نام} عزیز، سلام.',
    'پیرو درخواست شما در CRM نمونه:',
    'محصول درخواستی: {محصول}',
    '{یادداشت}',
    'برای پیگیری با کارشناس شما {کارشناس} در تماس باشید.',
  ].join('\n'),
  invite: [
    '{نام} عزیز، سلام.',
    'برای دیدن لیست قیمت روز و محصولات موجود، به کانال CRM نمونه بپیوندید:',
    '{لینک}',
  ].join('\n'),
};

// امضای پایان همه‌ی پیام‌ها. جدا از متن اصلی نگه داشته می‌شود تا کاربر مجبور
// نباشد شماره را در هر سه متن تکرار کند و یادش برود یکی را عوض کند.
const FOOTER = '(شماره تماس: {شماره})';

const FIELDS = ['phone', 'channelLink', 'welcome', 'reminder', 'invite'];

function clean(v, fallback) {
  if (v === undefined || v === null) return fallback;
  const s = String(v).trim();
  return s === '' ? '' : s;
}

// خواندن پیام‌ها. اگر ردیفی در دیتابیس نباشد یا خراب باشد، پیش‌فرض‌ها
// برگردانده می‌شوند — برنامه هیچ‌وقت به خاطر تنظیمات از کار نمی‌افتد.
async function getMessages() {
  const row = await prisma.setting.findUnique({ where: { key: MESSAGES_KEY } });
  if (!row) return Object.assign({}, DEFAULTS, { footer: FOOTER, placeholders: PLACEHOLDERS });

  let saved = {};
  try {
    saved = JSON.parse(row.value) || {};
  } catch (e) {
    saved = {};
  }

  const out = {};
  FIELDS.forEach((f) => {
    out[f] = saved[f] === undefined ? DEFAULTS[f] : String(saved[f]);
  });
  out.footer = FOOTER;
  out.placeholders = PLACEHOLDERS;
  return out;
}

async function saveMessages(userId, body) {
  const b = body || {};
  const data = {};

  FIELDS.forEach((f) => {
    // فیلدی که فرستاده نشده، مقدار قبلی‌اش نباید پاک شود؛ در روت مقدار
    // فعلی خوانده و کامل فرستاده می‌شود، ولی این محافظ را هم نگه می‌داریم.
    data[f] = clean(b[f], DEFAULTS[f]);
  });

  // متن هر سه پیام نباید خالی باشد، وگرنه دکمه‌ی کپی متن خالی می‌دهد.
  ['welcome', 'reminder', 'invite'].forEach((f) => {
    if (!data[f]) {
      const e = new Error('متن پیام‌ها نمی‌تواند خالی باشد');
      e.status = 400;
      throw e;
    }
  });

  await prisma.setting.upsert({
    where: { key: MESSAGES_KEY },
    create: {
      key: MESSAGES_KEY,
      value: JSON.stringify(data),
      updatedAt: new Date(),
      updatedBy: userId || null,
    },
    update: {
      value: JSON.stringify(data),
      updatedAt: new Date(),
      updatedBy: userId || null,
    },
  });

  return getMessages();
}

async function resetMessages(userId) {
  return saveMessages(userId, DEFAULTS);
}

// ---------------------------------------------------------------
// «کانال ارتباطی / نحوه‌ی آشنایی» — همان فهرستی که در فرم سرنخ، فیلترها و
// پاپ‌آپ اپ «اپ تماس» نشان داده می‌شود. مدیر می‌تواند افزوده/ویرایش/غیرفعال/مرتب کند.
// گزینه‌ی غیرفعال در فرم‌های جدید نمی‌آید ولی سرنخ‌های قدیمی مقدارشان را نگه می‌دارند.
// ---------------------------------------------------------------
const CHANNELS_KEY = 'channelOptions';
const DEFAULT_CHANNELS = [
  'تماس تلفنی', 'حضوری / نمایشگاه', 'وبسایت', 'اینستاگرام', 'تلگرام', 'واتساپ', 'بله',
  'دیوار', 'شیپور', 'معرفی مشتری', 'مشتری قبلی', 'بنر و تابلو', 'عبور از جلوی نمایشگاه', 'سایر',
].map((name) => ({ name, active: true }));

async function getChannelOptions() {
  const row = await prisma.setting.findUnique({ where: { key: CHANNELS_KEY } });
  if (!row) return DEFAULT_CHANNELS.map((o) => Object.assign({}, o));
  try {
    const list = JSON.parse(row.value);
    if (Array.isArray(list) && list.length) {
      return list.filter((o) => o && o.name).map((o) => ({ name: String(o.name), active: o.active !== false }));
    }
  } catch (e) { /* خراب → پیش‌فرض */ }
  return DEFAULT_CHANNELS.map((o) => Object.assign({}, o));
}

async function saveChannelOptions(userId, list) {
  if (!Array.isArray(list)) throw Object.assign(new Error('فهرست نامعتبر است'), { status: 400 });
  const seen = new Set();
  const clean = [];
  for (const o of list) {
    const name = String((o && o.name) || '').trim().slice(0, 60);
    if (!name || seen.has(name)) continue;
    seen.add(name);
    clean.push({ name, active: !(o && o.active === false) });
  }
  if (!clean.some((o) => o.active)) throw Object.assign(new Error('حداقل یک گزینه‌ی فعال لازم است'), { status: 400 });
  const value = JSON.stringify(clean);
  await prisma.setting.upsert({
    where: { key: CHANNELS_KEY },
    create: { key: CHANNELS_KEY, value, updatedAt: new Date(), updatedBy: userId || null },
    update: { value, updatedAt: new Date(), updatedBy: userId || null },
  });
  return getChannelOptions();
}

module.exports = {
  getMessages, saveMessages, resetMessages, DEFAULTS, FOOTER, PLACEHOLDERS,
  getChannelOptions, saveChannelOptions, DEFAULT_CHANNELS,
};
