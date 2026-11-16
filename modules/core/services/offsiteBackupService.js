// نسخه‌ی پشتیبان بیرون از سرور: هر شب آخرین پشتیبان دیتابیس، رمزگذاری‌شده با رمزی که
// مدیر انتخاب کرده، به چت خصوصی ربات بله‌ی خودِ مدیر فرستاده می‌شود.
// (تلگرام از سرورهای ایران در دسترس نیست؛ API بله همان شکل تلگرام است.)
//
// قالب فایل .enc:  "CRMBK1" | salt(16) | iv(12) | tag(16) | داده‌ی رمزشده (AES-256-GCM، کلید = scrypt(رمز))
// بازگردانی: node scripts/decrypt-backup.js <file.enc>
const fs = require('fs');
const path = require('path');
const { prisma } = require('../../../shared/prisma');
const { encrypt, decrypt } = require('../../../shared/backup-crypto');

const CONFIG_KEY = 'backupBale';
const STATUS_KEY = 'backupBaleStatus';
const API = 'https://tapi.bale.ai/bot';

function fail(status, message) {
  const e = new Error(message);
  e.status = status;
  return e;
}

function backupDir() {
  return process.env.BACKUP_DIR || 'D:\\auto-crm-backups';
}

async function readSetting(key) {
  const row = await prisma.setting.findUnique({ where: { key } });
  if (!row) return {};
  try {
    return JSON.parse(row.value) || {};
  } catch (e) {
    return {};
  }
}

async function writeSetting(key, value, userId) {
  const data = { value: JSON.stringify(value), updatedAt: new Date(), updatedBy: userId || null };
  await prisma.setting.upsert({ where: { key }, create: Object.assign({ key }, data), update: data });
}

// چیزی که به مرورگر برمی‌گردد — توکن و رمز هیچ‌وقت کامل برنمی‌گردند
async function publicConfig() {
  const c = await readSetting(CONFIG_KEY);
  const s = await readSetting(STATUS_KEY);
  return {
    configured: !!(c.token && c.chatId && c.passphrase),
    tokenHint: c.token ? '…' + String(c.token).slice(-4) : '',
    chatId: c.chatId || '',
    chatTitle: c.chatTitle || '',
    hasPassphrase: !!c.passphrase,
    lastSentAt: s.lastSentAt || null,
    lastFile: s.lastFile || '',
    lastError: s.lastError || '',
    lastErrorAt: s.lastErrorAt || null,
  };
}

async function saveConfig(userId, body) {
  const c = await readSetting(CONFIG_KEY);
  const b = body || {};
  if (b.token !== undefined && String(b.token).trim()) c.token = String(b.token).trim();
  if (b.chatId !== undefined && String(b.chatId).trim()) {
    c.chatId = String(b.chatId).trim();
    if (b.chatTitle !== undefined) c.chatTitle = String(b.chatTitle || '').slice(0, 100);
  }
  if (b.passphrase !== undefined && String(b.passphrase)) {
    if (String(b.passphrase).length < 8) throw fail(400, 'رمز فایل پشتیبان باید دست‌کم ۸ نویسه باشد');
    c.passphrase = String(b.passphrase);
  }
  if (b.disable === true) {
    await writeSetting(CONFIG_KEY, {}, userId);
    return publicConfig();
  }
  await writeSetting(CONFIG_KEY, c, userId);
  return publicConfig();
}

async function bale(token, method, init) {
  const res = await fetch(API + token + '/' + method, Object.assign({ signal: AbortSignal.timeout(60000) }, init || {}));
  const j = await res.json().catch(() => ({}));
  if (!res.ok || j.ok === false) {
    if (res.status === 401 || res.status === 403 || res.status === 404) throw fail(400, 'توکن ربات بله درست نیست');
    throw fail(502, 'بله خطا داد: ' + (j.description || res.status));
  }
  return j.result;
}

// شناسه‌ی چت: مدیر به ربات خودش یک پیام می‌دهد؛ این‌جا آخرین چتی که پیام داده پیدا می‌شود
async function findChat(body) {
  const c = await readSetting(CONFIG_KEY);
  const token = (body && String(body.token || '').trim()) || c.token;
  if (!token) throw fail(400, 'اول توکن ربات را وارد کنید');
  const me = await bale(token, 'getMe');
  const updates = await bale(token, 'getUpdates');
  const msgs = (updates || []).map((u) => u.message || u.edited_message || u.channel_post).filter(Boolean);
  const last = msgs[msgs.length - 1];
  if (!last) {
    throw fail(400, 'پیامی پیدا نشد — در بله به ربات «' + (me.username || me.first_name || '') + '» یک پیام (مثلاً «سلام») بفرستید و دوباره بزنید');
  }
  const chat = last.chat || {};
  const title = chat.title || [chat.first_name, chat.last_name].filter(Boolean).join(' ') || chat.username || '';
  return { chatId: String(chat.id), chatTitle: title, botName: me.username || me.first_name || '' };
}

function latestBackupFile() {
  const dir = backupDir();
  if (!fs.existsSync(dir)) return null;
  const files = fs.readdirSync(dir).filter((f) => /^crm_template-.*\.sql\.gz$/.test(f)).sort();
  return files.length ? path.join(dir, files[files.length - 1]) : null;
}

// فرستادن آخرین پشتیبان؛ اگر تنظیم نشده باشد بی‌صدا رد می‌شود (skipped)
async function sendLatest() {
  const c = await readSetting(CONFIG_KEY);
  if (!c.token || !c.chatId || !c.passphrase) return { skipped: true };
  const file = latestBackupFile();
  if (!file) throw fail(404, 'هنوز فایل پشتیبانی روی سرور نیست');
  const name = path.basename(file);
  try {
    const enc = encrypt(fs.readFileSync(file), c.passphrase);
    const form = new FormData();
    form.append('chat_id', c.chatId);
    form.append('caption', 'پشتیبان CRM نمونه — ' + name.replace(/^crm_template-|\.sql\.gz$/g, '') + '\nرمزگذاری‌شده؛ برای باز کردن رمز فایل لازم است.');
    form.append('document', new Blob([enc]), name + '.enc');
    await bale(c.token, 'sendDocument', { method: 'POST', body: form });
    await writeSetting(STATUS_KEY, { lastSentAt: Date.now(), lastFile: name, lastError: '' });
    return { sent: true, file: name, bytes: enc.length };
  } catch (e) {
    const s = await readSetting(STATUS_KEY);
    await writeSetting(STATUS_KEY, Object.assign(s, { lastError: e.message, lastErrorAt: Date.now() }));
    throw e;
  }
}

module.exports = { publicConfig, saveConfig, findChat, sendLatest, encrypt, decrypt, latestBackupFile };
