// API اپ اندروید «اپ تماس». احراز هویت با توکن دستگاه (نه نشست مرورگر):
//   Authorization: Bearer <deviceToken>
// فقط /pair بدون توکن است (با کد یک‌بارمصرف ۱۵ دقیقه‌ای که مدیر از CRM می‌گیرد).
const express = require('express');
const { rateLimit, ipKeyGenerator } = require('express-rate-limit');
const callService = require('../services/callService');
const { asyncRoute } = require('../../../shared/async');

const router = express.Router();

const tooMany = (req, res) => res.status(429).json({ error: 'درخواست‌ها زیاد است، کمی بعد دوباره تلاش کنید' });

// جفت‌سازی: ۱۰ تلاش در ۱۵ دقیقه برای هر آی‌پی (حدس زدن کد ۶ رقمی عملاً ممکن نیست)
const pairLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 10, standardHeaders: 'draft-7', legacyHeaders: false, handler: tooMany });
// بقیه: ۶۰۰ درخواست در دقیقه برای هر گوشی (کلید = توکن، نه آی‌پی — چند گوشی پشت یک اینترنت)
const deviceLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 600,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  keyGenerator: (req) => (req.headers.authorization ? String(req.headers.authorization) : ipKeyGenerator(req.ip)),
  handler: tooMany,
});

router.post(
  '/pair',
  pairLimiter,
  asyncRoute(async (req, res) => {
    res.json(await callService.pairDevice(req.body || {}));
  })
);

// همه‌ی مسیرهای بعدی توکن لازم دارند
router.use(deviceLimiter);
router.use(
  asyncRoute(async (req, res, next) => {
    const m = /^Bearer\s+(.+)$/i.exec(String(req.headers.authorization || ''));
    const line = m ? await callService.lineFromToken(m[1].trim(), req.headers['x-app-version']) : null;
    if (!line) return res.status(401).json({ error: 'دستگاه شناخته نشد — اپ را دوباره جفت کنید' });
    req.line = line;
    next();
  })
);

router.get(
  '/bootstrap',
  asyncRoute(async (req, res) => {
    res.json(await callService.bootstrap(req.line, req.query.formHash));
  })
);

// وضعیت زنده‌ی خط (زنگ خورد / در حال مکالمه / قطع شد) — برای نمای «الان در حال مکالمه» در CRM
router.post(
  '/active-call',
  asyncRoute(async (req, res) => {
    res.json(require('../services/liveCallService').set(req.line, req.body || {}));
  })
);

router.post(
  '/calls/batch',
  asyncRoute(async (req, res) => {
    res.json(await callService.ingestBatch(req.line, (req.body || {}).calls));
  })
);

// ثبت پاپ‌آپ تماس — PATCH و POST هر دو (HttpURLConnection اندروید PATCH ندارد)
const logCallRoute = asyncRoute(async (req, res) => {
  res.json(await callService.logCall(req.params.id, req.body || {}, { lineId: req.line.id }));
});
router.patch('/calls/:id', logCallRoute);
router.post('/calls/:id/log', logCallRoute);

router.get(
  '/lookup',
  asyncRoute(async (req, res) => {
    res.json({ lead: await callService.lookup(req.query.phone) });
  })
);

router.get(
  '/contacts',
  asyncRoute(async (req, res) => {
    res.json(await callService.contactsSince(req.query.since, req.query.limit, req.query.afterId));
  })
);

router.get(
  '/app-version',
  asyncRoute(async (req, res) => {
    res.json(await callService.appVersion());
  })
);

module.exports = router;
