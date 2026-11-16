// سرویس سرنخ‌ها — تنها جایی که کوئری‌های Prisma مربوط به سرنخ، خودروهای درخواستی،
// پیگیری‌ها و گزارش‌ها نوشته می‌شود. روت‌های Express هیچ‌وقت مستقیم به دیتابیس دستور نمی‌دهند.
const { prisma, getDefaultBranchId } = require('../../../shared/prisma');
const { can } = require('../../../shared/permissions');
const Jalali = require('../../../shared/jalali');
const Cycle = require('../../../shared/purchase-cycle');
const CustomerStage = require('../../../shared/customer-stage');
const { CALL_OUTCOMES: CALL_OUTCOME_CODES } = require('../../../shared/call-outcomes');

function fail(status, message) {
  const e = new Error(message);
  e.status = status;
  return e;
}

// شماره تلفن را به یک شکل یکسان برمی‌گرداند تا «۰۹۱۲…»، «+۹۸۹۱۲…» و
// «۹۸۹۱۲…» همه یک شماره حساب شوند — بدون این نرمال‌سازی، تشخیص تکراری
// (پایین‌تر) عملاً کار نمی‌کند چون رشته‌ها literal مقایسه می‌شوند.
// تابع مشترک در shared/phone.js (ارقام فارسی/عربی، +98، صفر اول، شماره‌های ثابت)
const { normalizePhone } = require('../../../shared/phone');
const { JOB_TYPES } = require('../../../shared/customer-sheet');
const { creditUserId } = require('../lib/credit');

// «نوع مشتری» برای فیلتر سریع — همان مقادیری که نسخه‌ی قبلی استفاده می‌کرد
const SOCIAL_CHANNELS = ['اینستاگرام', 'تلگرام', 'واتساپ'];
// نتیجه‌های «ثبت تماس» در پروفایل مشتری — با همین مقدارها «آخرین تماس» پیدا می‌شود
const CALL_OUTCOMES = ['جواب داد', 'جواب نداد'];
const WALKIN_CHANNEL = 'حضوری / نمایشگاه';
const CANCELLED_STATUS = 'فروش ناموفق';


// برچسب‌های آماده‌ای که همیشه در فهرست انتخاب دیده می‌شوند. کاربر می‌تواند برچسب
// تازه هم بسازد؛ برچسب تازه از همان لحظه که روی یک سرنخ ثبت شد، در فهرست
// همه‌ی کاربران ظاهر می‌شود (مثل فهرست خودروهای ثبت‌شده).
const DEFAULT_TAGS = ['فقط شماره', 'لید سرد', 'لید داغ', 'مشتری قدیمی', 'پیگیری ویژه'];

// حد و حدود برچسب‌ها تا فهرست انتخاب با متن‌های طولانی یا تکراری شلوغ نشود.
const MAX_TAGS_PER_LEAD = 10;
const MAX_TAG_LENGTH = 30;

// برچسب‌ها در PostgreSQL ستون String[] هستند و در MySQL یک آرایه‌ی JSON؛ هر دو
// حالت (و همچنین رکوردهای قدیمی که مقدارشان null است) به یک آرایه‌ی ساده تبدیل می‌شوند.
function normalizeTags(value) {
  let raw = value;
  if (raw === null || raw === undefined) return [];
  if (typeof raw === 'string') {
    try {
      raw = JSON.parse(raw);
    } catch {
      raw = [raw];
    }
  }
  if (!Array.isArray(raw)) return [];
  const out = [];
  for (const item of raw) {
    const tag = String(item).trim().slice(0, MAX_TAG_LENGTH);
    if (tag && !out.includes(tag)) out.push(tag);
    if (out.length >= MAX_TAGS_PER_LEAD) break;
  }
  return out;
}

// شرط سرنخ‌هایی که «پیگیری امروز یا عقب‌افتاده» دارند: یادآوری تنظیم شده،
// تاریخش تا پایان امروز رسیده یا گذشته، و سرنخ منصرف نشده است.
function dueFollowUpWhere() {
  const endOfToday = new Date();
  endOfToday.setHours(23, 59, 59, 999);
  return {
    nextFollowUpDate: { not: null, lte: endOfToday },
    status: { not: CANCELLED_STATUS },
  };
}

// مالک سرنخ همیشه همراه رکورد خوانده می‌شود، چون خروجی API به آن نیاز دارد.
const LEAD_INCLUDE = {
  owner: { select: { fullName: true } },
  // فقط step ها — برای نشان دادن خلاصه‌ی پیشرفت پیگیری مرحله اول به‌صورت چند
  // نقطه‌ی رنگی در لیست مشتریان، بدون بار اضافه‌ی متن کامل پیگیری‌ها
  followups: { where: { step: { not: null } }, select: { step: true }, orderBy: { createdAt: 'asc' } },
};

// تبدیل رکورد دیتابیس به دقیقاً همان ساختاری که رابط کاربری از نسخه‌ی JSON انتظار دارد:
// نام فیلدها همان قبلی، تاریخ‌ها عدد میلی‌ثانیه، قیمت‌ها عدد معمولی (نه BigInt).
function toLeadOut(lead) {
  return {
    id: lead.id,
    ownerId: lead.ownerId,
    name: lead.customerName,
    phone: lead.phone,
    channel: lead.channel || '',
    contactMethods: lead.preferredContact || [],
    tags: normalizeTags(lead.tags),
    priceFrom: lead.priceFrom === null || lead.priceFrom === undefined ? null : Number(lead.priceFrom),
    priceTo: lead.priceTo === null || lead.priceTo === undefined ? null : Number(lead.priceTo),
    payment: lead.paymentTerms || '',
    delivery: lead.deliveryType || '',
    currentCar: lead.currentCar || '',
    shopName: lead.shopName || '',
    city: lead.city || '',
    jobType: lead.jobType || '',
    kycStatus: lead.kycStatus || 'none',
    kycReason: lead.kycReason || '',
    kycRejectNotifiedAt: lead.kycRejectNotifiedAt ? lead.kycRejectNotifiedAt.getTime() : null,
    firstPurchaseAt: lead.firstPurchaseAt ? lead.firstPurchaseAt.getTime() : null,
    nationalId: lead.nationalId || '',
    alvarCode: lead.alvarCode || '',
    status: lead.status,
    cancelReason: lead.cancelReason,
    notes: lead.notes || '',
    nextFollowUpDate: lead.nextFollowUpDate ? lead.nextFollowUpDate.getTime() : null,
    nextFollowUpNote: lead.nextFollowUpNote || '',
    soldCompany: lead.soldCompany || '',
    soldModel: lead.soldModel || '',
    soldPrice: lead.soldPrice === null || lead.soldPrice === undefined ? null : Number(lead.soldPrice),
    createdAt: lead.createdAt.getTime(),
    updatedAt: lead.updatedAt.getTime(),
    ownerName: lead.owner ? lead.owner.fullName : 'نامشخص',
    // ترتیب قدم‌های تکمیل‌شده‌ی «پیگیری مرحله اول» — برای نقطه‌های رنگی در لیست مشتریان
    firstTouchSteps: Array.isArray(lead.followups) ? lead.followups.map((f) => f.step) : undefined,
  };
}

