#!/usr/bin/env node
// آزمایش سالم بودن پشتیبان (روی سرور، MariaDB):
//  ۱) آخرین فایل پشتیبان را با همان روشِ نسخه‌ی بله رمز می‌کند و دوباره باز می‌کند (رمز درست کار می‌کند؟)
//  ۲) آن را در یک دیتابیس «موقت و جدا» (crm_restore_test) برمی‌گرداند — به دیتابیس اصلی دست نمی‌زند
//  ۳) تعداد ردیف‌های جدول‌های مهم را با دیتابیس اصلی مقایسه می‌کند
//  ۴) دیتابیس موقت را پاک می‌کند
//   node scripts/backup-restore-test.js [فایل .sql.gz]   (نیاز به sudo بدون رمز برای mysql)
require('dotenv').config({ quiet: true });
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');
const { encrypt, decrypt } = require('../shared/backup-crypto');
const { prisma } = require('../shared/prisma');

const TEST_DB = 'crm_restore_test';
const TABLES = ['users', 'leads', 'followups', 'call_logs', 'club_members', 'lead_status_history'];
const sql = (q, db) => execFileSync('sudo', ['-n', 'mysql', '-N', '-B'].concat(db ? [db] : []).concat(['-e', q]), { encoding: 'utf8' }).trim();
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');

(async () => {
  const dir = process.env.BACKUP_DIR;
  const file = process.argv[2] || path.join(dir, fs.readdirSync(dir).filter((f) => /^crm_template-.*\.sql\.gz$/.test(f)).sort().pop());
  const liveDb = new URL(process.env.DATABASE_URL).pathname.replace(/^\//, '');
  if (liveDb === TEST_DB) throw new Error('نام دیتابیس آزمایشی با دیتابیس اصلی یکی است');
  console.log('فایل: ' + path.basename(file) + ' (' + Math.round(fs.statSync(file).size / 1024) + ' کیلوبایت)');

  // ۱) رمز کردن و باز کردن با رمزِ بله
  const row = await prisma.setting.findUnique({ where: { key: 'backupBale' } }).catch(() => null);
  let pass = null;
  try { pass = row && JSON.parse(row.value).passphrase; } catch (e) {}
  const raw = fs.readFileSync(file);
  if (pass) {
    const back = decrypt(encrypt(raw, pass), pass);
    console.log('۱) رمزگذاری/بازگشایی نسخه‌ی بله: ' + (sha(back) === sha(raw) ? 'سالم ✓' : 'خراب ✗'));
  } else console.log('۱) رمز پشتیبان بله پیدا نشد — این مرحله رد شد');

  // ۲) برگرداندن در دیتابیس موقت
  sql('DROP DATABASE IF EXISTS `' + TEST_DB + '`; CREATE DATABASE `' + TEST_DB + '` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;');
  try {
    execFileSync('bash', ['-c', 'gunzip -c "$0" | sudo -n mysql "$1"', file, TEST_DB], { stdio: 'inherit' });
    console.log('۲) برگرداندن در دیتابیس موقت: انجام شد ✓');

    // ۳) مقایسه با دیتابیس اصلی (اختلاف کم یعنی بعد از زمان پشتیبان ردیف تازه ثبت شده)
    let ok = true;
    for (const t of TABLES) {
      const a = Number(sql('SELECT COUNT(*) FROM `' + t + '`', TEST_DB));
      const b = Number(sql('SELECT COUNT(*) FROM `' + t + '`', liveDb));
      if (!(a > 0 || b === 0) || a > b) ok = false;
      console.log('   ' + t.padEnd(20) + ' پشتیبان: ' + String(a).padStart(6) + ' | اصلی: ' + String(b).padStart(6));
    }
    console.log('۳) نتیجه: ' + (ok ? 'پشتیبان سالم و کامل است ✓' : 'مشکل دارد ✗'));
    process.exitCode = ok ? 0 : 1;
  } finally {
    sql('DROP DATABASE IF EXISTS `' + TEST_DB + '`;');
    console.log('۴) دیتابیس موقت پاک شد.');
    await prisma.$disconnect();
  }
})().catch((e) => {
  console.error('خطا: ' + e.message);
  process.exit(1);
});
