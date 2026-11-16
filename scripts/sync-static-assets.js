#!/usr/bin/env node

// هاست cPanel فایل‌های رابط را مستقیماً از ریشه‌ی برنامه سرو می‌کند، در حالی
// که Express همان فایل‌ها را از public/ می‌خواند. این دو نسخه باید همیشه یکسان
// باشند؛ در غیر این صورت HTML قدیمی با JavaScript جدید ترکیب و boot متوقف می‌شود.
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const FILES = [
  'index.html',
  'css/app.css',
  'css/tokens.css',
  'js/app.js',
  'js/theme.js',
  'img/crm-logo.svg',
  'js/workdesk.js',
  'js/kyc.js',
  'kyc.html',
  'fonts/Vazirmatn-Bold.woff2',
  'fonts/Vazirmatn-Medium.woff2',
  'fonts/Vazirmatn-Regular.woff2',
  'fonts/Vazirmatn-SemiBold.woff2',
];

for (const relative of FILES) {
  const source = path.join(ROOT, 'public', relative);
  const destination = path.join(ROOT, relative);
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.copyFileSync(source, destination);
}

console.log('Static files synchronized: public/ -> application root');