function toFollowupOut(f) {
  return {
    id: f.id,
    leadId: f.leadId,
    userId: f.userId,
    followupDate: f.followupDate.getTime(),
    content: f.content,
    outcome: f.outcome || '',
    messageSent: !!f.messageSent,
    viaSocialMedia: !!f.viaSocialMedia,
    step: f.step || null,
    createdAt: f.createdAt.getTime(),
    byName: f.user ? f.user.fullName : 'نامشخص',
  };
}

// قیمت‌ها در دیتابیس BigInt هستند؛ ورودی نامعتبر مثل نسخه‌ی قبل به null تبدیل می‌شود.
function toPrice(v) {
  if (v === undefined || v === null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? BigInt(Math.round(n)) : null;
}

function cleanText(v) {
  const s = v === undefined || v === null ? '' : String(v).trim();
  return s === '' ? null : s;
}

// تاریخ یادآوری پیگیری بعدی. مقدار خالی یعنی «یادآوری نداشته باش» و null برمی‌گرداند؛
// مقدار نامعتبر خطا می‌دهد تا مسیر بتواند ۴۰۰ برگرداند و هیچ فیلدی نصفه‌کاره تغییر نکند.
function toFollowUpDate(v) {
  if (v === undefined || v === null || String(v).trim() === '') return null;
  const d = new Date(v);
  if (isNaN(d.getTime())) throw fail(400, 'تاریخ یادآوری پیگیری معتبر نیست');
  return d;
}

// همه‌ی کارشناسان همه‌ی مشتریان را می‌بینند؛ مشتری به کارشناس خاصی تعلق ندارد.
function scopeWhere(user, query) {
  const where = {};
  if (query && query.branchId && can(user, 'all_leads')) where.branchId = query.branchId;
  return where;
}

// فیلترهایی که مستقیماً در SQL اعمال می‌شوند (روی ستون‌های ایندکس‌شده)
function filterWhere(user, query) {
  const q = query || {};
  const where = Object.assign({}, scopeWhere(user, q));

  if (q.status) where.status = q.status;
  if (q.channel) where.channel = q.channel;
  // نتیجه‌ی تماس: مشتری‌ای که دست‌کم یک تماسش این نتیجه را گرفته (مثلاً فقط استعلام قیمت)
  if (q.outcome && CALL_OUTCOME_CODES.some((o) => o.code === q.outcome)) {
    where.callLogs = { some: { outcomes: { contains: q.outcome } } };
  }
  // «بدون خرید» — برای پیدا کردن مثلاً کسانی که فقط استعلام قیمت کردند و نخریدند
  if (q.noPurchase === '1' || q.noPurchase === 'true') where.firstPurchaseAt = null;

  if (q.segment === 'walkin') where.channel = WALKIN_CHANNEL;
  else if (q.segment === 'social') where.channel = { in: SOCIAL_CHANNELS };
  else if (q.segment === 'followup') Object.assign(where, dueFollowUpWhere());

  return where;
}

// جستجوی متنی: نام، تلفن، برچسب‌ها، کد آلور و شهر با فاصله به هم چسبانده می‌شوند
// و عبارت جستجو در همان رشته گشته می‌شود.
function matchesQuery(leadOut, rawQ) {
  const q = String(rawQ).toLowerCase();
  const tagText = (leadOut.tags || []).join(' ');
  return [leadOut.name, leadOut.phone, leadOut.currentCar, tagText, leadOut.alvarCode, leadOut.city]
    .join(' ')
    .toLowerCase()
    .includes(q);
}

// ستون‌هایی که فهرست را می‌شود بر اساسشان مرتب کرد. فهرست بسته است تا هر
// رشته‌ای از آدرس مستقیم به کوئری دیتابیس نرود.
//
// nulls: 'last' برای «پیگیری بعدی» لازم است: سرنخ‌های بدون یادآوری باید ته
// فهرست بروند، نه اینکه در حالت صعودی همه‌شان اول بیایند.
const SORT_FIELDS = {
  createdAt: (dir) => ({ createdAt: dir }),
  updatedAt: (dir) => ({ updatedAt: dir }),
  name: (dir) => ({ customerName: dir }),
  status: (dir) => ({ status: dir }),
  channel: (dir) => ({ channel: dir }),
  city: (dir) => ({ city: dir }),
  owner: (dir) => ({ owner: { fullName: dir } }),
  // MySQL does not support Prisma's explicit null ordering. Rows are sorted
  // portably below so records without a date still appear last.
  nextFollowUpDate: (dir) => ({ nextFollowUpDate: dir }),
};

function orderByFor(q) {
  // در حالت «پیگیری امروز/عقب‌افتاده» نزدیک‌ترین یادآوری اول می‌آید.
  if (q.segment === 'followup' && !q.sort) return { nextFollowUpDate: 'asc' };
  const dir = q.dir === 'asc' ? 'asc' : 'desc';
  const build = SORT_FIELDS[q.sort];
  // پیش‌فرض مثل قبل: جدیدترین سرنخ اول
  return build ? build(dir) : { createdAt: 'desc' };
}

// فهرست سرنخ‌ها با اعمال همه‌ی فیلترها
async function listLeads(user, query) {
  const q = query || {};
  const orderBy = orderByFor(q);
  const rows = await prisma.lead.findMany({
    where: filterWhere(user, query),
    include: LEAD_INCLUDE,
    orderBy,
  });
  let out = rows.map(toLeadOut);
  // فیلتر برچسب در همین‌جا (نه در SQL) انجام می‌شود، چون شکل ذخیره‌سازی برچسب‌ها در
  // PostgreSQL و MySQL فرق دارد و این‌طور رفتار هر دو دیتابیس دقیقاً یکسان می‌ماند.
  if (q.tag) out = out.filter((l) => (l.tags || []).includes(String(q.tag)));
  if (query && query.q) out = out.filter((l) => matchesQuery(l, query.q));
  await attachLastCall(out);
  // 🔥 مشتری داغ (نشانه‌ی خرید در ۱۴ روز اخیر) برای برجسته کردن در فهرست
  await require('./heatService').attachHeat(out);
  if (q.sort === 'heat') {
    const direction = q.dir === 'asc' ? 1 : -1;
    out.sort((a, b) => ((a.heat ? a.heat.at : -1) - (b.heat ? b.heat.at : -1)) * direction);
  }
  // این دو ستون در SQL قابل مرتب‌سازی نیستند (یکی null دارد، دیگری محاسبه‌شده است)،
  // پس همین‌جا مرتب می‌شوند؛ خالی‌ها همیشه آخر.
  if (q.sort === 'nextFollowUpDate' || q.sort === 'lastCallAt') {
    const field = q.sort;
    const direction = q.dir === 'asc' ? 1 : -1;
    out.sort((a, b) => {
      if (a[field] == null) return b[field] == null ? 0 : 1;
      if (b[field] == null) return -1;
      return (a[field] - b[field]) * direction;
    });
  }
  // شهر هم همین‌جا مرتب می‌شود: بیشتر مشتری‌ها شهر ندارند، اگر این خالی‌ها اول
  // بیایند (حالت پیش‌فرض ASC در SQL) به نظر می‌رسد سورت کار نمی‌کند — خالی‌ها
  // همیشه ته فهرست می‌روند، چه صعودی چه نزولی.
  if (q.sort === 'city') {
    const direction = q.dir === 'asc' ? 1 : -1;
    out.sort((a, b) => {
      const av = a.city || '';
      const bv = b.city || '';
      if (!av) return bv ? 1 : 0;
      if (!bv) return -1;
      return av.localeCompare(bv, 'fa') * direction;
    });
  }
  attachCustomerStage(out);
  return out;
}

// مرحله‌ی مشتری (shared/customer-stage.js) روی هر ردیف — برای نوار فیلتر و قیف فروش.
// «آخرین حرکت» همان آخرین تماس است که attachLastCall گذاشته.
function attachCustomerStage(list) {
  for (const l of list) {
    l.stage = CustomerStage.describe({
      kycStatus: l.kycStatus, kycToken: l.kycToken, kycRejectNotifiedAt: l.kycRejectNotifiedAt, firstPurchaseAt: l.firstPurchaseAt,
      jobType: l.jobType, shopName: l.shopName, channel: l.channel, lastActivityAt: l.lastCallAt,
    });
  }
  return list;
}

// «آخرین تماس» هر مشتری — هم تماس‌هایی که مستقیم در پروفایل ثبت شده‌اند (بدون
// پیگیری گروهی)، هم تماس‌های مرحله‌ی اول قدیمی، هم جابه‌جایی کارت به «تماس موفق/ناموفق»
// در پیگیری گروهی. هرکدام جدیدتر بود همان حساب می‌شود.
async function attachLastCall(list) {
  const ids = list.map((l) => l.id);
  if (!ids.length) return list;
  const [calls, logs, phoneCalls] = await Promise.all([
    prisma.followup.groupBy({
      by: ['leadId'],
      where: { leadId: { in: ids }, OR: [{ outcome: { in: CALL_OUTCOMES } }, { step: { startsWith: 'call' } }] },
      _max: { followupDate: true },
    }),
    prisma.pipelineItemLog.findMany({
      where: { stage: { in: ['call_ok', 'call_failed'] }, item: { leadId: { in: ids } } },
      select: { createdAt: true, item: { select: { leadId: true } } },
    }),
    // تماس‌هایی که اپ «اپ تماس» از گوشی‌های کاری فرستاده (ورودی/خروجی)
    prisma.callLog.groupBy({
      by: ['leadId'],
      where: { leadId: { in: ids }, direction: { in: ['INCOMING', 'OUTGOING'] } },
      _max: { startedAt: true },
    }),
  ]);
  const last = {};
  const bump = (id, d) => {
    if (!d) return;
    const t = d.getTime();
    if (!last[id] || t > last[id]) last[id] = t;
  };
  for (const c of calls) bump(c.leadId, c._max.followupDate);
  for (const g of logs) bump(g.item.leadId, g.createdAt);
  for (const p of phoneCalls) bump(p.leadId, p._max.startedAt);
  for (const l of list) l.lastCallAt = last[l.id] || null;
  return list;
}

// تعداد هر «نوع مشتری» برای دکمه‌های فیلتر سریع — فقط بر اساس محدوده‌ی دسترسی
// محاسبه می‌شود (بدون اعمال فیلترهای دیگر)، دقیقاً مثل نسخه‌ی قبل.
async function segmentCounts(user, query) {
  const base = scopeWhere(user, query);
  const [all, walkin, social, followup] = await Promise.all([
    prisma.lead.count({ where: base }),
    prisma.lead.count({ where: Object.assign({}, base, { channel: WALKIN_CHANNEL }) }),
    prisma.lead.count({ where: Object.assign({}, base, { channel: { in: SOCIAL_CHANNELS } }) }),
    prisma.lead.count({ where: Object.assign({}, base, dueFollowUpWhere()) }),
  ]);
  return { all, walkin, social, followup };
}

// خواندن یک سرنخ با رعایت دسترسی. اگر سرنخ متعلق به کارشناس دیگری باشد،
// برای جلوگیری از افشای وجود رکورد همان خطای «یافت نشد» برگردانده می‌شود.
async function getOwnedLead(user, id) {
  const lead = await prisma.lead.findUnique({ where: { id }, include: LEAD_INCLUDE });
  if (!lead) throw fail(404, 'سرنخ یافت نشد');
  if (!can(user, 'all_leads') && lead.ownerId !== user.id) throw fail(404, 'سرنخ یافت نشد');
  return lead;
}

async function getLeadDetail(user, id) {
  const lead = await getOwnedLead(user, id);
  const followups = await prisma.followup.findMany({
    where: { leadId: lead.id },
    orderBy: { followupDate: 'desc' },
    include: { user: { select: { fullName: true } } },
  });
  // تماس‌های گوشی‌های کاری برای تایم‌لاین پرونده
  const phoneCalls = await prisma.callLog.findMany({
    where: { leadId: lead.id },
    orderBy: { startedAt: 'desc' },
    take: 200,
    include: { line: { select: { name: true } }, operator: { select: { fullName: true } } },
  });
  // تماس‌هایی که پیگیری شده‌اند (وصل‌شده یا ثبت‌شده) همان‌جا در «پیگیری‌ها» می‌آیند؛
  // این‌جا فقط بی‌پاسخ‌ها و تماس‌های ثبت‌نشده‌ی بی‌جواب می‌مانند تا دوبار دیده نشوند
  const calls = phoneCalls
    .filter((c) => !(c.direction === 'OUTGOING' && (c.durationSec > 0 || c.logStatus === 'LOGGED')))
    .map((c) => ({
    id: c.id,
    direction: c.direction,
    startedAt: c.startedAt.getTime(),
    durationSec: c.durationSec,
    lineName: c.line ? c.line.name : '',
    operatorName: c.operator ? c.operator.fullName : '',
    note: c.note || '',
    logStatus: c.logStatus,
  }));
  const heat = (await require('./heatService').heatFor([{ id: lead.id, status: lead.status }])).get(lead.id) || null;
  return { lead: toLeadOut(lead), followups: followups.map(toFollowupOut), calls, heat };
}



// شعبه‌ی سرنخ خودکار تعیین می‌شود و کاربر آن را انتخاب نمی‌کند: شعبه‌ی کارشناسی که
// سرنخ به‌نام اوست. برای کارشناس همان شعبه‌ی خودش است؛ وقتی مدیر سرنخ را به‌نام
// کارشناس دیگری ثبت می‌کند، شعبه‌ی همان کارشناس ثبت می‌شود تا گزارش شعبه‌ها درست بماند.
async function resolveBranchId(ownerBranchId) {
  return ownerBranchId || (await getDefaultBranchId());
}

// مشتریِ موجود با همین شماره — با هر شکلی که قبلاً ذخیره شده (۰۹۱۲…، ۹۱۲…، ۹۸۹۱۲…):
// شماره‌ی کامل یا ۱۰ رقم آخر. برای هشدار زنده در فرم ثبت دستی و جلوگیری از ثبت تکراری.
async function findByPhone(user, raw) {
  const phone = normalizePhone(raw);
  const digits = String(phone || '').replace(/\D/g, '');
  if (digits.length < 10) return null;
  const last10 = digits.slice(-10);
  const row = await prisma.lead.findFirst({
    where: { OR: [{ phone }, { phone: { endsWith: last10 } }] },
    select: { id: true, customerName: true, phone: true, ownerId: true, owner: { select: { fullName: true } } },
  });
  if (!row) return null;
  return {
    id: row.id, name: row.customerName || 'بدون نام', phone: row.phone,
    ownerName: row.owner ? row.owner.fullName : '',
    canOpen: !!user && (can(user, 'all_leads') || row.ownerId === user.id),
  };
}

async function createLead(user, body, ownerId, ownerBranchId) {
  const now = new Date();
  const phone = normalizePhone(body.phone);
  if (!phone) throw fail(400, 'شماره تماس را وارد کنید');

  // تشخیص تکراری: اگر همین شماره (با هر فرمتی که قبلاً ثبت شده) قبلاً سرنخ
  // دارد، ثبت رد می‌شود — به‌جای این‌که دو کارشناس روی یک مشتری کار کنند.
  const dup = await findByPhone(user, phone);
  if (dup) {
    throw fail(409, 'این مشتری قبلاً ثبت شده است: «' + dup.name + '»' + (dup.ownerName ? ' — کارشناس: ' + dup.ownerName : ''));
  }

  // اعتبارسنجی تاریخ قبل از هر نوشتنی انجام می‌شود
  const explicitFollowUpDate = toFollowUpDate(body.nextFollowUpDate);
  // ثبت دستی (کارشناس پشت میز): منبع ورود اجباری است؛ تاریخ پیگیری اختیاری
  // («بدون پیگیری» هم مجاز است). ورودی‌های خودکار (فرم سایت، وردست، تماس) شامل نمی‌شوند.
  if (body.manual === true) {
    if (!String(body.channel || '').trim()) throw fail(400, 'منبع ورود مشتری را انتخاب کنید');
  }
  // یادآور دیگر خودکار ساخته نمی‌شود؛ پیگیری از طریق پیگیری گروهی انجام می‌شود و یادآور
  // فقط چیزی است که خودِ کارشناس روی کارت تنظیم می‌کند.
  const nextFollowUpDate = explicitFollowUpDate;
  const nextFollowUpNote = cleanText(body.nextFollowUpNote);
  const lead = await prisma.lead.create({
    data: {
      ownerId,
      branchId: await resolveBranchId(ownerBranchId),
      // نام مشتری اختیاری است: برای سرنخ‌هایی که فقط شماره‌شان را داریم، رشته‌ی
      // خالی ذخیره می‌شود و رابط کاربری به‌جای آن «بدون نام» نشان می‌دهد.
      customerName: String(body.name || '').trim(),
      phone,
      channel: cleanText(body.channel),
      preferredContact: Array.isArray(body.contactMethods) ? body.contactMethods.map(String) : [],
      tags: normalizeTags(body.tags),
      paymentTerms: cleanText(body.payment),
      deliveryType: cleanText(body.delivery),
      currentCar: cleanText(body.currentCar),
      shopName: cleanText(body.shopName),
      city: cleanText(body.city),
      jobType: cleanText(body.jobType),
      status: 'جدید',
      cancelReason: null,
      notes: cleanText(body.notes),
      priceFrom: toPrice(body.priceFrom),
      priceTo: toPrice(body.priceTo),
      nextFollowUpDate,
      nextFollowUpNote,
      createdAt: now,
      updatedAt: now,
    },
    include: LEAD_INCLUDE,
  });
  // ورودی خودکار: «ورود از فرم سایت» یا «ورود از وردست» — هر کدام برچسب خودش را دارد
  const INTAKE_ACTIONS = ['intake', 'intake_vardast'];
  const entryAction = !user && INTAKE_ACTIONS.includes(body.intakeAction) ? body.intakeAction : 'created';
  // ورودی خودکار می‌تواند متن سطر ورود را خودش بدهد (مثلاً خلاصه‌ی گفت‌وگوی وردست) تا یک ورود = یک سطر بماند
  const entrySummary = entryAction !== 'created' && body.intakeSummary ? String(body.intakeSummary) : [lead.customerName, lead.channel].filter(Boolean).join(' · ');
  await audit().log(lead.id, user && user.id, entryAction, entrySummary.slice(0, 190));
  return toLeadOut(lead);
}

function audit() {
  return require('./auditService');
}

// ---------------------------------------------------------------
// مسئول پرونده و «صف مشتریان بدون مسئول»
// سرنخ‌های فرم سایت و ورودی‌های خودکار به‌نام کاربر سیستمیِ «صف» ثبت می‌شوند
// تا هر کارشناس بتواند با «برداشتن» مسئولشان شود.
// ---------------------------------------------------------------
const QUEUE_USERNAME = '__queue__';

async function queueUser() {
  let u = await prisma.user.findUnique({ where: { username: QUEUE_USERNAME } });
  if (!u) {
    const bcrypt = require('bcryptjs');
    u = await prisma.user.create({
      data: {
        username: QUEUE_USERNAME,
        // ورود با این حساب ممکن نیست (حساب غیرفعال و رمز تصادفی)
        passwordHash: bcrypt.hashSync(require('crypto').randomBytes(24).toString('hex'), 10),
        fullName: 'صف مشتریان بدون مسئول',
        role: 'rep',
        isActive: false,
        permissions: 'no_rank',
      },
    });
  }
  return u;
}

async function listQueue() {
  const q = await queueUser();
  const rows = await prisma.lead.findMany({ where: { ownerId: q.id }, include: LEAD_INCLUDE, orderBy: { createdAt: 'desc' }, take: 300 });
  return rows.map(toLeadOut);
}

async function claimLead(user, id) {
  const q = await queueUser();
  const lead = await prisma.lead.findUnique({ where: { id } });
  if (!lead) throw fail(404, 'سرنخ یافت نشد');
  if (lead.ownerId !== q.id) throw fail(409, 'این مشتری قبلاً مسئول دارد');
  const row = await prisma.lead.update({
    where: { id },
    data: { ownerId: user.id, branchId: await resolveBranchId(user.branchId), updatedAt: new Date() },
    include: LEAD_INCLUDE,
  });
  await audit().log(id, user.id, 'claimed', 'مسئول: ' + user.fullName);
  return toLeadOut(row);
}

async function assignLead(user, id, ownerId, reason) {
  if (!can(user, 'all_leads')) throw fail(403, 'تعیین مسئول فقط با دسترسی «همه‌ی مشتری‌ها»');
  const lead = await getOwnedLead(user, id);
  const owner = await prisma.user.findUnique({ where: { id: String(ownerId || '') } });
  if (!owner) throw fail(400, 'مسئول را انتخاب کنید');
  if (owner.id === lead.ownerId) return toLeadOut(lead);
  const row = await prisma.lead.update({
    where: { id },
    data: { ownerId: owner.id, branchId: await resolveBranchId(owner.branchId), updatedAt: new Date() },
    include: LEAD_INCLUDE,
  });
  const names = await audit().userNames([lead.ownerId, owner.id]);
  await audit().log(id, user.id, 'owner_changed', cleanText(reason) || null, [
    { field: 'ownerId', label: 'مسئول پرونده', from: names.get(lead.ownerId) || '—', to: owner.fullName },
  ]);
  return toLeadOut(row);
}

async function updateLead(user, id, body) {
  const existing = await getOwnedLead(user, id);

  // همه‌ی اعتبارسنجی‌ها قبل از ساخته شدن data انجام می‌شوند، تا اگر درخواست رد شد
  // هیچ فیلدی نصفه‌کاره تغییر نکند — همان الگویی که برای status/cancelReason رعایت شده.
  const hasFollowUpDate = body.nextFollowUpDate !== undefined;
  const nextFollowUpDate = hasFollowUpDate ? toFollowUpDate(body.nextFollowUpDate) : undefined;

  const data = { updatedAt: new Date() };
  let statusChange = null;

  if (body.status !== undefined) {
    data.status = body.status;
    data.cancelReason = body.status === 'فروش ناموفق' ? String(body.cancelReason).trim() : null;
    if (body.status !== existing.status) {
      statusChange = { oldStatus: existing.status, newStatus: body.status };
    }
  }

  // سقف طول هر فیلد مثل ستون دیتابیس، تا متن بلند به‌جای پیام روشن خطای ۵۰۰ ندهد
  const short = (v, n) => (v === undefined || v === null ? null : String(v).trim().slice(0, n) || null);
  if (body.name !== undefined) data.customerName = String(body.name || '').trim().slice(0, 191);
  if (body.tags !== undefined) data.tags = normalizeTags(body.tags);
  if (body.phone !== undefined) {
    const phone = (normalizePhone(body.phone) || String(body.phone || '').trim()).slice(0, 32);
    const digits = phone.replace(/\D/g, '');
    if (phone !== existing.phone) {
      if (digits.length < 10) throw fail(400, 'شماره تماس معتبر نیست');
      const dup = await prisma.lead.findFirst({
        where: { id: { not: id }, OR: [{ phone }, { phone: { endsWith: digits.slice(-10) } }] },
        select: { customerName: true },
      });
      if (dup) throw fail(409, 'این شماره برای مشتری دیگری («' + (dup.customerName || 'بدون نام') + '») ثبت است؛ اگر یک نفرند، از «ادغام تکراری‌ها» استفاده کنید');
    }
    data.phone = phone;
  }
  if (body.channel !== undefined) data.channel = short(body.channel, 191);
  if (body.payment !== undefined) data.paymentTerms = short(body.payment, 191);
  if (body.delivery !== undefined) data.deliveryType = short(body.delivery, 191);
  if (body.currentCar !== undefined) data.currentCar = short(body.currentCar, 191);
  if (body.shopName !== undefined) data.shopName = short(body.shopName, 191);
  if (body.city !== undefined) data.city = short(body.city, 100);
  if (body.jobType !== undefined) {
    const job = cleanText(body.jobType);
    if (job && job !== existing.jobType && !JOB_TYPES.includes(job)) throw fail(400, 'نوع مشتری نامعتبر است');
    data.jobType = job ? job.slice(0, 50) : null;
  }
  // کد مشتری در حسابداری آلور — فقط حروف و رقم، تا ۳۲ نویسه
  if (body.alvarCode !== undefined) data.alvarCode = String(body.alvarCode || '').replace(/[۰-۹]/g, (d) => '۰۱۲۳۴۵۶۷۸۹'.indexOf(d)).replace(/[^0-9A-Za-z_/-]/g, '').slice(0, 32) || null;
  if (body.notes !== undefined) data.notes = cleanText(body.notes);
  if (body.contactMethods !== undefined && Array.isArray(body.contactMethods)) {
    data.preferredContact = body.contactMethods.map(String);
  }
  if (body.priceFrom !== undefined) data.priceFrom = toPrice(body.priceFrom);
  if (body.priceTo !== undefined) data.priceTo = toPrice(body.priceTo);
  // مدل فروخته‌شده فقط وقتی وضعیت «موفق» می‌شود ثبت می‌شود — برای گزارش «فروش به تفکیک مدل»
  if (body.soldCompany !== undefined) data.soldCompany = short(body.soldCompany, 191);
  if (body.soldModel !== undefined) data.soldModel = short(body.soldModel, 191);
  if (body.soldPrice !== undefined) data.soldPrice = toPrice(body.soldPrice);
  if (hasFollowUpDate) data.nextFollowUpDate = nextFollowUpDate;
  if (body.nextFollowUpNote !== undefined) data.nextFollowUpNote = cleanText(body.nextFollowUpNote);

  // همه‌ی تغییرها در یک تراکنش انجام می‌شوند تا اگر جایی خطا داد، رکورد نیمه‌کاره نماند.
  const updated = await prisma.$transaction(async (tx) => {
    const row = await tx.lead.update({ where: { id }, data, include: LEAD_INCLUDE });
    if (statusChange) {
      await tx.leadStatusHistory.create({
        data: {
          leadId: id,
          oldStatus: statusChange.oldStatus,
          newStatus: statusChange.newStatus,
          changedBy: user.id,
        },
      });
    }
    return row;
  });

  const changes = audit().diff(existing, data);
  if (changes.length) await audit().log(id, user.id, 'updated', null, changes);
  return toLeadOut(updated);
}

// حذف مشتری فقط برای مدیر؛ پیگیری‌ها و سوابق وابسته هم پاک می‌شوند (تماس‌ها و پیامک‌ها بدون مشتری می‌مانند).
// قبل از حذف، کل پرونده (با سوابق و ردیف مدارک) در data/deleted-leads ذخیره می‌شود تا حذف اشتباهی
// بدون بازیابی کل بکاپ قابل برگشت باشد؛ فایل عکس مدرک‌ها هم روی دیسک می‌ماند.
async function archiveLeads(user, ids) {
  const leads = await prisma.lead.findMany({
    where: { id: { in: ids } },
    include: {
      vehicles: true, followups: true, statusHistory: true, pipelineItems: true, audits: true,
      tasks: true, salesReports: true, kycDocuments: true,
      callLogs: { select: { id: true } }, smsLogs: { select: { id: true } },
    },
  });
  if (!leads.length) return 0;
  const fs = require('fs');
  const path = require('path');
  const dir = path.join(__dirname, '../../../data/deleted-leads');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, new Date().toISOString().replace(/[:.]/g, '-') + '-' + leads.length + '.json');
  fs.writeFileSync(file, JSON.stringify({ deletedAt: new Date(), deletedBy: { id: user.id, name: user.fullName }, leads }, (k, v) => (typeof v === 'bigint' ? String(v) : v), 1));
  console.log('[حذف مشتری] ' + leads.length + ' پرونده توسط ' + (user.fullName || user.id) + ' — نسخه در ' + path.basename(file));
  return leads.length;
}

