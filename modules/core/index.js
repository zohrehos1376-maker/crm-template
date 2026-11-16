// ماژول «core» — زیربنای مشترک همه‌ی ماژول‌ها:
// ورود و احراز هویت، کاربران و شعبه‌ها.
//
// قاعده‌ی وابستگی: ماژول‌های دیگر (crm، و در آینده inventory و accounting)
// می‌توانند از core استفاده کنند، ولی core هیچ‌وقت به آن‌ها وابسته نمی‌شود.
const express = require('express');

const router = express.Router();

router.use('/auth', require('./routes/auth'));
router.use('/users', require('./routes/users'));
router.use('/branches', require('./routes/branches'));
router.use('/settings', require('./routes/settings'));

module.exports = router;
