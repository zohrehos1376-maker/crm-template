// یکسان‌سازی یک‌باره‌ی شماره‌ی سرنخ‌های موجود با shared/phone.js
// تا تماس‌های گوشی (و تشخیص تکراری) با سرنخ‌های قدیمی هم تطبیق پیدا کند.
//
//   node scripts/normalize-lead-phones.js          ← فقط گزارش (هیچ چیزی تغییر نمی‌کند)
//   node scripts/normalize-lead-phones.js --apply  ← اعمال (قبلش npm run backup)
require('dotenv').config({ quiet: true, override: true });
const { prisma } = require('../shared/prisma');
const { normalizePhone } = require('../shared/phone');

(async () => {
  const apply = process.argv.includes('--apply');
  const leads = await prisma.lead.findMany({ select: { id: true, phone: true, customerName: true } });
  const changes = [];
  for (const l of leads) {
    const n = normalizePhone(l.phone);
    if (n && n !== l.phone) changes.push({ id: l.id, from: l.phone, to: n, name: l.customerName });
  }
  console.log(`سرنخ‌ها: ${leads.length} | نیاز به یکسان‌سازی: ${changes.length}`);
  changes.slice(0, 15).forEach((c) => console.log(`  ${c.name || '(بدون نام)'}: «${c.from}» → «${c.to}»`));
  if (apply && changes.length) {
    await prisma.$transaction(changes.map((c) => prisma.lead.update({ where: { id: c.id }, data: { phone: c.to } })));
    console.log(`اعمال شد: ${changes.length}`);
  } else if (!apply) {
    console.log('(فقط گزارش — برای اعمال: --apply)');
  }
  await prisma.$disconnect();
})().catch((e) => {
  console.error('خطا:', e.message);
  process.exit(1);
});