async function deleteLead(user, id) {
  if (!user || user.role !== 'manager') throw fail(403, 'حذف مشتری فقط برای مدیر است');
  await getOwnedLead(user, id);
  await archiveLeads(user, [id]);
  await prisma.lead.delete({ where: { id } });
}

async function deleteLeads(user, ids) {
  if (!user || user.role !== 'manager') throw fail(403, 'حذف مشتری فقط برای مدیر است');
  const list = [...new Set((Array.isArray(ids) ? ids : []).map(String).filter(Boolean))].slice(0, 1000);
  if (!list.length) throw fail(400, 'هیچ مشتری انتخاب نشده');
  await archiveLeads(user, list);
  const r = await prisma.lead.deleteMany({ where: { id: { in: list } } });
  return r.count;
}

// قدم‌های «پیگیری مرحله اول»: پیام (همیشه اول) + تماس‌های شماره‌دار به هر
// تعداد (کارشناس با دکمه‌ی «+» می‌تواند تماس ۴، ۵، … هم اضافه کند). ترتیب هم
// در سرور enforce می‌شود، نه فقط در رابط کاربری، چون کاربر می‌تواند درخواست
// را مستقیم بفرستد.
function isFirstTouchStep(step) {
  return step === 'message' || /^call([1-9]\d*)$/.test(step);
}

