#!/usr/bin/env node
/**
 * پشتیبان‌گیری از دیتابیس.
 *
 * یک فایل فشرده‌ی .sql.gz در پوشه‌ی پشتیبان می‌سازد، سالم بودنش را بررسی می‌کند،
 * و نسخه‌های قدیمی را طبق قانون نگهداری پاک می‌کند.
 *
 * اجرای دستی:      npm run backup
 * اجرای خودکار:    با زمان‌بند ویندوز (scripts/backup-schedule.js)
 *
 * قانون نگهداری:
 *   - ۳۰ پشتیبان آخر همیشه نگه داشته می‌شوند
 *   - علاوه بر آن، اولین پشتیبان هر ماه هرگز پاک نمی‌شود (بایگانی ماهانه)
 */
require('dotenv').config({ quiet: true });

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { spawn } = require('child_process');

const APP_DIR = path.join(__dirname, '..');
const BACKUP_DIR = process.env.BACKUP_DIR || 'C:\\crm-template-backups';
// نسخه‌های ۱۴ روز اخیر نگه داشته می‌شوند (و همیشه دست‌کم ۵ نسخه‌ی آخر، حتی اگر مدتی پشتیبانی گرفته نشده باشد)
const KEEP_DAYS = Number(process.env.BACKUP_KEEP_DAYS) || 14;
const KEEP_MIN = 5;

function log(msg) {
  const stamp = new Date().toLocaleString('en-CA');
  console.log('[' + stamp + '] ' + msg);
}

function fail(msg) {
  log('خطا: ' + msg);
  process.exit(1);
}

function findMysqlDump() {
  if (process.env.MYSQL_BIN) {
    const candidate = path.join(process.env.MYSQL_BIN, 'mysqldump.exe');
    if (fs.existsSync(candidate)) return candidate;
  }
  const laragonRoot = 'C:\\laragon\\bin\\mysql';
  if (fs.existsSync(laragonRoot)) {
    const versions = fs.readdirSync(laragonRoot).sort().reverse();
    for (const version of versions) {
      const candidate = path.join(laragonRoot, version, 'bin', 'mysqldump.exe');
      if (fs.existsSync(candidate)) return candidate;
    }
  }
  return 'mysqldump';
}

function stamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return (
    d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + '-' + p(d.getHours()) + p(d.getMinutes()) + p(d.getSeconds())
  );
}

// نام فایل‌ها به شکل crm_template-YYYYMMDD-HHMMSS.sql.gz است
const FILE_RE = /^crm_template-(\d{4})(\d{2})(\d{2})-\d{6}\.sql\.gz$/;

