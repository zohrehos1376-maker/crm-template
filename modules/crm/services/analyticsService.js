// گزارشات و آمار فروش — همه از فاکتورهای ثبت‌شده (lead_audits با action خرید اول/تکراری).
// مبلغ‌ها در دیتابیس ریال‌اند و این‌جا به همان ریال نمایش داده می‌شوند. خرید حذف‌شده (purchase_deleted) حساب نمی‌شود.
// هر گزارش { title, columns, rows, numeric, money, summary, ... } برمی‌گرداند تا پیش‌نمایش و اکسل یکسان باشند.
const { prisma } = require('../../../shared/prisma');
const { normalizePhone } = require('../../../shared/phone');
const Jalali = require('../../../shared/jalali');

const DAY = 86400000;
const SETTINGS_KEY = 'analytics_rfm';
const DEFAULT_SETTINGS = {
  goldCount: 5,        // طلایی: حداقل تعداد فاکتور
  goldAmount: 1000000000, // طلایی: حداقل جمع خرید (ریال)
  activeDays: 45,      // تا این‌قدر روز از آخرین خرید «فعال» است
  sleepDays: 120,      // بیش از این‌قدر روز بی‌خرید = خواب‌رفته
  churnFactor: 1.5,    // دیرکرد: فاصله‌ی معمول × این عدد گذشته باشد
};

const fa = (n) => Jalali.toFaDigits(String(n));
const day = (d) => (d ? Jalali.formatDate(new Date(d)) : '');
const sep = (n) => fa(String(Math.round(Number(n) || 0)).replace(/\B(?=(\d{3})+(?!\d))/g, ','));
const toman = (n) => sep(n) + ' ریال';
const pct = (a, b) => (b ? Math.round((a / b) * 1000) / 10 : 0);
const pctTxt = (a, b) => fa(pct(a, b)) + '٪';
const daysBetween = (a, b) => Math.floor((b - a) / DAY);
function parseJson(s, def) { try { return s ? JSON.parse(s) : def; } catch (e) { return def; } }

function range(q) {
  const now = Date.now();
  const to = Number(q.to) > 0 ? Number(q.to) : now;
  const from = Number(q.from) > 0 ? Number(q.from) : to - 30 * DAY;
  if (to <= from) throw Object.assign(new Error('بازه‌ی تاریخ نادرست است'), { status: 400 });
  if (to - from > 800 * DAY) throw Object.assign(new Error('بازه‌ی گزارش حداکثر ۸۰۰ روز است'), { status: 400 });
  return { from, to };
}

// ---------- تنظیمات آستانه‌ها ----------
async function getSettings() {
  const row = await prisma.setting.findUnique({ where: { key: SETTINGS_KEY } });
  const saved = row ? parseJson(row.value, {}) : {};
  const out = {};
  for (const k of Object.keys(DEFAULT_SETTINGS)) {
    const v = Number(saved[k]);
    out[k] = Number.isFinite(v) && v > 0 ? v : DEFAULT_SETTINGS[k];
  }
  return out;
}
async function saveSettings(userId, body) {
  const out = {};
  for (const k of Object.keys(DEFAULT_SETTINGS)) {
    const v = Number(String((body || {})[k] ?? '').replace(/[,،\s]/g, ''));
    if (!Number.isFinite(v) || v <= 0) throw Object.assign(new Error('همه‌ی عددها باید بزرگ‌تر از صفر باشند'), { status: 400 });
    out[k] = v;
  }
  if (out.sleepDays <= out.activeDays) throw Object.assign(new Error('روز «خواب‌رفته» باید بیشتر از روز «فعال» باشد'), { status: 400 });
  const value = JSON.stringify(out);
  await prisma.setting.upsert({
    where: { key: SETTINGS_KEY },
    create: { key: SETTINGS_KEY, value, updatedAt: new Date(), updatedBy: userId || null },
    update: { value, updatedAt: new Date(), updatedBy: userId || null },
  });
  memo = null;
  return out;
}

