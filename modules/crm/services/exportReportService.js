// صفحه‌ی «گزارش‌گیری»: هر گزارش = خلاصه (چند عدد) + جدول با نام مشتری‌ها، برای پیش‌نمایش، اکسل و PDF.
// بازه: q.from / q.to (میلی‌ثانیه؛ to انحصاری) — q.userId: فقط یک کارشناس.
const { prisma } = require('../../../shared/prisma');
const { outcomeLabel } = require('../../../shared/call-outcomes');
const { REPORT_KINDS, NO_PURCHASE_REASONS, KYC_STATUSES, labelOf } = require('../../../shared/workdesk');
const Jalali = require('../../../shared/jalali');

const UNANSWERED = ['MISSED', 'REJECTED'];
const DAY = 86400000;

function range(q) {
  const now = Date.now();
  const to = Number(q.to) > 0 ? Number(q.to) : now;
  const from = Number(q.from) > 0 ? Number(q.from) : to - 30 * DAY;
  if (to - from > 400 * DAY) throw Object.assign(new Error('بازه‌ی گزارش حداکثر ۴۰۰ روز است'), { status: 400 });
  return { from: new Date(from), to: new Date(to), userId: q.userId ? String(q.userId) : null };
}
const fa = (n) => Jalali.toFaDigits(String(n));
const day = (d) => (d ? Jalali.formatDate(new Date(d)) : '');
const dayTime = (d) => (d ? Jalali.formatDate(new Date(d)) + ' ' + new Date(d).toLocaleTimeString('en-GB', { timeZone: 'Asia/Tehran', hour: '2-digit', minute: '2-digit' }) : '');
const nameOf = (l) => (l && l.customerName) || 'بدون نام';
const money = (n) => fa(String(Math.round(Number(n) || 0)).replace(/\B(?=(\d{3})+(?!\d))/g, ',')) + ' ریال';

async function userNames() {
  const rows = await prisma.user.findMany({ select: { id: true, fullName: true } });
  return new Map(rows.map((u) => [u.id, u.fullName]));
}
function parseJson(s, def) { try { return s ? JSON.parse(s) : def; } catch (e) { return def; } }
const LEAD_SELECT = { id: true, customerName: true, phone: true, shopName: true, city: true, ownerId: true, kycStatus: true, channel: true };
async function leadsByPhone(phones) {
  const list = [...new Set(phones.filter(Boolean))];
  if (!list.length) return new Map();
  const rows = await prisma.lead.findMany({ where: { phone: { in: list } }, select: LEAD_SELECT });
  return new Map(rows.map((l) => [l.phone, l]));
}

// ---------- ۱) فروش‌ها ----------
async function sales(q) {
  const r = range(q);
  const names = await userNames();
  const audits = await prisma.leadAudit.findMany({
    where: Object.assign({ action: { in: ['first_purchase', 'purchase'] }, createdAt: { gte: r.from, lt: r.to } }, r.userId ? { userId: r.userId } : {}),
    orderBy: { createdAt: 'desc' },
    include: { lead: { select: LEAD_SELECT } },
  });
  let total = 0, firsts = 0;
  const rows = audits.map((a) => {
    const ch = parseJson(a.changes, []);
    const get = (f) => { const c = ch.find((x) => x.field === f); return c ? c.to : ''; };
    const price = Number(get('_salePrice')) || 0;
    total += price;
    if (a.action === 'first_purchase') firsts++;
    return [day(a.createdAt), nameOf(a.lead), a.lead ? a.lead.phone : '', a.lead ? a.lead.shopName || '' : '', a.lead ? a.lead.city || '' : '',
      names.get(a.userId) || '', get('_saleInvoice') || get('_saleModel'), price || '', a.action === 'first_purchase' ? 'خرید اول' : 'خرید تکراری',
      a.lead ? labelOf(KYC_STATUSES, a.lead.kycStatus) : '', get('_saleReason')];
  });
  const buyers = new Set(audits.map((a) => a.leadId)).size;
  return {
    columns: ['تاریخ', 'مشتری', 'تلفن', 'فروشگاه', 'شهر', 'کارشناس', 'شماره فاکتور', 'مبلغ فاکتور (ریال)', 'نوع خرید', 'وضعیت احراز', 'دلیل فروش بدون احراز'],
    numeric: [7], money: [7],
    summary: [['تعداد فروش', fa(rows.length)], ['مشتریان خریدار', fa(buyers)], ['خرید اول', fa(firsts)], ['جمع مبلغ', money(total)]],
    rows,
    footer: ['جمع', '', '', '', '', '', '', total, '', '', ''],
  };
}

