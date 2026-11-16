#!/usr/bin/env node
/**
 * داده‌ی نمونه برای دیدن و امتحان CRM (مشتری، سرنخ صف، تماس، پیگیری، وظیفه، گروه پشتیبان، احراز، گزارش).
 * همه‌ی نام‌ها «(نمونه)» دارند و شماره‌ها در بازه‌ی 0912000010x–0912000012x هستند تا با داده‌ی واقعی قاطی نشوند.
 * اجرای دوباره چیز تکراری نمی‌سازد (شماره‌ی موجود رد می‌شود).
 *
 * اجرا: node scripts/seed-demo.js
 * کارها به نام اولین مدیر فعال ثبت می‌شوند. پاک کردن: فقط با اجازه‌ی کاربر (همه‌ی سرنخ‌هایی که نامشان «(نمونه)» دارد).
 */
require('dotenv').config({ quiet: true });
const { prisma } = require('../shared/prisma');
const leadService = require('../modules/crm/services/leadService');
const callService = require('../modules/crm/services/callService');
const kycService = require('../modules/crm/services/kycService');
const taskService = require('../modules/crm/services/taskService');
const reportService = require('../modules/crm/services/salesReportService');
const fileService = require('../modules/crm/services/customerFileService');
const { parsePermissions } = require('../shared/permissions');

const N = (s) => s + ' (نمونه)';
const MIN = 60000, HOUR = 3600000, DAY = 86400000;

