const express = require('express');
const multer = require('multer');
const leadService = require('../services/leadService');
const mergeService = require('../services/mergeService');
const { requireAuth, requirePerm, requireManager } = require('../../core/middleware/auth');
const { asyncRoute } = require('../../../shared/async');
const { buildWorkbookXlsx } = require('../../../shared/xlsx');
const Jalali = require('../../../shared/jalali');

const router = express.Router();
router.use(requireAuth);

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

const STATUSES = ['جدید', 'تماس اولیه/ارسال پیام', 'در حال پیگیری', 'مراجعه حضوری', 'فروش موفق', 'فروش ناموفق'];

// ستون‌های خروجی اکسل مشتریان
const EXPORT_HEADERS = [
  'نام مشتری', 'تلفن', 'کانال ارتباطی', 'روش ارتباط ترجیحی',
  'فروشگاه', 'شهر',
  'قیمت از (دلار)', 'قیمت تا (دلار)', 'شرایط پرداخت',
  'نوع تحویل', 'خودروی فعلی', 'کارشناس', 'وضعیت پیگیری', 'دلیل انصراف', 'تاریخ ثبت',
  'یادآوری پیگیری بعدی', 'یادداشت یادآوری', 'توضیحات', 'برچسب‌ها',
];
const EXPORT_NUMERIC_COLS = new Set([6, 7]);

router.get(
  '/',
  asyncRoute(async (req, res) => {
    const [leads, counts] = await Promise.all([
      leadService.listLeads(req.user, req.query),
      leadService.segmentCounts(req.user, req.query),
    ]);
    res.json({ leads, counts });
  })
);

// خروجی اکسل از همان سرنخ‌هایی که کاربر اجازه دیدنشان را دارد (با همان فیلترهای فعلی جدول).
// این مسیر باید قبل از "/:id" تعریف شود وگرنه اکسپرس "export" را به‌عنوان id می‌گیرد.
router.get(
  '/export',
  asyncRoute(async (req, res) => {
    const list = await leadService.listLeads(req.user, req.query);

    const rows = list.map((l) => {
      // تاریخ در خروجی اکسل شمسی نوشته می‌شود (با ارقام انگلیسی تا در اکسل
      // خوانا بماند و هنگام آپلود دوباره هم درست خوانده شود)
      const dateStr = Jalali.formatDate(new Date(l.createdAt), { withTime: true });
      return [
        l.name, l.phone, l.channel || '', (l.contactMethods || []).join('، '),
        l.shopName || '', l.city || '',
        l.priceFrom, l.priceTo, l.payment || '', l.delivery || '',
        l.currentCar || '', l.ownerName, l.status || '', l.cancelReason || '', dateStr,
        l.nextFollowUpDate ? Jalali.formatDate(new Date(l.nextFollowUpDate)) : '',
        l.nextFollowUpNote || '',
        l.notes || '',
        (l.tags || []).join('، '),
      ];
    });

    const buf = buildWorkbookXlsx('سرنخ‌ها', EXPORT_HEADERS, rows, EXPORT_NUMERIC_COLS);
    // تاریخ نام فایل هم شمسی است، ولی با ارقام انگلیسی تا نام فایل در ویندوز سالم بماند
    const filename = 'sales-leads-' + Jalali.formatDate(new Date()).replace(/\//g, '-') + '.xlsx';
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="' + filename + '"');
    res.send(buf);
  })
);

// سرنخ‌هایی که پیگیری‌شان امروز است یا عقب افتاده — برای کارت داشبورد مدیر.
// این مسیر باید قبل از "/:id" باشد.
router.get(
  '/due-followups',
  requirePerm('all_leads'),
  asyncRoute(async (req, res) => {
    res.json({ leads: await leadService.dueFollowUps(req.query.branchId || null) });
  })
);

// داده‌ی صفحه‌ی «امروز». برخلاف /due-followups این مسیر برای هر دو نقش باز است:
// محدوده‌ی دسترسی داخل سرویس اعمال می‌شود، پس کارشناس فقط کارهای خودش را
// می‌بیند. باید قبل از "/:id" باشد وگرنه today به‌عنوان شناسه خوانده می‌شود.
router.get(
  '/today',
  asyncRoute(async (req, res) => {
    res.json(await leadService.todayWork(req.user, req.query));
  })
);

// لیدهای گرم (🌤) — چند نشانه‌ی خرید با هم در ۷ روز اخیر. قبل از "/:id".
router.get(
  '/hot',
  asyncRoute(async (req, res) => {
    const q = { ownerId: req.query.ownerId || undefined, branchId: req.query.branchId || undefined };
    const all = await leadService.listLeads(req.user, q);
    const leads = all.filter((l) => l.heat).sort((a, b) => b.heat.at - a.heat.at);
    res.json({ leads, counts: { hot: leads.length, warm: 0 } });
  })
);


// سرنخ‌های تکراری (همان شماره) و ادغامشان — فقط مدیر. قبل از "/:id".
router.get(
  '/duplicates',
  requirePerm('leads_admin'),
  asyncRoute(async (req, res) => {
    res.json(await mergeService.findDuplicates());
  })
);

router.post(
  '/merge',
  requirePerm('leads_admin'),
  asyncRoute(async (req, res) => {
    res.json(await mergeService.merge(req.user, req.body || {}));
  })
);

// فرم ثبت دستی: آیا این شماره قبلاً مشتری دارد؟ (هشدار زنده، قبل از "/:id")
router.get(
  '/check-phone',
  asyncRoute(async (req, res) => {
    res.json({ lead: await leadService.findByPhone(req.user, req.query.phone) });
  })
);

// برچسب‌های قابل انتخاب (آماده + هرچه تا حالا ساخته شده). مثل بالا، قبل از "/:id".
router.get(
  '/tags',
  asyncRoute(async (req, res) => {
    res.json({ tags: await leadService.knownTags() });
  })
);

// ورود مشتریان از اکسل (CRM نمونه): نام، تلفن، شهر، فروشگاه، نوع مشتری، وضعیت احراز، منبع، توضیحات.
// شماره‌ی موجود به‌روز می‌شود؛ اول پیش‌نمایش، با apply=1 اعمال. فقط مدیر.
const CustomerSheet = require('../../../shared/customer-sheet');
router.get('/customers-template', (req, res) => {
  const buf = buildWorkbookXlsx('مشتریان', CustomerSheet.CUSTOMER_HEADERS, [
    ['علی محمدی', '09120000000', 'تهران', 'موبایل محمدی', 'تعمیرکار', 'تأیید شده', 'فرم همکاری سایت', ''],
  ], new Set());
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', "attachment; filename=\"customers-template.xlsx\"; filename*=UTF-8''" + encodeURIComponent('نمونه-ورود-مشتریان.xlsx'));
  res.send(buf);
});
router.post('/customers-import', requireManager, (req, res, next) => {
  upload.single('file')(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.code === 'LIMIT_FILE_SIZE' ? 'حجم فایل بیشتر از حد مجاز (۵ مگابایت) است' : 'خطا در آپلود فایل' });
    next();
  });
}, asyncRoute(async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'فایلی انتخاب نشده است' });
  const r = await require('../services/customerImportService').importCustomers(req.user, req.file.buffer, req.query.apply === '1');
  res.json(r);
}));

