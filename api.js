// نقطه‌ی ثبت همه‌ی ماژول‌ها. این روتر در server.js زیر مسیر /api/v1 سوار می‌شود.
//
// افزودن ماژول جدید = ساخت پوشه در modules/ و یک خط اضافه کردن اینجا.
// نسخه‌بندی (v1) باعث می‌شود اگر روزی ساختار پاسخ‌ها عوض شد، بتوان نسخه‌ی ۲
// را کنار نسخه‌ی ۱ اضافه کرد بدون اینکه چیزی بشکند.
const express = require('express');

const router = express.Router();

router.use(require('./modules/core'));
router.use(require('./modules/crm'));

module.exports = router;