const CUSTOMERS = [
  { phone: '09120000101', name: 'رضا کریمی', shopName: 'موبایل کریمی', city: 'تهران', jobType: 'تعمیرکار', channel: 'تماس تلفنی', notes: 'مشتری ثابت؛ بیشتر LCD سامسونگ سری A می‌خرد.' },
  { phone: '09120000102', name: 'مهدی رستمی', shopName: 'تعمیرگاه رستمی', city: 'کرج', jobType: 'تعمیرکار', channel: 'اینستاگرام' },
  { phone: '09120000103', name: 'سارا احمدی', shopName: 'قطعات موبایل نگین', city: 'اصفهان', jobType: 'قطعه‌فروش', channel: 'معرفی همکار' },
  { phone: '09120000104', name: 'علی نوروزی', shopName: 'موبایل پارسه', city: 'شیراز', jobType: 'تعمیرکار و قطعه‌فروش', channel: 'تماس تلفنی' },
  { phone: '09120000105', name: 'حسین مرادی', shopName: 'تک‌تعمیر', city: 'تهران', jobType: 'تعمیرکار', channel: 'سایت' },
  { phone: '09120000106', name: 'نرگس صالحی', shopName: 'موبایل صالحی', city: 'مشهد', jobType: 'قطعه‌فروش', channel: 'تماس تلفنی' },
  { phone: '09120000107', name: 'امیر قاسمی', shopName: 'ال‌سی‌دی قاسمی', city: 'رشت', jobType: 'تعمیرکار', channel: 'تماس تلفنی' },
  { phone: '09120000108', name: 'محمد جعفری', shopName: 'موبایل جعفری', city: 'قم', jobType: 'تعمیرکار', channel: 'نمایشگاه' },
];
// ورودی‌های فرم همکاری سایت و وردست که هنوز مسئول ندارند (برای «منتظر پاسخ» و «صف بدون مسئول»)
const QUEUE = [
  { phone: '09120000111', name: 'کیوان یزدانی', shopName: 'موبایل یزدان', city: 'یزد', jobType: 'تعمیرکار', source: 'فرم همکاری سایت', ago: 20 * MIN },
  { phone: '09120000112', name: 'لیلا حسینی', shopName: 'قطعات حسینی', city: 'اهواز', jobType: 'قطعه‌فروش', source: 'فرم همکاری سایت', ago: 3 * HOUR },
  { phone: '09120000113', name: 'پیمان شریفی', shopName: 'شریفی موبایل', city: 'کرمان', jobType: 'تعمیرکار', source: 'وردست (اینستاگرام)', ago: 50 * MIN },
  // بدون مسئول و دیرشده (بیشتر از ۳۰ دقیقه → قرمز)
  { phone: '09120000114', name: 'بهنام قربانی', shopName: 'موبایل بهنام', city: 'زنجان', jobType: 'قطعه‌فروش', source: 'وردست (اینستاگرام)', ago: 5 * HOUR },
  // «در حال رسیدگی»: مسئول دارد ولی هنوز اقدامی ثبت نشده
  { phone: '09120000115', name: 'سعید اکبری', shopName: 'ال‌سی‌دی اکبری', city: 'ساری', jobType: 'تعمیرکار', source: 'فرم همکاری سایت', ago: 2 * HOUR, claim: true },
  { phone: '09120000116', name: 'مریم نجفی', shopName: 'قطعات نجفی', city: 'بندرعباس', jobType: 'قطعه‌فروش', source: 'وردست (اینستاگرام)', ago: 90 * MIN, claim: true },
  // «رسیدگی شد» با اقدام ثبت‌شده
  { phone: '09120000117', name: 'فرهاد مرادی', shopName: 'موبایل فرهاد', city: 'همدان', jobType: 'تعمیرکار', source: 'فرم همکاری سایت', ago: 6 * HOUR, claim: true, done: 'لینک احراز همکاری فرستادم — منتظر مدارک است' },
  { phone: '09120000118', name: 'الهام رضوی', shopName: 'موبایل رضوی', city: 'گرگان', jobType: 'قطعه‌فروش', source: 'وردست (اینستاگرام)', ago: 8 * HOUR, claim: true, done: 'تماس گرفتم و صحبت شد — قیمت دادم، فکر می‌کند' },
  // لیدهای وردست (اینستاگرام / دایرکت) با متن سؤال مشتری — همه‌ی حالت‌ها
  { phone: '09120000131', name: 'یوسف طاهری', shopName: 'موبایل طاهری', city: 'اراک', jobType: 'تعمیرکار', source: 'وردست (دایرکت اینستاگرام)', note: 'قیمت LCD سامسونگ A12 اورجینال چنده؟', ago: 8 * MIN },
  { phone: '09120000132', name: 'سمیرا فتحی', shopName: 'قطعات فتحی', city: 'قزوین', jobType: 'قطعه‌فروش', source: 'وردست (دایرکت اینستاگرام)', note: 'برای همکاری عمده شرایطتون چیه؟', ago: 70 * MIN },
  { phone: '09120000133', name: 'رامین داوودی', shopName: 'سرویس موبایل رامین', city: 'سنندج', jobType: 'تعمیرکار', source: 'وردست (کامنت اینستاگرام)', note: 'تاچ آیفون ۱۱ موجوده؟', ago: 4 * HOUR },
  { phone: '09120000134', name: 'نسیم بهرامی', shopName: 'موبایل بهرامی', city: 'یاسوج', jobType: 'تعمیرکار و قطعه‌فروش', source: 'وردست (دایرکت اینستاگرام)', note: 'ارسال به شهرستان چطوریه؟', ago: 3 * HOUR, claim: true },
  { phone: '09120000135', name: 'جواد عابدی', shopName: 'ال‌سی‌دی عابدی', city: 'خرم‌آباد', jobType: 'قطعه‌فروش', source: 'وردست (دایرکت اینستاگرام)', note: 'لیست قیمت شیائومی را می‌خواهم', ago: 26 * HOUR, claim: true, done: 'پیام دادم (واتساپ / تلگرام) — لیست قیمت فرستادم' },
];

// یک «مدرک نمونه» (عکس کوچک) برای پرونده‌هایی که باید تأیید/رد شوند
const fs = require('fs');
const path = require('path');
const UPLOAD_DIR = path.join(__dirname, '../data/uploads/kyc');
const SAMPLE_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAGQAAAAyCAIAAAC0i1xTAAAAXklEQVR4nO3PMQ0AIBDAwAcJ8y8BE2yEhLtJOnRdM7Pgx74OeIjNYjaL2Sxms5jNYjaL2Sxms5jNYjaL2Sxms5jNYjaL2Sxms5jNYjaL2Sxms5jNYjaL2Sxms9gFqgQB/dDzIskAAAAASUVORK5CYII=',
  'base64'
);
async function kycDoc(leadId, at) {
  if (!leadId) return;
  if (await prisma.kycDocument.findFirst({ where: { leadId }, select: { id: true } })) return;
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
  const fileName = 'demo-' + leadId.slice(0, 8) + '.png';
  fs.writeFileSync(path.join(UPLOAD_DIR, fileName), SAMPLE_PNG);
  await prisma.kycDocument.create({ data: { leadId, fileName, mime: 'image/png', size: SAMPLE_PNG.length, createdAt: new Date(at) } });
}

