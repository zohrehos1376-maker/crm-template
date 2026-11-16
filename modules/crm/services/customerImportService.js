// ورود مشتریان از اکسل: شماره‌ی تازه پرونده می‌سازد؛ شماره‌ی موجود با خانه‌های پرِ فایل به‌روز می‌شود
// (خانه‌ی خالی یعنی دست نزن). اول پیش‌نمایش (apply=false)، بعد اعمال.
const { prisma } = require('../../../shared/prisma');
const { normalizePhone } = require('../../../shared/phone');
const { readFirstSheetRows } = require('../../../shared/xlsx-read');
const S = require('../../../shared/customer-sheet');
const leadService = require('./leadService');
const { can } = require('../../../shared/permissions');

function fail(status, message) { const e = new Error(message); e.status = status; return e; }
// «| نمونه» برچسب داخلی CRM قدیمی است، جزو نام نیست
const cleanName = (s) => String(s || '').replace(/\s*\|\s*نمونه\s*$/, '').trim();
// وضعیت احراز فقط رو به جلو عوض می‌شود؛ تصمیم «تأیید/رد» با فایل قدیمی‌تر به عقب برنمی‌گردد
const KYC_STEP = { none: 0, awaiting: 1, pending: 2, approved: 3, rejected: 3 };
const kycForward = (from, to) => (KYC_STEP[to] || 0) > (KYC_STEP[from || 'none'] || 0);
const txt = (v, n) => String(v === undefined || v === null ? '' : v).trim().slice(0, n || 191);

function parse(buffer) {
  let rows;
  try { rows = readFirstSheetRows(buffer); } catch (e) { throw fail(400, 'فایل اکسل قابل خواندن نیست — از فایل نمونه استفاده کنید'); }
  if (!rows.length) throw fail(400, 'فایل خالی است');
  const header = rows[0].map(S.norm);
  const col = {};
  S.CUSTOMER_HEADERS.forEach((h) => { col[h] = header.indexOf(S.norm(h)); });
  if (col['فروشگاه / تعمیرگاه'] === -1) col['فروشگاه / تعمیرگاه'] = header.indexOf(S.norm('فروشگاه'));
  if (col['تلفن'] === -1) throw fail(400, 'ستون «تلفن» در فایل پیدا نشد. از فایل نمونه استفاده کنید.');
  const get = (r, k) => (col[k] >= 0 && r[col[k]] !== undefined ? txt(r[col[k]], k === 'توضیحات' ? 4000 : 191) : '');
  const out = [];
  const warnings = [];
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    if (!r || !r.some((c) => String(c || '').trim())) continue;
    const phone = normalizePhone(get(r, 'تلفن'));
    // موبایل یا تلفن ثابت با کد شهر (۱۰ تا ۱۳ رقم)
    if (!phone || !/^\+?\d{10,13}$/.test(phone)) { warnings.push('ردیف ' + (i + 1) + ': شماره‌ی تلفن معتبر نیست — رد شد'); continue; }
    const kycText = get(r, 'وضعیت احراز');
    const kyc = S.kycFromLabel(kycText);
    if (kyc === undefined) warnings.push('ردیف ' + (i + 1) + ': وضعیت احراز «' + kycText + '» شناخته نشد — دست نخورد');
    out.push({
      row: i + 1, phone, name: cleanName(get(r, 'نام مشتری')), city: get(r, 'شهر'), shop: get(r, 'فروشگاه / تعمیرگاه'),
      job: S.jobFromText(get(r, 'نوع مشتری')), kyc: kyc || null, channel: get(r, 'منبع'), notes: get(r, 'توضیحات'),
    });
  }
  return { rows: out, warnings };
}

async function importCustomers(user, buffer, apply) {
  const { rows, warnings } = parse(buffer);
  const seen = new Set();
  const st = { rows: rows.length, created: 0, updated: 0, unchanged: 0, duplicateInFile: 0, kycKept: 0 };
  const samples = [];
  const owner = await leadService.queueUser();
  // وضعیت احراز فقط با دسترسی «تأیید و رد مدارک» از اکسل عوض می‌شود
  const canKyc = can(user, 'kyc_review');
  for (const r of rows) {
    if (seen.has(r.phone)) { st.duplicateInFile++; continue; }
    seen.add(r.phone);
    // همان شماره با شکل دیگر (0 / 98 / +98) هم تکراری است: ۱۰ رقم آخر ملاک است
    const tail = r.phone.replace(/\D/g, '').slice(-10);
    const lead = await prisma.lead.findFirst({ where: { phone: r.phone } })
      || (tail.length === 10 ? await prisma.lead.findFirst({ where: { phone: { endsWith: tail } }, orderBy: { createdAt: 'asc' } }) : null);
    if (seen.has('t:' + tail)) { st.duplicateInFile++; continue; }
    seen.add('t:' + tail);
    if (!lead) {
      st.created++;
      if (samples.length < 15) samples.push('تازه: ' + r.phone + ' ' + (r.name || '—'));
      if (apply) {
        const l = await prisma.lead.create({
          data: {
            phone: r.phone, customerName: r.name, city: r.city || null, shopName: r.shop || null, jobType: r.job,
            kycStatus: (canKyc && r.kyc) || 'none', channel: r.channel || 'ورود از اکسل', notes: r.notes || null,
            preferredContact: [], status: 'جدید', ownerId: owner.id, updatedAt: new Date(),
          },
        });
        await prisma.leadAudit.create({ data: { leadId: l.id, userId: user.id, action: 'created', summary: 'ورود از اکسل' } });
      }
      continue;
    }
    const data = {};
    const changes = [];
    const set = (field, label, to, from) => {
      if (to === null || to === undefined || to === '' || to === from) return;
      data[field] = to;
      changes.push({ field, label, from: from || '—', to });
    };
    set('customerName', 'نام مشتری', r.name, lead.customerName);
    set('city', 'شهر', r.city, lead.city);
    set('shopName', 'فروشگاه', r.shop, lead.shopName);
    set('jobType', 'نوع مشتری', r.job, lead.jobType);
    if (!canKyc) r.kyc = null;
    if (r.kyc && r.kyc !== lead.kycStatus && !kycForward(lead.kycStatus, r.kyc)) st.kycKept = (st.kycKept || 0) + 1;
    if (r.kyc && kycForward(lead.kycStatus, r.kyc)) {
      data.kycStatus = r.kyc;
      changes.push({ field: 'kycStatus', label: 'وضعیت احراز', from: S.KYC_LABELS[lead.kycStatus] || lead.kycStatus, to: S.KYC_LABELS[r.kyc] });
    }
    if (r.notes && !String(lead.notes || '').includes(r.notes)) {
      data.notes = (lead.notes ? lead.notes + '\n\n' : '') + r.notes;
      changes.push({ field: 'notes', label: 'توضیحات', from: '', to: '(اضافه شد)' });
    }
    if (!changes.length) { st.unchanged++; continue; }
    st.updated++;
    if (samples.length < 15) samples.push(r.phone + ': ' + changes.map((c) => c.label + ' ' + c.from + ' ← ' + c.to).join('، '));
    if (apply) {
      await prisma.lead.update({ where: { id: lead.id }, data: Object.assign(data, { updatedAt: new Date() }) });
      await prisma.leadAudit.create({ data: { leadId: lead.id, userId: user.id, action: 'edited', summary: 'به‌روزرسانی از اکسل', changes: JSON.stringify(changes) } });
    }
  }
  return Object.assign(st, { applied: !!apply, warnings: warnings.slice(0, 50), samples });
}

module.exports = { importCustomers };
