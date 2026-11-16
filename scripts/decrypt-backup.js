#!/usr/bin/env node
// باز کردن فایل پشتیبانِ رمزشده‌ای که در بله ذخیره شده (crm_template-….sql.gz.enc)
//
//   node scripts/decrypt-backup.js crm_template-20261017-033001.sql.gz.enc
//   (رمز را می‌پرسد؛ یا: BACKUP_PASSPHRASE=... node scripts/decrypt-backup.js <file>)
//
// خروجی همان فایل .sql.gz معمولی کنار فایل ورودی است که با روش عادی بازگردانی می‌شود.
const fs = require('fs');
const readline = require('readline');
const { decrypt } = require('../shared/backup-crypto');

async function ask(q) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => rl.question(q, (a) => { rl.close(); resolve(a); }));
}

(async () => {
  const file = process.argv[2];
  if (!file || !fs.existsSync(file)) {
    console.error('استفاده: node scripts/decrypt-backup.js <فایل .enc>');
    process.exit(1);
  }
  const pass = process.env.BACKUP_PASSPHRASE || (await ask('رمز فایل پشتیبان: '));
  const out = file.replace(/\.enc$/, '') || file + '.sql.gz';
  fs.writeFileSync(out === file ? file + '.sql.gz' : out, decrypt(fs.readFileSync(file), pass));
  console.log('باز شد → ' + (out === file ? file + '.sql.gz' : out));
})().catch((e) => {
  console.error('خطا: ' + e.message);
  process.exit(1);
});
