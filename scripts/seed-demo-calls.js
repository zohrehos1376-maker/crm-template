// داده‌ی نمونه‌ی تماس‌ها برای آزمودن تب «تماس‌ها» — از هر نوع و هر وضعیت چند مورد.
// اجرا: node scripts/seed-demo-calls.js      پاک کردن: node scripts/seed-demo-calls.js --clear
// همه‌ی ردیف‌ها externalId با پیشوند DEMO- دارند، پس فقط همان‌ها پاک می‌شوند.
const { prisma } = require('../shared/prisma');

const PREFIX = 'DEMO-CALL-';
const H = 3600 * 1000;

async function clear() {
  const n = await prisma.callLog.deleteMany({ where: { externalId: { startsWith: PREFIX } } });
  console.log('تماس‌های نمونه پاک شد:', n.count);
}

async function main() {
  if (process.argv.includes('--clear')) return clear();

  const line = await prisma.phoneLine.findFirst({ orderBy: { createdAt: 'asc' } });
  if (!line) throw new Error('هیچ خط تلفنی تعریف نشده — اول از تنظیمات یک خط بسازید.');
  const user = await prisma.user.findFirst({ where: { isActive: true, username: { not: '__queue__' } }, orderBy: { createdAt: 'asc' } });
  const leads = await prisma.lead.findMany({ select: { id: true, phone: true, customerName: true }, take: 3 });

  await clear();
  const now = Date.now();
  const rows = [];
  let i = 0;
  const add = (o) => {
    i += 1;
    rows.push(Object.assign({
      phoneLineId: line.id,
      externalId: PREFIX + i,
      phoneRaw: o.phone,
      phoneNormalized: o.phone,
      operatorUserId: user ? user.id : null,
      durationSec: 0,
      logStatus: 'UNLOGGED',
      callbackDone: false,
    }, o, { startedAt: new Date(now - o.agoH * H) }));
    delete rows[rows.length - 1].phone;
    delete rows[rows.length - 1].agoH;
  };

  // ۱) ورودی بلاتکلیف — شماره‌ی تازه (فرم ثبت + ساخت پرونده)
  add({ phone: '09141110001', direction: 'INCOMING', durationSec: 95, agoH: 1 });
  // ۲) ورودی بلاتکلیف — شماره‌ی موجود در CRM (فرم بدون «از کجا آشنا شده»)
  if (leads[0]) add({ phone: leads[0].phone, direction: 'INCOMING', durationSec: 212, agoH: 2, leadId: leads[0].id, callerName: leads[0].customerName });
  // ۳) خروجی بلاتکلیف
  add({ phone: '09141110003', direction: 'OUTGOING', durationSec: 64, agoH: 3 });
  // ۴) بی‌پاسخ — باید زنگ زد (دو دکمه‌ی تماس برگشتی)
  add({ phone: '09141110004', direction: 'MISSED', agoH: 4 });
  // ۵) بی‌پاسخ خارج از ساعت کاری (۳ بامداد)
  add({ phone: '09141110005', direction: 'MISSED', agoH: Math.max(1, new Date().getHours() - 3) + 24 });
  // ۶) ردشده — باید زنگ زد
  add({ phone: '09141110006', direction: 'REJECTED', agoH: 5 });
  // ۷) بی‌پاسخ که تماس برگشتی گرفته شده
  add({ phone: '09141110007', direction: 'MISSED', agoH: 26, callbackDone: true });
  // ۸) ثبت‌شده با نتیجه — استعلام قیمت
  add({ phone: '09141110008', direction: 'INCOMING', durationSec: 183, agoH: 27, logStatus: 'LOGGED', callerName: 'موبایل رضایی (نمونه)', heardFrom: 'اینستاگرام', outcomes: 'price_inquiry', note: 'قیمت LCD شیائومی را پرسید' });
  // ۹) ثبت‌شده با چند نتیجه + محصول ناموجود
  add({ phone: '09141110009', direction: 'INCOMING', durationSec: 340, agoH: 28, logStatus: 'LOGGED', callerName: 'تعمیرات پارس (نمونه)', heardFrom: 'معرفی مشتری', outcomes: 'price_inquiry,out_of_stock', productNote: 'LCD سامسونگ A51 اورجینال', note: 'ناموجود بود، گفت خبر بدهیم' });
  // ۱۰) ثبت‌شده — درخواست همکاری
  add({ phone: '09141110010', direction: 'INCOMING', durationSec: 268, agoH: 29, logStatus: 'LOGGED', callerName: 'سرویس موبایل آریا (نمونه)', heardFrom: 'وبسایت', outcomes: 'cooperation', note: 'فرم احراز برایش فرستاده شد' });
  // ۱۱) «ثبت نشد» — تبلیغاتی
  add({ phone: '09141110011', direction: 'INCOMING', durationSec: 12, agoH: 30, logStatus: 'DISMISSED', dismissReason: 'تبلیغاتی / مزاحم' });
  // ۱۲) «ثبت نشد» — اشتباه گرفته شده
  add({ phone: '09141110012', direction: 'INCOMING', durationSec: 7, agoH: 31, logStatus: 'DISMISSED', dismissReason: 'اشتباه گرفته شده' });
  // ۱۳) تماس برگشتی خودکار: بی‌پاسخ + خروجیِ پاسخ‌داده با همان شماره
  add({ phone: '09141110013', direction: 'MISSED', agoH: 33 });
  add({ phone: '09141110013', direction: 'OUTGOING', durationSec: 144, agoH: 32 });
  // ۱۴) استعلام قیمت تکراری (نشان «🔁 استعلام قیمت N بار»)
  add({ phone: '09141110014', direction: 'INCOMING', durationSec: 90, agoH: 50, logStatus: 'LOGGED', callerName: 'موبایل کاوه (نمونه)', outcomes: 'price_inquiry', note: 'بار اول قیمت پرسید' });
  add({ phone: '09141110014', direction: 'INCOMING', durationSec: 77, agoH: 36, logStatus: 'LOGGED', callerName: 'موبایل کاوه (نمونه)', outcomes: 'price_inquiry', note: 'بار دوم قیمت پرسید' });
  add({ phone: '09141110014', direction: 'INCOMING', durationSec: 60, agoH: 10, logStatus: 'LOGGED', callerName: 'موبایل کاوه (نمونه)', outcomes: 'price_inquiry', note: 'بار سوم قیمت پرسید' });

  await prisma.callLog.createMany({ data: rows });

  // همان قاعده‌ی سرور: هر تماس پاسخ‌داده، بی‌پاسخ‌های قبلیِ همان شماره را «تماس برگشتی» می‌کند
  const answered = rows.filter((r) => r.durationSec > 0 && (r.direction === 'OUTGOING' || r.direction === 'INCOMING'));
  for (const a of answered) {
    await prisma.callLog.updateMany({
      where: { phoneNormalized: a.phoneNormalized, direction: { in: ['MISSED', 'REJECTED'] }, callbackDone: false, startedAt: { lt: a.startedAt } },
      data: { callbackDone: true },
    });
  }
  console.log('تماس نمونه ساخته شد:', rows.length, '— خط:', line.name);
  console.log('برای پاک کردن: node scripts/seed-demo-calls.js --clear');
}

main().catch((e) => { console.error(e.message); process.exitCode = 1; }).finally(() => prisma.$disconnect());
