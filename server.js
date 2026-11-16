// خواندن تنظیمات محیطی از فایل .env (باید قبل از هر چیز دیگری اجرا شود).
// override باعث می‌شود متغیرهای قدیمی ذخیره‌شده در PM2، دیتابیس انتخاب‌شده
// در فایل .env را بی‌صدا جایگزین نکنند.
require('dotenv').config({ quiet: true, override: true });
// ساعت سرور آروان UTC است؛ «امروز»، «فردا» و تاریخ‌های شمسی همه باید به ساعت تهران حساب شوند
process.env.TZ = 'Asia/Tehran';

const express = require('express');
const session = require('express-session');
const helmet = require('helmet');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { prisma, DATABASE_PROVIDER } = require('./shared/prisma');
const PrismaSessionStore = require('./shared/session-store');
const userService = require('./modules/core/services/userService');
const { errorHandler } = require('./shared/async');

const apiRoutes = require('./api');

const app = express();
const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || '0.0.0.0';
const SESSION_MAX_AGE_DAYS = Number(process.env.SESSION_MAX_AGE_DAYS) || 30;
const IS_PRODUCTION = process.env.NODE_ENV === 'production';

// در حالت تولید، برنامه پشت یک وب‌سرور (مثل nginx) قرار می‌گیرد. بدون این تنظیم،
// اکسپرس پروتکل اصلی درخواست را از X-Forwarded-Proto تشخیص نمی‌دهد.
if (IS_PRODUCTION) app.set('trust proxy', 1);

// کلید نشست‌ها (session secret): اولویت با متغیر SESSION_SECRET در فایل .env است.
// اگر تعریف نشده باشد، یک کلید ثابت ساخته و در data/.session-secret ذخیره می‌شود
// تا با هر بار راه‌اندازی مجدد سرور، کاربران از سیستم خارج نشوند.
const DATA_DIR = path.join(__dirname, 'data');
const SECRET_PATH = path.join(DATA_DIR, '.session-secret');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
let secret = process.env.SESSION_SECRET;
if (!secret) {
  if (fs.existsSync(SECRET_PATH)) {
    secret = fs.readFileSync(SECRET_PATH, 'utf8');
  } else {
    secret = crypto.randomBytes(32).toString('hex');
    fs.writeFileSync(SECRET_PATH, secret, 'utf8');
  }
}

// هدرهای امنیتی پایه. سیاست محتوا (CSP) دستی تنظیم شده تا فونت گوگل و
// استایل‌های inline موجود در صفحه همچنان کار کنند.
app.use(
  helmet({
    contentSecurityPolicy: {
      useDefaults: true,
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
        fontSrc: ["'self'", 'https://fonts.gstatic.com'],
        imgSrc: ["'self'", 'data:'],
        connectSrc: ["'self'"],
        objectSrc: ["'none'"],
        frameAncestors: ["'none'"],
        // تا وقتی روی HTTPS نرفته‌ایم این را فعال نمی‌کنیم، وگرنه در شبکه‌ی
        // داخلی (http) بارگذاری منابع به هم می‌ریزد.
        upgradeInsecureRequests: null,
      },
    },
  })
);

// rawBody برای بررسی امضای وب‌هوک‌ها (وردست) لازم است
app.use(express.json({ verify: (req, res, buf) => { req.rawBody = buf; } }));
// پاسخ‌های JSON بزرگ فشرده (gzip) فرستاده می‌شوند تا تب‌ها روی اینترنت کند سریع باز شوند
// زمان واقعی هر مسیر API، خلاصه هر ۱۰ دقیقه در لاگ سرور ([api-timing])
app.use('/api', require('./shared/api-timing').apiTiming());
app.use('/api', require('./shared/gzip-json').gzipJson());

