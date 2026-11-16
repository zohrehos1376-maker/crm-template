/**
 * اصلاح داده‌ی قدیمی: بی‌پاسخ‌هایی که به‌خاطر باگ logLinkedCalls نتیجه‌ی تماس برگشتی روی آن‌ها
 * کپی شده بود (outcomes/note/productNote/followUpAt). از امروز این کپی دیگر انجام نمی‌شود؛
 * این اسکریپت فقط داده‌ی قدیمیِ آلوده را پاک می‌کند — logStatus و callbackDone دست نمی‌خورند
 * (آن تماس واقعاً با تماس برگشتی بسته شده، همین درست است).
 *
 * تشخیص «آلوده»: بی‌پاسخی که outcomes دارد و یک تماسِ واقعی (برقرارشده) با همان شماره، در ۷ روز
 * بعدش، با دقیقاً همان outcomes و همان note وجود دارد — یعنی محتوا از آن تماس کپی شده (رفتار دقیق
 * باگ). اگر این تطابق نباشد (مثلاً کارشناس خودش مستقیم روی همین بی‌پاسخ چیزی ثبت کرده)، دست نمی‌خورد.
 *
 * اجرا: node scripts/fix-missed-call-outcomes.js            (فقط گزارش می‌دهد)
 *       node scripts/fix-missed-call-outcomes.js --apply     (واقعاً اصلاح می‌کند)
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const { prisma } = require('../shared/prisma');

const apply = process.argv.includes('--apply');

async function main() {
  const candidates = await prisma.callLog.findMany({
    where: { direction: { in: ['MISSED', 'REJECTED'] }, outcomes: { not: null } },
    select: { id: true, phoneNormalized: true, startedAt: true, outcomes: true, note: true, leadId: true, callbackDone: true },
    orderBy: { startedAt: 'asc' },
  });
  console.log('بی‌پاسخ‌های دارای نتیجه (کاندید بررسی):', candidates.length);

  let polluted = 0;
  for (const c of candidates) {
    const match = await prisma.callLog.findFirst({
      where: {
        phoneNormalized: c.phoneNormalized,
        direction: { in: ['INCOMING', 'OUTGOING'] },
        durationSec: { gt: 0 },
        startedAt: { gt: c.startedAt, lte: new Date(c.startedAt.getTime() + 7 * 86400000) },
        outcomes: c.outcomes,
        note: c.note,
      },
      select: { id: true, startedAt: true },
    });
    if (!match) continue;
    polluted++;
    console.log(
      (apply ? 'اصلاح:' : 'آلوده:'),
      c.phoneNormalized, c.startedAt.toISOString().slice(0, 16),
      '← کپی از تماس', match.startedAt.toISOString().slice(0, 16),
      'نتیجه:', c.outcomes, c.leadId ? '(پرونده دارد)' : ''
    );
    if (apply) {
      await prisma.callLog.update({
        where: { id: c.id },
        data: { outcomes: null, note: null, productNote: null, followUpAt: null },
      });
    }
  }
  console.log('---');
  console.log('آلوده پیدا شد:', polluted, apply ? '— همه اصلاح شدند' : '— برای اصلاح: --apply بزنید');
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
