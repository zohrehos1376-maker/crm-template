const express = require('express');
const branchService = require('../services/branchService');
const { requireAuth, requirePerm } = require('../middleware/auth');
const { asyncRoute } = require('../../../shared/async');

const router = express.Router();
router.use(requireAuth);

// همه‌ی کاربران واردشده می‌توانند فهرست شعبه‌ها را بخوانند (برای نمایش نام شعبه در فرم‌ها)،
// ولی ساخت و ویرایش فقط کار مدیر است.
router.get(
  '/',
  asyncRoute(async (req, res) => {
    res.json({ branches: await branchService.listBranches() });
  })
);

router.post(
  '/',
  requirePerm('settings'),
  asyncRoute(async (req, res) => {
    const { name, city, address } = req.body || {};
    if (!name || !String(name).trim()) {
      return res.status(400).json({ error: 'نام شعبه را وارد کنید' });
    }
    const branch = await branchService.createBranch({ name, city, address });
    res.status(201).json({ branch });
  })
);

router.patch(
  '/:id',
  requirePerm('settings'),
  asyncRoute(async (req, res) => {
    const { name, city, address } = req.body || {};
    const branch = await branchService.updateBranch(req.params.id, { name, city, address });
    res.json({ branch });
  })
);

module.exports = router;
