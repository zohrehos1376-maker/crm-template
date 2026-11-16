// سرویس شعبه‌ها — تنها جایی که کوئری‌های Prisma مربوط به شعبه‌ها نوشته می‌شود.
const { prisma, caseInsensitiveEquals } = require('../../../shared/prisma');

function fail(status, message) {
  const e = new Error(message);
  e.status = status;
  return e;
}

function toBranchOut(b) {
  if (!b) return null;
  return {
    id: b.id,
    name: b.name,
    city: b.city || '',
    address: b.address || '',
    createdAt: b.createdAt.getTime(),
  };
}

function cleanText(v) {
  const s = v === undefined || v === null ? '' : String(v).trim();
  return s === '' ? null : s;
}

async function listBranches() {
  const rows = await prisma.branch.findMany({ orderBy: { createdAt: 'asc' } });
  return rows.map(toBranchOut);
}

async function findById(id) {
  const b = await prisma.branch.findUnique({ where: { id } });
  return toBranchOut(b);
}

async function createBranch({ name, city, address }) {
  const cleanName = String(name).trim();
  const exists = await prisma.branch.findFirst({
    where: { name: caseInsensitiveEquals(cleanName) },
  });
  if (exists) throw fail(400, 'شعبه‌ای با این نام از قبل وجود دارد');

  const b = await prisma.branch.create({
    data: { name: cleanName, city: cleanText(city), address: cleanText(address) },
  });
  return toBranchOut(b);
}

async function updateBranch(id, { name, city, address }) {
  const branch = await prisma.branch.findUnique({ where: { id } });
  if (!branch) throw fail(404, 'شعبه یافت نشد');

  const data = {};
  if (name !== undefined) {
    const cleanName = String(name).trim();
    if (!cleanName) throw fail(400, 'نام شعبه را وارد کنید');
    const dup = await prisma.branch.findFirst({
      where: { name: caseInsensitiveEquals(cleanName), id: { not: id } },
    });
    if (dup) throw fail(400, 'شعبه‌ای با این نام از قبل وجود دارد');
    data.name = cleanName;
  }
  if (city !== undefined) data.city = cleanText(city);
  if (address !== undefined) data.address = cleanText(address);

  const updated = await prisma.branch.update({ where: { id }, data });
  return toBranchOut(updated);
}

module.exports = { listBranches, findById, createBranch, updateBranch };
