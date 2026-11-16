// ارسال پیامک (IPPanel). کلید API و شماره‌ی خط را مدیر در «تنظیمات ← سامانه‌ی پیامکی» می‌گذارد
// (جدول settings، کلید smsPanel)؛ اگر آنجا خالی باشد از .env خوانده می‌شود (IPPANEL_API_KEY / IPPANEL_SENDER).
// اگر هیچ‌کدام تنظیم نشده باشد، پیامک «دستی» ثبت می‌شود: متن آماده به کارشناس نشان داده می‌شود
// تا از گوشی خودش بفرستد، و در سابقه‌ی پرونده هم می‌ماند.
const { prisma } = require('../../../shared/prisma');
const { normalizePhone } = require('../../../shared/phone');

const URL = process.env.IPPANEL_URL || 'https://api2.ippanel.com/api/v1/sms/send/webservice/single';
const EDGE_URL = process.env.IPPANEL_EDGE_URL || 'https://edge.ippanel.com/v1/api/send';
const KEY_REJECTED = 'کلید API را سامانه‌ی پیامکی نپذیرفت (401) — کلید را دوباره کامل از پنل کپی کنید';
const CONFIG_KEY = 'smsPanel';
let cache = { at: 0, cfg: null };

// کلید چسبانده‌شده را تمیز می‌کند: «IPPANEL_API_KEY=…»، «apikey: …»، «Bearer …»، گیومه و فاصله
function cleanKey(v) {
  return String(v || '').trim()
    .replace(/^(IPPANEL_API_KEY|API_KEY|apikey|api-key|Authorization)\s*[=:]\s*/i, '')
    .replace(/^(Bearer|AccessKey)\s+/i, '')
    .replace(/^["']|["']$/g, '')
    .replace(/\s+/g, '');
}

function fail(status, message) { const e = new Error(message); e.status = status; return e; }

async function readSaved() {
  const row = await prisma.setting.findUnique({ where: { key: CONFIG_KEY } });
  if (!row) return {};
  try { return JSON.parse(row.value) || {}; } catch (e) { return {}; }
}

async function config() {
  if (cache.cfg && Date.now() - cache.at < 30000) return cache.cfg;
  const s = await readSaved();
  const cfg = s.apiKey && s.sender
    ? { apiKey: cleanKey(s.apiKey), sender: s.sender, source: 'settings', lastTest: s.lastTest || null }
    : { apiKey: cleanKey(process.env.IPPANEL_API_KEY), sender: process.env.IPPANEL_SENDER || '', source: process.env.IPPANEL_API_KEY ? 'env' : '', lastTest: s.lastTest || null };
  cache = { at: Date.now(), cfg };
  return cfg;
}

async function configured() {
  const c = await config();
  return !!(c.apiKey && c.sender);
}

// چیزی که به مرورگر برمی‌گردد — کلید هیچ‌وقت کامل برنمی‌گردد
async function publicConfig() {
  const c = await config();
  return {
    configured: !!(c.apiKey && c.sender),
    provider: 'IPPanel',
    sender: c.sender || '',
    keyHint: c.apiKey ? '…' + String(c.apiKey).slice(-4) : '',
    source: c.source,
    lastTest: c.lastTest,
  };
}

async function saveConfig(userId, body) {
  const b = body || {};
  const s = await readSaved();
  if (b.disable === true) {
    delete s.apiKey;
    delete s.sender;
  } else {
    if (b.apiKey !== undefined && String(b.apiKey).trim()) s.apiKey = cleanKey(b.apiKey);
    if (b.sender !== undefined && String(b.sender).trim()) {
      const sender = String(b.sender).replace(/[\s-]/g, '');
      if (!/^\+?\d{4,20}$/.test(sender)) throw fail(400, 'شماره‌ی خط فقط رقم است (مثلاً 3000505 یا +983000505)');
      s.sender = sender;
    }
    if (!s.apiKey || !s.sender) throw fail(400, 'کلید API و شماره‌ی خط هر دو لازم است');
  }
  const data = { value: JSON.stringify(s), updatedAt: new Date(), updatedBy: userId || null };
  await prisma.setting.upsert({ where: { key: CONFIG_KEY }, create: Object.assign({ key: CONFIG_KEY }, data), update: data });
  cache = { at: 0, cfg: null };
  return publicConfig();
}

// کلیدهای پنل جدید IPPanel (Edge) شکل base64 از «uuid + رشته» دارند؛ کلیدهای قدیمی به api2 می‌روند
function isEdgeKey(key) {
  try { return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i.test(Buffer.from(String(key), 'base64').toString('utf8')); } catch (e) { return false; }
}

function intl(num) {
  const d = String(num).replace(/\D/g, '');
  if (d.startsWith('98')) return '+' + d;
  if (d.startsWith('0')) return '+98' + d.slice(1);
  return '+98' + d;
}

async function deliverEdge(c, phone, body) {
  const res = await fetch(EDGE_URL, {
    method: 'POST',
    headers: { Authorization: c.apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ sending_type: 'webservice', from_number: intl(c.sender), message: body, params: { recipients: [intl(phone)] } }),
    signal: AbortSignal.timeout(15000),
  });
  const data = await res.json().catch(() => ({}));
  const meta = data.meta || {};
  if (!res.ok || meta.status === false) {
    return { status: 'failed', error: (res.status === 401 ? KEY_REJECTED : String(meta.message || data.message || 'HTTP ' + res.status)).slice(0, 190) };
  }
  const ids = data.data && (data.data.message_outbox_ids || data.data.message_id);
  return { status: 'sent', providerRef: ids ? String(Array.isArray(ids) ? ids[0] : ids) : null };
}

async function deliver(phone, body) {
  const c = await config();
  if (!c.apiKey || !c.sender) return { status: 'manual' };
  try {
    if (isEdgeKey(c.apiKey)) return await deliverEdge(c, phone, body);
    const res = await fetch(URL, {
      method: 'POST',
      headers: { apikey: c.apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ recipient: [phone], sender: c.sender, message: body }),
      signal: AbortSignal.timeout(15000),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || (data.status && String(data.status).toUpperCase() !== 'OK')) {
      return { status: 'failed', error: (res.status === 401 ? KEY_REJECTED : String(data.message || data.error || 'HTTP ' + res.status)).slice(0, 190) };
    }
    const ref = data.data && (data.data.message_id || data.data.bulk_id);
    return { status: 'sent', providerRef: ref ? String(ref) : null };
  } catch (e) {
    return { status: 'failed', error: String(e.message).slice(0, 190) };
  }
}

// ارسال + ثبت در sms_logs. خروجی: { status: sent | failed | manual, body, phone }
async function send({ phone, body, leadId, userId, topic }) {
  const p = normalizePhone(phone);
  if (!p) throw fail(400, 'شماره‌ی همراه معتبر نیست');
  const text = String(body || '').trim().slice(0, 1000);
  if (!text) throw fail(400, 'متن پیامک خالی است');
  const r = await deliver(p, text);
  await prisma.smsLog.create({
    data: { leadId: leadId || null, phone: p, topic: topic || null, body: text, status: r.status, providerRef: r.providerRef || null, error: r.error || null, userId: userId || null },
  });
  return { status: r.status, error: r.error || null, body: text, phone: p };
}

// پیامک آزمایشی از صفحه‌ی تنظیمات؛ نتیجه کنار تنظیمات نگه داشته می‌شود
async function test(userId, phone) {
  if (!(await configured())) throw fail(400, 'اول کلید API و شماره‌ی خط را ذخیره کنید');
  const r = await send({ phone, body: 'پیامک آزمایشی CRM CRM نمونه — اتصال سامانه‌ی پیامکی برقرار است.', userId, topic: 'آزمایش' });
  const s = await readSaved();
  s.lastTest = { at: Date.now(), status: r.status, error: r.error || '', phone: r.phone };
  const data = { value: JSON.stringify(s), updatedAt: new Date(), updatedBy: userId || null };
  await prisma.setting.upsert({ where: { key: CONFIG_KEY }, create: Object.assign({ key: CONFIG_KEY }, data), update: data });
  cache = { at: 0, cfg: null };
  return Object.assign(r, { config: await publicConfig() });
}

// فهرست همه‌ی پیامک‌های فرستاده‌شده: چه متنی، چه کسی فرستاده، برای چه مشتری‌ای
const SMS_STATUS = { sent: 'فرستاده شد', failed: 'ناموفق', manual: 'دستی (پنل وصل نیست)' };
const SMS_TOPIC = {
  kyc_link: 'لینک احراز همکاری', kyc_remind: 'یادآوری تکمیل مدارک',
  kyc_approved: 'تأیید همکاری', kyc_rejected: 'رد مدارک',
};
async function listAll(q) {
  const o = q || {};
  const where = {};
  if (o.status && SMS_STATUS[o.status]) where.status = o.status;
  if (o.userId) where.userId = String(o.userId);
  if (o.from || o.to) {
    where.createdAt = {};
    if (Number(o.from) > 0) where.createdAt.gte = new Date(Number(o.from));
    if (Number(o.to) > 0) where.createdAt.lt = new Date(Number(o.to));
  }
  const search = String(o.q || '').trim();
  if (search) {
    const p = normalizePhone(search);
    where.OR = [{ body: { contains: search } }, { phone: { contains: p || search } }, { lead: { customerName: { contains: search } } }];
  }
  const rows = await prisma.smsLog.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: Math.min(Number(o.limit) || 300, 1000),
    include: { lead: { select: { id: true, customerName: true } } },
  });
  const ids = [...new Set(rows.map((r) => r.userId).filter(Boolean))];
  const users = ids.length ? await prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, fullName: true } }) : [];
  const names = new Map(users.map((u) => [u.id, u.fullName]));
  return {
    rows: rows.map((r) => ({
      id: r.id, at: r.createdAt.getTime(), phone: r.phone, topic: SMS_TOPIC[r.topic] || r.topic || '', body: r.body,
      status: r.status, statusLabel: SMS_STATUS[r.status] || r.status, error: r.error || '',
      leadId: r.leadId || '', leadName: r.lead ? r.lead.customerName || '' : '',
      by: r.userId ? names.get(r.userId) || '' : 'سیستم',
    })),
  };
}

async function listForLead(leadId) {
  const rows = await prisma.smsLog.findMany({ where: { leadId }, orderBy: { createdAt: 'desc' }, take: 100 });
  return rows.map((r) => ({ id: r.id, topic: r.topic || '', body: r.body, status: r.status, error: r.error || '', createdAt: r.createdAt.getTime(), userId: r.userId }));
}

module.exports = { send, configured, listForLead, listAll, publicConfig, saveConfig, test, SMS_STATUS };
