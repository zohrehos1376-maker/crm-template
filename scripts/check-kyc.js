#!/usr/bin/env node
/**
 * بررسی سلامت وضعیت احراز همه‌ی پرونده‌ها (فقط خواندن، چیزی عوض نمی‌شود).
 * قاعده: احراز نشده (فرمی نرفته) → منتظر مدارک (لینک رفته) → منتظر تأیید کارشناس (مدرک آمده) → احراز شده / رد شده.
 * اجرا: node scripts/check-kyc.js
 */
require('dotenv').config({ quiet: true });
const { prisma } = require('../shared/prisma');

const LABEL = { none: 'احراز نشده', awaiting: 'منتظر مدارک', pending: 'منتظر تأیید کارشناس', approved: 'احراز شده', rejected: 'مدارک رد شده' };

async function main() {
  const leads = await prisma.lead.findMany({
    select: { id: true, customerName: true, phone: true, kycStatus: true, kycToken: true, kycSubmittedAt: true, kycReviewedAt: true, channel: true },
  });
  const docs = new Set((await prisma.kycDocument.findMany({ select: { leadId: true } })).map((d) => d.leadId));
  const links = new Set((await prisma.leadAudit.findMany({ where: { action: { in: ['kyc_link', 'kyc_remind'] } }, select: { leadId: true } })).map((a) => a.leadId));

  const count = {};
  const bad = [];
  for (const l of leads) {
    const s = l.kycStatus || 'none';
    count[s] = (count[s] || 0) + 1;
    const hasDocs = docs.has(l.id);
    const sent = !!l.kycToken || links.has(l.id);
    if (s === 'awaiting' && !sent && !hasDocs) bad.push([l, 'منتظر مدارک است ولی فرمی برایش فرستاده نشده → باید «احراز نشده» باشد']);
    if (s === 'none' && hasDocs) bad.push([l, 'مدرک دارد ولی «احراز نشده» است → باید «منتظر تأیید کارشناس» باشد']);
    if (s === 'pending' && !hasDocs) bad.push([l, 'منتظر تأیید است ولی هیچ مدرکی ندارد']);
    if (s === 'approved' && !l.kycReviewedAt) bad.push([l, 'احراز شده ولی تاریخ بررسی ندارد (داده‌ی قدیمی)']);
  }
  console.log('همه‌ی پرونده‌ها:', leads.length);
  Object.keys(count).forEach((k) => console.log('  ' + (LABEL[k] || k) + ':', count[k]));
  console.log('ناهماهنگ:', bad.length);
  bad.slice(0, 40).forEach(([l, why]) => console.log(' -', l.customerName, '|', l.phone, '|', LABEL[l.kycStatus] || l.kycStatus, '|', why));
}

main().catch((e) => { console.error(e.message); process.exitCode = 1; }).finally(() => prisma.$disconnect());
