// یک نمونه‌ی مشترک از اتصال به دیتابیس MariaDB برای کل برنامه.
// همه‌ی سرویس‌ها از همین نمونه استفاده می‌کنند تا تعداد اتصال‌ها کنترل‌شده بماند.
require('dotenv').config({ quiet: true, override: true });

if (!process.env.DATABASE_URL) {
  throw new Error(
    'متغیر DATABASE_URL در فایل .env تعریف نشده است. بدون آن اتصال به دیتابیس ممکن نیست.'
  );
}

// فقط MariaDB/MySQL (لپ‌تاپ و سرور هر دو MariaDB 10.11)
const DATABASE_PROVIDER = 'mysql';
const { PrismaClient } = require('../node_modules/.prisma/client-mysql');
const { PrismaMariaDb } = require('@prisma/adapter-mariadb');
const url = new URL(process.env.DATABASE_URL);
if (!['mysql:', 'mariadb:'].includes(url.protocol)) {
  throw new Error('مقدار DATABASE_URL باید با mysql:// شروع شود.');
}
const adapter = new PrismaMariaDb({
  host: url.hostname,
  port: Number(url.port) || 3306,
  user: decodeURIComponent(url.username),
  password: decodeURIComponent(url.password),
  database: decodeURIComponent(url.pathname.replace(/^\//, '')),
  connectionLimit: Number(process.env.DB_CONNECTION_LIMIT) || 10,
});

const prisma = new PrismaClient({ adapter });

// collation ستون (utf8mb4_unicode_ci) مقایسه را خودش بدون حساسیت به حروف بزرگ/کوچک انجام می‌دهد
function caseInsensitiveEquals(value) {
  return { equals: value };
}

// نام شعبه‌ی پیش‌فرض؛ تا وقتی قابلیت چندشعبه‌ای اضافه نشده، همه‌ی کاربران و
// سرنخ‌ها به همین شعبه وصل می‌شوند.
const DEFAULT_BRANCH_NAME = process.env.DEFAULT_BRANCH_NAME || 'دفتر مرکزی';

let cachedBranchId = null;

// شناسه‌ی شعبه‌ی پیش‌فرض را برمی‌گرداند و اگر وجود نداشته باشد می‌سازد.
async function getDefaultBranchId() {
  if (cachedBranchId) return cachedBranchId;
  let branch = await prisma.branch.findFirst({ where: { name: DEFAULT_BRANCH_NAME } });
  if (!branch) {
    branch = await prisma.branch.create({ data: { name: DEFAULT_BRANCH_NAME } });
  }
  cachedBranchId = branch.id;
  return cachedBranchId;
}

module.exports = {
  prisma,
  getDefaultBranchId,
  DEFAULT_BRANCH_NAME,
  DATABASE_PROVIDER,
  caseInsensitiveEquals,
};
