// ماژول «crm» — سرنخ‌های فروش، خودروهای درخواستی، پیگیری‌ها و گزارش‌های فروش.
//
// این ماژول از core (کاربران، شعبه‌ها، احراز هویت) استفاده می‌کند،
// ولی هیچ ماژول دیگری به آن وابسته نیست. برای افزودن ماژول بعدی
// (مثلاً انبار)، یک پوشه‌ی هم‌سطح این بسازید و در api.js ثبتش کنید.
const express = require('express');

const router = express.Router();

router.use('/leads', require('./routes/leads'));
router.use('/reports', require('./routes/reports'));
// تماس‌های گوشی‌های کاری: صفحه‌ی CRM (نشست) و API اپ اندروید (توکن دستگاه)
router.use('/calls', require('./routes/calls'));
router.use('/device', require('./routes/device'));
// CRM نمونه: میز کار مشاور (احراز، وظیفه، گزارش، پیامک، صف) و مسیرهای عمومی (فرم احراز، فرم سایت)
router.use('/workdesk', require('./routes/workdesk'));
router.use('/public', require('./routes/public'));

module.exports = router;