// ---------- داده‌ی پایه: همه‌ی فاکتورها + مشتری‌ها (۳۰ ثانیه حافظه) ----------
let memo = null;
async function load() {
  if (memo && Date.now() - memo.at < 30000) return memo.data;
  const audits = await prisma.leadAudit.findMany({
    where: { action: { in: ['first_purchase', 'purchase'] } },
    select: { id: true, leadId: true, userId: true, createdAt: true, changes: true },
    orderBy: { createdAt: 'asc' },
  });
  const sales = audits.map((a) => {
    const ch = parseJson(a.changes, []);
    const get = (f) => { const c = Array.isArray(ch) ? ch.find((x) => x && x.field === f) : null; return c ? String(c.to ?? '').trim() : ''; };
    const rial = Number(String(get('_salePrice')).replace(/[^\d.]/g, '')) || 0;
    return { id: a.id, leadId: a.leadId, userId: a.userId, at: a.createdAt.getTime(), invoice: get('_saleInvoice'), amount: rial };
  });
  const ids = [...new Set(sales.map((s) => s.leadId))];
  const leadRows = ids.length
    ? await prisma.lead.findMany({ where: { id: { in: ids } }, select: { id: true, customerName: true, phone: true, shopName: true, city: true } })
    : [];
  const leads = new Map(leadRows.map((l) => [l.id, l]));
  // خلاصه‌ی هر مشتری از کل سابقه (برای RFM، دیرکرد و لیست تماس)
  const customers = new Map();
  for (const s of sales) {
    let c = customers.get(s.leadId);
    if (!c) { c = { leadId: s.leadId, lead: leads.get(s.leadId) || null, sales: [], amount: 0 }; customers.set(s.leadId, c); }
    c.sales.push(s);
    c.amount += s.amount;
  }
  for (const c of customers.values()) {
    c.first = c.sales[0].at;
    c.last = c.sales[c.sales.length - 1].at;
    // فاکتورهای یک روز یک «نوبت خرید» حساب می‌شوند تا فاصله‌ی معمول به‌هم نریزد
    const days = [...new Set(c.sales.map((s) => Math.floor((s.at + 12600000) / DAY)))];
    c.visits = days.length;
    c.interval = days.length >= 2 ? (days[days.length - 1] - days[0]) / (days.length - 1) : null;
  }
  const users = await prisma.user.findMany({ select: { id: true, fullName: true } });
  const data = { sales, customers, userNames: new Map(users.map((u) => [u.id, u.fullName])) };
  memo = { at: Date.now(), data };
  return data;
}

const nameOf = (c) => (c.lead && c.lead.customerName) || 'بدون نام';
const phoneOf = (c) => (c.lead && c.lead.phone) || '';
const shopOf = (c) => (c.lead && c.lead.shopName) || '';

function segmentOf(c, st, now) {
  const rec = daysBetween(c.last, now);
  if (rec > st.sleepDays) return 'sleeping';
  if (c.visits <= 1) return 'once';
  if (c.visits >= st.goldCount && c.amount >= st.goldAmount && rec <= st.activeDays) return 'gold';
  if (rec > st.activeDays) return 'risk';
  return 'growing';
}
const SEGMENTS = {
  gold: { label: 'طلایی', hint: 'خرید زیاد و پرمبلغ، اخیراً هم خریده' },
  growing: { label: 'رو به رشد', hint: 'بیش از یک بار خریده و فعال است' },
  risk: { label: 'در معرض ریزش', hint: 'چند بار خریده ولی مدتی است نخریده' },
  sleeping: { label: 'خواب‌رفته', hint: 'مدت زیادی هیچ خریدی نداشته' },
  once: { label: 'یک‌بار خرید', hint: 'فقط یک نوبت خرید داشته' },
};

