// سرویس کاربران — تنها جایی که کوئری‌های Prisma مربوط به کاربران نوشته می‌شود.
// روت‌ها (routes/auth.js و routes/users.js) هیچ‌وقت مستقیم به دیتابیس دستور نمی‌دهند.
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const { prisma, getDefaultBranchId, caseInsensitiveEquals } = require('../../../shared/prisma');
const { parsePermissions, cleanPermissions } = require('../../../shared/permissions');

// خطای قابل نمایش به کاربر، همراه با کد وضعیت HTTP
function fail(status, message) {
  const e = new Error(message);
  e.status = status;
  return e;
}

// تبدیل رکورد دیتابیس به همان ساختاری که رابط کاربری از قبل انتظار دارد.
// نکته: در دیتابیس نام فیلد is_active است ولی خروجی باید active باشد و
// تاریخ‌ها به‌صورت عدد میلی‌ثانیه برگردند (دقیقاً مثل نسخه‌ی JSON).
function toUserOut(u) {
  if (!u) return null;
  return {
    id: u.id,
    username: u.username,
    fullName: u.fullName,
    role: u.role,
    roleTitle: u.roleTitle || '',
    // عنوانی که در رابط کاربری نشان داده می‌شود: عنوان دلخواه، وگرنه نقش پیش‌فرض
    roleLabel: u.roleTitle || (u.role === 'manager' ? 'مدیر' : 'کارشناس فروش'),
    active: u.isActive,
    branchId: u.branchId,
    branchName: u.branch ? u.branch.name : null,
    // مدیر همه‌ی دسترسی‌ها را دارد؛ این فهرست فقط دسترسی‌های اضافه‌ی کارشناس است
    permissions: u.role === 'manager' ? [] : parsePermissions(u.permissions),
    createdAt: u.createdAt.getTime(),
  };
}

// نام شعبه همراه هر کاربر خوانده می‌شود تا رابط کاربری بتواند نمایشش دهد
const USER_INCLUDE = { branch: { select: { name: true } } };

function genPassword() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  let out = '';
  for (let i = 0; i < 10; i++) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
}

// در اولین اجرا روی یک دیتابیس خالی، یک حساب مدیر پیش‌فرض می‌سازد و رمز
// تصادفی آن را یک‌بار در کنسول و فایل SETUP.txt نمایش می‌دهد.
async function seedIfEmpty() {
  const count = await prisma.user.count();
  if (count > 0) return;

  const password = genPassword();
  await prisma.user.create({
    data: {
      username: 'admin',
      passwordHash: bcrypt.hashSync(password, 10),
      fullName: 'مدیر سیستم',
      role: 'manager',
      isActive: true,
      branchId: await getDefaultBranchId(),
    },
  });

  const msg =
    '\n=========================================\n' +
    '  حساب مدیر پیش‌فرض ساخته شد\n' +
    '  نام کاربری : admin\n' +
    '  رمز عبور   : ' + password + '\n' +
    '  لطفاً پس از اولین ورود، از بخش «تغییر رمز عبور» این رمز را عوض کنید.\n' +
    '=========================================\n';
  console.log(msg);
  try {
    fs.writeFileSync(path.join(__dirname, '..', 'SETUP.txt'), msg, 'utf8');
  } catch (e) {
    // اگر نوشتن فایل ممکن نبود مشکلی نیست — پیام در کنسول موجود است
  }
}

// ورود: جستجوی نام کاربری بدون حساسیت به بزرگی/کوچکی حروف، دقیقاً مثل نسخه‌ی قبل
async function authenticate(username, password) {
  const user = await prisma.user.findFirst({
    where: { username: caseInsensitiveEquals(String(username)) },
    include: USER_INCLUDE,
  });
  // نام کاربری ناموجود هم همان‌قدر طول می‌کشد تا از روی زمان پاسخ نشود فهمید کدام نام کاربری وجود دارد
  const ok = bcrypt.compareSync(String(password), user ? user.passwordHash : DUMMY_HASH);
  if (!user || !user.isActive || !ok) return null;
  return toUserOut(user);
}
const DUMMY_HASH = bcrypt.hashSync(require('crypto').randomBytes(16).toString('hex'), 10);

