// روت‌های دیتابیس همگی async هستند. این پوشش کوچک باعث می‌شود
// خطاهای داخل آن‌ها به‌جای «گیر کردن» درخواست، به پاسخ مناسب تبدیل شوند.
function asyncRoute(fn) {
  return function (req, res, next) {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

// تبدیل خطا به پاسخ JSON. خطاهای قابل نمایش (status دارند) با همان پیام برمی‌گردند،
// بقیه به‌صورت خطای عمومی سرور، و متن کامل فقط در کنسول سرور ثبت می‌شود.
function errorHandler(err, req, res, next) {
  if (res.headersSent) return next(err);
  if (err && err.status) {
    return res.status(err.status).json({ error: err.message });
  }
  console.error('خطای سرور:', err && err.stack ? err.stack : err);
  res.status(500).json({ error: 'خطای سرور، دوباره تلاش کنید' });
}

module.exports = { asyncRoute, errorHandler };