// وضعیت دیرکرد یک مشتری (فقط برای کسی که حداقل دو نوبت خرید دارد)
function overdueOf(c, st, now) {
  if (!c.interval) return null;
  const interval = Math.max(c.interval, 3); // خریدهای خیلی پشت‌سرهم، هشدار بی‌جا نسازند
  const since = daysBetween(c.last, now);
  const expected = c.last + interval * DAY;
  return { interval, since, expected, late: since > interval * st.churnFactor, lateDays: Math.round(since - interval) };
}

// ---------- ۱) داشبورد ----------
function periodStats(sales, from, to) {
  const list = sales.filter((s) => s.at >= from && s.at < to);
  const amount = list.reduce((t, s) => t + s.amount, 0);
  return { list, amount, count: list.length, buyers: new Set(list.map((s) => s.leadId)).size };
}
// مرز ماه شمسی به میلی‌ثانیه‌ی میلادی (برای سطر «ماهانه»)
function monthRange(jy, jm) {
  const g1 = Jalali.toGregorian(jy, jm, 1);
  const start = new Date(g1.gy, g1.gm - 1, g1.gd).getTime();
  const ny = jm === 12 ? jy + 1 : jy, nm = jm === 12 ? 1 : jm + 1;
  const g2 = Jalali.toGregorian(ny, nm, 1);
  return { start, end: new Date(g2.gy, g2.gm - 1, g2.gd).getTime(), ny, nm };
}
// روند بازه به سطرهای «روزانه»، «هفتگی» (پیش‌فرض) یا «ماهانه» (ماه شمسی کامل) تقسیم می‌شود
function buildTrend(list, from, to, granularity) {
  const out = [];
  if (granularity === 'day') {
    for (let s = from; s < to; s += DAY) {
      const e = Math.min(s + DAY, to);
      const p = periodStats(list, s, e);
      out.push({ from: s, to: e, label: day(s), short: day(s).slice(5), amount: p.amount, count: p.count, buyers: p.buyers });
    }
  } else if (granularity === 'month') {
    const d0 = new Date(from);
    let j = Jalali.toJalali(d0.getFullYear(), d0.getMonth() + 1, d0.getDate());
    let jy = j.jy, jm = j.jm;
    for (let guard = 0; guard < 240; guard += 1) {
      const m = monthRange(jy, jm);
      const s = Math.max(m.start, from), e = Math.min(m.end, to);
      if (s >= to) break;
      const p = periodStats(list, s, e);
      out.push({ from: s, to: e, label: Jalali.MONTH_NAMES[jm - 1] + ' ' + jy, short: Jalali.MONTH_NAMES[jm - 1], amount: p.amount, count: p.count, buyers: p.buyers });
      if (m.end >= to) break;
      jy = m.ny; jm = m.nm;
    }
  } else {
    for (let s = from; s < to; s += 7 * DAY) {
      const e = Math.min(s + 7 * DAY, to);
      const p = periodStats(list, s, e);
      out.push({ from: s, to: e, label: day(s), short: day(s).slice(5), amount: p.amount, count: p.count, buyers: p.buyers });
    }
  }
  return out;
}
async function dashboard(q) {
  const r = range(q);
  const granularity = ['day', 'month'].includes(q.granularity) ? q.granularity : 'week';
  const { sales, customers } = await load();
  const cur = periodStats(sales, r.from, r.to);
  const len = r.to - r.from;
  const prev = periodStats(sales, r.from - len, r.from);
  const newCur = [...customers.values()].filter((c) => c.first >= r.from && c.first < r.to).length;
  const newPrev = [...customers.values()].filter((c) => c.first >= r.from - len && c.first < r.from).length;
  const avg = (p) => (p.count ? p.amount / p.count : 0);
  const change = (a, b) => (b ? Math.round(((a - b) / b) * 1000) / 10 : null);
  const kpis = [
    { key: 'amount', label: 'جمع خرید', value: cur.amount, prev: prev.amount, money: true },
    { key: 'count', label: 'تعداد فاکتور', value: cur.count, prev: prev.count },
    { key: 'buyers', label: 'مشتریان فعال (خریدار)', value: cur.buyers, prev: prev.buyers },
    { key: 'avg', label: 'میانگین هر فاکتور', value: avg(cur), prev: avg(prev), money: true },
    { key: 'new', label: 'مشتری جدید (خرید اول)', value: newCur, prev: newPrev },
  ].map((k) => Object.assign(k, { change: change(k.value, k.prev) }));
  const weeks = buildTrend(cur.list, r.from, r.to, granularity);
  const fmtV = (k, v) => (k.money ? toman(v) : fa(Math.round(v)));
  const trendCol = granularity === 'day' ? 'روز' : granularity === 'month' ? 'ماه' : 'هفته (از)';
  const columns = granularity === 'week'
    ? [trendCol, 'تا', 'جمع خرید (ریال)', 'تعداد فاکتور', 'مشتری خریدار']
    : [trendCol, 'جمع خرید (ریال)', 'تعداد فاکتور', 'مشتری خریدار'];
  const rows = granularity === 'week'
    ? weeks.map((w) => [w.label, day(w.to - 1), Math.round(w.amount), w.count, w.buyers])
    : weeks.map((w) => [w.label, Math.round(w.amount), w.count, w.buyers]);
  const numeric = granularity === 'week' ? [2, 3, 4] : [1, 2, 3];
  const money = granularity === 'week' ? [2] : [1];
  const footer = granularity === 'week'
    ? ['جمع', '', Math.round(cur.amount), cur.count, cur.buyers]
    : ['جمع', Math.round(cur.amount), cur.count, cur.buyers];
  return {
    title: 'داشبورد فروش',
    kpis,
    weeks,
    granularity,
    summary: kpis.map((k) => [k.label, fmtV(k, k.value)]),
    columns,
    numeric, money,
    rows,
    footer,
    compare: kpis.map((k) => [k.label, fmtV(k, k.value), fmtV(k, k.prev), k.change === null ? '—' : fa(k.change) + '٪']),
  };
}

