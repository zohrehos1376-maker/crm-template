// یک‌باره: تماس‌های قبلیِ گوشی‌های کاری با مشتری‌های ثبت‌شده را به «پیگیری» در پرونده تبدیل می‌کند
// (از این به بعد خودکار انجام می‌شود). تکرار اجرا بی‌خطر است — پیگیری تکراری ساخته نمی‌شود.
//
//   node scripts/calls-to-followups.js          ← فقط گزارش
//   node scripts/calls-to-followups.js --apply  ← اعمال (قبلش npm run backup)
require('dotenv').config({ quiet: true, override: true });
const { prisma } = require('../shared/prisma');
const callService = require('../modules/crm/services/callService');

(async () => {
  const apply = process.argv.includes('--apply');
  // تماس‌های ورودی دیگر پیگیری کارشناس حساب نمی‌شوند — پیگیری خودکاری که قبلاً از آن‌ها ساخته شده پاک می‌شود
  // (فقط همان ردیفِ خودکار: همان سرنخ + دقیقاً همان لحظه‌ی شروع تماس)
  const inbound = await prisma.callLog.findMany({
    where: { leadId: { not: null }, direction: 'INCOMING' },
    select: { leadId: true, startedAt: true },
  });
  let inboundFu = [];
  for (const c of inbound) {
    const f = await prisma.followup.findFirst({ where: { leadId: c.leadId, followupDate: c.startedAt }, select: { id: true } });
    if (f) inboundFu.push(f.id);
  }
  console.log('پیگیری‌های ساخته‌شده از تماس ورودی (حذف می‌شوند): ' + inboundFu.length);
  if (apply && inboundFu.length) await prisma.followup.deleteMany({ where: { id: { in: inboundFu } } });
  const calls = await prisma.callLog.findMany({
    where: {
      leadId: { not: null },
      direction: 'OUTGOING',
      OR: [{ durationSec: { gt: 0 } }, { logStatus: 'LOGGED' }],
    },
    select: { id: true, leadId: true, startedAt: true },
    orderBy: { startedAt: 'asc' },
  });
  let missing = 0;
  for (const c of calls) {
    const has = await prisma.followup.findFirst({ where: { leadId: c.leadId, followupDate: c.startedAt }, select: { id: true } });
    if (!has) missing++;
  }
  console.log(`تماس‌های وصل‌شده/ثبت‌شده با مشتری‌های CRM: ${calls.length} | بدون پیگیری: ${missing}`);
  if (!apply) {
    console.log('(فقط گزارش — برای اعمال: --apply)');
    process.exit(0);
  }
  for (const c of calls) await callService.syncCallFollowup(c.id);
  console.log('اعمال شد.');
  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