// قدم قبلیِ لازم برای اینکه step فعلی مجاز باشد؛ برای «message» چیزی لازم
// نیست، برای «call1» باید «message» انجام شده باشد، برای «callN» باید
// «call(N-1)» انجام شده باشد.
function prevFirstTouchStep(step) {
  if (step === 'message') return null;
  const m = /^call([1-9]\d*)$/.exec(step);
  const n = Number(m[1]);
  return n === 1 ? 'message' : 'call' + (n - 1);
}

async function addFollowup(user, id, body) {
  const lead = await getOwnedLead(user, id);
  let followupDate = body.followupDate ? new Date(body.followupDate) : new Date();
  if (isNaN(followupDate.getTime())) followupDate = new Date();

  // «ثبت تماس» از پروفایل مشتری (بدون پیگیری گروهی): نتیجه اجباری، متن اختیاری،
  // و تاریخ تماس نمی‌تواند در آینده باشد.
  const isCall = body.kind === 'call';
  if (isCall) {
    if (!CALL_OUTCOMES.includes(body.outcome)) throw fail(400, 'نتیجه‌ی تماس را انتخاب کنید');
    const endOfToday = new Date();
    endOfToday.setHours(23, 59, 59, 999);
    if (followupDate > endOfToday) throw fail(400, 'تاریخ تماس نمی‌تواند بعد از امروز باشد');
  }

  const step = !isCall && body.step && isFirstTouchStep(body.step) ? body.step : null;

  const data = {
    leadId: lead.id,
    userId: await creditUserId(user, lead.ownerId),
    followupDate,
    content: String(body.content || '').trim() || (isCall ? 'تماس تلفنی' : ''),
    outcome: cleanText(body.outcome),
    messageSent: !!body.messageSent,
    viaSocialMedia: !!body.viaSocialMedia,
    step,
  };

  // تاریخ پیگیری بعدیِ دستی (اختیاری) — قبل از هر نوشتنی اعتبارسنجی می‌شود
  const explicitNext = toFollowUpDate(body.nextFollowUpDate);
  const explicitNextNote = cleanText(body.nextFollowUpNote);

  const result = await prisma.$transaction(async (tx) => {
    let f;
    let isNewStep = false;
    if (step) {
      // ترتیب را همین‌جا هم چک می‌کنیم: قدم قبلی باید قبلاً ثبت شده باشد.
      const prevStep = prevFirstTouchStep(step);
      if (prevStep) {
        const prevDone = await tx.followup.findUnique({
          where: { leadId_step: { leadId: lead.id, step: prevStep } },
        });
        if (!prevDone) throw fail(400, 'ابتدا قدم قبلی را ثبت کنید');
      }
      const existing = await tx.followup.findUnique({
        where: { leadId_step: { leadId: lead.id, step } },
        select: { id: true },
      });
      isNewStep = !existing;
      // اگر این قدم قبلاً ثبت شده، همان ردیف ویرایش می‌شود نه یک ردیف تازه —
      // وگرنه هر بار که کارشناس یادداشتش را اصلاح می‌کند، در گزارش «پیگیری
      // امروز» چند بار شمرده می‌شود.
      f = await tx.followup.upsert({
        where: { leadId_step: { leadId: lead.id, step } },
        update: data,
        create: data,
        include: { user: { select: { fullName: true } } },
      });
    } else {
      f = await tx.followup.create({ data, include: { user: { select: { fullName: true } } } });
    }

    const now = new Date();
    const leadData = { updatedAt: now };

    if (step && isNewStep) {
      // --- پیشرفت خودکار وضعیت ---
      // اولین پیام → «تماس اولیه/ارسال پیام»؛ اولین تماس واقعی → «در حال پیگیری».
      // بعد از آن مراحل بعدی (مراجعه حضوری / فروش) تصمیم کارشناس است، نه خودکار.
      let newStatus = null;
      if (step === 'message' && lead.status === 'جدید') newStatus = 'تماس اولیه/ارسال پیام';
      else if (/^call/.test(step) && (lead.status === 'جدید' || lead.status === 'تماس اولیه/ارسال پیام')) {
        newStatus = 'در حال پیگیری';
      }
      if (newStatus) {
        leadData.status = newStatus;
        await tx.leadStatusHistory.create({
          data: { leadId: lead.id, oldStatus: lead.status, newStatus, changedBy: user.id },
        });
      }

      // --- زمان‌بندی خودکار قدم بعدی ---
      // این همان چیزی است که سرنخ را از «لیست وظایف» امروز بیرون می‌برد و فردا
      // (یا هر وقت موعدش رسید) دوباره برمی‌گرداند. کارشناس لازم نیست تاریخ
      // انتخاب کند؛ اگر خواست، تاریخ دستی در پاپ‌آپ بر این اولویت دارد.
      const finalStatus = newStatus || lead.status;
      const closed = finalStatus === 'فروش موفق' || finalStatus === CANCELLED_STATUS;
      if (explicitNext) {
        leadData.nextFollowUpDate = explicitNext;
        leadData.nextFollowUpNote = explicitNextNote || nextStepNote(step);
      } else if (!closed) {
        const days = nextStepDelayDays(step);
        const next = new Date(now);
        next.setDate(next.getDate() + days);
        next.setHours(10, 0, 0, 0);
        leadData.nextFollowUpDate = next;
        leadData.nextFollowUpNote = nextStepNote(step);
      }
    } else if (explicitNext) {
      leadData.nextFollowUpDate = explicitNext;
      leadData.nextFollowUpNote = explicitNextNote;
    } else if (Cycle.isStep(lead.purchaseFollowStep)) {
      // مشتریِ خریدکرده: همین پیگیری قدم بعدیِ چرخه را می‌گذارد
      // (۲ روز ارسال → ۵ تا ۷ روز سفارش جدید → هر ۲ هفته دوره‌ای)
      Object.assign(leadData, Cycle.advance(lead.purchaseFollowStep, now));
    }

    const updatedLead = await tx.lead.update({ where: { id: lead.id }, data: leadData, include: LEAD_INCLUDE });
    return { followup: f, lead: updatedLead };
  });

  // شناسه‌ی پیگیری در سابقه‌ی پرونده ذخیره می‌شود (فیلد مخفی، نمایش داده نمی‌شود) تا
  // بعداً از همان‌جا بشود این کارت را اصلاح کرد — فقط برای پیگیری‌های آزاد، نه مراحل اول
  const fuRef = step ? [] : [{ field: '_followupId', label: '', from: '', to: result.followup.id }];
  // نوع پیگیری و پیگیری بعدیِ همین ثبت — در سوابق نشان داده می‌شود تا معلوم باشد پیگیری از کجا آمده
  const kindLabel = String(body.kindLabel || '').trim().slice(0, 60);
  if (kindLabel) fuRef.push({ field: '_fuKind', label: '', from: '', to: kindLabel });
  if (explicitNext) fuRef.push({ field: '_fuNext', label: '', from: '', to: explicitNext.toISOString() });
  await audit().log(lead.id, user.id, 'followup', (kindLabel ? String(body.content || '') : [body.outcome, body.content].filter(Boolean).join(' — ')).slice(0, 190), fuRef);
  return { followup: toFollowupOut(result.followup), lead: toLeadOut(result.lead) };
}