router.post(
  '/',
  asyncRoute(async (req, res) => {
    const b = req.body || {};
    // فقط شماره تماس الزامی است. برای سرنخ‌هایی که از تماس تلفنی آمده‌اند و هنوز
    // نامشان را نمی‌دانیم، نام می‌تواند خالی بماند.
    if (!b.phone) {
      return res.status(400).json({ error: 'شماره تماس الزامی است' });
    }

    // مشتری به کارشناس خاصی تعلق ندارد؛ سازنده به‌عنوان ثبت‌کننده ذخیره می‌شود.
    const ownerId = req.user.id;
    const ownerBranchId = req.user.branchId;

    // ثبت دستی از فرم «ثبت دستی / حضوری»: منبع و قدم بعدی اجباری می‌شوند
    const lead = await leadService.createLead(req.user, Object.assign({}, b, { manual: true }), ownerId, ownerBranchId);
    res.status(201).json({ lead });
  })
);

router.get(
  '/:id',
  asyncRoute(async (req, res) => {
    res.json(await leadService.getLeadDetail(req.user, req.params.id));
  })
);

router.patch(
  '/:id',
  asyncRoute(async (req, res) => {
    const b = req.body || {};
    if (b.status !== undefined) {
      if (!STATUSES.includes(b.status)) return res.status(400).json({ error: 'وضعیت نامعتبر است' });
      if (b.status === 'فروش ناموفق' && (!b.cancelReason || !String(b.cancelReason).trim())) {
        return res.status(400).json({ error: 'برای ثبت انصراف، دلیل آن را وارد کنید' });
      }
    }
    const lead = await leadService.updateLead(req.user, req.params.id, b);
    res.json({ lead });
  })
);

router.post(
  '/bulk-delete',
  asyncRoute(async (req, res) => {
    const count = await leadService.deleteLeads(req.user, (req.body || {}).ids);
    res.json({ ok: true, count });
  })
);

router.delete(
  '/:id',
  asyncRoute(async (req, res) => {
    await leadService.deleteLead(req.user, req.params.id);
    res.json({ ok: true });
  })
);

router.post(
  '/:id/followups',
  asyncRoute(async (req, res) => {
    const b = req.body || {};
    // برای «ثبت تماس» متن اختیاری است؛ برای بقیه‌ی پیگیری‌ها مثل قبل الزامی
    if (b.kind !== 'call' && (!b.content || !String(b.content).trim())) {
      return res.status(400).json({ error: 'محتوای مکالمه را وارد کنید' });
    }
    // پاسخ هم پیگیری ثبت‌شده را دارد هم سرنخِ به‌روزشده (وضعیت و تاریخ پیگیری بعدی
    // ممکن است خودکار عوض شده باشند) تا رابط کاربری بدون درخواست دوباره آن را نشان دهد.
    const result = await leadService.addFollowup(req.user, req.params.id, b);
    res.status(201).json(result);
  })
);

// اصلاح یک پیگیری آزاد که قبلاً ثبت شده (غلط‌تایپی، نتیجه‌ی اشتباه و…). فقط
// محتوا و نتیجه عوض می‌شود؛ مراحل اول پیگیری (step) از همان باکسشان ویرایش می‌شوند.
router.patch(
  '/:id/followups/:fid',
  asyncRoute(async (req, res) => {
    const result = await leadService.editFollowup(req.user, req.params.id, req.params.fid, req.body || {});
    res.json({ followup: result });
  })
);

module.exports = router;
