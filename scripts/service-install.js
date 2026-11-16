#!/usr/bin/env node
/**
 * نصب برنامه به‌عنوان «سرویس ویندوز».
 *
 * چرا سرویس؟ تا برنامه بدون هیچ پنجره‌ای در پس‌زمینه اجرا شود، با روشن شدن
 * ویندوز خودکار بالا بیاید (حتی قبل از ورود کاربر) و اگر کرش کرد خود ویندوز
 * دوباره اجرایش کند. نیازی به باز نگه داشتن پنجره‌ی مشکی نیست.
 *
 * اجرا (نیاز به دسترسی مدیر دارد):  npm run service:install
 * حذف سرویس:                        npm run service:uninstall
 */
const path = require('path');
const { Service } = require('node-windows');

const APP_DIR = path.join(__dirname, '..');

const svc = new Service({
  name: 'CRM Crm',
  description: 'CRM فروش CRM نمونه',
  script: path.join(APP_DIR, 'server.js'),
  workingDirectory: APP_DIR,
  // اگر برنامه کرش کند، ویندوز با فاصله‌ی کوتاه دوباره اجرایش می‌کند
  wait: 10,
  grow: 0.25,
  maxRestarts: 40,
});

svc.on('install', () => {
  console.log('سرویس نصب شد. در حال اجرا…');
  svc.start();
});

svc.on('alreadyinstalled', () => {
  console.log('سرویس از قبل نصب است.');
});

svc.on('start', () => {
  console.log('');
  console.log('=========================================');
  console.log('  سرویس «CRM Crm» در حال اجراست.');
  console.log('  برنامه از این پس خودکار با ویندوز بالا می‌آید،');
  console.log('  بدون هیچ پنجره‌ای.');
  console.log('=========================================');
  console.log('');
});

svc.on('error', (e) => {
  console.error('خطا در نصب سرویس:', e && e.message ? e.message : e);
});

console.log('در حال نصب سرویس ویندوز…');
svc.install();
