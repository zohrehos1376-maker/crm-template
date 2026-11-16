// صفحه‌ی «تماس‌ها» و مدیریت خطوط تلفن در CRM (با نشست مرورگر)
const express = require('express');
const QRCode = require('qrcode');
const callService = require('../services/callService');
const { requireAuth, requirePerm } = require('../../core/middleware/auth');
const { asyncRoute } = require('../../../shared/async');

const router = express.Router();
router.use(requireAuth);

// --- خطوط تلفن (فقط مدیر) — قبل از "/:id" ---
router.get(
  '/lines',
  requirePerm('calls_admin'),
  asyncRoute(async (req, res) => {
    res.json({ lines: await callService.listLines() });
  })
);

router.post(
  '/lines',
  requirePerm('calls_admin'),
  asyncRoute(async (req, res) => {
    res.status(201).json({ line: await callService.createLine(req.body || {}) });
  })
);

router.patch(
  '/lines/:id',
  requirePerm('calls_admin'),
  asyncRoute(async (req, res) => {
    res.json({ line: await callService.updateLine(req.params.id, req.body || {}) });
  })
);

// حذف خط (اگر تماس داشته باشد، بایگانی می‌شود و تماس‌ها می‌مانند)
router.delete(
  '/lines/:id',
  requirePerm('calls_admin'),
  asyncRoute(async (req, res) => {
    res.json(await callService.removeLine(req.params.id));
  })
);

router.post(
  '/lines/:id/pairing',
  requirePerm('calls_admin'),
  asyncRoute(async (req, res) => {
    res.json({ line: await callService.regeneratePairing(req.params.id) });
  })
);

router.post(
  '/lines/:id/revoke',
  requirePerm('calls_admin'),
  asyncRoute(async (req, res) => {
    res.json({ line: await callService.revokeLine(req.params.id) });
  })
);

// QR جفت‌سازی: آدرس سرور + کد. اپ با اسکن آن، بدون تایپ وصل می‌شود.
router.get(
  '/lines/:id/qr',
  requirePerm('calls_admin'),
  asyncRoute(async (req, res) => {
    const lines = await callService.listLines();
    const line = lines.find((l) => l.id === req.params.id);
    if (!line || !line.pairingCode) return res.status(404).json({ error: 'کد جفت‌سازی فعالی نیست — یک کد تازه بسازید' });
    const server = process.env.PUBLIC_URL || 'https://' + req.get('host').replace(/:\d+$/, '');
    const payload = JSON.stringify({ app: 'crm-call', server, code: line.pairingCode });
    const svg = await QRCode.toString(payload, { type: 'svg', margin: 1, errorCorrectionLevel: 'M' });
    res.json({ svg, server, code: line.pairingCode, expiresAt: line.pairingExpiresAt });
  })
);

router.get(
  '/report',
  requirePerm('calls_admin'),
  asyncRoute(async (req, res) => {
    res.json(await callService.report(req.query));
  })
);

// --- تماس‌ها ---
router.get(
  '/',
  asyncRoute(async (req, res) => {
    res.json(await callService.listCalls(req.user, req.query));
  })
);

// یک تماس (برای باز کردن فرم ثبت از میز کار)
router.get(
  '/:id',
  asyncRoute(async (req, res) => {
    res.json({ call: await callService.getCall(req.user, req.params.id) });
  })
);

// تکمیل تماس ثبت‌نشده از CRM؛ پاسخ‌دهنده پیش‌فرض = کاربر فعلی
router.post(
  '/:id/log',
  asyncRoute(async (req, res) => {
    await callService.getCall(req.user, req.params.id); // کنترل دسترسی
    res.json(await callService.logCall(req.params.id, req.body || {}, { defaultOperatorId: req.user.id }));
  })
);

// «ثبت نشد» برای تماس به‌دردنخور
router.post(
  '/:id/dismiss',
  asyncRoute(async (req, res) => {
    const b = req.body || {};
    res.json({ call: await callService.markDismissed(req.user, req.params.id, b.dismissed !== false, b.reason) });
  })
);

router.post(
  '/:id/callback',
  asyncRoute(async (req, res) => {
    res.json({ call: await callService.markCallback(req.user, req.params.id, (req.body || {}).done !== false) });
  })
);

module.exports = router;