// ---------- ۲) استعلام قیمت بدون خرید ----------
async function inquiries(q) {
  const r = range(q);
  const names = await userNames();
  const calls = await prisma.callLog.findMany({
    where: Object.assign({ outcomes: { contains: 'price_inquiry' }, direction: { notIn: UNANSWERED }, startedAt: { gte: r.from, lt: r.to } }, r.userId ? { operatorUserId: r.userId } : {}),
    select: { phoneNormalized: true, startedAt: true, operatorUserId: true, callerName: true, productNote: true },
    orderBy: { startedAt: 'asc' },
  });
  const by = new Map();
  for (const c of calls) {
    if (!c.phoneNormalized || c.phoneNormalized === 'unknown') continue;
    const g = by.get(c.phoneNormalized) || { n: 0, days: new Set(), last: null, ops: new Set(), products: new Set(), caller: '' };
    g.n++; g.days.add(day(c.startedAt)); g.last = c.startedAt;
    if (c.operatorUserId) g.ops.add(names.get(c.operatorUserId) || '');
    if (c.productNote) g.products.add(c.productNote);
    if (c.callerName) g.caller = c.callerName;
    by.set(c.phoneNormalized, g);
  }
  const leads = await leadsByPhone([...by.keys()]);
  // فقط کسانی که در همین بازه خرید ثبت‌شده ندارند
  const bought = new Set((await prisma.leadAudit.findMany({
    where: { action: { in: ['first_purchase', 'purchase'] }, createdAt: { gte: r.from, lt: r.to }, leadId: { in: [...leads.values()].map((l) => l.id) } },
    select: { leadId: true },
  })).map((a) => a.leadId));
  const rows = [];
  for (const [phone, g] of by) {
    const l = leads.get(phone);
    if (l && bought.has(l.id)) continue;
    rows.push([l ? nameOf(l) : g.caller || 'ثبت‌نشده', phone, l ? l.shopName || '' : '', l ? l.city || '' : '', g.n, g.days.size, day(g.last),
      [...g.ops].filter(Boolean).join('، '), [...g.products].join('، '), l ? names.get(l.ownerId) || '' : '']);
  }
  rows.sort((a, b) => b[4] - a[4]);
  return {
    columns: ['مشتری', 'تلفن', 'فروشگاه', 'شهر', 'تعداد استعلام', 'چند روز', 'آخرین استعلام', 'پاسخ‌دهنده', 'محصولات پرسیده‌شده', 'کارشناس پرونده'],
    numeric: [4, 5],
    summary: [['مشتریان استعلام‌کننده بدون خرید', fa(rows.length)], ['کل استعلام‌ها', fa(rows.reduce((s, x) => s + x[4], 0))], ['۳ بار یا بیشتر', fa(rows.filter((x) => x[4] >= 3).length)]],
    rows,
  };
}

// ---------- ۳) کالای ناموجود درخواستی ----------
async function outOfStock(q) {
  const r = range(q);
  const [calls, reports] = await Promise.all([
    prisma.callLog.findMany({
      where: Object.assign({ outcomes: { contains: 'out_of_stock' }, direction: { notIn: UNANSWERED }, startedAt: { gte: r.from, lt: r.to } }, r.userId ? { operatorUserId: r.userId } : {}),
      select: { phoneNormalized: true, startedAt: true, productNote: true, callerName: true },
    }),
    prisma.salesReport.findMany({
      where: Object.assign({ kind: 'out_of_stock', createdAt: { gte: r.from, lt: r.to } }, r.userId ? { createdBy: r.userId } : {}),
      select: { phone: true, details: true, createdAt: true },
    }),
  ]);
  const items = calls.map((c) => ({ phone: c.phoneNormalized, product: c.productNote, at: c.startedAt, qty: 0, caller: c.callerName }))
    .concat(reports.map((x) => { const d = parseJson(x.details, {}); return { phone: x.phone, product: d.product, at: x.createdAt, qty: Number(d.quantity) || 0 }; }));
  const leads = await leadsByPhone(items.map((i) => i.phone));
  const groups = new Map();
  for (const i of items) {
    const key = String(i.product || 'نامشخص').trim().replace(/\s+/g, ' ');
    const g = groups.get(key.toLowerCase()) || { product: key, n: 0, qty: 0, customers: new Map(), last: null };
    g.n++; g.qty += i.qty;
    if (!g.last || i.at > g.last) g.last = i.at;
    const l = leads.get(i.phone);
    g.customers.set(i.phone, l ? nameOf(l) + ' (' + i.phone + ')' : (i.caller || 'ثبت‌نشده') + ' (' + i.phone + ')');
    groups.set(key.toLowerCase(), g);
  }
  const rows = [...groups.values()].sort((a, b) => b.n - a.n)
    .map((g) => [g.product, g.n, g.customers.size, g.qty || '', day(g.last), [...g.customers.values()].join('، ')]);
  return {
    columns: ['محصول', 'تعداد درخواست', 'تعداد مشتری', 'تعداد قطعه (گزارش‌ها)', 'آخرین درخواست', 'مشتریان'],
    numeric: [1, 2, 3],
    summary: [['محصولات ناموجود درخواستی', fa(rows.length)], ['کل درخواست‌ها', fa(items.length)]],
    rows,
  };
}

