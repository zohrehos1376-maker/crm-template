const express = require('express');
const rateLimit = require('express-rate-limit');
const userService = require('../services/userService');
const { requireAuth } = require('../middleware/auth');
const { asyncRoute } = require('../../../shared/async');

const router = express.Router();

// محدودسازی تلاش ورود برای جلوگیری از حدس زدن رمز عبور.
// ورودهای موفق شمرده نمی‌شوند، پس کاربر عادی هیچ‌وقت به این محدودیت نمی‌خورد.
// (وقتی برنامه روی چند سرور اجرا شود، این شمارنده باید به یک انبار مشترک منتقل شود.)
const LOGIN_WINDOW_MINUTES = Number(process.env.LOGIN_RATE_WINDOW_MINUTES) || 15;
const LOGIN_MAX_ATTEMPTS = Number(process.env.LOGIN_RATE_MAX_ATTEMPTS) || 10;

const loginLimiter = rateLimit({
  windowMs: LOGIN_WINDOW_MINUTES * 60 * 1000,
  limit: LOGIN_MAX_ATTEMPTS,
  skipSuccessfulRequests: true,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  handler: (req, res) => {
    res.status(429).json({
      error:
        'تعداد تلاش‌های ناموفق ورود زیاد بود. لطفاً ' +
        LOGIN_WINDOW_MINUTES +
        ' دقیقه صبر کنید و دوباره تلاش کنید.',
    });
  },
});

router.post(
  '/login',
  loginLimiter,
  asyncRoute(async (req, res) => {
    const { username, password } = req.body || {};
    if (!username || !password) {
      return res.status(400).json({ error: 'نام کاربری و رمز عبور را وارد کنید' });
    }
    const user = await userService.authenticate(username, password);
    if (!user) {
      return res.status(401).json({ error: 'نام کاربری یا رمز عبور اشتباه است' });
    }
    req.session.regenerate((err) => {
      if (err) return res.status(500).json({ error: 'خطای سرور، دوباره تلاش کنید' });
      req.session.userId = user.id;
      // نشست پیش از پاسخ دادن ذخیره می‌شود تا مطمئن شویم در دیتابیس نوشته شده است.
      req.session.save((saveErr) => {
        if (saveErr) return res.status(500).json({ error: 'خطای سرور، دوباره تلاش کنید' });
        res.json({ user: { id: user.id, username: user.username, fullName: user.fullName, role: user.role, active: user.active, permissions: user.permissions } });
      });
    });
  })
);

const userOut = (u) => ({ id: u.id, username: u.username, fullName: u.fullName, role: u.role, active: u.active, permissions: u.permissions });

// هر کارشناس با نام کاربری و رمز خودش وارد می‌شود (اکانت مشترک و جابه‌جایی بدون رمز در CRM نمونه نیست)
router.post('/logout', asyncRoute(async (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
}));

router.get('/me', requireAuth, asyncRoute(async (req, res) => {
  res.json({ user: userOut(req.user) });
}));

router.post(
  '/change-password',
  requireAuth,
  asyncRoute(async (req, res) => {
    const { oldPassword, newPassword } = req.body || {};
    if (!oldPassword || !newPassword || String(newPassword).length < userService.MIN_PASSWORD) {
      return res.status(400).json({ error: 'رمز جدید باید حداقل ۸ کاراکتر باشد' });
    }
    await userService.changePassword(req.user.id, oldPassword, newPassword);
    // اگر رمز لو رفته بود، بقیه‌ی دستگاه‌ها همین حالا بیرون می‌روند (همین دستگاه وارد می‌ماند)
    await userService.revokeSessions(req.user.id, req.sessionID);
    res.json({ ok: true });
  })
);

module.exports = router;
