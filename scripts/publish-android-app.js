// اعلام نسخه‌ی تازه‌ی اپ «اپ تماس» به گوشی‌ها (صفحه‌ی اصلی اپ پیام «نسخه‌ی تازه» نشان می‌دهد).
// فایل APK باید از قبل در ~/crm-downloads/crm-call.apk گذاشته شده باشد.
//
//   node scripts/publish-android-app.js <versionCode> <versionName> [url] [notes]
//   مثال: node scripts/publish-android-app.js 3 1.0.3 https://crm.example.com/downloads/crm-call.apk
require('dotenv').config({ quiet: true, override: true });
const { prisma } = require('../shared/prisma');

(async () => {
  const [code, name, url, notes] = process.argv.slice(2);
  const versionCode = Number(code);
  if (!versionCode || !name) {
    console.error('استفاده: node scripts/publish-android-app.js <versionCode> <versionName> [url] [notes]');
    process.exit(1);
  }
  const value = JSON.stringify({
    versionCode,
    versionName: name,
    url: url || 'https://crm.example.com/downloads/crm-call.apk',
    notes: notes || '',
  });
  await prisma.setting.upsert({
    where: { key: 'androidApp' },
    create: { key: 'androidApp', value, updatedAt: new Date() },
    update: { value, updatedAt: new Date() },
  });
  console.log('نسخه‌ی اعلام‌شده:', value);
  await prisma.$disconnect();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
