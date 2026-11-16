// «گزارش روزانه‌ی مدیران» — PDF یک‌صفحه‌ای از کار امروزِ کل تیم فروش + کارهای مدیر CRM.
// هر شب ساعت ۲۲ (scripts/daily-report.js با cron) ساخته و به چت بله‌ی مدیر CRM فرستاده می‌شود؛
// از داشبورد مدیریتی هم برای هر روز دلخواه دانلود می‌شود.
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');
const { prisma } = require('../../../shared/prisma');
const Jalali = require('../../../shared/jalali');
const repStats = require('./repStatsService');
const heatService = require('./heatService');
const { UNCONFIRMED_MARK } = require('../lib/followup-marks');

const DAY = 86400000;
const OFF = 3.5 * 3600000; // تهران
const WON = 'فروش موفق';
const LOST = 'فروش ناموفق';
const VISIT = 'مراجعه حضوری';
const CLOSED = [WON, LOST];
const WEEKDAYS = ['یکشنبه', 'دوشنبه', 'سه‌شنبه', 'چهارشنبه', 'پنجشنبه', 'جمعه', 'شنبه'];
const APP_DIR = path.join(__dirname, '..', '..', '..');
const NOTE_PREFIX = 'dailyNote:';
const STATUS_KEY = 'dailyReportStatus';

