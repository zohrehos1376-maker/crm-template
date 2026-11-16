// تنظیمات Prisma — آدرس اتصال به دیتابیس از فایل .env خوانده می‌شود (فقط MariaDB).
require('dotenv').config({ quiet: true, override: true });

const path = require('node:path');

const prismaRoot = path.join(__dirname, 'prisma', 'mysql');

module.exports = {
  schema: path.join(prismaRoot, 'schema.prisma'),
  migrations: {
    path: path.join(prismaRoot, 'migrations'),
  },
  datasource: {
    url: process.env.DATABASE_URL,
  },
};