// ---------- ۲) بخش‌بندی مشتریان (RFM) ----------
async function segments(q) {
  const st = await getSettings();
  const { customers } = await load();
  const now = Date.now();
  const counts = {}; const amounts = {};
  Object.keys(SEGMENTS).forEach((k) => { counts[k] = 0; amounts[k] = 0; });
  const filter = q.segment && SEGMENTS[q.segment] ? q.segment : '';
  const rows = [];
  for (const c of customers.values()) {
    const seg = segmentOf(c, st, now);
    counts[seg]++; amounts[seg] += c.amount;
    if (filter && seg !== filter) continue;
    rows.push({ seg, c, row: [nameOf(c), phoneOf(c), shopOf(c), SEGMENTS[seg].label, c.visits, Math.round(c.amount), day(c.last), daysBetween(c.last, now)] });
  }
  const order = ['gold', 'growing', 'risk', 'once', 'sleeping'];
  rows.sort((a, b) => order.indexOf(a.seg) - order.indexOf(b.seg) || b.c.amount - a.c.amount);
  const total = customers.size;
  return {
    title: 'بخش‌بندی مشتریان' + (filter ? ' — ' + SEGMENTS[filter].label : ''),
    settings: st,
    segments: order.map((k) => ({ key: k, label: SEGMENTS[k].label, hint: SEGMENTS[k].hint, count: counts[k], amount: Math.round(amounts[k]), share: pct(counts[k], total) })),
    summary: order.map((k) => [SEGMENTS[k].label, fa(counts[k]) + ' مشتری (' + pctTxt(counts[k], total) + ')']),
    columns: ['مشتری', 'تلفن', 'فروشگاه', 'گروه', 'نوبت خرید', 'جمع خرید (ریال)', 'آخرین خرید', 'روز از آخرین خرید'],
    numeric: [4, 5, 7], money: [5],
    rows: rows.map((x) => x.row),
  };
}