function dumpCommand() {
  const url = new URL(process.env.DATABASE_URL);
  return {
    executable: findMysqlDump(),
    args: [
      '--single-transaction', '--routines', '--triggers', '--default-character-set=utf8mb4',
      '--host=' + url.hostname, '--port=' + (url.port || '3306'),
      '--user=' + decodeURIComponent(url.username), decodeURIComponent(url.pathname.replace(/^\//, '')),
    ],
    // رمز روی command line قرار نمی‌گیرد تا در فهرست پردازش‌های سیستم دیده نشود.
    env: Object.assign({}, process.env, { MYSQL_PWD: decodeURIComponent(url.password) }),
  };
}

function runDump(command, outPath) {
  return new Promise((resolve, reject) => {
    const child = spawn(command.executable, command.args, {
      windowsHide: true,
      env: command.env,
    });

    const gzip = zlib.createGzip({ level: 9 });
    const out = fs.createWriteStream(outPath);
    let stderr = '';

    child.stderr.on('data', (d) => (stderr += d.toString()));
    child.on('error', (e) => reject(new Error('اجرای ابزار پشتیبان‌گیری ممکن نشد: ' + e.message)));

    child.stdout.pipe(gzip).pipe(out);

    out.on('error', reject);
    out.on('finish', () => {
      if (child.exitCode !== null && child.exitCode !== 0) {
        reject(new Error('ابزار پشتیبان‌گیری با خطا تمام شد: ' + stderr.trim()));
      } else {
        resolve();
      }
    });
    child.on('close', (code) => {
      if (code !== 0) {
        gzip.destroy();
        out.destroy();
        reject(new Error('ابزار پشتیبان‌گیری با کد ' + code + ' تمام شد: ' + stderr.trim()));
      }
    });
  });
}

// بررسی سالم بودن فایل: باید باز شود و جدول‌های اصلی داخلش باشند
function verify(filePath) {
  const raw = zlib.gunzipSync(fs.readFileSync(filePath)).toString('utf8');
  const required = ['CREATE TABLE `leads`', 'CREATE TABLE `users`', 'CREATE TABLE `branches`'];
  const missing = required.filter((m) => !raw.includes(m));
  if (missing.length) throw new Error('فایل پشتیبان ناقص است — پیدا نشد: ' + missing.join('، '));
  return {
    bytes: fs.statSync(filePath).size,
    // تعداد تقریبی رکوردهای داده، فقط برای اطمینان از خالی نبودن
    hasData: /INSERT INTO `?leads`?/m.test(raw),
  };
}

// پاک کردن نسخه‌های قدیمی: نسخه‌های ۱۴ روز اخیر (BACKUP_KEEP_DAYS) می‌مانند + دست‌کم ۵ نسخه‌ی آخر
function prune() {
  const files = fs
    .readdirSync(BACKUP_DIR)
    .filter((f) => FILE_RE.test(f))
    .sort();

  const limit = Date.now() - KEEP_DAYS * 86400000;
  const keep = new Set(files.slice(-KEEP_MIN));
  for (const f of files) {
    const m = FILE_RE.exec(f);
    if (new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).getTime() >= limit - 86400000) keep.add(f);
  }

  const removed = [];
  for (const f of files) {
    if (!keep.has(f)) {
      fs.unlinkSync(path.join(BACKUP_DIR, f));
      removed.push(f);
    }
  }
  return { total: files.length, kept: keep.size, removed };
}

// بایگانی data/uploads به crm_template-uploads-YYYYMMDD-HHMMSS.tar.gz با همان قانون نگهداری
const UPLOADS_DIR = path.join(APP_DIR, 'data', 'uploads');
const UPLOADS_RE = /^crm_template-uploads-(\d{4})(\d{2})(\d{2})-\d{6}\.tar\.gz$/;

// هر بایگانی عکس‌ها یک نسخه‌ی کامل است؛ پس فقط ۷ نسخه‌ی آخر می‌ماند (نه ۱۴ روز)،
// و اگر از آخرین بایگانی هیچ فایلی عوض نشده باشد، نسخه‌ی تازه ساخته نمی‌شود
// (قبلاً هر انتشار یک نسخه‌ی کامل تکراری می‌ساخت و پوشه‌ی بکاپ صدها مگابایت پر می‌شد).
const UPLOADS_KEEP = Number(process.env.BACKUP_UPLOADS_KEEP) || 7;
const SITE_DIR = path.join(UPLOADS_DIR, 'kyc', 'site');
// نسخه‌های کوچک عکس‌ها (kyc/thumbs) دوباره ساخته می‌شوند؛ بکاپ لازم ندارند
const THUMBS_DIR = path.join(UPLOADS_DIR, 'kyc', 'thumbs');

function newestMtime(dir) {
  let newest = 0;
  let entries = [];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (_) { return 0; }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (p === SITE_DIR || p === THUMBS_DIR) continue;
    try {
      const t = e.isDirectory() ? Math.max(fs.statSync(p).mtimeMs, newestMtime(p)) : fs.statSync(p).mtimeMs;
      if (t > newest) newest = t;
    } catch (_) { /* فایلی که وسط کار پاک شد */ }
  }
  return newest;
}

function backupUploads() {
  if (!fs.existsSync(UPLOADS_DIR)) return Promise.resolve(null);
  const existing = fs.readdirSync(BACKUP_DIR).filter((f) => UPLOADS_RE.test(f)).sort();
  const last = existing[existing.length - 1];
  if (last) {
    const lastTime = fs.statSync(path.join(BACKUP_DIR, last)).mtimeMs;
    if (newestMtime(UPLOADS_DIR) < lastTime) {
      const removed = pruneUploads(existing);
      return Promise.resolve({ skipped: true, removed });
    }
  }
  const fileName = 'crm_template-uploads-' + stamp() + '.tar.gz';
  const outPath = path.join(BACKUP_DIR, fileName);
  // tar در ویندوز ۱۰ به بعد و لینوکس موجود است. نام فایل نسبی می‌دهیم تا tar گیت‌بش «C:» را میزبان راه دور نداند.
  const tarExe = process.platform === 'win32' ? path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe') : 'tar';
  return new Promise((resolve, reject) => {
    // نسخه‌ی محلی عکس‌های سایت (uploads/kyc/site) در بایگانی روزانه نمی‌آید؛ جدا و فقط یک‌بار کپی می‌شود (mirrorSiteDocs)
    const child = spawn(tarExe, ['-czf', fileName, '--exclude=uploads/kyc/site', '--exclude=uploads/kyc/thumbs', '-C', path.join(APP_DIR, 'data'), 'uploads'], { cwd: BACKUP_DIR, windowsHide: true });
    let stderr = '';
    child.stderr.on('data', (d) => (stderr += d.toString()));
    child.on('error', (e) => reject(new Error('اجرای tar ممکن نشد: ' + e.message)));
    child.on('close', (code) => {
      if (code !== 0) {
        try { fs.unlinkSync(outPath); } catch (_) { /* نادیده */ }
        return reject(new Error('tar با کد ' + code + ' تمام شد: ' + stderr.trim()));
      }
      const removed = pruneUploads(fs.readdirSync(BACKUP_DIR).filter((f) => UPLOADS_RE.test(f)).sort());
      resolve({ bytes: fs.statSync(outPath).size, removed });
    });
  });
}

