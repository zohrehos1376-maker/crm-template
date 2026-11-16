// «داشبورد مدیریتی» — تصویر واقعیِ امروزِ کل تیم: تماس‌های گوشی‌های کاری، پیگیری‌ها، سرنخ‌های تازه،
// مشتری‌های داغ و هشدارها (تماس بی‌پاسخ، تماس ثبت‌نشده، پیگیری عقب‌افتاده). کار هر کارشناس: repStatsService.
const { prisma } = require('../../../shared/prisma');
const heatService = require('./heatService');
const { UNCONFIRMED_MARK } = require('../lib/followup-marks');

const DAY = 86400000;
const TEHRAN_OFFSET = 3.5 * 3600000; // ایران ساعت تابستانی ندارد
const CLOSED = ['فروش موفق', 'فروش ناموفق'];
const tehranDayStart = (ms) => Math.floor((ms + TEHRAN_OFFSET) / DAY) * DAY - TEHRAN_OFFSET;

async function managerDashboard() {
  const now = Date.now();
  const todayStart = tehranDayStart(now);
  const today = { gte: new Date(todayStart) };
  const weekAgo = new Date(now - 7 * DAY);

  const [leadsToday, followupsToday, karizToday, callsByDir, answeredToday, missedOpen, unlogged, overdue, openLeads] =
    await Promise.all([
      prisma.lead.count({ where: { createdAt: today } }),
      prisma.followup.count({ where: { createdAt: today, NOT: { content: { contains: UNCONFIRMED_MARK } } } }),
      prisma.pipelineItemLog.count({ where: { createdAt: today } }),
      prisma.callLog.groupBy({ by: ['direction'], where: { startedAt: today }, _count: { _all: true }, _sum: { durationSec: true } }),
      prisma.callLog.count({ where: { startedAt: today, durationSec: { gt: 0 } } }),
      // مشتری زنگ زده و جواب نگرفته و هنوز کسی به او زنگ برنگشته (۷ روز اخیر)
      prisma.callLog.count({ where: { startedAt: { gte: weekAgo }, direction: { in: ['MISSED', 'REJECTED'] }, callbackDone: false } }),
      // تماس وصل‌شده‌ای که فرمش پر نشده (۷ روز اخیر)
      prisma.callLog.count({ where: { startedAt: { gte: weekAgo }, logStatus: 'UNLOGGED', direction: { in: ['INCOMING', 'OUTGOING'] } } }),
      prisma.lead.count({ where: { status: { notIn: CLOSED }, nextFollowUpDate: { lt: new Date(todayStart) } } }),
      prisma.lead.findMany({ where: { status: { notIn: CLOSED } }, select: { id: true, status: true } }),
    ]);

  const calls = { total: 0, incoming: 0, outgoing: 0, missed: 0, answered: answeredToday, talkSec: 0 };
  for (const g of callsByDir) {
    calls.total += g._count._all;
    calls.talkSec += g._sum.durationSec || 0;
    if (g.direction === 'INCOMING') calls.incoming += g._count._all;
    else if (g.direction === 'OUTGOING') calls.outgoing += g._count._all;
    else calls.missed += g._count._all;
  }

  const heat = await heatService.heatFor(openLeads);
  let hot = 0;
  const warm = 0; // «داغ» حذف شد — همه‌ی خروجی‌های heatService «لید گرم»اند
  for (const h of heat.values()) if (h.level === 'warm') hot++;

  return {
    today: { leads: leadsToday, followups: followupsToday + karizToday, calls, hot, warm },
    alerts: { missedOpen, unlogged, overdue },
  };
}

module.exports = { managerDashboard };