// ---------- ۳) هشدار ریزش ----------
async function churn() {
  const st = await getSettings();
  const { customers } = await load();
  const now = Date.now();
  const list = [];
  for (const c of customers.values()) {
    const o = overdueOf(c, st, now);
    if (!o || !o.late || o.since > st.sleepDays * 3) continue; // خیلی قدیمی‌ها در «خواب‌رفته» دیده می‌شوند
    list.push({ c, o, seg: segmentOf(c, st, now) });
  }
  list.sort((a, b) => b.o.since / b.o.interval - a.o.since / a.o.interval || b.c.amount - a.c.amount);
  return {
    title: 'هشدار ریزش — مشتری‌هایی که از موعد همیشگی خریدشان گذشته',
    summary: [['تعداد مشتری دیرکرده', fa(list.length)], ['جمع خرید سابق این مشتری‌ها', toman(list.reduce((t, x) => t + x.c.amount, 0))], ['معیار', 'گذشتن ' + fa(st.churnFactor) + ' برابر فاصله‌ی معمول']],
    columns: ['مشتری', 'تلفن', 'فروشگاه', 'گروه', 'فاصله‌ی معمول (روز)', 'آخرین خرید', 'روز گذشته', 'دیرکرد (روز)', 'موعد مورد انتظار', 'جمع خرید (ریال)'],
    numeric: [4, 6, 7, 9], money: [9],
    rows: list.map(({ c, o, seg }) => [nameOf(c), phoneOf(c), shopOf(c), SEGMENTS[seg].label, Math.round(o.interval), day(c.last), o.since, o.lateDays, day(o.expected), Math.round(c.amount)]),
  };
}

// ---------- ۴) لیست تماس هفتگی (برای همه‌ی کارشناسان) ----------
async function callList() {
  const st = await getSettings();
  const { customers } = await load();
  const now = Date.now();
  const items = [];
  for (const c of customers.values()) {
    if (!phoneOf(c)) continue;
    const seg = segmentOf(c, st, now);
    const o = overdueOf(c, st, now);
    const since = daysBetween(c.last, now);
    let reason = '', pr = 0;
    if (o && o.late && o.since <= st.sleepDays * 3) {
      reason = 'از موعد همیشگی خرید ' + fa(o.lateDays) + ' روز گذشته (معمولاً هر ' + fa(Math.round(o.interval)) + ' روز)';
      pr = seg === 'gold' || c.visits >= st.goldCount ? 1 : 2;
    } else if (o && o.expected >= now && o.expected < now + 7 * DAY) {
      reason = 'موعد خرید بعدی همین هفته است (' + day(o.expected) + ')';
      pr = seg === 'gold' ? 2 : 3;
    } else if (c.visits === 1 && since >= 14 && since <= 60) {
      reason = 'فقط یک بار خریده (' + fa(since) + ' روز پیش) — تشویق به خرید دوم';
      pr = 2;
    } else if (seg === 'sleeping' && c.visits >= 2 && since <= st.sleepDays * 2) {
      reason = 'مشتری چندباره که ' + fa(since) + ' روز است نخریده — بازگرداندن';
      pr = 3;
    }
    if (!reason) continue;
    items.push({ c, seg, reason, pr, since });
  }
  items.sort((a, b) => a.pr - b.pr || b.c.amount - a.c.amount);
  const PR = { 1: 'فوری', 2: 'مهم', 3: 'عادی' };
  return {
    title: 'لیست تماس هفته',
    summary: [['تعداد تماس پیشنهادی', fa(items.length)], ['فوری', fa(items.filter((x) => x.pr === 1).length)], ['مهم', fa(items.filter((x) => x.pr === 2).length)], ['عادی', fa(items.filter((x) => x.pr === 3).length)]],
    columns: ['اولویت', 'مشتری', 'تلفن', 'فروشگاه', 'گروه', 'آخرین خرید', 'دلیل تماس'],
    numeric: [], money: [],
    leadIds: items.map((x) => x.c.leadId),
    rows: items.map((x) => [PR[x.pr], nameOf(x.c), phoneOf(x.c), shopOf(x.c), SEGMENTS[x.seg].label, day(x.c.last), x.reason]),
  };
}