const fa = (n) => Jalali.toFaDigits(String(n == null ? 0 : n));
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const dayStart = (ms) => Math.floor((ms + OFF) / DAY) * DAY - OFF;
// کلید روز به شکل YYYY-MM-DD میلادیِ تقویم تهران
const dayKey = (ms) => new Date(ms + OFF).toISOString().slice(0, 10);
function parseDay(s) {
  if (!s) return dayStart(Date.now());
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s));
  if (!m) return dayStart(Date.now());
  return Date.UTC(+m[1], +m[2] - 1, +m[3]) - OFF;
}
function jDate(ms) {
  const d = new Date(ms + OFF);
  const j = Jalali.toJalali(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
  return { j, label: WEEKDAYS[d.getUTCDay()] + ' ' + fa(j.jd) + ' ' + Jalali.MONTH_NAMES[j.jm - 1] + ' ' + fa(j.jy) };
}
function monthStart(ms) {
  const { j } = jDate(ms);
  const g = Jalali.toGregorian(j.jy, j.jm, 1);
  return Date.UTC(g.gy, g.gm - 1, g.gd) - OFF;
}
function talk(sec) {
  const m = Math.round((sec || 0) / 60);
  if (m < 60) return fa(m) + ' دقیقه';
  return fa(Math.floor(m / 60)) + ' ساعت' + (m % 60 ? ' و ' + fa(m % 60) + ' دقیقه' : '');
}

async function readJson(key) {
  const row = await prisma.setting.findUnique({ where: { key } });
  if (!row) return null;
  try { return JSON.parse(row.value); } catch (e) { return null; }
}
async function writeJson(key, value, userId) {
  const data = { value: JSON.stringify(value), updatedAt: new Date(), updatedBy: userId || null };
  await prisma.setting.upsert({ where: { key }, create: Object.assign({ key }, data), update: data });
}

// ---------- یادداشت دستی «کارهای امروز من» ----------
async function getNote(dateStr) {
  const n = await readJson(NOTE_PREFIX + dayKey(parseDay(dateStr)));
  return { date: dayKey(parseDay(dateStr)), text: (n && n.text) || '', updatedAt: (n && n.updatedAt) || null };
}
async function saveNote(dateStr, text, userId) {
  const key = NOTE_PREFIX + dayKey(parseDay(dateStr));
  await writeJson(key, { text: String(text || '').slice(0, 4000), updatedAt: Date.now() }, userId);
  return getNote(dateStr);
}

// ---------- آمار یک بازه ----------
async function periodStats(from, to) {
  const range = { gte: new Date(from), lt: new Date(to) };
  const [leads, calls, answered, unlogged, followups, kariz, won, lost, visits] = await Promise.all([
    prisma.lead.count({ where: { createdAt: range } }),
    prisma.callLog.groupBy({ by: ['direction'], where: { startedAt: range }, _count: { _all: true }, _sum: { durationSec: true } }),
    prisma.callLog.count({ where: { startedAt: range, durationSec: { gt: 0 } } }),
    prisma.callLog.count({ where: { startedAt: range, durationSec: { gt: 0 }, logStatus: 'UNLOGGED', direction: { in: ['INCOMING', 'OUTGOING'] } } }),
    prisma.followup.count({ where: { createdAt: range, NOT: { content: { contains: UNCONFIRMED_MARK } } } }),
    prisma.pipelineItemLog.count({ where: { createdAt: range } }),
    prisma.leadStatusHistory.findMany({
      where: { newStatus: WON, changedAt: range },
      distinct: ['leadId'],
      select: { lead: { select: { customerName: true, owner: { select: { fullName: true } } } } },
    }),
    prisma.leadStatusHistory.findMany({ where: { newStatus: LOST, changedAt: range }, distinct: ['leadId'], select: { leadId: true } }),
    prisma.leadStatusHistory.findMany({ where: { newStatus: VISIT, changedAt: range }, distinct: ['leadId'], select: { leadId: true } }),
  ]);
  const c = { total: 0, incoming: 0, outgoing: 0, missed: 0, talkSec: 0, answered, unlogged };
  for (const g of calls) {
    c.total += g._count._all;
    c.talkSec += g._sum.durationSec || 0;
    if (g.direction === 'INCOMING') c.incoming += g._count._all;
    else if (g.direction === 'OUTGOING') c.outgoing += g._count._all;
    else c.missed += g._count._all;
  }
  return {
    leads,
    calls: c,
    followups: followups + kariz,
    won: won.map((w) => ({
      customer: (w.lead && w.lead.customerName) || 'مشتری',
      rep: (w.lead && w.lead.owner && w.lead.owner.fullName) || '',
    })),
    lost: lost.length,
    visits: visits.length,
  };
}

// ---------- کارهای مدیر CRM در آن روز ----------
function systemChanges(from, to) {
  try {
    const out = execFileSync('git', ['log', '--since=@' + Math.floor(from / 1000), '--until=@' + Math.floor(to / 1000), '--format=%s'], {
      cwd: APP_DIR,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    return out.split('\n').map((s) => s.trim()).filter((s) => s && !/^progress:/i.test(s) && !/^Merge /.test(s) && !/claude/i.test(s));
  } catch (e) {
    return [];
  }
}
// کارنامه‌ی نوشته‌شده برای مدیر (docs/worklog.md): هر کار = عنوان | چه شد | فایده
function worklog(key) {
  try {
    const lines = fs.readFileSync(path.join(APP_DIR, 'docs', 'worklog.md'), 'utf8').split(/\r?\n/);
    const out = [];
    let on = false;
    for (const l of lines) {
      const h = /^##\s+(\d{4}-\d{2}-\d{2})/.exec(l);
      if (h) { on = h[1] === key; continue; }
      if (on && /^-\s+/.test(l)) {
        const [title, what, why] = l.replace(/^-\s+/, '').split('|').map((x) => (x || '').trim());
        if (title) out.push({ title, what, why });
      }
    }
    return out;
  } catch (e) {
    return [];
  }
}
function mergesCount(from, to) {
  const dir = path.join(process.env.BACKUP_DIR || '', 'lead-merges');
  try {
    return fs.readdirSync(dir).filter((f) => {
      const t = fs.statSync(path.join(dir, f)).mtimeMs;
      return t >= from && t < to;
    }).length;
  } catch (e) {
    return 0;
  }
}

async function collect(dateStr) {
  const from = parseDay(dateStr);
  const to = from + DAY;
  const now = Date.now();
  const ms = monthStart(from);
  const [today, yesterday, month, rs] = await Promise.all([
    periodStats(from, to),
    periodStats(from - DAY, from),
    periodStats(ms, to),
    repStats.daily({ from, to: Math.min(to - 1, now) }),
  ]);
  const open = await prisma.lead.findMany({ where: { status: { notIn: CLOSED } }, select: { id: true, status: true } });
  const heat = await heatService.heatFor(open);
  let hot = 0;
  const warm = 0; // «داغ» حذف شد
  for (const h of heat.values()) if (h.level === 'warm') hot++;
  const [overdue, missedOpen, newUsers, newClub] = await Promise.all([
    prisma.lead.count({ where: { status: { notIn: CLOSED }, nextFollowUpDate: { lt: new Date(dayStart(now)) } } }),
    prisma.callLog.count({ where: { startedAt: { gte: new Date(now - 7 * DAY) }, direction: { in: ['MISSED', 'REJECTED'] }, callbackDone: false } }),
    prisma.user.count({ where: { createdAt: { gte: new Date(from), lt: new Date(to) } } }),
    prisma.clubMember.count({ where: { createdAt: { gte: new Date(from), lt: new Date(to) } } }).catch(() => 0),
  ]);
  const note = await getNote(dayKey(from));
  return {
    date: jDate(from).label,
    monthName: Jalali.MONTH_NAMES[jDate(from).j.jm - 1],
    generatedAt: now,
    today,
    yesterday,
    month,
    now: { hot, warm, overdue, missedOpen },
    // کارهای هر کارشناس در همین روز — بدون نمره و رتبه (repStatsService)
    reps: rs.reps,
    repTeam: rs.total,
    admin: {
      log: worklog(dayKey(from)),
      changes: systemChanges(from, to),
      merges: mergesCount(from, to),
      newUsers,
      newClub,
      note: note.text,
    },
  };
}

// ---------- HTML ----------
function fontFaces() {
  const dirs = [path.join(APP_DIR, 'fonts'), path.join(APP_DIR, 'public', 'fonts')];
  const faces = [['Regular', 400], ['Medium', 500], ['Bold', 700]];
  return faces.map(([n, w]) => {
    for (const d of dirs) {
      const f = path.join(d, 'Vazirmatn-' + n + '.woff2');
      if (fs.existsSync(f)) return "@font-face{font-family:Vaz;font-weight:" + w + ";src:url(data:font/woff2;base64," + fs.readFileSync(f).toString('base64') + ") format('woff2')}";
    }
    return '';
  }).join('\n');
}

function delta(a, b) {
  if (a === b) return '<span class="d same">مثل دیروز</span>';
  const up = a > b;
  return '<span class="d ' + (up ? 'up' : 'down') + '">' + (up ? '▲ ' : '▼ ') + fa(Math.abs(a - b)) + ' نسبت به دیروز</span>';
}

function renderHtml(d) {
  const t = d.today;
  const y = d.yesterday;
  const tile = (label, n, sub, small) => '<div class="tile"><span class="tl">' + label + '</span><b' + (small ? ' class="sm"' : '') + '>' + n + '</b><span class="ts">' + (sub || '') + '</span></div>';
  const attention = [
    [d.now.missedOpen, 'تماس بی‌پاسخ بدون تماس برگشتی (۷ روز اخیر)'],
    [t.calls.unlogged, 'تماس وصل‌شده‌ی امروز که فرمش ثبت نشده'],
    [d.now.overdue, 'پیگیری عقب‌افتاده'],
  ];
  const repRow = (r, nm) => '<tr><td class="nm">' + nm + '</td><td>' + fa(r.calls) + '</td><td>' + (r.talkSec ? talk(r.talkSec) : '—') + '</td><td>' + fa(r.callbacks) +
    '</td><td>' + fa(r.priceInquiry) + '</td><td>' + fa(r.objection) + '</td><td>' + fa(r.outOfStock) + '</td><td>' + fa(r.followups) + '</td><td>' + fa(r.named) +
    '</td><td>' + fa(r.kycApproved) + '</td></tr>';
  const team = d.repTeam;
  const repRows = (d.reps.length ? d.reps.map((r) => repRow(r, esc(r.name))).join('') : '<tr><td colspan="10" class="muted">امروز کاری ثبت نشده است.</td></tr>') +
    repRow(team, '<b>کل تیم</b><small>بی‌پاسخ ' + fa(team.missed) + ' · بی‌جواب مانده ' + fa(team.missedOpen) + '</small>');
  const a = d.admin;
  const adminItems = [];
  // کارهای روز به زبان مدیر (docs/worklog.md)؛ اگر برای این روز چیزی نوشته نشده، فهرست تغییرات سیستم
  const logHtml = a.log.length
    ? '<div class="wl">' + a.log.map((w) => '<div class="wli"><b>' + esc(w.title) + '</b>' + (w.what ? '<p>' + esc(w.what) + '</p>' : '') +
        (w.why ? '<p class="why">فایده: ' + esc(w.why) + '</p>' : '') + '</div>').join('') + '</div>'
    : '';
  if (!a.log.length) a.changes.slice(0, 8).forEach((c) => adminItems.push('<li>' + esc(c) + '</li>'));
  if (a.newUsers) adminItems.push('<li>ساخت ' + fa(a.newUsers) + ' کاربر تازه</li>');
  if (a.merges) adminItems.push('<li>ادغام ' + fa(a.merges) + ' گروه سرنخ تکراری</li>');
  if (a.newClub) adminItems.push('<li>افزودن ' + fa(a.newClub) + ' عضو به باشگاه مشتریان</li>');
  const noteHtml = a.note ? '<div class="note"><b>کارهای دیگر امروز:</b><br>' + esc(a.note).replace(/\n/g, '<br>') + '</div>' : '';

  return '<!doctype html><html lang="fa" dir="rtl"><head><meta charset="utf-8"><style>' + fontFaces() + `
@page{size:A4;margin:0}
*{box-sizing:border-box}
body{margin:0;font-family:Vaz,Tahoma,sans-serif;color:#26221b;font-size:11.5px;line-height:1.75;-webkit-print-color-adjust:exact;print-color-adjust:exact}
.page{padding:11mm 12mm 8mm}
.top{display:flex;justify-content:space-between;align-items:flex-end;border-bottom:3px solid #a37a22;padding-bottom:8px;margin-bottom:12px}
.top h1{margin:0;font-size:20px;font-weight:700}
.top .dt{font-size:13px;color:#76570f;font-weight:700}
.top .br{font-size:10.5px;color:#7a705f}
h2{font-size:13px;margin:10px 0 6px;color:#76570f;font-weight:700}
.tiles{display:grid;grid-template-columns:repeat(4,1fr);gap:7px}
.tile{border:1px solid #e2dccf;border-radius:7px;padding:7px 9px;background:#fffdf8}
.tile .tl{display:block;font-size:10.5px;color:#675e4f}
.tile b{display:block;font-size:21px;line-height:1.35;color:#26221b}
.tile b.sm{font-size:15px;line-height:1.95}
.tile .ts{display:block;font-size:9.5px;color:#7a705f;min-height:14px}
.d{font-weight:700}.d.up{color:#2f7a4a}.d.down{color:#b0451d}.d.same{color:#7a705f}
.wins{background:#e8f4ec;border-radius:7px;padding:7px 10px}
.wins div{padding:2px 0}
.att{display:grid;grid-template-columns:repeat(3,1fr);gap:7px}
.att div{background:#fbeadb;border-radius:7px;padding:6px 9px}
.att div.ok{background:#e8f4ec}
.att b{font-size:17px;color:#a4561c;margin-inline-end:6px}
.att div.ok b{color:#2f7a4a}
table{width:100%;border-collapse:collapse;font-size:10.5px}
th{background:#f1e5c4;color:#4d3a0d;font-weight:700;padding:5px 6px;text-align:center}
td{padding:5px 6px;border-bottom:1px solid #ece6d8;text-align:center}
td.nm{text-align:right;font-weight:700}
td.nm .nc{font-size:9.5px;font-weight:400;color:#2f7a4a}
td.nm small{display:block;font-weight:400;color:#8a7f6c;font-size:9.5px}
td.sc{font-weight:700;color:#76570f}
td.mw{font-weight:700;color:#2f7a4a}
tr.idle td{color:#9a917f}
.month{display:flex;gap:16px;flex-wrap:wrap;background:#fffdf8;border:1px solid #e2dccf;border-radius:7px;padding:7px 10px}
.month span b{font-size:14px}
.admin{border:1px solid #e2dccf;border-radius:7px;padding:8px 12px;background:#fffdf8;font-size:10.5px;line-height:1.6}
.admin ul{margin:0;padding-inline-start:16px}
.admin li{margin:1px 0}
.note{margin-top:6px;border-top:1px dashed #d9cfb8;padding-top:6px}
.wl{display:flex;flex-direction:column;gap:6px}
.wli{border-bottom:1px solid #eee6d4;padding-bottom:5px;break-inside:avoid}
.wli:last-child{border-bottom:0}
.wli b{font-size:11.5px;color:#26221b}
.wli p{margin:1px 0 0}
.wli .why{color:#2f7a4a}
.admin ul{margin-top:6px}
h2{break-after:avoid}
.tiles,.att,table,.month{break-inside:avoid}
.muted{color:#8a7f6c}
.foot{margin-top:6px;font-size:9px;color:#9a917f;text-align:center}
</style></head><body><div class="page">
<div class="top"><div><h1>گزارش روزانه‌ی فروش CRM نمونه</h1><div class="br">CRM نمونه · سامانه‌ی CRM</div></div><div class="dt">` + esc(d.date) + `</div></div>

<h2>امروز در یک نگاه</h2>
<div class="tiles">` +
    tile('فروش موفق', fa(t.won.length), delta(t.won.length, y.won.length)) +
    tile('سرنخ تازه', fa(t.leads), delta(t.leads, y.leads)) +
    tile('مراجعه‌ی حضوری', fa(t.visits), delta(t.visits, y.visits)) +
    tile('پیگیری ثبت‌شده', fa(t.followups), delta(t.followups, y.followups)) +
    tile('کل تماس‌ها', fa(t.calls.total), 'ورودی ' + fa(t.calls.incoming) + ' · خروجی ' + fa(t.calls.outgoing) + ' · بی‌پاسخ ' + fa(t.calls.missed)) +
    tile('مدت مکالمه', talk(t.calls.talkSec), fa(t.calls.answered) + ' تماس وصل‌شده', true) +
    tile('🌤 لید گرم', fa(d.now.hot), 'چند نشانه‌ی خرید در ۷ روز اخیر') +
    tile('فروش ناموفق', fa(t.lost), '') +
    `</div>

<h2>🏆 فروش‌های امروز</h2>` +
    (t.won.length
      ? '<div class="wins">' + t.won.map((w) => '<div>✔ <b>' + esc(w.customer) + '</b>' + (w.rep ? ' · کارشناس: ' + esc(w.rep) : '') + '</div>').join('') + '</div>'
      : '<div class="muted">امروز فروش موفقی ثبت نشده است.</div>') +
    `

<h2>⚠️ نیاز به توجه</h2>
<div class="att">` + attention.map(([n, l]) => '<div class="' + (n ? '' : 'ok') + '"><b>' + fa(n) + '</b>' + l + '</div>').join('') + `</div>

<h2>کارهای کارشناس‌ها امروز</h2>
<table><thead><tr><th>کارشناس</th><th>تماس ثبت‌شده</th><th>مکالمه</th><th>جواب به بی‌پاسخ</th><th>استعلام قیمت</th><th>اعتراض</th><th>ناموجود</th><th>پیگیری</th><th>نام‌گذاری شماره</th><th>احراز تأییدشده</th></tr></thead><tbody>` +
    repRows + `</tbody></table>

<h2>از ابتدای ` + esc(d.monthName) + ` تا امروز</h2>
<div class="month"><span>فروش موفق: <b>` + fa(d.month.won.length) + `</b></span><span>سرنخ تازه: <b>` + fa(d.month.leads) + `</b></span><span>مراجعه‌ی حضوری: <b>` + fa(d.month.visits) + `</b></span><span>تماس: <b>` + fa(d.month.calls.total) + `</b></span><span>پیگیری: <b>` + fa(d.month.followups) + `</b></span></div>

<h2>کارهای مدیر CRM امروز</h2>
<div class="admin">` + logHtml + (adminItems.length ? '<ul>' + adminItems.join('') + '</ul>' : '') + noteHtml +
    (!a.log.length && !adminItems.length && !a.note ? '<span class="muted">برای امروز کاری ثبت نشده است.</span>' : '') + `</div>

<div class="foot">ساخته‌شده خودکار از CRM نمونه · امتیاز هر کارشناس از ۱۰۰ و نسبت به بهترینِ تیم در همان روز است (نیمی از امتیاز = فروش موفق). کارشناس‌های ماه اول (🌱) بعد از کارشناس‌های باسابقه رتبه می‌گیرند.</div>
</div></body></html>`;
}

// ---------- PDF ----------
function findChrome() {
  if (process.env.CHROME_PATH && fs.existsSync(process.env.CHROME_PATH)) return process.env.CHROME_PATH;
  const base = path.join(os.homedir(), '.cache', 'puppeteer', 'chrome-headless-shell');
  try {
    for (const v of fs.readdirSync(base).sort().reverse()) {
      for (const sub of fs.readdirSync(path.join(base, v))) {
        for (const exe of ['chrome-headless-shell', 'chrome-headless-shell.exe']) {
          const p = path.join(base, v, sub, exe);
          if (fs.existsSync(p)) return p;
        }
      }
    }
  } catch (e) {}
  const win = ['C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'];
  return win.find((p) => fs.existsSync(p)) || null;
}

async function toPdf(html, opts) {
  const exe = findChrome();
  if (!exe) throw Object.assign(new Error('مرورگر سازنده‌ی PDF روی سرور نصب نیست'), { status: 500 });
  const puppeteer = require('puppeteer-core');
  const browser = await puppeteer.launch({ executablePath: exe, headless: true, args: ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage'] });
  try {
    const page = await browser.newPage();
    // صفحه هیچ درخواست بیرونی ندارد (فونت‌ها داخل خود HTML است)
    await page.setRequestInterception(true);
    page.on('request', (r) => (r.url().startsWith('data:') || r.url() === 'about:blank' ? r.continue() : r.abort()));
    await page.setContent(html, { waitUntil: 'load' });
    await page.evaluate(() => document.fonts.ready);
    // اندازه‌ی واقعی A4؛ روزهای پرکار به صفحه‌ی دوم می‌رود تا متن کامل و خوانا بماند
    return Buffer.from(await page.pdf(Object.assign({ format: 'A4', printBackground: true, preferCSSPageSize: true }, opts && opts.landscape ? { landscape: true } : {},
      // شماره‌ی صفحه پایین هر صفحه (گزارش‌های چندصفحه‌ای)
      opts && opts.pageNumbers ? { displayHeaderFooter: true, headerTemplate: '<span></span>', footerTemplate: '<div style="width:100%;text-align:center;font-size:8px;color:#888"><span class="pageNumber"></span> / <span class="totalPages"></span></div>' } : {})));
  } finally {
    await browser.close();
  }
}

async function buildPdf(dateStr) {
  const data = await collect(dateStr);
  return { pdf: await toPdf(renderHtml(data)), data, fileName: 'crm-daily-' + dayKey(parseDay(dateStr)) + '.pdf' };
}

// ---------- ارسال به بله ----------
// همان ربات «پشتیبان در بله»؛ مقصد: بله‌ی شخصی مدیر CRM (dailyReportChat) — اگر تنظیم نشده، همان چت پشتیبان
const CHAT_KEY = 'dailyReportChat';
async function chatInfo() {
  const b = (await readJson('backupBale')) || {};
  const own = (await readJson(CHAT_KEY)) || {};
  return { token: b.token || '', chatId: own.chatId || b.chatId || '', chatTitle: own.chatId ? own.chatTitle || '' : b.chatTitle || '', personal: !!own.chatId };
}
async function publicChat() {
  const c = await chatInfo();
  let bot = '';
  if (c.token) {
    try {
      const j = await (await fetch('https://tapi.bale.ai/bot' + c.token + '/getMe', { signal: AbortSignal.timeout(15000) })).json();
      bot = (j.result && j.result.username) || '';
    } catch (e) {}
  }
  return { ready: !!(c.token && c.chatId), chatTitle: c.chatTitle, personal: c.personal, bot };
}
// مدیر از بله‌ی شخصی‌اش به ربات پیام می‌دهد؛ آخرین چت خصوصی که پیام داده مقصد گزارش می‌شود
async function linkChat(userId) {
  const c = await chatInfo();
  if (!c.token) throw Object.assign(new Error('اول ربات بله را در تنظیمات ← «پشتیبان در بله» تعریف کنید'), { status: 400 });
  const j = await (await fetch('https://tapi.bale.ai/bot' + c.token + '/getUpdates', { signal: AbortSignal.timeout(20000) })).json();
  const msgs = ((j && j.result) || []).map((u) => u.message).filter((m) => m && m.chat && m.chat.type === 'private');
  const last = msgs[msgs.length - 1];
  if (!last) throw Object.assign(new Error('پیامی پیدا نشد — از بله‌ی شخصی‌تان به ربات یک پیام (مثلاً «سلام») بفرستید و دوباره بزنید'), { status: 400 });
  const title = [last.chat.first_name, last.chat.last_name].filter(Boolean).join(' ') || last.chat.username || '';
  await writeJson(CHAT_KEY, { chatId: String(last.chat.id), chatTitle: title }, userId);
  return publicChat();
}

async function sendToBale(dateStr) {
  const c = await chatInfo();
  if (!c.token || !c.chatId) return { skipped: true, reason: 'ربات بله در تنظیمات ← «پشتیبان در بله» تعریف نشده' };
  const { pdf, data, fileName } = await buildPdf(dateStr);
  const t = data.today;
  const caption = '📊 گزارش روزانه‌ی فروش نمونه — ' + data.date + '\n' +
    'فروش: ' + fa(t.won.length) + ' · سرنخ: ' + fa(t.leads) + ' · تماس: ' + fa(t.calls.total) + ' · پیگیری: ' + fa(t.followups);
  const form = new FormData();
  form.append('chat_id', c.chatId);
  form.append('caption', caption);
  form.append('document', new Blob([pdf], { type: 'application/pdf' }), fileName);
  try {
    const res = await fetch('https://tapi.bale.ai/bot' + c.token + '/sendDocument', { method: 'POST', body: form, signal: AbortSignal.timeout(60000) });
    const j = await res.json().catch(() => ({}));
    if (!res.ok || j.ok === false) throw new Error('بله خطا داد: ' + (j.description || res.status));
    await writeJson(STATUS_KEY, { lastSentAt: Date.now(), lastDate: data.date, lastError: '' });
    return { sent: true, date: data.date, bytes: pdf.length };
  } catch (e) {
    await writeJson(STATUS_KEY, { lastError: e.message, lastErrorAt: Date.now() });
    throw e;
  }
}

module.exports = { toPdf, fontFaces, collect, renderHtml, buildPdf, sendToBale, getNote, saveNote, dayKey, parseDay, publicChat, linkChat };