// ---------- ۴) علت عدم خرید و گزارش‌های مشاوران ----------
async function reasons(q) {
  const r = range(q);
  const names = await userNames();
  const [reports, objections] = await Promise.all([
    prisma.salesReport.findMany({
      where: Object.assign({ createdAt: { gte: r.from, lt: r.to } }, r.userId ? { createdBy: r.userId } : {}),
      include: { lead: { select: LEAD_SELECT } }, orderBy: { createdAt: 'desc' },
    }),
    prisma.callLog.findMany({
      where: Object.assign({ outcomes: { contains: 'price_objection' }, direction: { notIn: UNANSWERED }, startedAt: { gte: r.from, lt: r.to } }, r.userId ? { operatorUserId: r.userId } : {}),
      select: { phoneNormalized: true, startedAt: true, operatorUserId: true, note: true, productNote: true, callerName: true }, orderBy: { startedAt: 'desc' },
    }),
  ]);
  const leads = await leadsByPhone(objections.map((c) => c.phoneNormalized));
  const rows = reports.map((x) => {
    const d = parseJson(x.details, {});
    const detail = [d.reason ? 'علت: ' + labelOf(NO_PURCHASE_REASONS, d.reason) : '', d.product ? 'کالا: ' + d.product : '',
      d.competitor ? 'رقیب: ' + d.competitor : '', d.competitorPrice ? 'قیمت رقیب: ' + money(d.competitorPrice) : '',
      d.ourPrice ? 'قیمت ما: ' + money(d.ourPrice) : '', d.quantity ? 'تعداد: ' + fa(d.quantity) : '', d.subject ? 'موضوع: ' + d.subject : ''].filter(Boolean).join(' · ');
    return [dayTime(x.createdAt), x.lead ? nameOf(x.lead) : 'ثبت‌نشده', x.phone, labelOf(REPORT_KINDS, x.kind), detail, x.note || '',
      names.get(x.createdBy) || '', x.status === 'open' ? 'باز' : 'بررسی شد', x.resolution || ''];
  }).concat(objections.map((c) => {
    const l = leads.get(c.phoneNormalized);
    return [dayTime(c.startedAt), l ? nameOf(l) : c.callerName || 'ثبت‌نشده', c.phoneNormalized, outcomeLabel('price_objection'),
      c.productNote ? 'کالا: ' + c.productNote : '', c.note || '', names.get(c.operatorUserId) || '', '', ''];
  }));
  rows.sort((a, b) => (a[0] < b[0] ? 1 : -1));
  const count = (label) => rows.filter((x) => x[3] === label).length;
  return {
    columns: ['زمان', 'مشتری', 'تلفن', 'نوع', 'جزئیات', 'توضیح کارشناس', 'کارشناس', 'وضعیت', 'پاسخ مدیر'],
    numeric: [],
    summary: REPORT_KINDS.map((k) => [k.label, fa(count(k.label))]).concat([[outcomeLabel('price_objection') + ' (تماس)', fa(objections.length)]]),
    rows,
  };
}

