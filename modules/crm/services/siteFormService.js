// خواندن فرم‌های همکاری از سایت (GET) — مستقل از اینکه سایت بتواند خودش بفرستد یا نه.
// سایت: SITE_FORMS_URL (مسیر REST وردپرس، docs/site-forms-wordpress.php) با هدر X-Intake-Token.
// فرم تکراری با شماره‌ی فرم سایت (wpform:<id>) در kycService.intake کنار گذاشته می‌شود.
const kycService = require('./kycService');

const EVERY_MS = 30 * 60 * 1000;
const LOOKBACK_DAYS = 7;
let running = false;
let last = null;

async function pull() {
  const url = process.env.SITE_FORMS_URL;
  const token = process.env.INTAKE_TOKEN;
  if (!url || !token) return { ok: false, error: 'SITE_FORMS_URL تنظیم نشده است' };
  if (running) return { ok: false, error: 'در حال خواندن است' };
  running = true;
  const out = { ok: true, at: new Date().toISOString(), received: 0, added: 0, duplicate: 0, failed: 0, errors: [] };
  try {
    const since = new Date(Date.now() - LOOKBACK_DAYS * 86400000).toISOString().slice(0, 10);
    const res = await fetch(url + (url.includes('?') ? '&' : '?') + 'since=' + since, {
      headers: { 'X-Intake-Token': token, Accept: 'application/json' },
      signal: AbortSignal.timeout(30000),
    });
    if (!res.ok) throw new Error('سایت پاسخ ' + res.status + ' داد');
    const data = await res.json();
    const entries = Array.isArray(data) ? data : data.entries || [];
    out.received = entries.length;
    for (const e of entries) {
      if (!e || !e.id || !e.phone) continue;
      try {
        const r = await kycService.intake(Object.assign({ source: 'فرم همکاری سایت' }, e), []);
        if (r.duplicate) out.duplicate++;
        else out.added++;
      } catch (err) {
        out.failed++;
        if (out.errors.length < 5) out.errors.push('فرم ' + e.id + ': ' + err.message);
      }
    }
  } catch (err) {
    out.ok = false;
    out.error = err.message;
  } finally {
    running = false;
  }
  last = out;
  console.log('[site-forms] ' + (out.ok ? 'دریافت ' + out.received + ' · تازه ' + out.added + ' · تکراری ' + out.duplicate + ' · خطا ' + out.failed : 'خطا: ' + out.error));
  return out;
}

function status() {
  return { configured: !!process.env.SITE_FORMS_URL, last };
}

function start() {
  if (!process.env.SITE_FORMS_URL) return;
  setTimeout(() => pull().catch(() => {}), 60 * 1000);
  setInterval(() => pull().catch(() => {}), EVERY_MS).unref();
}

module.exports = { pull, status, start };