// اصلاح یک پیگیری آزاد که قبلاً ثبت شده (غلط‌تایپی، نتیجه‌ی اشتباه). فقط محتوا و
// نتیجه عوض می‌شود — نه تاریخ، نه مرحله، نه اثرهای خودکارش (وضعیت/پیگیری بعدی) که
// فقط موقع ثبت اولیه اعمال می‌شوند. مراحل اول پیگیری (step) از باکس خودشان ویرایش می‌شوند.
async function editFollowup(user, id, followupId, body) {
  const lead = await getOwnedLead(user, id);
  const f = await prisma.followup.findUnique({ where: { id: String(followupId || '') } });
  if (!f || f.leadId !== lead.id) throw fail(404, 'پیگیری پیدا نشد');
  if (f.step) throw fail(400, 'این مرحله را با کلیک روی باکسش ویرایش کنید');
  // فیلدی که نیامده دست‌نخورده می‌ماند — فرم‌های ساده‌تر (مثلاً فقط یادداشت) نتیجه‌ی قبلی را پاک نمی‌کنند
  const content = body.content !== undefined ? cleanText(body.content) || '' : f.content;
  const outcome = body.outcome !== undefined ? cleanText(body.outcome) : f.outcome;
  const messageSent = body.messageSent !== undefined ? !!body.messageSent : f.messageSent;
  const viaSocialMedia = body.viaSocialMedia !== undefined ? !!body.viaSocialMedia : f.viaSocialMedia;
  if (!content && !outcome) throw fail(400, 'محتوا یا نتیجه را وارد کنید');
  const updated = await prisma.followup.update({
    where: { id: f.id },
    data: { content, outcome, messageSent, viaSocialMedia },
    include: { user: { select: { fullName: true } } },
  });
  await audit().log(lead.id, user.id, 'followup_edited', [outcome, content].filter(Boolean).join(' — ').slice(0, 190), [{ field: '_followupId', label: '', from: '', to: updated.id }]);
  return toFollowupOut(updated);
}

