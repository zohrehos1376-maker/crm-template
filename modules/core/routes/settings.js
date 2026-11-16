const express = require('express');
const settingsService = require('../services/settingsService');
const offsiteBackup = require('../services/offsiteBackupService');
const { requireAuth, requirePerm } = require('../middleware/auth');
const { asyncRoute } = require('../../../shared/async');

const router = express.Router();
router.use(requireAuth);

// خواندن برای همه‌ی کاربران واردشده لازم است: کارشناس هم باید بتواند پیام
// آماده را کپی کند. ولی تغییر دادن فقط کار مدیر است.
router.get(
  '/messages',
  asyncRoute(async (req, res) => {
    res.json({ messages: await settingsService.getMessages() });
  })
);

router.put(
  '/messages',
  requirePerm('settings'),
  asyncRoute(async (req, res) => {
    res.json({ messages: await settingsService.saveMessages(req.user.id, req.body || {}) });
  })
);

// گزینه‌های «کانال ارتباطی / نحوه‌ی آشنایی» — خواندن برای همه، تغییر فقط مدیر
router.get(
  '/channels',
  asyncRoute(async (req, res) => {
    res.json({ channels: await settingsService.getChannelOptions() });
  })
);

router.put(
  '/channels',
  requirePerm('settings'),
  asyncRoute(async (req, res) => {
    res.json({ channels: await settingsService.saveChannelOptions(req.user.id, (req.body || {}).channels) });
  })
);

router.post(
  '/messages/reset',
  requirePerm('settings'),
  asyncRoute(async (req, res) => {
    res.json({ messages: await settingsService.resetMessages(req.user.id) });
  })
);

// نسخه‌ی پشتیبان شبانه در بله (فقط مدیر) — توکن و رمز هیچ‌وقت کامل برگردانده نمی‌شوند
router.get(
  '/backup-bale',
  requirePerm('settings'),
  asyncRoute(async (req, res) => {
    res.json(await offsiteBackup.publicConfig());
  })
);

router.put(
  '/backup-bale',
  requirePerm('settings'),
  asyncRoute(async (req, res) => {
    res.json(await offsiteBackup.saveConfig(req.user.id, req.body || {}));
  })
);

router.post(
  '/backup-bale/find-chat',
  requirePerm('settings'),
  asyncRoute(async (req, res) => {
    res.json(await offsiteBackup.findChat(req.body || {}));
  })
);

router.post(
  '/backup-bale/test',
  requirePerm('settings'),
  asyncRoute(async (req, res) => {
    const r = await offsiteBackup.sendLatest();
    if (r.skipped) return res.status(400).json({ error: 'اول توکن، چت و رمز فایل را ذخیره کنید' });
    res.json(Object.assign(r, { status: await offsiteBackup.publicConfig() }));
  })
);

// سامانه‌ی پیامکی (فقط مدیر) — کلید API هیچ‌وقت کامل برگردانده نمی‌شود
const smsService = require('../services/smsService');
router.get('/sms', requirePerm('settings'), asyncRoute(async (req, res) => res.json(await smsService.publicConfig())));
router.put('/sms', requirePerm('settings'), asyncRoute(async (req, res) => res.json(await smsService.saveConfig(req.user.id, req.body || {}))));
router.get('/sms/log', requirePerm('sms_send', 'settings'), asyncRoute(async (req, res) => res.json(await smsService.listAll(req.query))));
router.post('/sms/test', requirePerm('settings'), asyncRoute(async (req, res) => res.json(await smsService.test(req.user.id, (req.body || {}).phone))));

module.exports = router;