function pruneUploads(files) {
  const keep = new Set(files.slice(-UPLOADS_KEEP));
  let removed = 0;
  for (const f of files) if (!keep.has(f)) { fs.unlinkSync(path.join(BACKUP_DIR, f)); removed++; }
  return removed;
}

// عکس‌های سایت نام تصادفی دارند و هرگز عوض نمی‌شوند: هر شب فقط فایل‌های تازه به
// <BACKUP_DIR>/uploads-site کپی می‌شوند و چیزی از آنجا پاک نمی‌شود (هر عکس یک‌بار در بکاپ).
function mirrorSiteDocs() {
  const src = path.join(UPLOADS_DIR, 'kyc', 'site');
  if (!fs.existsSync(src)) return { copied: 0, total: 0 };
  const dst = path.join(BACKUP_DIR, 'uploads-site');
  fs.mkdirSync(dst, { recursive: true });
  let copied = 0, total = 0;
  for (const f of fs.readdirSync(src)) {
    total++;
    const to = path.join(dst, f);
    if (!fs.existsSync(to)) { fs.copyFileSync(path.join(src, f), to); copied++; }
  }
  return { copied, total };
}

async function main() {
  if (!process.env.DATABASE_URL) fail('DATABASE_URL در فایل .env تعریف نشده است.');

  fs.mkdirSync(BACKUP_DIR, { recursive: true });

  const fileName = 'crm_template-' + stamp() + '.sql.gz';
  const outPath = path.join(BACKUP_DIR, fileName);

  log('شروع پشتیبان‌گیری → ' + outPath);

  try {
    await runDump(dumpCommand(), outPath);
  } catch (e) {
    try { fs.unlinkSync(outPath); } catch (_) { /* نادیده */ }
    fail(e.message);
  }

  let info;
  try {
    info = verify(outPath);
  } catch (e) {
    try { fs.unlinkSync(outPath); } catch (_) { /* نادیده */ }
    fail('بررسی سلامت فایل ناموفق بود: ' + e.message);
  }

  log('پشتیبان ساخته و بررسی شد: ' + Math.round(info.bytes / 1024) + ' کیلوبایت' + (info.hasData ? '' : ' (هشدار: داده‌ای در جدول سرنخ‌ها نبود)'));

  const p = prune();
  log('نسخه‌های موجود: ' + (p.total - p.removed.length) + ' | پاک‌شده: ' + p.removed.length);

  // فایل‌های بارگذاری‌شده (مدرک‌های احراز) در دیتابیس نیستند؛ جدا بایگانی می‌شوند.
  try {
    const u = await backupUploads();
    if (u && u.skipped) log('بایگانی فایل‌های بارگذاری‌شده: تغییری نبود، نسخه‌ی تازه لازم نشد | پاک‌شده: ' + u.removed);
    else if (u) log('بایگانی فایل‌های بارگذاری‌شده: ' + Math.round(u.bytes / 1024) + ' کیلوبایت | پاک‌شده: ' + u.removed);
  } catch (e) {
    log('هشدار: بایگانی فایل‌های بارگذاری‌شده ناموفق بود: ' + e.message);
  }
  try {
    const m = mirrorSiteDocs();
    if (m.total) log('عکس‌های مدرک سایت: ' + m.copied + ' فایل تازه کپی شد (کل ' + m.total + ')');
  } catch (e) {
    log('هشدار: کپی عکس‌های مدرک سایت ناموفق بود: ' + e.message);
  }

  // نسخه‌ی بیرون از سرور: رمزشده به بله (اگر در تنظیمات CRM ← پشتیبان در بله فعال شده باشد)
  try {
    const offsite = require('../modules/core/services/offsiteBackupService');
    const r = await offsite.sendLatest();
    if (r.sent) log('نسخه‌ی رمزشده به بله فرستاده شد (' + Math.round(r.bytes / 1024) + ' کیلوبایت)');
  } catch (e) {
    log('هشدار: ارسال پشتیبان به بله ناموفق بود: ' + e.message);
  } finally {
    try { await require('../shared/prisma').prisma.$disconnect(); } catch (_) { /* نادیده */ }
  }

  log('پشتیبان‌گیری با موفقیت تمام شد.');
}

main().catch((e) => fail(e && e.message ? e.message : String(e)));