// ---------- ۵) عملکرد کارشناس‌ها ----------
async function performance(q) {
  const r = range(q);
  const users = await prisma.user.findMany({ where: Object.assign({ isActive: true }, r.userId ? { id: r.userId } : {}), select: { id: true, fullName: true } });
  const ids = users.map((u) => u.id);
  const [calls, followups, purchases] = await Promise.all([
    prisma.callLog.findMany({ where: { operatorUserId: { in: ids }, startedAt: { gte: r.from, lt: r.to } }, select: { operatorUserId: true, direction: true, durationSec: true, phoneNormalized: true, outcomes: true } }),
    prisma.followup.findMany({ where: { userId: { in: ids }, createdAt: { gte: r.from, lt: r.to } }, select: { userId: true, leadId: true } }),
    prisma.leadAudit.findMany({ where: { userId: { in: ids }, action: { in: ['first_purchase', 'purchase'] }, createdAt: { gte: r.from, lt: r.to } }, select: { userId: true, leadId: true, changes: true } }),
  ]);
  const leadIds = [...new Set(followups.map((f) => f.leadId).concat(purchases.map((p) => p.leadId)))];
  const leadRows = leadIds.length ? await prisma.lead.findMany({ where: { id: { in: leadIds } }, select: LEAD_SELECT }) : [];
  const byId = new Map(leadRows.map((l) => [l.id, l]));
  const byPhone = await leadsByPhone(calls.map((c) => c.phoneNormalized));
  const rows = [];
  let tCalls = 0, tSales = 0, tAmount = 0;
  for (const u of users) {
    const myCalls = calls.filter((c) => c.operatorUserId === u.id);
    const answered = myCalls.filter((c) => !UNANSWERED.includes(c.direction) && c.durationSec > 0);
    const myFu = followups.filter((f) => f.userId === u.id);
    const mySales = purchases.filter((p) => p.userId === u.id);
    const amount = mySales.reduce((s, p) => { const c = parseJson(p.changes, []).find((x) => x.field === '_salePrice'); return s + (c ? Number(c.to) || 0 : 0); }, 0);
    if (!myCalls.length && !myFu.length && !mySales.length) continue;
    const customers = new Map();
    for (const c of answered) { const l = byPhone.get(c.phoneNormalized); customers.set(c.phoneNormalized, l ? nameOf(l) : c.phoneNormalized); }
    for (const f of myFu) { const l = byId.get(f.leadId); if (l) customers.set(l.phone, nameOf(l)); }
    const buyers = [...new Set(mySales.map((p) => p.leadId))].map((id) => byId.get(id)).filter(Boolean).map(nameOf);
    const talk = answered.reduce((s, c) => s + (c.durationSec || 0), 0);
    tCalls += answered.length; tSales += mySales.length; tAmount += amount;
    rows.push([u.fullName, answered.length, myCalls.filter((c) => c.direction === 'OUTGOING').length, Math.round(talk / 60),
      myCalls.filter((c) => String(c.outcomes || '').includes('price_inquiry')).length, myFu.length, mySales.length, amount || '',
      customers.size, buyers.join('، '), [...customers.values()].join('، ')]);
  }
  rows.sort((a, b) => b[7] - a[7] || b[1] - a[1]);
  return {
    columns: ['کارشناس', 'تماس پاسخ‌داده', 'تماس خروجی', 'دقیقه مکالمه', 'استعلام قیمت', 'پیگیری', 'فروش', 'مبلغ فروش (ریال)', 'تعداد مشتری', 'خریداران', 'مشتریانی که با آن‌ها کار شد'],
    numeric: [1, 2, 3, 4, 5, 6, 7, 8], money: [7],
    summary: [['کارشناس فعال', fa(rows.length)], ['تماس پاسخ‌داده', fa(tCalls)], ['فروش', fa(tSales)], ['جمع مبلغ', money(tAmount)]],
    rows,
  };
}

