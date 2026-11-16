#!/usr/bin/env node
/**
 * ثبت پشتیبان‌گیری خودکار در زمان‌بند ویندوز (Task Scheduler).
 *
 *   npm run backup:schedule     ثبت یا به‌روزرسانی زمان‌بندی
 *   npm run backup:unschedule   حذف زمان‌بندی
 *
 * دو زمان‌بندی ثبت می‌شود:
 *   ۱. هر روز ساعت مشخص (پیش‌فرض ۱۴:۰۰)
 *   ۲. هنگام ورود کاربر — تا اگر آن ساعت کامپیوتر خاموش بوده، پشتیبان از دست نرود
 *
 * نیازی به دسترسی مدیر ندارد؛ زمان‌بندی برای همین کاربر ثبت می‌شود.
 */
const path = require('path');
const { execFileSync } = require('child_process');

const APP_DIR = path.join(__dirname, '..');
const DAILY_TASK = 'CRM Crm - Backup Daily';
const LOGON_TASK = 'CRM Crm - Backup At Logon';
const AT_TIME = process.env.BACKUP_AT || '14:00';

// اجرای پشتیبان‌گیری بدون باز شدن پنجره: cmd آن را در پس‌زمینه اجرا می‌کند
const RUN = 'cmd /c "cd /d ' + APP_DIR + ' && npm run backup >> ' + path.join(APP_DIR, 'logs', 'backup.log') + ' 2>&1"';

function schtasks(args) {
  // stderr خفه می‌شود چون بخش‌هایی از این کار اختیاری‌اند و پیام خطایشان
  // نباید کاربر را نگران کند؛ نتیجه‌ی واقعی در پایان گزارش می‌شود.
  return execFileSync('schtasks', args, {
    encoding: 'utf8',
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'ignore'],
  });
}

function removeTask(name) {
  try {
    schtasks(['/delete', '/tn', name, '/f']);
    return true;
  } catch (e) {
    return false;
  }
}

function createDaily() {
  schtasks(['/create', '/tn', DAILY_TASK, '/tr', RUN, '/sc', 'daily', '/st', AT_TIME, '/f']);
}

// اگر کامپیوتر سر ساعت مقرر خاموش بوده، ویندوز در اولین فرصت پشتیبان را بگیرد.
// این تنظیم در schtasks نیست و فقط از PowerShell قابل اعمال است.
function enableCatchUp() {
  try {
    execFileSync(
      'powershell',
      [
        '-NoProfile',
        '-Command',
        "$s = New-ScheduledTaskSettingsSet -StartWhenAvailable; Set-ScheduledTask -TaskName '" + DAILY_TASK + "' -Settings $s | Out-Null",
      ],
      { encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] }
    );
    return true;
  } catch (e) {
    return false;
  }
}

// زمان‌بندی «هنگام ورود کاربر» روی همه‌ی سیستم‌ها بدون دسترسی مدیر ساخته نمی‌شود.
// اگر نشد مشکلی نیست — زمان‌بندی روزانه به‌تنهایی کار را انجام می‌دهد.
function createLogon() {
  try {
    schtasks(['/create', '/tn', LOGON_TASK, '/tr', RUN, '/sc', 'onlogon', '/f']);
    return true;
  } catch (e) {
    return false;
  }
}

function list() {
  for (const name of [DAILY_TASK, LOGON_TASK]) {
    try {
      const out = schtasks(['/query', '/tn', name, '/fo', 'list']);
      const status = (/Status:\s*(.+)/i.exec(out) || [])[1];
      const next = (/Next Run Time:\s*(.+)/i.exec(out) || [])[1];
      console.log('  ✓ ' + name + (status ? ' | وضعیت: ' + status.trim() : '') + (next ? ' | اجرای بعدی: ' + next.trim() : ''));
    } catch (e) {
      console.log('  ✗ ' + name + ' ثبت نشده');
    }
  }
}

const mode = process.argv[2] === 'remove' ? 'remove' : 'install';

try {
  if (mode === 'remove') {
    console.log('در حال حذف زمان‌بندی پشتیبان‌گیری…');
    console.log(removeTask(DAILY_TASK) ? '  زمان‌بندی روزانه حذف شد' : '  زمان‌بندی روزانه وجود نداشت');
    console.log(removeTask(LOGON_TASK) ? '  زمان‌بندی هنگام ورود حذف شد' : '  زمان‌بندی هنگام ورود وجود نداشت');
  } else {
    console.log('در حال ثبت پشتیبان‌گیری خودکار…');
    createDaily();
    console.log('  زمان‌بندی روزانه ساعت ' + AT_TIME + ' ثبت شد');
    console.log(
      enableCatchUp()
        ? '  اگر کامپیوتر آن ساعت خاموش باشد، در اولین فرصت جبران می‌شود'
        : '  (تنظیم جبران خودکار اعمال نشد — زمان‌بندی روزانه به کار خودش ادامه می‌دهد)'
    );
    if (createLogon()) console.log('  زمان‌بندی هنگام ورود کاربر هم ثبت شد');
    console.log('');
    console.log('زمان‌بندی‌های ثبت‌شده:');
    list();
    console.log('');
    console.log('پشتیبان‌ها در این پوشه ذخیره می‌شوند: ' + (process.env.BACKUP_DIR || 'D:\\auto-crm-backups'));
  }
} catch (e) {
  console.error('خطا: ' + (e.stderr ? String(e.stderr).trim() : e.message));
  process.exit(1);
}
