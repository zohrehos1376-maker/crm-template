// مسیرهای عمومی (بدون ورود): فرم احراز همکار با لینک یک‌بارمصرف، و ورود سرنخ از فرم سایت.
const express = require('express');
const crypto = require('crypto');
const multer = require('multer');
const rateLimit = require('express-rate-limit');
const { asyncRoute } = require('../../../shared/async');
const kycService = require('../services/kycService');
const vardastService = require('../services/vardastService');

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 12 * 1024 * 1024, files: 4 } });
const tooMany = (req, res) => res.status(429).json({ error: 'تعداد درخواست‌ها زیاد است؛ چند دقیقه بعد دوباره تلاش کنید' });
const formLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 30, standardHeaders: 'draft-7', legacyHeaders: false, handler: tooMany });
const intakeLimiter = rateLimit({ windowMs: 60 * 1000, limit: 60, standardHeaders: 'draft-7', legacyHeaders: false, handler: tooMany });

router.get('/kyc/:token', formLimiter, asyncRoute(async (req, res) => res.json(await kycService.publicForm(req.params.token))));
// اول لینک چک می‌شود، بعد فایل‌ها در حافظه گرفته می‌شوند (لینک جعلی حافظه‌ی سرور را پر نکند)
const kycTokenFirst = asyncRoute(async (req, res, next) => { await kycService.leadByToken(req.params.token); next(); });
const kycUpload = (req, res, next) => upload.array('documents', 4)(req, res, (err) => {
  if (!err) return next();
  res.status(400).json({ error: err.code === 'LIMIT_FILE_SIZE' ? 'حجم هر عکس حداکثر ۱۲ مگابایت است' : 'خطا در آپلود عکس‌ها' });
});
router.post('/kyc/:token', formLimiter, kycTokenFirst, kycUpload, asyncRoute(async (req, res) => res.json(await kycService.publicSubmit(req.params.token, req.body, req.files))));

// وردپرس (فرم همکاری) با هدر X-Intake-Token = INTAKE_TOKEN در .env
function intakeAuth(req, res, next) {
  const expected = process.env.INTAKE_TOKEN || '';
  const got = String(req.get('x-intake-token') || '');
  const okLen = expected.length >= 24 && got.length === expected.length;
  if (!okLen || !crypto.timingSafeEqual(Buffer.from(got), Buffer.from(expected))) {
    // تشخیص بدون لو دادن توکن: فقط می‌گوییم هدر آمده یا نه و طولش چقدر بوده،
    // تا معلوم شود مشکل «هدر نیامده»، «بریده شده» یا «توکن دیگری است».
    const why = !got ? 'هدر X-Intake-Token اصلاً نیامد'
      : got.length !== expected.length ? 'طول توکن ' + got.length + ' بود، باید ' + expected.length + ' باشد'
      : 'طول درست است ولی مقدار توکن اشتباه است';
    // علت فقط در لاگ سرور؛ پاسخ به بیرون چیزی درباره‌ی توکن درست (مثلاً طولش) لو نمی‌دهد
    console.log('[intake] رد شد — ' + why + ' · از ' + (req.ip || '—'));
    return res.status(401).json({ error: 'unauthorized' });
  }
  next();
}
router.post('/intake', intakeLimiter, intakeAuth, upload.array('documents', 4), asyncRoute(async (req, res) => res.json(await kycService.intake(req.body, req.files))));

// وب‌هوک وردست (سرنخ اینستاگرام و سفارش) — امضای HMAC در vardastService
const webhookLimiter = rateLimit({ windowMs: 60 * 1000, limit: 120, standardHeaders: 'draft-7', legacyHeaders: false, handler: tooMany });
router.post('/vardast', webhookLimiter, express.text({ type: (req) => !req.rawBody, limit: '1mb' }), asyncRoute(async (req, res) => {
  const raw = req.rawBody ? req.rawBody.toString('utf8') : typeof req.body === 'string' ? req.body : '';
  const r = await vardastService.handle(req.headers, raw);
  if (r.challenge !== undefined) return res.type('text/plain').send(r.challenge);
  res.json({ ok: true });
}));

module.exports = router;
