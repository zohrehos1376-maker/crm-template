const userService = require('../services/userService');
const { can } = require('../../../shared/permissions');

async function requireAuth(req, res, next) {
  if (!req.session || !req.session.userId) {
    return res.status(401).json({ error: 'ابتدا وارد سیستم شوید' });
  }
  let user;
  try {
    user = await userService.findActiveById(req.session.userId);
  } catch (e) {
    return next(e);
  }
  if (!user) {
    req.session.destroy(() => {});
    return res.status(401).json({ error: 'نشست شما معتبر نیست، دوباره وارد شوید' });
  }
  req.user = user;
  next();
}

function requireManager(req, res, next) {
  if (!req.user || req.user.role !== 'manager') {
    return res.status(403).json({ error: 'این بخش فقط برای مدیر در دسترس است' });
  }
  next();
}

// یکی از دسترسی‌های داده‌شده کافی است (مدیر همه را دارد)
function requirePerm(...keys) {
  return function (req, res, next) {
    if (req.user && keys.some((k) => can(req.user, k))) return next();
    return res.status(403).json({ error: 'به این بخش دسترسی ندارید — از مدیر بخواهید دسترسی را برایتان فعال کند' });
  };
}

module.exports = { requireAuth, requireManager, requirePerm };
