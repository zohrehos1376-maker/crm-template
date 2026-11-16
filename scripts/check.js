#!/usr/bin/env node
/**
 * عیب‌یاب: وضعیت همه‌چیز را بررسی می‌کند و نتیجه را در یک فایل متنی می‌نویسد.
 *
 * اجرا:  npm run check      (یا دوبار کلیک روی 4-CHECK.bat)
 *
 * هیچ تغییری در برنامه یا داده‌ها نمی‌دهد؛ فقط نگاه می‌کند.
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const http = require('http');
const { execFileSync, spawn } = require('child_process');

const APP_DIR = path.join(__dirname, '..');
const LOG_PATH = path.join(APP_DIR, '..', 'CHECK-RESULT.txt');

const out = [];
function say(msg) {
  console.log(msg);
  out.push(msg);
}
function section(title) {
  say('');
  say('--- ' + title + ' ---');
}
function run(cmd, args) {
  try {
    return execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  } catch (e) {
    return null;
  }
}

function readEnvValue(key) {
  const envPath = path.join(APP_DIR, '.env');
  if (!fs.existsSync(envPath)) return null;
  const line = fs
    .readFileSync(envPath, 'utf8')
    .split(/\r?\n/)
    .find((l) => l.startsWith(key + '='));
  return line ? line.slice(key.length + 1).trim() : null;
}

function checkHttp(port) {
  return new Promise((resolve) => {
    const req = http.get({ host: '127.0.0.1', port, path: '/', timeout: 5000 }, (res) => {
      res.resume();
      resolve('کد پاسخ: ' + res.statusCode);
    });
    req.on('timeout', () => { req.destroy(); resolve('پاسخی نداد (timeout)'); });
    req.on('error', (e) => resolve('اتصال برقرار نشد: ' + e.code));
  });
}

async function main() {
  const databaseProvider = 'mariadb';
  say('===== عیب‌یابی CRM نمونه =====');
  say('زمان: ' + new Date().toLocaleString('en-CA'));
  say('کامپیوتر: ' + os.hostname() + ' | ' + os.platform() + ' ' + os.release());

  // ---------------------------------------------------------------
  section('۱. Node.js');
  say('  نسخه: ' + process.version);

  // ---------------------------------------------------------------
  section('۲. سرویس دیتابیس (' + databaseProvider + ')');
  const sc = run('sc', ['query', 'state=', 'all']) || '';
  const serviceLines = sc.split(/\r?\n/);
  const dbServices = [];
  const servicePattern = /SERVICE_NAME:\s*.*(?:mysql|mariadb)/i;
  for (let i = 0; i < serviceLines.length; i++) {
    if (servicePattern.test(serviceLines[i])) {
      const name = serviceLines[i].split(':').slice(1).join(':').trim();
      const stateLine = serviceLines.slice(i, i + 5).find((l) => /STATE/.test(l)) || '';
      dbServices.push(name + ' → ' + (/RUNNING/.test(stateLine) ? 'در حال اجرا' : 'متوقف'));
    }
  }
  if (dbServices.length) dbServices.forEach((n) => say('  ' + n));
  else say('  !! سرویس ' + databaseProvider + ' در Windows Services پیدا نشد');

  // ---------------------------------------------------------------
  section('۳. فایل تنظیمات (.env)');
  const envExists = fs.existsSync(path.join(APP_DIR, '.env'));
  say('  ' + (envExists ? 'وجود دارد' : '!! وجود ندارد — اول 1-INSTALL.bat را اجرا کنید'));
  const port = Number(readEnvValue('PORT')) || 3000;
  const dbUrl = readEnvValue('DATABASE_URL');
  if (envExists) {
    say('  پورت تنظیم‌شده: ' + port);
    say('  موتور دیتابیس: ' + databaseProvider);
    // آدرس دیتابیس بدون نمایش رمز
    say('  آدرس دیتابیس: ' + (dbUrl ? dbUrl.replace(/:\/\/([^:]+):[^@]*@/, '://$1:<رمز>@') : '!! تعریف نشده'));
  }

  // ---------------------------------------------------------------
  section('۴. پکیج‌های برنامه');
  const hasModules = fs.existsSync(path.join(APP_DIR, 'node_modules', 'express'));
  say('  ' + (hasModules ? 'نصب شده' : '!! نصب نشده — اول 1-INSTALL.bat را اجرا کنید'));

  // ---------------------------------------------------------------
  section('۵. پورت ' + port);
  const netstat = run('netstat', ['-ano']) || '';
  const busy = netstat.split(/\r?\n/).filter((l) => l.includes('LISTENING') && l.includes(':' + port + ' '));
  if (busy.length) {
    say('  از قبل مشغول است:');
    busy.forEach((l) => say('    ' + l.trim()));
    say('  (یعنی یا برنامه از قبل در حال اجراست، یا برنامه‌ی دیگری این پورت را گرفته)');
  } else {
    say('  آزاد است');
  }

  // ---------------------------------------------------------------
  section('۶. آدرس‌های شبکه‌ی این کامپیوتر');
  const nets = os.networkInterfaces();
  let found = false;
  for (const name of Object.keys(nets)) {
    for (const n of nets[name] || []) {
      if (n.family === 'IPv4' && !n.internal) {
        say('  ' + n.address + '   →  http://' + n.address + ':' + port);
        found = true;
      }
    }
  }
  if (!found) say('  هیچ آدرس شبکه‌ای پیدا نشد');

  // ---------------------------------------------------------------
  section('۷. اجرای آزمایشی برنامه');

  if (!envExists || !hasModules) {
    say('  رد شد — اول باید 1-INSTALL.bat اجرا شود.');
  } else if (busy.length) {
    say('  برنامه از قبل روی این پورت در حال اجراست، پس فقط پاسخش را بررسی می‌کنم:');
    say('  ' + (await checkHttp(port)));
  } else {
    say('  در حال اجرا برای ۱۵ ثانیه…');
    const child = spawn(process.execPath, ['server.js'], { cwd: APP_DIR, stdio: ['ignore', 'pipe', 'pipe'] });
    let serverOutput = '';
    child.stdout.on('data', (d) => (serverOutput += d.toString()));
    child.stderr.on('data', (d) => (serverOutput += d.toString()));

    await new Promise((r) => setTimeout(r, 8000));
    const answer = await checkHttp(port);
    say('  پاسخ برنامه: ' + answer);

    // فقط همین فرایندی که خودمان ساختیم بسته می‌شود، نه بقیه‌ی برنامه‌های Node
    try { child.kill(); } catch (e) { /* از قبل بسته شده */ }
    await new Promise((r) => setTimeout(r, 500));

    say('');
    say('  --- آنچه خود برنامه چاپ کرد ---');
    (serverOutput.trim() || '(چیزی چاپ نکرد)').split(/\r?\n/).forEach((l) => say('  ' + l));
  }

  // ---------------------------------------------------------------
  say('');
  say('===== پایان بررسی =====');

  fs.writeFileSync(LOG_PATH, out.join('\r\n') + '\r\n', 'utf8');
  console.log('');
  console.log('نتیجه در این فایل ذخیره شد:');
  console.log('  ' + LOG_PATH);
}

main().catch((e) => {
  const msg = 'عیب‌یاب با خطا متوقف شد: ' + (e && e.message ? e.message : e);
  console.error(msg);
  try {
    fs.writeFileSync(LOG_PATH, out.concat(['', msg]).join('\r\n') + '\r\n', 'utf8');
  } catch (_) { /* نادیده */ }
  process.exit(1);
});
