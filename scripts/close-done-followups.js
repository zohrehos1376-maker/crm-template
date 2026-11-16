// یک‌بار: سرنخ‌هایی که موعد پیگیری‌شان رسیده و بعد از آن تماس وصل‌شده‌ای با مشتری داشته‌اند
// (همان کاری که حالا خودکار با هر تماس انجام می‌شود) — تاریخ پیگیری‌شان پاک می‌شود.
//   node scripts/close-done-followups.js          ← فقط گزارش
//   node scripts/close-done-followups.js --apply  ← اعمال (قبلش npm run backup)
require('dotenv').config({ quiet: true, override: true });
const { prisma } = require('../shared/prisma');

const tehranDayStart = (ms) => Math.floor((ms + 12600000) / 86400000) * 86400000 - 12600000;

(async () => {
  const apply = process.argv.includes('--apply');
  const leads = await prisma.lead.findMany({
    where: { status: { notIn: ['فروش موفق', 'فروش ناموفق'] }, nextFollowUpDate: { not: null, lte: new Date() } },
    select: { id: true, customerName: true, nextFollowUpDate: true, nextFollowUpNote: true },
  });
  const done = [];
  for (const l of leads) {
    const call = await prisma.callLog.findFirst({
      where: { leadId: l.id, durationSec: { gt: 0 }, startedAt: { gte: new Date(tehranDayStart(l.nextFollowUpDate.getTime())) } },
      select: { id: true },
    });
    if (call) done.push(l);
  }
  console.log('سرنخ با موعد گذشته/امروز: ' + leads.length + ' — بعد از موعد تماس وصل‌شده داشته‌اند: ' + done.length);
  done.forEach((l) => console.log(' - ' + (l.customerName || '(بی‌نام)') + ' | ' + (l.nextFollowUpNote || '').slice(0, 50)));
  if (apply && done.length) {
    await prisma.lead.updateMany({ where: { id: { in: done.map((l) => l.id) } }, data: { nextFollowUpDate: null, nextFollowUpNote: null } });
    console.log('اعمال شد.');
  }
  process.exit(0);
})();
