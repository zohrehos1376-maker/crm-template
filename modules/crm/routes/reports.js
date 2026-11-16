const express = require('express');
const leadService = require('../services/leadService');
const dashboardService = require('../services/dashboardService');
const dailyReportService = require('../services/dailyReportService');
const userService = require('../../core/services/userService');
const branchService = require('../../core/services/branchService');
const { requireAuth, requirePerm } = require('../../core/middleware/auth');
const { asyncRoute } = require('../../../shared/async');

const router = express.Router();
router.use(requireAuth);

// ---------- صفحه‌ی گزارش‌گیری: پیش‌نمایش + خروجی اکسل و PDF (با نام مشتری‌ها) ----------
const exportReports = require('../services/exportReportService');
router.get('/export', requirePerm('dashboard'), (req, res) => res.json({ reports: exportReports.list() }));
router.get(
  '/export/:kind.:ext(xlsx|pdf)',
  requirePerm('dashboard'),
  asyncRoute(async (req, res) => {
    const rep = await exportReports.build(req.params.kind, req.query);
    const name = 'crm-' + req.params.kind + '-' + new Date().toISOString().slice(0, 10) + '.' + req.params.ext;
    if (req.params.ext === 'xlsx') {
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', 'attachment; filename="' + name + '"');
      return res.send(exportReports.toXlsx(rep));
    }
    const pdf = await exportReports.toPdf(rep);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename="' + name + '"');
    res.send(pdf);
  })
);
router.get(
  '/export/:kind',
  requirePerm('dashboard'),
  asyncRoute(async (req, res) => {
    const rep = await exportReports.build(req.params.kind, req.query);
    // پیش‌نمایش: حداکثر ۲۰۰ ردیف اول؛ فایل‌ها همه‌ی ردیف‌ها را دارند
    res.json(Object.assign({}, rep, { total: rep.rows.length, rows: rep.rows.slice(0, 200) }));
  })
);

// آمار کار کارشناسان روزبه‌روز (بدون نمره): تماس، بی‌پاسخ، استعلام، اعتراض، ناموجود، نام‌گذاری، احراز
router.get(
  '/rep-stats',
  requirePerm('performance', 'dashboard'),
  asyncRoute(async (req, res) => {
    res.json(await require('../services/repStatsService').daily(req.query));
  })
);

// داشبورد مدیریتی: امروزِ کل تیم + هشدارها + امتیاز امروز و این هفته
router.get(
  '/manager-dashboard',
  requirePerm('dashboard'),
  asyncRoute(async (req, res) => {
    res.json(await dashboardService.managerDashboard());
  })
);

// گزارش روزانه‌ی مدیران (PDF) + یادداشت «کارهای امروز من» مدیر CRM
router.get(
  '/daily.pdf',
  requirePerm('dashboard'),
  asyncRoute(async (req, res) => {
    const { pdf, fileName } = await dailyReportService.buildPdf(req.query.date);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename="' + fileName + '"');
    res.send(pdf);
  })
);
router.get(
  '/daily-note',
  requirePerm('dashboard'),
  asyncRoute(async (req, res) => {
    res.json(await dailyReportService.getNote(req.query.date));
  })
);
router.put(
  '/daily-note',
  requirePerm('dashboard'),
  asyncRoute(async (req, res) => {
    res.json(await dailyReportService.saveNote((req.body || {}).date, (req.body || {}).text, req.user.id));
  })
);
router.get(
  '/daily-chat',
  requirePerm('dashboard'),
  asyncRoute(async (req, res) => {
    res.json(await dailyReportService.publicChat());
  })
);
router.post(
  '/daily-chat/link',
  requirePerm('dashboard'),
  asyncRoute(async (req, res) => {
    res.json(await dailyReportService.linkChat(req.user.id));
  })
);
router.post(
  '/daily-send',
  requirePerm('dashboard'),
  asyncRoute(async (req, res) => {
    res.json(await dailyReportService.sendToBale((req.body || {}).date));
  })
);

// ---------- گزارشات و آمار فروش (analyticsService) ----------
const analytics = require('../services/analyticsService');
const { can } = require('../../../shared/permissions');
function analyticsGate(req, res, next) {
  const def = analytics.REPORTS[req.params.kind];
  if (!def) return res.status(404).json({ error: 'گزارش ناشناخته' });
  if (def.perm && !can(req.user, def.perm)) return res.status(403).json({ error: 'دسترسی ندارید' });
  next();
}
router.get('/analytics', (req, res) => {
  res.json({ reports: Object.entries(analytics.REPORTS).filter(([, d]) => !d.perm || can(req.user, d.perm)).map(([kind, d]) => ({ kind, title: d.title, ranged: !!d.ranged })) });
});
router.get('/analytics/settings', requirePerm('analytics'), asyncRoute(async (req, res) => res.json({ settings: await analytics.getSettings() })));
router.put('/analytics/settings', requirePerm('settings'), asyncRoute(async (req, res) => res.json({ settings: await analytics.saveSettings(req.user.id, req.body || {}) })));
router.get('/analytics/:kind.xlsx', analyticsGate, asyncRoute(async (req, res) => {
  const rep = await analytics.build(req.params.kind, req.query);
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', 'attachment; filename="crm-' + req.params.kind + '-' + new Date().toISOString().slice(0, 10) + '.xlsx"');
  res.send(analytics.toXlsx(rep));
}));
router.get('/analytics/:kind', analyticsGate, asyncRoute(async (req, res) => {
  const rep = await analytics.build(req.params.kind, req.query);
  res.json(Object.assign({}, rep, { total: rep.rows.length, rows: rep.rows.slice(0, 300) }));
}));

module.exports = router;