// ---------- ۷) احراز همکاری ----------
async function kyc(q) {
  const r = range(q);
  const names = await userNames();
  const where = {
    OR: [{ kycSubmittedAt: { gte: r.from, lt: r.to } }, { kycReviewedAt: { gte: r.from, lt: r.to } }],
    kycStatus: { not: 'none' },
  };
  if (r.userId) where.ownerId = r.userId;
  const leads = await prisma.lead.findMany({
    where, orderBy: { kycSubmittedAt: 'desc' },
    select: Object.assign({ kycReason: true, kycSubmittedAt: true, kycReviewedAt: true, _count: { select: { kycDocuments: true } } }, LEAD_SELECT),
  });
  const reviews = leads.length ? await prisma.leadAudit.findMany({
    where: { leadId: { in: leads.map((l) => l.id) }, action: { in: ['kyc_approved', 'kyc_rejected'] } },
    orderBy: { createdAt: 'desc' }, select: { leadId: true, userId: true },
  }) : [];
  const reviewer = new Map();
  for (const a of reviews) if (!reviewer.has(a.leadId)) reviewer.set(a.leadId, names.get(a.userId) || '');
  const rows = leads.map((l) => [nameOf(l), l.phone, l.shopName || '', l.city || '', labelOf(KYC_STATUSES, l.kycStatus), day(l.kycSubmittedAt), day(l.kycReviewedAt),
    reviewer.get(l.id) || '', l._count.kycDocuments, l.kycStatus === 'rejected' ? l.kycReason || '' : '', names.get(l.ownerId) || '', l.channel || '']);
  const count = (s) => leads.filter((l) => l.kycStatus === s).length;
  return {
    columns: ['مشتری', 'تلفن', 'فروشگاه', 'شهر', 'وضعیت احراز', 'تاریخ ارسال مدارک', 'تاریخ بررسی', 'بررسی‌کننده', 'تعداد مدرک', 'دلیل رد', 'کارشناس پرونده', 'منبع'],
    numeric: [8],
    summary: [['کل', fa(leads.length)], ['تأییدشده', fa(count('approved'))], ['منتظر تأیید', fa(count('pending'))], ['منتظر مدارک', fa(count('awaiting'))], ['ردشده', fa(count('rejected'))]],
    rows,
  };
}

// ---------- ۸) مشتریان تازه به تفکیک منبع ----------
async function newCustomers(q) {
  const r = range(q);
  const names = await userNames();
  const where = { createdAt: { gte: r.from, lt: r.to } };
  if (r.userId) where.ownerId = r.userId;
  const leads = await prisma.lead.findMany({ where, orderBy: { createdAt: 'desc' }, select: Object.assign({ createdAt: true, jobType: true, firstPurchaseAt: true }, LEAD_SELECT) });
  const rows = leads.map((l) => [day(l.createdAt), l.channel || 'نامشخص', nameOf(l), l.phone, l.shopName || '', l.city || '', l.jobType || '',
    names.get(l.ownerId) || '', labelOf(KYC_STATUSES, l.kycStatus), l.firstPurchaseAt ? 'خرید کرده' : '—']);
  const byChannel = new Map();
  for (const l of leads) byChannel.set(l.channel || 'نامشخص', (byChannel.get(l.channel || 'نامشخص') || 0) + 1);
  return {
    columns: ['تاریخ ورود', 'منبع', 'مشتری', 'تلفن', 'فروشگاه', 'شهر', 'نوع مشتری', 'کارشناس', 'وضعیت احراز', 'خرید'],
    numeric: [],
    summary: [['مشتری تازه', fa(leads.length)], ['خرید کرده', fa(leads.filter((l) => l.firstPurchaseAt).length)]]
      .concat([...byChannel.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => [k, fa(v)])),
    rows,
  };
}

const REPORTS = {
  sales: { title: 'گزارش فروش‌ها', build: sales },
  inquiries: { title: 'استعلام قیمت بدون خرید', build: inquiries },
  out_of_stock: { title: 'کالای ناموجود درخواستی', build: outOfStock },
  reasons: { title: 'علت عدم خرید و گزارش‌های مشاوران', build: reasons },
  performance: { title: 'عملکرد کارشناس‌ها', build: performance },
  kyc: { title: 'احراز همکاری', build: kyc },
  new_customers: { title: 'مشتریان تازه به تفکیک منبع', build: newCustomers },
};

async function build(kind, q) {
  const def = REPORTS[kind];
  if (!def) throw Object.assign(new Error('گزارش پیدا نشد'), { status: 404 });
  const r = range(q || {});
  const data = await def.build(q || {});
  let userName = '';
  if (r.userId) { const u = await prisma.user.findUnique({ where: { id: r.userId }, select: { fullName: true } }); userName = u ? u.fullName : ''; }
  return Object.assign({ kind, title: def.title, from: r.from.getTime(), to: r.to.getTime(), period: day(r.from) + ' تا ' + day(new Date(r.to.getTime() - 1)), userName }, data);
}

function list() { return Object.entries(REPORTS).map(([kind, d]) => ({ kind, title: d.title })); }