// ---------- ۵) مشتریان برتر و سهم ۲۰٪ ----------
async function topCustomers(q) {
  const r = range(q);
  const { sales, customers } = await load();
  const per = new Map();
  for (const s of sales) {
    if (s.at < r.from || s.at >= r.to) continue;
    const p = per.get(s.leadId) || { amount: 0, count: 0 };
    p.amount += s.amount; p.count++;
    per.set(s.leadId, p);
  }
  const list = [...per.entries()].map(([id, p]) => ({ c: customers.get(id), p })).sort((a, b) => b.p.amount - a.p.amount);
  const total = list.reduce((t, x) => t + x.p.amount, 0);
  const topN = Math.max(1, Math.ceil(list.length * 0.2));
  const topAmount = list.slice(0, topN).reduce((t, x) => t + x.p.amount, 0);
  let run = 0;
  return {
    title: 'مشتریان برتر',
    summary: list.length
      ? [['تعداد مشتری خریدار', fa(list.length)], ['۲۰٪ برتر', fa(topN) + ' مشتری'], ['سهم ۲۰٪ برتر از فروش', pctTxt(topAmount, total)], ['جمع خرید بازه', toman(total)]]
      : [['تعداد مشتری خریدار', '۰']],
    columns: ['رتبه', 'مشتری', 'تلفن', 'فروشگاه', 'تعداد فاکتور', 'جمع خرید (ریال)', 'سهم از فروش', 'سهم تجمعی', '۲۰٪ برتر'],
    numeric: [0, 4, 5], money: [5],
    rows: list.map((x, i) => { run += x.p.amount; return [i + 1, nameOf(x.c), phoneOf(x.c), shopOf(x.c), x.p.count, Math.round(x.p.amount), pctTxt(x.p.amount, total), pctTxt(run, total), i < topN ? 'بله' : '']; }),
  };
}

// ---------- ۶) مشتریان جدید و نرخ خرید دوم ----------
async function newCustomers(q) {
  const r = range(q);
  const { customers } = await load();
  const now = Date.now();
  const list = [...customers.values()].filter((c) => c.first >= r.from && c.first < r.to).sort((a, b) => b.first - a.first);
  const second = list.filter((c) => c.visits >= 2);
  const gaps = second.map((c) => {
    const d2 = c.sales.find((s) => Math.floor((s.at + 12600000) / DAY) !== Math.floor((c.first + 12600000) / DAY));
    return d2 ? daysBetween(c.first, d2.at) : null;
  }).filter((x) => x !== null);
  const avgGap = gaps.length ? Math.round(gaps.reduce((t, x) => t + x, 0) / gaps.length) : 0;
  return {
    title: 'مشتریان جدید و خرید دوم',
    summary: [['مشتری جدید در بازه', fa(list.length)], ['خرید دوم کرده‌اند', fa(second.length)], ['نرخ خرید دوم', pctTxt(second.length, list.length)], ['میانگین فاصله تا خرید دوم', avgGap ? fa(avgGap) + ' روز' : '—']],
    columns: ['مشتری', 'تلفن', 'فروشگاه', 'تاریخ خرید اول', 'مبلغ خرید اول (ریال)', 'نوبت خرید تا امروز', 'خرید دوم', 'روز از خرید اول'],
    numeric: [4, 5, 7], money: [4],
    rows: list.map((c) => [nameOf(c), phoneOf(c), shopOf(c), day(c.first), Math.round(c.sales[0].amount), c.visits, c.visits >= 2 ? 'بله' : 'هنوز نه', daysBetween(c.first, now)]),
  };
}

