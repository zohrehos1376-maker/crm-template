#!/usr/bin/env node
// گزارش روزانه‌ی مدیران (PDF) — cron هر شب ساعت ۲۲ تهران اجرا می‌کند و به بله‌ی مدیر CRM می‌فرستد.
//   node scripts/daily-report.js                 ← ساخت و ارسال گزارش امروز
//   node scripts/daily-report.js --date=2026-10-19
//   node scripts/daily-report.js --out=report.pdf ← فقط ساخت فایل، بدون ارسال
require('dotenv').config({ quiet: true });
const fs = require('fs');
const svc = require('../modules/crm/services/dailyReportService');

const arg = (k) => (process.argv.find((a) => a.startsWith('--' + k + '=')) || '').split('=')[1];

(async () => {
  const stamp = '[' + new Date().toLocaleString('en-CA') + '] ';
  if (arg('out')) {
    const { pdf } = await svc.buildPdf(arg('date'));
    fs.writeFileSync(arg('out'), pdf);
    console.log(stamp + 'ساخته شد: ' + arg('out'));
  } else {
    const r = await svc.sendToBale(arg('date'));
    console.log(stamp + (r.sent ? 'گزارش ' + r.date + ' به بله فرستاده شد' : 'رد شد: ' + r.reason));
  }
  process.exit(0);
})().catch((e) => {
  console.error('[' + new Date().toLocaleString('en-CA') + '] خطا: ' + e.message);
  process.exit(1);
});
