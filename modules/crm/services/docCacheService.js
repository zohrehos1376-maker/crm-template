// نسخه‌ی محلی مدرک‌های فرم همکاری سایت: عکس از سایت گرفته، HEIC به JPEG تبدیل، فشرده و روی سرور خودمان ذخیره می‌شود
// تا اگر سایت خراب شد، مدرک در CRM باز بماند و در بکاپ باشد. آدرس سایت (sourceUrl) هم می‌ماند.
// اگر سایت جواب ندهد، دفعه‌ی بعد (هر ۳۰ دقیقه) دوباره تلاش می‌شود.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { prisma } = require('../../../shared/prisma');

const SITE_DIR = path.join(__dirname, '../../../data/uploads/kyc/site');
const MAX_BYTES = 30 * 1024 * 1024;
const EVERY_MS = 30 * 60 * 1000;
const docImage = require('../../../shared/doc-image');
const { isAllowedDocUrl } = require('../../../shared/doc-url');
let running = false;
// مدرکی که خطا داده تا ۶ ساعت دوباره امتحان نمی‌شود؛ وگرنه چند آدرس خراب اول صف
// (تازه‌ترین‌ها) هر بار کار را متوقف می‌کرد و بقیه‌ی مدرک‌ها هیچ‌وقت ذخیره نمی‌شدند.
const RETRY_AFTER_MS = 6 * 60 * 60 * 1000;
const failedAt = new Map();

// تغییر مسیر (redirect) دستی دنبال می‌شود تا مقصدش هم فقط سایت خودمان باشد
async function download(url) {
  let res;
  for (let hop = 0; ; hop++) {
    if (!isAllowedDocUrl(url)) { const e = new Error('آدرس مدرک از سایت CRM نمونه نیست'); e.fileProblem = true; throw e; }
    res = await fetch(url, { signal: AbortSignal.timeout(30000), redirect: 'manual' });
    if (res.status < 300 || res.status >= 400 || !res.headers.get('location')) break;
    if (hop >= 3) throw new Error('تغییر مسیر بیش از حد');
    url = new URL(res.headers.get('location'), url).href;
  }
  if (!res.ok) { const e = new Error('سایت پاسخ ' + res.status + ' داد'); e.http = res.status; throw e; }
  const len = Number(res.headers.get('content-length') || 0);
  if (len > MAX_BYTES) throw new Error('فایل بزرگ‌تر از ۳۰ مگابایت است');
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > MAX_BYTES) throw new Error('فایل بزرگ‌تر از ۳۰ مگابایت است');
  // نوع واقعی، تبدیل HEIC و فشرده‌سازی در shared/doc-image
  try {
    return await docImage.prepare(buf, res.headers.get('content-type'), url);
  } catch (e) {
    e.fileProblem = true;
    throw e;
  }
}

async function cacheOne(doc) {
  const small = await download(doc.sourceUrl);
  fs.mkdirSync(SITE_DIR, { recursive: true });
  const name = crypto.randomBytes(16).toString('hex') + docImage.EXT[small.mime];
  fs.writeFileSync(path.join(SITE_DIR, name), small.buf);
  await prisma.kycDocument.update({ where: { id: doc.id }, data: { fileName: 'site/' + name, mime: small.mime, size: small.buf.length } });
  return small.buf.length;
}

function recentFails() {
  const now = Date.now();
  for (const [id, at] of failedAt) if (now - at > RETRY_AFTER_MS) failedAt.delete(id);
  return [...failedAt.keys()];
}

async function run(opts) {
  const o = opts || {};
  if (running) return { ok: false, error: 'در حال انجام است' };
  running = true;
  const out = { ok: true, saved: 0, failed: 0, bytes: 0, stopped: false, lastError: '' };
  try {
    const docs = await prisma.kycDocument.findMany({
      where: Object.assign({ sourceUrl: { not: null }, fileName: '' }, o.leadId ? { leadId: o.leadId } : { id: { notIn: recentFails() } }),
      orderBy: { createdAt: 'desc' },
      take: o.limit || 500,
      select: { id: true, sourceUrl: true },
    });
    let failsInRow = 0;
    for (const d of docs) {
      try {
        out.bytes += await cacheOne(d);
        out.saved++;
        failsInRow = 0;
      } catch (e) {
        out.failed++;
        failedAt.set(d.id, Date.now());
        out.lastError = e.message;
        // فقط قطعی سایت (خطای شبکه یا 5xx) صف را نگه می‌دارد؛ خرابی یک فایل نه
        if (!e.http || e.http >= 500) { if (!e.fileProblem) failsInRow++; } else failsInRow = 0;
        // سایت از کار افتاده: بقیه را دفعه‌ی بعد امتحان کن، فشار بی‌خود نیاور
        if (failsInRow >= 5) { out.stopped = true; break; }
      }
    }
  } finally {
    running = false;
  }
  if (out.saved || out.failed) {
    console.log('[doc-cache] ذخیره ' + out.saved + ' (' + Math.round(out.bytes / 1024) + ' کیلوبایت) · ناموفق ' + out.failed + (out.lastError ? ' · ' + out.lastError : ''));
  }
  return out;
}

function start() {
  setTimeout(() => run().catch(() => {}), 2 * 60 * 1000).unref();
  setInterval(() => run().catch(() => {}), EVERY_MS).unref();
}

module.exports = { run, start, SITE_DIR };