// برنامه‌ی پیگیری بعد از هر قدم مرحله اول — همان ریتم ساده‌ای که با کاربر
// توافق شد: سه روز اول هر روز یک تماس، بعد از آن هر سه روز.
function nextStepDelayDays(step) {
  const m = /^call(\d+)$/.exec(step);
  const n = m ? Number(m[1]) : 0; // message = 0
  return n < 3 ? 1 : 3;
}

function nextStepNote(step) {
  const m = /^call(\d+)$/.exec(step);
  const n = m ? Number(m[1]) + 1 : 1;
  return 'تماس ' + Jalali.toFaDigits(String(n)) + ' با مشتری';
}

// فهرست برچسب‌های قابل انتخاب: برچسب‌های آماده به‌علاوه‌ی هر برچسبی که تا امروز
// روی یک سرنخ ثبت شده. به این ترتیب برچسبی که یک‌بار ساخته شد، دفعه‌ی بعد برای
// همه از فهرست قابل انتخاب است و لازم نیست دوباره تایپ شود.
async function knownTags() {
  const rows = await prisma.lead.findMany({ select: { tags: true } });
  const all = DEFAULT_TAGS.slice();
  for (const row of rows) {
    for (const tag of normalizeTags(row.tags)) {
      if (!all.includes(tag)) all.push(tag);
    }
  }
  return all;
}

