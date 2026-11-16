const express = require('express');
const userService = require('../services/userService');
const branchService = require('../services/branchService');
const { requireAuth, requirePerm } = require('../middleware/auth');
const { PERMISSIONS } = require('../../../shared/permissions');
const { asyncRoute } = require('../../../shared/async');

const router = express.Router();
router.use(requireAuth);

// فهرست کاربران برای جدول کاربران و فیلترهای «کارشناس» در بخش‌های مدیریتی
const canListUsers = requirePerm('users', 'all_leads', 'performance', 'dashboard', 'calls_admin', 'demand');
// ساخت/ویرایش کاربر؛ نقش و دسترسی را فقط مدیر تعیین می‌کند (تا کسی به خودش دسترسی ندهد)
const canEditUsers = requirePerm('users');
const isManager = (req) => req.user.role === 'manager';

router.get(
  '/',
  canListUsers,
  asyncRoute(async (req, res) => {
    res.json({ users: await userService.listUsers(), permissionCatalog: PERMISSIONS });
  })
);

router.post(
  '/',
  canEditUsers,
  asyncRoute(async (req, res) => {
    const { username, password, fullName, branchId } = req.body || {};
    let { role, permissions, roleTitle } = req.body || {};
    if (!isManager(req)) {
      role = 'rep';
      permissions = [];
      roleTitle = undefined;
    }
    if (!username || !password || !fullName || !['rep', 'manager'].includes(role)) {
      return res.status(400).json({ error: 'همه فیلدها را کامل کنید' });
    }
    if (String(password).length < userService.MIN_PASSWORD) {
      return res.status(400).json({ error: 'رمز عبور باید حداقل ۸ کاراکتر باشد' });
    }
    // انتخاب شعبه برای هر کاربر اجباری است
    if (!branchId) {
      return res.status(400).json({ error: 'شعبه‌ی کاربر را انتخاب کنید' });
    }
    if (!(await branchService.findById(branchId))) {
      return res.status(400).json({ error: 'شعبه‌ی انتخاب‌شده معتبر نیست' });
    }
    const user = await userService.createUser({ username, password, fullName, role, roleTitle, branchId, permissions });
    res.status(201).json({ user });
  })
);

router.patch(
  '/:id',
  canEditUsers,
  asyncRoute(async (req, res) => {
    const { fullName, active, password, branchId } = req.body || {};
    let { role, permissions, roleTitle } = req.body || {};
    if (!isManager(req)) {
      // کسی که مدیر نیست: فقط کارشناس‌ها را ویرایش می‌کند و نقش/دسترسی را عوض نمی‌کند
      const target = (await userService.listUsers()).find((u) => u.id === req.params.id);
      if (!target || target.role === 'manager') return res.status(403).json({ error: 'ویرایش حساب مدیر فقط با مدیر است' });
      // کسی که دسترسی‌ای دارد که ویرایشگر ندارد، فقط با مدیر ویرایش می‌شود (جلوی تغییر رمز و ورود به‌جای او)
      const mine = req.user.permissions || [];
      if (target.id !== req.user.id && (target.permissions || []).some((k) => !mine.includes(k))) {
        return res.status(403).json({ error: 'این کارشناس دسترسی‌هایی دارد که شما ندارید؛ ویرایشش فقط با مدیر است' });
      }
      role = undefined;
      permissions = undefined;
      roleTitle = undefined;
    }
    if (req.params.id === req.user.id && active === false) {
      return res.status(400).json({ error: 'نمی‌توانید حساب خودتان را غیرفعال کنید' });
    }
    if (password && String(password).length < userService.MIN_PASSWORD) {
      return res.status(400).json({ error: 'رمز عبور باید حداقل ۸ کاراکتر باشد' });
    }
    if (branchId !== undefined) {
      if (!branchId) return res.status(400).json({ error: 'شعبه‌ی کاربر را انتخاب کنید' });
      if (!(await branchService.findById(branchId))) {
        return res.status(400).json({ error: 'شعبه‌ی انتخاب‌شده معتبر نیست' });
      }
    }
    const user = await userService.updateUser(req.params.id, { fullName, role, roleTitle, active, password, branchId, permissions });
    // رمز تازه یا غیرفعال شدن حساب: آن کاربر روی همه‌ی دستگاه‌ها بیرون می‌رود
    if (password || active === false) await userService.revokeSessions(req.params.id, req.params.id === req.user.id ? req.sessionID : null);
    res.json({ user });
  })
);

module.exports = router;