// ---------- ۷) فروش ثبت‌شده به تفکیک کارشناس (مشتری‌ها مال کل مجموعه‌اند؛ این فقط ثبت‌کننده‌ی فاکتور است) ----------
async function team(q) {
  const r = range(q);
  const { sales, userNames, customers } = await load();
  const per = new Map();
  for (const s of sales) {
    if (s.at < r.from || s.at >= r.to) continue;
    const k = s.userId || '';
    const p = per.get(k) || { amount: 0, count: 0, buyers: new Set(), firsts: 0 };
    p.amount += s.amount; p.count++; p.buyers.add(s.leadId);
    const c = customers.get(s.leadId);
    if (c && c.sales[0].id === s.id) p.firsts++;
    per.set(k, p);
  }
  const list = [...per.entries()].sort((a, b) => b[1].amount - a[1].amount);
  const total = list.reduce((t, [, p]) => t + p.amount, 0);
  return {
    title: 'فروش ثبت‌شده به تفکیک کارشناس',
    summary: [['تعداد کارشناس ثبت‌کننده', fa(list.length)], ['جمع خرید بازه', toman(total)]],
    columns: ['کارشناس', 'تعداد فاکتور', 'جمع مبلغ (ریال)', 'میانگین فاکتور (ریال)', 'مشتری خریدار', 'خرید اول مشتری', 'سهم از فروش'],
    numeric: [1, 2, 3, 4, 5], money: [2, 3],
    rows: list.map(([id, p]) => [userNames.get(id) || 'نامشخص', p.count, Math.round(p.amount), Math.round(p.amount / p.count), p.buyers.size, p.firsts, pctTxt(p.amount, total)]),
  };
}

// ---------- ۸) کیفیت داده ----------
async function quality(q) {
  const r = range(q);
  const { sales, customers } = await load();
  const inRange = sales.filter((s) => s.at >= r.from && s.at < r.to);
  const rows = [];
  const cName = (s) => { const c = customers.get(s.leadId); return c ? nameOf(c) : ''; };
  const cPhone = (s) => { const c = customers.get(s.leadId); return c ? phoneOf(c) : ''; };
  // شماره فاکتور تکراری (در کل سابقه، برای فاکتورهای این بازه)
  const byInv = new Map();
  for (const s of sales) { if (!s.invoice) continue; const k = s.invoice.replace(/\s/g, ''); byInv.set(k, (byInv.get(k) || []).concat(s)); }
  let dupInv = 0, noInv = 0, odd = 0;
  for (const s of inRange) {
    const same = s.invoice ? byInv.get(s.invoice.replace(/\s/g, '')) : null;
    if (same && same.length > 1) { dupInv++; rows.push(['شماره فاکتور تکراری', day(s.at), cName(s), cPhone(s), s.invoice, Math.round(s.amount), 'این شماره ' + fa(same.length) + ' بار ثبت شده']); }
    if (!s.invoice) { noInv++; rows.push(['بدون شماره فاکتور', day(s.at), cName(s), cPhone(s), '', Math.round(s.amount), 'شماره فاکتور وارد نشده']); }
  }
  // مبلغ غیرعادی: صفر/خالی، یا بیش از ۱۰ برابر / کمتر از یک‌دهم میانه‌ی همه‌ی فاکتورها
  const amounts = sales.map((s) => s.amount).filter((x) => x > 0).sort((a, b) => a - b);
  const median = amounts.length ? amounts[Math.floor(amounts.length / 2)] : 0;
  for (const s of inRange) {
    let why = '';
    if (!s.amount) why = 'مبلغ وارد نشده یا صفر است';
    else if (median && amounts.length >= 10 && s.amount > median * 10) why = 'بیش از ۱۰ برابر فاکتور معمول (' + toman(median) + ')';
    else if (median && amounts.length >= 10 && s.amount < median / 10) why = 'کمتر از یک‌دهم فاکتور معمول (' + toman(median) + ')';
    if (why) { odd++; rows.push(['مبلغ غیرعادی', day(s.at), cName(s), cPhone(s), s.invoice, Math.round(s.amount), why]); }
  }
  // مشتری تکراری: شماره‌ی یکسان، یا فروشگاه هم‌نام در یک شهر
  const leads = await prisma.lead.findMany({ select: { id: true, customerName: true, phone: true, shopName: true, city: true } });
  const groups = new Map();
  const add = (k, l, why) => { if (!groups.has(k)) groups.set(k, { why, list: [] }); groups.get(k).list.push(l); };
  for (const l of leads) {
    const p = normalizePhone(l.phone);
    if (p && p.length >= 8) add('p:' + p, l, 'شماره‌ی یکسان');
    const shop = String(l.shopName || '').replace(/[\s‌]+/g, '').replace(/ي/g, 'ی').replace(/ك/g, 'ک');
    if (shop.length >= 3) add('s:' + shop + '|' + String(l.city || '').trim(), l, 'فروشگاه هم‌نام در یک شهر');
  }
  let dupCust = 0;
  for (const g of groups.values()) {
    // گروه خیلی بزرگ فروشگاه هم‌نام معمولاً نام عمومی است (مثل «فروشگاه همکار»)، نه تکراری
    if (g.list.length < 2 || (g.why !== 'شماره‌ی یکسان' && g.list.length > 3)) continue;
    dupCust++;
    rows.push(['مشتری تکراری احتمالی', '', g.list.map((l) => l.customerName || 'بدون نام').join(' / '), g.list.map((l) => l.phone).join(' / '), '', '', g.why + (g.list[0].shopName ? ' — ' + g.list[0].shopName : '')]);
  }
  return {
    title: 'کیفیت داده‌ها',
    summary: [['فاکتور با شماره‌ی تکراری', fa(dupInv)], ['فاکتور بدون شماره', fa(noInv)], ['مبلغ غیرعادی', fa(odd)], ['گروه مشتری تکراری احتمالی', fa(dupCust)]],
    columns: ['نوع مشکل', 'تاریخ', 'مشتری', 'تلفن', 'شماره فاکتور', 'مبلغ (ریال)', 'توضیح'],
    numeric: [5], money: [5],
    rows,
  };
}