const MIN_PASSWORD = 8;

// خروج از همه‌ی دستگاه‌ها (بعد از عوض شدن رمز)؛ exceptSid = همین نشستی که رمز را عوض کرده
async function revokeSessions(userId, exceptSid) {
  const where = { sess: { path: '$.userId', equals: userId } };
  if (exceptSid) where.NOT = { sid: exceptSid };
  const r = await prisma.session.deleteMany({ where });
  return r.count;
}

// برای middleware احراز هویت: فقط کاربر فعال برگردانده می‌شود
async function findActiveById(id) {
  const user = await prisma.user.findFirst({ where: { id, isActive: true }, include: USER_INCLUDE });
  return toUserOut(user);
}

async function changePassword(userId, oldPassword, newPassword) {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user || !bcrypt.compareSync(oldPassword, user.passwordHash)) {
    throw fail(400, 'رمز عبور فعلی اشتباه است');
  }
  await prisma.user.update({
    where: { id: userId },
    data: { passwordHash: bcrypt.hashSync(newPassword, 10) },
  });
}

async function listUsers() {
  // حساب سیستمیِ «صف مشتریان بدون مسئول» (__queue__) در فهرست کاربران نمی‌آید
  const users = await prisma.user.findMany({ where: { username: { not: '__queue__' } }, orderBy: { createdAt: 'asc' }, include: USER_INCLUDE });
  return users.map(toUserOut);
}

const cleanRoleTitle = (v) => String(v === undefined || v === null ? '' : v).trim().slice(0, 40);

async function createUser({ username, password, fullName, role, roleTitle, branchId, permissions }) {
  const exists = await prisma.user.findFirst({
    where: { username: caseInsensitiveEquals(String(username).trim()) },
  });
  if (exists) throw fail(400, 'این نام کاربری قبلاً استفاده شده است');

  const user = await prisma.user.create({
    data: {
      username: String(username).trim(),
      passwordHash: bcrypt.hashSync(password, 10),
      fullName: String(fullName).trim(),
      role,
      roleTitle: cleanRoleTitle(roleTitle) || null,
      isActive: true,
      branchId,
      permissions: role === 'manager' ? null : cleanPermissions(permissions).join(',') || null,
    },
    include: USER_INCLUDE,
  });
  return toUserOut(user);
}

async function updateUser(id, { fullName, role, roleTitle, active, password, branchId, permissions }) {
  const user = await prisma.user.findUnique({ where: { id } });
  if (!user) throw fail(404, 'کاربر یافت نشد');

  const data = {};
  if (fullName) data.fullName = String(fullName).trim();
  if (role && ['rep', 'manager'].includes(role)) data.role = role;
  if (roleTitle !== undefined) data.roleTitle = cleanRoleTitle(roleTitle) || null;
  if (typeof active === 'boolean') data.isActive = active;
  if (password) data.passwordHash = bcrypt.hashSync(password, 10);
  if (branchId) data.branchId = branchId;
  if (permissions !== undefined) data.permissions = cleanPermissions(permissions).join(',') || null;

  const updated = await prisma.user.update({ where: { id }, data, include: USER_INCLUDE });
  return toUserOut(updated);
}

// کارشناس فعالی که مدیر می‌خواهد سرنخ را به نام او ثبت کند
async function findActiveRepById(id) {
  const user = await prisma.user.findFirst({ where: { id, isActive: true }, include: USER_INCLUDE });
  return toUserOut(user);
}

// برای آپلود اکسل: پیدا کردن کارشناس بر اساس نام کاملش
async function findByFullName(fullName) {
  const user = await prisma.user.findFirst({ where: { fullName: String(fullName) }, include: USER_INCLUDE });
  return toUserOut(user);
}

// برای گزارش عملکرد کارشناسان
async function listReps() {
  const reps = await prisma.user.findMany({ where: { role: 'rep', username: { not: '__queue__' } }, include: USER_INCLUDE });
  return reps.map(toUserOut);
}

module.exports = {
  MIN_PASSWORD,
  revokeSessions,
  seedIfEmpty,
  authenticate,
  findActiveById,
  changePassword,
  listUsers,
  createUser,
  updateUser,
  findActiveRepById,
  findByFullName,
  listReps,
};