// ---------- اکسل ----------
function toXlsx(rep) {
  const { buildMultiSheetXlsx } = require('../../../shared/xlsx');
  const info = [['گزارش', rep.title], ['بازه', rep.period], ['کارشناس', rep.userName || 'همه'], ['تعداد ردیف', String(rep.rows.length)], ['', '']].concat(rep.summary);
  const rows = rep.footer ? rep.rows.concat([rep.footer]) : rep.rows;
  return buildMultiSheetXlsx([
    { name: 'خلاصه', headers: ['عنوان', 'مقدار'], rows: info },
    { name: 'جزئیات', headers: rep.columns, rows, numericCols: new Set(rep.numeric || []) },
  ]);
}

// ---------- PDF ----------
function esc(s) { return String(s === null || s === undefined ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
function cell(rep, i, v) {
  if ((rep.money || []).includes(i) && v !== '') return fa(String(Math.round(Number(v) || 0)).replace(/\B(?=(\d{3})+(?!\d))/g, ','));
  return Jalali.toFaDigits(String(v === null || v === undefined ? '' : v));
}
function renderHtml(rep, fontFaces) {
  const logo = (() => {
    try { return 'data:image/svg+xml;base64,' + require('fs').readFileSync(require('path').join(__dirname, '../../../public/img/crm-logo.svg')).toString('base64'); } catch (e) { return ''; }
  })();
  const body = rep.rows.length
    ? rep.rows.map((r) => '<tr>' + r.map((v, i) => '<td>' + esc(cell(rep, i, v)) + '</td>').join('') + '</tr>').join('')
    : '<tr><td colspan="' + rep.columns.length + '" class="empty">در این بازه موردی نیست.</td></tr>';
  const foot = rep.footer ? '<tfoot><tr>' + rep.footer.map((v, i) => '<td>' + esc(cell(rep, i, v)) + '</td>').join('') + '</tr></tfoot>' : '';
  return `<!doctype html><html lang="fa" dir="rtl"><head><meta charset="utf-8"><style>
${fontFaces}
@page{size:A4 landscape;margin:12mm 10mm 14mm}
body{margin:0;font-family:Vaz,Tahoma,sans-serif;color:#1f2430;font-size:9.5px;line-height:1.6;-webkit-print-color-adjust:exact;print-color-adjust:exact}
.head{display:flex;align-items:center;gap:12px;border-bottom:2px solid #1b7db8;padding-bottom:8px;margin-bottom:10px}
.head img{height:34px}.head h1{font-size:16px;margin:0}.head .meta{margin-inline-start:auto;text-align:left;color:#555;font-size:10px}
.sum{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:10px}.sum div{border:1px solid #d6dde6;border-radius:6px;padding:4px 10px;background:#f5f8fb}
.sum b{display:block;font-size:12px;color:#1b7db8}
table{width:100%;border-collapse:collapse}thead{display:table-header-group}tr{page-break-inside:avoid}
th{background:#1b7db8;color:#fff;font-weight:700;padding:5px 4px;border:1px solid #1b7db8;text-align:right}
td{padding:4px;border:1px solid #dfe5ec;vertical-align:top;overflow-wrap:anywhere}
tbody tr:nth-child(even) td{background:#f7f9fc}tfoot td{font-weight:700;background:#eaf3fa}
.empty{text-align:center;color:#777;padding:14px}
</style></head><body>
<div class="head">${logo ? '<img src="' + logo + '">' : ''}<div><h1>${esc(rep.title)}</h1><div>CRM نمونه</div></div>
<div class="meta">بازه: ${esc(Jalali.toFaDigits(rep.period))}<br>کارشناس: ${esc(rep.userName || 'همه')}<br>تاریخ تهیه: ${esc(Jalali.toFaDigits(dayTime(new Date())))}</div></div>
<div class="sum">${rep.summary.map(([k, v]) => '<div>' + esc(k) + '<b>' + esc(v) + '</b></div>').join('')}</div>
<table><thead><tr>${rep.columns.map((c) => '<th>' + esc(c) + '</th>').join('')}</tr></thead><tbody>${body}</tbody>${foot}</table>
</body></html>`;
}
async function toPdf(rep) {
  const daily = require('./dailyReportService');
  return daily.toPdf(renderHtml(rep, daily.fontFaces()), { landscape: true, pageNumbers: true });
}

module.exports = { list, build, toXlsx, toPdf, renderHtml, REPORTS };