// فهرست سرنخ‌هایی که پیگیری‌شان امروز است یا عقب افتاده — برای کارت داشبورد مدیر.
// اگر شعبه‌ای انتخاب شده باشد، فقط همان شعبه شمرده می‌شود.
async function dueFollowUps(branchId, limit) {
  const where = Object.assign({}, dueFollowUpWhere(), branchId ? { branchId } : {});
  const rows = await prisma.lead.findMany({
    where,
    include: LEAD_INCLUDE,
    orderBy: { nextFollowUpDate: 'asc' },
    take: limit || 50,
  });
  return rows.map(toLeadOut);
}

// ---------- لیست وظایف ----------

// همه‌چیزی که صفحهٔ «لیست وظایف» لازم دارد، در یک رفت‌وبرگشت.
//
// چرا یک تابع جدا و نه استفاده از listLeads؟ چون این صفحه باید بگوید «چه کار
// کن» — یعنی دسته‌های متفاوت با معیارهای متفاوت، به‌علاوهٔ شمارش‌ها. اگر همین
// را با چند بار صدا زدن listLeads بسازیم، هم کند می‌شود و هم منطق دسته‌بندی
// در فرانت‌اند تکرار می‌شود.
//
// محدودهٔ دسترسی مثل بقیهٔ جاها از scopeWhere می‌آید: کارشناس فقط سرنخ‌های
// خودش را می‌بیند، مدیر همه — یا با query.ownerId فقط یک کارشناس مشخص.
//
// query.range بازهٔ فهرست پیگیری‌ها را تعیین می‌کند:
//   today    (پیش‌فرض) عقب‌افتاده‌ها + پیگیری‌های امروز
//   tomorrow فقط پیگیری‌های فردا
//   all      هر سرنخی که یادآوری دارد، از عقب‌افتاده تا آینده
// شمارش کارت‌ها به بازه ربطی ندارد و همیشه کامل است.
const TASK_RANGES = ['today', 'tomorrow', 'all'];