// نشست‌ها در دیتابیس انتخاب‌شده ذخیره می‌شوند، نه در حافظه‌ی سرور. نتیجه: با ری‌استارت
// سرور کاربران وارد می‌مانند، و در آینده چند سرور می‌توانند نشست‌ها را به اشتراک بگذارند.
app.use(
  session({
    store: new PrismaSessionStore({ prisma, pruneIntervalMs: 15 * 60 * 1000 }),
    // نام جدا از پروژه‌ی مرجع (هم روی همان IP است؛ کوکی به پورت وابسته نیست و نشست‌ها هم را بیرون نیندازند)
    name: 'crm_template.sid',
    secret,
    resave: false,
    saveUninitialized: false,
    rolling: true,
    cookie: {
      maxAge: SESSION_MAX_AGE_DAYS * 24 * 60 * 60 * 1000,
      httpOnly: true,
      sameSite: 'lax',
      // بر اساس پروتکل واقعی درخواست تصمیم بگیر: روی HTTPS کوکی امن است، اما
      // دسترسی HTTP شبکه نیز می‌تواند کوکی را نگه دارد و بعد از refresh خارج نشود.
      secure: 'auto',
    },
  })
);

// سقف کلی درخواست به API برای هر آی‌پی (جلوی سیل درخواست؛ کار عادی چند کارشناس پشت یک اینترنت به آن نمی‌رسد)
app.use('/api', require('express-rate-limit').rateLimit({
  windowMs: 60 * 1000,
  limit: Number(process.env.API_RATE_PER_MIN) || 3000,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  handler: (req, res) => res.status(429).json({ error: 'درخواست‌ها زیاد است، کمی بعد دوباره تلاش کنید' }),
}));

// لایه‌ی دوم حفاظت CSRF: کوکی SameSite=lax همه‌ی زیردامنه‌های crm.example.com (سایت وردپرس، CRM قدیمی cPanel)
// را «هم‌سایت» حساب می‌کند. درخواست تغییر داده از مرورگر فقط از همین آدرس پذیرفته می‌شود.
// اپ گوشی (توکن دستگاه) و وب‌هوک‌های سایت/وردست کوکی ندارند و Origin هم نمی‌فرستند.
const SAFE_METHODS = ['GET', 'HEAD', 'OPTIONS'];
app.use('/api', (req, res, next) => {
  if (SAFE_METHODS.includes(req.method) || req.path.startsWith('/v1/device/') || req.path.startsWith('/v1/public/')) return next();
  const origin = req.get('origin');
  const site = req.get('sec-fetch-site');
  let sameOrigin = true;
  if (origin) {
    try { sameOrigin = new URL(origin).host === req.get('host'); } catch (e) { sameOrigin = false; }
  } else if (site && site !== 'same-origin' && site !== 'none') {
    sameOrigin = false;
  }
  if (!sameOrigin) return res.status(403).json({ error: 'این درخواست از سایت دیگری آمده و پذیرفته نشد' });
  next();
});

// همه‌ی ماژول‌ها زیر یک مسیر نسخه‌دار سوار می‌شوند
app.use('/api/v1', apiRoutes);

// ماژول تبدیل تاریخ شمسی در shared/ است تا سرور و مرورگر از یک کد استفاده کنند
app.get('/js/jalali.js', (req, res) => {
  res.type('application/javascript');
  res.sendFile(path.join(__dirname, 'shared', 'jalali.js'));
});

// index.html هرگز نباید کش شود — هر بار باید نسخه‌ی تازه از دیسک خوانده شود.
// دلیلش این است که خودِ این فایل، عنصرهایی که app.js دنبالشان می‌گردد را
// تعریف می‌کند؛ اگر مرورگر یک نسخه‌ی قدیمی از آن را نگه دارد در حالی که
// app.js به نسخه‌ی جدیدتر (که نسخه‌بندی‌شده و طولانی‌مدت کش می‌شود) به‌روز
// شده، دنبال عنصری می‌گردد که در آن HTML قدیمی وجود ندارد — دقیقاً همان
// چیزی که یک‌بار باعث شد پروفایل مشتری باز نشود.
// نسخه‌ی فایل‌های ثابت (?v=...) خودکار از روی کامیت فعلی ساخته می‌شود تا بعد از هر
// انتشار، مرورگرها به‌جای نسخه‌ی کش‌شده‌ی app.js/app.css نسخه‌ی تازه را بگیرند —
// بدون این‌که کسی مجبور باشد شماره‌ی نسخه را دستی در index.html عوض کند.
const ASSET_VERSION = (() => {
  try {
    return require('child_process').execSync('git rev-parse --short HEAD', { cwd: __dirname, stdio: ['ignore', 'pipe', 'ignore'] })
      .toString().trim() || String(Date.now());
  } catch (e) {
    return String(Date.now());
  }
})();

