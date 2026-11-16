#!/usr/bin/env node

// ---------------------------------------------------------------------------
// یک اسکریپت واحد برای بعد از npm install — به‌جای زنجیره‌ی
// «npm run x && npm run y && npm run z» که قبلاً اینجا بود.
//
// چرا این تغییر لازم شد: روی هاست‌های cPanel/CloudLinux (Node.js Selector)،
// وقتی «Run NPM Install» زده می‌شود، فراخوانی‌های تو‌در‌توی «npm run» داخل
// postinstall گاهی cwd را گم می‌کنند و دنبال اسکریپت‌ها در مسیر اشتباه
// (پوشه‌ی nodevenv به‌جای ریشه‌ی واقعی برنامه) می‌گردند — نتیجه‌اش خطای
// «Cannot find module» بود.
//
// این نسخه فقط از __dirname استفاده می‌کند (که همیشه، صرف‌نظر از cwd،
// درست است) و هر سه قدم را مستقیم از همین‌جا صدا می‌زند — هیچ «npm run»
// تو‌در‌تویی در کار نیست.
const path = require('path');
const fs = require('fs');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');

function step(name, fn) {
  console.log('\n[postinstall] ' + name);
  try {
    fn();
  } catch (e) {
    console.warn('[postinstall] «' + name + '» ناموفق بود: ' + e.message);
    console.warn('[postinstall] نصب متوقف نمی‌شود — بقیه‌ی مراحل ادامه پیدا می‌کند.');
  }
}

// ---------- ۱) هماهنگ کردن HTML/CSS/JS ریشه با public/ ----------
// (منطق همان scripts/sync-static-assets.js است، مستقیم اینجا تکرار شده تا
// نیازی به اجرای «node scripts/x.js» با مسیر نسبی نباشد)
step('هماهنگ‌سازی فایل‌های ثابت (public/ → ریشه)', function () {
  var FILES = [
    'index.html', 'css/app.css', 'css/tokens.css',
    'js/app.js', 'js/theme.js',
    'img/crm-logo.svg', 'js/workdesk.js', 'js/kyc.js', 'kyc.html',
    'fonts/Vazirmatn-Bold.woff2', 'fonts/Vazirmatn-Medium.woff2',
    'fonts/Vazirmatn-Regular.woff2', 'fonts/Vazirmatn-SemiBold.woff2',
  ];
  FILES.forEach(function (relative) {
    var source = path.join(ROOT, 'public', relative);
    var destination = path.join(ROOT, relative);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.copyFileSync(source, destination);
  });
  console.log('  ' + FILES.length + ' فایل هماهنگ شد.');
});

// ---------- ۲) ساخت کلاینت Prisma ----------
step('ساخت کلاینت Prisma', function () {
  [path.join(ROOT, 'prisma', 'mysql', 'schema.prisma')].forEach(function (schemaPath) {
    var r = spawnSync('npx', ['prisma', 'generate', '--schema', schemaPath], {
      cwd: ROOT,
      stdio: 'inherit',
      shell: true,
    });
    if (r.status !== 0) throw new Error('prisma generate برای ' + schemaPath + ' شکست خورد');
  });
});

// ---------- ۳) اعمال migration های دیتابیس ----------
step('اعمال migration های دیتابیس', function () {
  var envPath = path.join(ROOT, '.env');
  if (!process.env.DATABASE_URL && !fs.existsSync(envPath)) {
    console.log('  DATABASE_URL تعریف نشده — این مرحله رد شد.');
    return;
  }
  require('dotenv').config({ path: envPath, quiet: true, override: true });
  var schemaPath = path.join(ROOT, 'prisma', 'mysql', 'schema.prisma');

  var r = spawnSync('npx', ['prisma', 'migrate', 'deploy', '--schema', schemaPath], {
    cwd: ROOT,
    stdio: 'inherit',
    shell: true,
  });
  if (r.status === 0) {
    console.log('  migration ها با موفقیت اعمال شد.');
  } else {
    console.warn('  اعمال migration ناموفق بود — معمولاً یعنی DATABASE_URL درست نیست.');
    console.warn('  برنامه بالا می‌آید، ولی قابلیت‌های تازه ممکن است کار نکنند.');
  }
});

console.log('\n[postinstall] تمام شد.');