async function todayWork(user, query) {
  const q = query || {};
  const range = TASK_RANGES.indexOf(q.range) !== -1 ? q.range : 'today';
  const base = scopeWhere(user, q);

  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const endOfToday = new Date();
  endOfToday.setHours(23, 59, 59, 999);

  const startOfTomorrow = new Date(startOfToday);
  startOfTomorrow.setDate(startOfTomorrow.getDate() + 1);
  const endOfTomorrow = new Date(endOfToday);
  endOfTomorrow.setDate(endOfTomorrow.getDate() + 1);

  const startOfMonth = new Date();
  startOfMonth.setDate(1);
  startOfMonth.setHours(0, 0, 0, 0);

  const notCancelled = { status: { not: CANCELLED_STATUS } };

  // عقب‌افتاده: موعد یادآوری قبل از امروز بوده و هنوز انجام نشده
  const overdueWhere = Object.assign({}, base, notCancelled, {
    nextFollowUpDate: { not: null, lt: startOfToday },
  });
  const todayWhere = Object.assign({}, base, notCancelled, {
    nextFollowUpDate: { gte: startOfToday, lte: endOfToday },
  });
  const tomorrowWhere = Object.assign({}, base, notCancelled, {
    nextFollowUpDate: { gte: startOfTomorrow, lte: endOfTomorrow },
  });

  // بدون پیگیری بعدی: هنوز «جدید» است و هیچ یادآوری برایش تنظیم نشده.
  // این‌ها سرنخ‌هایی‌اند که در سکوت فراموش می‌شوند.
  const idleWhere = Object.assign({}, base, {
    status: 'جدید',
    nextFollowUpDate: null,
  });

  // شرط فهرست بر اساس بازهٔ انتخابی
  let listWhere;
  if (range === 'tomorrow') {
    listWhere = tomorrowWhere;
  } else if (range === 'all') {
    listWhere = Object.assign({}, base, notCancelled, { nextFollowUpDate: { not: null } });
  } else {
    listWhere = Object.assign({}, base, notCancelled, { nextFollowUpDate: { not: null, lte: endOfToday } });
  }

  // شمارش‌ها جدا از فهرست‌ها گرفته می‌شوند: فهرست‌ها سقف دارند و اگر عدد کارت
  // را از طول فهرست بسازیم، در حجم بالا عدد اشتباه نشان می‌دهد.
  const [followUps, idle, followUpsTotal, overdueCount, todayCount, tomorrowCount, idleCount, wonThisMonth, newToday] =
    await Promise.all([
      prisma.lead.findMany({
        where: listWhere,
        include: LEAD_INCLUDE,
        orderBy: { nextFollowUpDate: 'asc' },
        take: 200,
      }),
      prisma.lead.findMany({
        where: idleWhere,
        include: LEAD_INCLUDE,
        orderBy: { createdAt: 'asc' }, // قدیمی‌ترینِ رهاشده اول
        take: 200,
      }),
      prisma.lead.count({ where: listWhere }),
      prisma.lead.count({ where: overdueWhere }),
      prisma.lead.count({ where: todayWhere }),
      prisma.lead.count({ where: tomorrowWhere }),
      prisma.lead.count({ where: idleWhere }),
      prisma.lead.count({
        where: Object.assign({}, base, { status: 'فروش موفق', updatedAt: { gte: startOfMonth } }),
      }),
      prisma.lead.count({
        where: Object.assign({}, base, { createdAt: { gte: startOfToday, lte: endOfToday } }),
      }),
    ]);

  return {
    range,
    counts: {
      overdue: overdueCount,
      today: todayCount,
      tomorrow: tomorrowCount,
      idle: idleCount,
      wonThisMonth,
      newToday,
    },
    followUpsTotal,
    followUps: followUps.map(toLeadOut),
    idle: idle.map(toLeadOut),
  };
}

// ---------- گزارش‌ها ----------


module.exports = {
  findByPhone,
  listLeads,
  segmentCounts,
  getLeadDetail,
  getOwnedLead,
  createLead,
  updateLead,
  deleteLead,
  deleteLeads,
  addFollowup,
  editFollowup,
  knownTags,
  dueFollowUps,
  todayWork,
  toLeadOut,
  queueUser,
  listQueue,
  claimLead,
  assignLead,
};
