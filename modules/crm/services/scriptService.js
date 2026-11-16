// جمله‌های آماده‌ی فروش (kind=script) و الگوهای پیامک بر اساس موضوع (kind=sms) — جدول sales_scripts
const { prisma } = require('../../../shared/prisma');
const { DEFAULT_SCRIPTS, DEFAULT_SMS } = require('../../../shared/workdesk');

function fail(status, message) {
  const e = new Error(message);
  e.status = status;
  return e;
}

// CRM نمونه: گزینه‌های «چه شد؟» کارت‌های استیکردار ثبت پیگیری هم از تنظیمات تعریف می‌شوند
const FU_DEFAULTS = {
  fu_ok: ['فقط قیمت پرسید', 'به قیمت اعتراض کرد', 'سفارش داد', 'منتظر موجودی است', 'مقایسه می‌کند', 'بعداً تماس بگیرم', 'منصرف شد'],
  fu_noanswer: ['خاموش بود', 'مشغول بود', 'رد تماس داد', 'پیام گذاشتم'],
  fu_msg: ['لیست قیمت فرستادم', 'عکس محصول فرستادم', 'پیام یادآوری', 'لینک احراز فرستادم'],
  fu_visit: ['محصول را دید', 'قیمت گرفت', 'خرید کرد', 'پیش‌پرداخت داد'],
};
const KINDS = ['script', 'sms'].concat(Object.keys(FU_DEFAULTS));

function scriptOut(r) {
  return { id: r.id, kind: r.kind, topic: r.topic || '', title: r.title, body: r.body, isActive: r.isActive, sortOrder: r.sortOrder, updatedAt: r.updatedAt.getTime() };
}

// اولین بار که فهرست خالی است، متن‌های پیش‌فرض ساخته می‌شوند
async function ensureDefaults(kind) {
  if (await prisma.salesScript.count({ where: { kind } })) {
    if (kind === 'sms') await ensureSmsTopics();
    return;
  }
  const list = FU_DEFAULTS[kind] ? FU_DEFAULTS[kind].map((t) => ({ title: t, body: t })) : kind === 'sms' ? DEFAULT_SMS : DEFAULT_SCRIPTS;
  await prisma.salesScript.createMany({
    data: list.map((x, i) => ({ kind, topic: x.topic || null, title: x.title, body: x.body, sortOrder: i })),
  });
}

// الگوهای پیامکِ تازه (مثلاً پیامک خودکار استعلام دوم) به نصب‌های قبلی هم اضافه می‌شوند
async function ensureSmsTopics() {
  const topics = DEFAULT_SMS.filter((x) => x.topic).map((x) => x.topic);
  const have = await prisma.salesScript.findMany({ where: { kind: 'sms', topic: { in: topics } }, select: { topic: true } });
  const set = new Set(have.map((r) => r.topic));
  const missing = DEFAULT_SMS.filter((x) => x.topic && !set.has(x.topic));
  if (!missing.length) return;
  const n = await prisma.salesScript.count({ where: { kind: 'sms' } });
  await prisma.salesScript.createMany({
    data: missing.map((x, i) => ({ kind: 'sms', topic: x.topic, title: x.title, body: x.body, sortOrder: n + i })),
  });
}

async function list(kind, activeOnly) {
  if (!KINDS.includes(kind)) throw fail(400, 'نوع متن نامعتبر است');
  await ensureDefaults(kind);
  const rows = await prisma.salesScript.findMany({
    where: Object.assign({ kind }, activeOnly ? { isActive: true } : {}),
    orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
  });
  return rows.map(scriptOut);
}

function clean(body) {
  const b = body || {};
  const title = String(b.title || '').trim().slice(0, 120);
  const text = String(b.body || '').trim().slice(0, 4000);
  if (!title) throw fail(400, 'عنوان را بنویسید');
  if (!text) throw fail(400, 'متن را بنویسید');
  return { title, body: text, topic: b.topic ? String(b.topic).trim().slice(0, 64) : null, isActive: b.isActive !== false, sortOrder: Number(b.sortOrder) || 0 };
}

async function create(user, kind, body) {
  if (!KINDS.includes(kind)) throw fail(400, 'نوع متن نامعتبر است');
  return scriptOut(await prisma.salesScript.create({ data: Object.assign({ kind, updatedBy: user.id }, clean(body)) }));
}

async function update(user, id, body) {
  const row = await prisma.salesScript.update({ where: { id }, data: Object.assign({ updatedBy: user.id }, clean(body)) }).catch(() => {
    throw fail(404, 'متن پیدا نشد');
  });
  return scriptOut(row);
}

async function byTopic(topic) {
  await ensureDefaults('sms');
  return prisma.salesScript.findFirst({ where: { kind: 'sms', topic, isActive: true }, orderBy: { sortOrder: 'asc' } });
}

// جای‌گذاری {نام}، {لینک}، {دلیل}، {کارشناس} و هر کلید دیگر
function fill(text, vars) {
  return String(text || '').replace(/\{([^{}]+)\}/g, (m, k) => (vars && vars[k] !== undefined && vars[k] !== null ? String(vars[k]) : ''));
}

// هر کارشناس می‌تواند متن کوتاه‌دستی برای پیگیری اضافه کند (بدون نیاز به دسترسی admin)
async function quickAdd(user, kind, body) {
  const allowed = ['fu_ok', 'fu_noanswer', 'fu_msg', 'fu_visit', 'script', 'sms'];
  if (!allowed.includes(kind)) throw fail(400, 'نوع متن نامعتبر است');
  // افزودن سریع فقط متن ساده می‌سازد؛ موضوع (مثل «لینک احراز») و ترتیب فقط با «مدیریت جمله‌های آماده»
  const b = body || {};
  return create(user, kind, { title: b.title, body: b.body });
}

// گزینه‌های افزوده‌شده به منوهای کشویی (نتیجه‌ی تماس، دلیل ثبت‌نشدن، …) — kind=opt و topic=نام منو
async function listChoices() {
  const rows = await prisma.salesScript.findMany({ where: { kind: 'opt', isActive: true }, orderBy: { createdAt: 'asc' } });
  const out = {};
  rows.forEach((r) => { (out[r.topic] = out[r.topic] || []).push(r.title); });
  return out;
}

async function addChoice(user, key, label) {
  key = String(key || '').trim();
  if (!/^[a-z_]{1,40}$/.test(key)) throw fail(400, 'منوی نامعتبر');
  const text = String(label || '').replace(/[,،]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 40);
  if (!text) throw fail(400, 'متن گزینه را بنویسید');
  const dup = await prisma.salesScript.findFirst({ where: { kind: 'opt', topic: key, title: text } });
  if (dup) return { key, label: text };
  await prisma.salesScript.create({ data: { kind: 'opt', topic: key, title: text, body: text, updatedBy: user.id } });
  return { key, label: text };
}

module.exports = { list, create, update, byTopic, fill, quickAdd, listChoices, addChoice };
