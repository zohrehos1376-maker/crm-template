#!/usr/bin/env node
/**
 * اصلاح وضعیت احراز پرونده‌های قدیمی: «منتظر مدارک» فقط برای کسی که فرم/لینک برایش رفته.
 * پرونده‌هایی که awaiting هستند ولی نه لینکی گرفته‌اند و نه مدرکی فرستاده‌اند → «احراز نشده».
 * هیچ داده‌ای پاک نمی‌شود؛ فقط همین یک ستون اصلاح می‌شود.
 * اجرا: node scripts/fix-kyc-awaiting.js [--dry]
 */
require('dotenv').config({ quiet: true });
const { prisma } = require('../shared/prisma');

async function main() {
  const dry = process.argv.includes('--dry');
  const rows = await prisma.lead.findMany({
    where: { kycStatus: 'awaiting', kycToken: null },
    select: { id: true, customerName: true },
  });
  const withDocs = new Set((await prisma.kycDocument.findMany({
    where: { leadId: { in: rows.map((r) => r.id) } }, select: { leadId: true },
  })).map((d) => d.leadId));
  const fix = rows.filter((r) => !withDocs.has(r.id));
  console.log('پرونده‌های نیازمند اصلاح:', fix.length);
  fix.slice(0, 20).forEach((r) => console.log(' -', r.customerName));
  if (dry || !fix.length) return;
  const n = await prisma.lead.updateMany({ where: { id: { in: fix.map((r) => r.id) } }, data: { kycStatus: 'none' } });
  console.log('اصلاح شد:', n.count, '— حالا «احراز نشده» هستند');
}

main().catch((e) => { console.error(e.message); process.exitCode = 1; }).finally(() => prisma.$disconnect());