const REPORTS = {
  dashboard: { title: 'داشبورد فروش', build: dashboard, perm: 'analytics', ranged: true },
  segments: { title: 'بخش‌بندی مشتریان', build: segments, perm: 'analytics' },
  churn: { title: 'هشدار ریزش', build: churn, perm: 'analytics' },
  calls: { title: 'لیست تماس هفته', build: callList, perm: null },
  top: { title: 'مشتریان برتر', build: topCustomers, perm: 'analytics', ranged: true },
  newcust: { title: 'مشتریان جدید و خرید دوم', build: newCustomers, perm: 'analytics', ranged: true },
  team: { title: 'فروش به تفکیک کارشناس', build: team, perm: 'performance', ranged: true },
  quality: { title: 'کیفیت داده‌ها', build: quality, perm: 'analytics', ranged: true },
};

async function build(kind, q) {
  const def = REPORTS[kind];
  if (!def) throw Object.assign(new Error('گزارش ناشناخته'), { status: 404 });
  const rep = await def.build(q || {});
  let period = 'تا امروز';
  if (def.ranged) { const r = range(q || {}); period = day(r.from) + ' تا ' + day(r.to - 1); }
  return Object.assign({ kind, period }, rep);
}

function toXlsx(rep) {
  const { buildMultiSheetXlsx } = require('../../../shared/xlsx');
  const info = [['گزارش', rep.title], ['بازه', rep.period], ['تعداد ردیف', String(rep.rows.length)], ['', '']].concat(rep.summary || []);
  const sheets = [{ name: 'خلاصه', headers: ['عنوان', 'مقدار'], rows: info }];
  if (rep.compare) sheets.push({ name: 'مقایسه', headers: ['شاخص', 'این بازه', 'بازه‌ی قبل', 'تغییر'], rows: rep.compare });
  sheets.push({ name: 'جزئیات', headers: rep.columns, rows: rep.footer ? rep.rows.concat([rep.footer]) : rep.rows, numericCols: new Set(rep.numeric || []) });
  return buildMultiSheetXlsx(sheets);
}

module.exports = { REPORTS, build, toXlsx, getSettings, saveSettings, DEFAULT_SETTINGS, _segmentOf: segmentOf, _overdueOf: overdueOf };