async function main() {
  const admin = await prisma.user.findFirst({ where: { role: 'manager', isActive: true, username: { not: '__queue__' } }, orderBy: { createdAt: 'asc' } });
  if (!admin) throw new Error('مدیر فعالی پیدا نشد');
  const user = { id: admin.id, username: admin.username, fullName: admin.fullName, role: admin.role, active: true, branchId: admin.branchId, permissions: parsePermissions(admin.permissions) };
  const now = Date.now();
  const ids = {};

  // ۱) مشتری‌ها
  for (const c of CUSTOMERS) {
    const found = await prisma.lead.findFirst({ where: { phone: c.phone }, select: { id: true } });
    if (found) { ids[c.phone] = found.id; continue; }
    const r = await leadService.createLead(user, Object.assign({}, c, { name: N(c.name), contactMethods: ['تماس تلفنی'] }), admin.id, admin.branchId);
    ids[c.phone] = r.lead ? r.lead.id : r.id;
  }
  // ۲) فرم همکاری سایت و وردست → صف بدون مسئول
  for (const q of QUEUE) {
    if (await prisma.lead.findFirst({ where: { phone: q.phone }, select: { id: true } })) continue;
    const r = await kycService.intake({ phone: q.phone, name: N(q.name), shopName: q.shopName, city: q.city, jobType: q.jobType, source: q.source, note: q.note });
    await prisma.lead.update({ where: { id: r.leadId }, data: { createdAt: new Date(now - q.ago) } });
    await prisma.leadAudit.updateMany({ where: { leadId: r.leadId, action: 'intake' }, data: { createdAt: new Date(now - q.ago) } });
    // مسئول شدن کارشناس («در حال رسیدگی») و بعد ثبت اقدام («رسیدگی شد»)
    if (q.claim) await prisma.lead.update({ where: { id: r.leadId }, data: { ownerId: admin.id } });
    if (q.done) await prisma.leadAudit.create({ data: { leadId: r.leadId, userId: admin.id, action: 'intake_done', summary: q.done, createdAt: new Date(now - q.ago + 30 * MIN) } });
  }

  // ۳) تماس‌های خط نمونه
  const line = (await prisma.phoneLine.findFirst({ where: { name: 'خط نمونه' } })) || (await prisma.phoneLine.create({ data: { name: 'خط نمونه' } }));
  const calls = [];
  // مشتری ۱: گروه پشتیبان دارد ولی زیاد زنگ می‌زند → «ترجیح تماس»
  for (let i = 1; i <= 6; i++) calls.push({ externalId: 'demo-101-' + i, startedAt: now - i * 4 * DAY, direction: 'INCOMING', durationSec: 60 + i * 20, phone: '09120000101' });
  calls.push(
    { externalId: 'demo-102-1', startedAt: now - 2 * HOUR, direction: 'INCOMING', durationSec: 140, phone: '09120000102' },
    { externalId: 'demo-103-1', startedAt: now - DAY, direction: 'INCOMING', durationSec: 95, phone: '09120000103' },
    { externalId: 'demo-104-1', startedAt: now - 3 * DAY, direction: 'OUTGOING', durationSec: 210, phone: '09120000104' },
    // تماس‌های بی‌پاسخ برای «منتظر پاسخ»: ۵ دقیقه، ۴۵ دقیقه و ۳ ساعت پیش
    { externalId: 'demo-miss-1', startedAt: now - 5 * MIN, direction: 'MISSED', phone: '09120000121', contactName: '' },
    { externalId: 'demo-miss-2', startedAt: now - 45 * MIN, direction: 'MISSED', phone: '09120000122' },
    { externalId: 'demo-miss-3', startedAt: now - 3 * HOUR, direction: 'MISSED', phone: '09120000105' },
    // تماس پاسخ‌داده که هنوز ثبت نشده
    { externalId: 'demo-unlogged-1', startedAt: now - 30 * MIN, direction: 'INCOMING', durationSec: 75, phone: '09120000123' },
  );
  await callService.ingestBatch(line, calls);

  // ۴) پیگیری‌ها، وظیفه‌ها، گروه پشتیبان، احراز و گزارش به مدیر (فقط بار اول)
  const firstRun = !(await prisma.followup.count({ where: { leadId: ids['09120000101'] } }));
  if (firstRun) {
    const fu = (phone, content, extra) => leadService.addFollowup(user, ids[phone], Object.assign({ content }, extra || {}));
    await fu('09120000101', '✅ تماس گرفتم — جواب داد: سفارش داد، LCD A51 و A32');
    await fu('09120000102', '✅ تماس گرفتم — جواب داد: فقط قیمت پرسید');
    await fu('09120000103', '💬 پیام دادم: لیست قیمت فرستادم', { messageSent: true });
    await fu('09120000104', '📵 تماس گرفتم — جواب نداد: مشغول بود');
    await fu('09120000106', '🏢 حضوری آمد: محصول را دید، قیمت گرفت');

    await taskService.create(user, ids['09120000102'], { topic: 'quote', dueAt: now + DAY, note: 'پیش‌فاکتور LCD Note 12 برایش بفرستیم' });
    await taskService.create(user, ids['09120000104'], { topic: 'part_check', dueAt: now - DAY, note: 'بررسی موجودی تاچ و ال‌سی‌دی iPhone 11' });
    await taskService.create(user, ids['09120000107'], { topic: 'delivery', dueAt: now + 2 * HOUR, note: 'هماهنگی ارسال با پیک' });

    await fileService.updateSupportGroup(user, ids['09120000101'], { platform: 'whatsapp', name: 'CRM نمونه — موبایل کریمی (نمونه)', members: [admin.id] });
    await fileService.updateSupportGroup(user, ids['09120000103'], { platform: 'telegram', name: 'CRM نمونه — نگین (نمونه)', members: [admin.id] });


    await reportService.create(user, { leadId: ids['09120000102'], kind: 'competitor_price', details: { product: 'LCD سامسونگ A51', ourPrice: '1850000', competitorPrice: '1700000', competitor: 'بازار علاءالدین' }, note: 'مشتری می‌گوید رقیب ارزان‌تر داده' });
    await reportService.create(user, { leadId: ids['09120000106'], kind: 'out_of_stock', details: { product: 'تاچ ال‌سی‌دی Xiaomi Note 12', quantity: '5' }, note: '' });
  }

  // وضعیت احراز نمونه‌ها (هر بار اجرا، حتی روی داده‌ی قبلی): «منتظر تأیید» و «احراز شده» بدون مدرک نمی‌مانند
  const demo = await prisma.lead.findMany({ where: { customerName: { contains: '(نمونه)' }, kycStatus: { in: ['pending', 'approved'] } }, select: { id: true, kycStatus: true, kycSubmittedAt: true, kycReviewedAt: true } });
  for (const l of demo) {
    await kycDoc(l.id, (l.kycSubmittedAt && l.kycSubmittedAt.getTime()) || now - 2 * HOUR);
    const data = {};
    if (!l.kycSubmittedAt) data.kycSubmittedAt = new Date(now - 2 * HOUR);
    if (l.kycStatus === 'approved' && !l.kycReviewedAt) { data.kycReviewedAt = new Date(now - DAY); data.kycReviewedBy = admin.id; }
    if (Object.keys(data).length) await prisma.lead.update({ where: { id: l.id }, data });
  }

  const count = await prisma.lead.count({ where: { customerName: { contains: '(نمونه)' } } });
  console.log('آماده شد: ' + count + ' مشتری/سرنخ نمونه، تماس‌ها روی «خط نمونه».');
}

main().catch((e) => { console.error('خطا: ' + e.message); process.exitCode = 1; }).finally(() => prisma.$disconnect());
