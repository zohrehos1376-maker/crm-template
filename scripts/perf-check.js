#!/usr/bin/env node
// اندازه‌گیری سرعت بخش‌های اصلی (همان کارهایی که هنگام باز شدن هر تب انجام می‌شود) روی دیتابیس واقعی.
// فقط زمان (میلی‌ثانیه) و تعداد ردیف چاپ می‌شود — هیچ اطلاعات مشتری نمایش داده نمی‌شود و چیزی تغییر نمی‌کند.
// اجرا: node scripts/perf-check.js
require('dotenv').config({ quiet: true });
const { prisma } = require('../shared/prisma');
const userService = require('../modules/core/services/userService');
const leadService = require('../modules/crm/services/leadService');
const callService = require('../modules/crm/services/callService');
const myDesk = require('../modules/crm/services/mydeskService');
const dashboardService = require('../modules/crm/services/dashboardService');

function size(v) {
  if (Array.isArray(v)) return v.length + ' ردیف';
  if (v && typeof v === 'object') {
    const k = Object.keys(v).find((x) => Array.isArray(v[x]));
    return k ? v[k].length + ' ردیف (' + k + ')' : '';
  }
  return '';
}

(async () => {
  const mgr = await prisma.user.findFirst({ where: { role: 'manager', isActive: true }, select: { id: true } });
  if (!mgr) throw new Error('مدیر فعالی پیدا نشد');
  const user = await userService.findActiveById(mgr.id);
  const from = Date.now() - 7 * 864e5;
  const jobs = [
    ['ورود کاربر (هر درخواست)', () => userService.findActiveById(mgr.id)],
    ['فهرست مشتریان /leads', () => leadService.listLeads(user, {})],
    ['شمارش بخش‌ها /leads', () => leadService.segmentCounts(user, {})],
    ['کارهای من /mydesk', () => myDesk.feed(user, { days: 7 })],
    ['تماس‌ها /calls', () => callService.listCalls(user, { from, sort: 'desc' })],
    ['گزارش تماس‌ها', () => callService.report({ from })],
    ['داشبورد مدیر', () => dashboardService.managerDashboard()],
  ];
  for (const [name, fn] of jobs) {
    for (let i = 0; i < 2; i++) {
      const t = process.hrtime.bigint();
      let r, err = '';
      try { r = await fn(); } catch (e) { err = ' خطا: ' + e.message; }
      const ms = Number(process.hrtime.bigint() - t) / 1e6;
      const bytes = r ? Buffer.byteLength(JSON.stringify(r, (k, v) => (typeof v === 'bigint' ? String(v) : v))) : 0;
      console.log((i ? '  (بار دوم) ' : '') + name + ': ' + Math.round(ms) + 'ms · ' + Math.round(bytes / 1024) + 'KB ' + size(r) + err);
    }
  }
  await prisma.$disconnect();
})().catch((e) => { console.error(e.message); process.exit(1); });