app.get(['/', '/index.html'], (req, res) => {
  const file = path.join(__dirname, 'public', 'index.html');
  fs.readFile(file, 'utf8', (err, html) => {
    if (err) return res.status(500).send('index.html not found');
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.type('html').send(html.replace(/\?v=[0-9A-Za-z-]+/g, '?v=' + ASSET_VERSION));
  });
});

// فرم عمومی احراز همکار (لینک پیامکی، بدون ورود)
app.get('/kyc/:token', (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.sendFile(path.join(__dirname, 'public', 'kyc.html'));
});

app.use(
  express.static(path.join(__dirname, 'public'), {
    setHeaders(res, filePath) {
      if (path.basename(filePath) === 'index.html') {
        res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
      }
    },
  })
);

// فایل نصب اپ اندروید «اپ تماس» — بیرون از مخزن git نگه داشته می‌شود
// (پیش‌فرض: ~/crm-downloads؛ با DOWNLOADS_DIR قابل تغییر)
app.use(
  '/downloads',
  express.static(process.env.DOWNLOADS_DIR || path.join(require('os').homedir(), 'crm-downloads'), {
    index: false,
    setHeaders(res, filePath) {
      res.setHeader('Cache-Control', 'no-cache');
      if (filePath.endsWith('.apk')) res.setHeader('Content-Type', 'application/vnd.android.package-archive');
    },
  })
);

// تبدیل خطاهای پیش‌بینی‌نشده به پاسخ JSON قابل فهم (باید بعد از همه‌ی مسیرها بیاید)
app.use(errorHandler);

async function start() {
  // هاست cPanel رابط کاربری را از کپی‌های ریشه‌ی پروژه سرو می‌کند (نه public/)
  // و server.js را مستقیم اجرا می‌کند — پس هوک prestart آنجا هرگز اجرا نمی‌شود.
  // همگام‌سازی در لحظه‌ی بالا آمدن تضمین می‌کند بعد از هر ری‌استارت، HTML/JS
  // ریشه همان نسخه‌ی public/ باشد؛ وگرنه HTML کهنه با JS تازه ترکیب می‌شود.
  try {
    require('./scripts/sync-static-assets.js');
  } catch (e) {
    console.warn('هشدار: همگام‌سازی فایل‌های ثابت انجام نشد: ' + e.message);
  }

  try {
    await userService.seedIfEmpty();
  } catch (e) {
    console.error('');
    console.error('اتصال به دیتابیس ' + DATABASE_PROVIDER + ' برقرار نشد.');
    console.error('  ' + e.message);
    console.error('');
    console.error('بررسی کنید که سرویس دیتابیس روشن باشد و DATABASE_URL در فایل .env درست باشد.');
    process.exit(1);
  }

  require('./modules/crm/services/siteFormService').start();
  require('./modules/crm/services/docCacheService').start();
  app.listen(PORT, HOST, () => {
    const databaseUrl = new URL(process.env.DATABASE_URL);
    const databaseName = decodeURIComponent(databaseUrl.pathname.replace(/^\//, ''));
    console.log('');
    console.log('سرور CRM CRM نمونه اجرا شد.');
    console.log(
      'دیتابیس فعال: ' +
        DATABASE_PROVIDER +
        '://' +
        databaseUrl.hostname +
        ':' +
        (databaseUrl.port || '3306') +
        '/' +
        databaseName
    );
    console.log('دسترسی از همین سیستم : http://localhost:' + PORT);
    console.log('دسترسی از سایر سیستم‌های شبکه : http://<آی‌پی این سیستم>:' + PORT);
    console.log('');
  });
}

start();
