// سرویس «ثبت تماس‌های موبایل» — خطوط تلفن (گوشی‌های کاری) و تماس‌هایی که اپ
// اندروید «اپ تماس» می‌فرستد. تنها جایی که جدول‌های phone_lines و call_logs
// خوانده/نوشته می‌شوند. صدای مکالمه ذخیره نمی‌شود؛ فقط اطلاعات تماس و یادداشت.
const crypto = require('crypto');
const { can } = require('../../../shared/permissions');
const { prisma } = require('../../../shared/prisma');
const { normalizePhone, toEnDigits } = require('../../../shared/phone');
const leadService = require('./leadService');
const settingsService = require('../../core/services/settingsService');
const { UNCONFIRMED_MARK } = require('../lib/followup-marks');
const { creditUserId } = require('../lib/credit');
const Cycle = require('../../../shared/purchase-cycle');
const { startOfTodayTehran } = require('../../../shared/consultant-desk');
const { CALL_OUTCOMES, outcomeLabel, WORK_HOURS, parseOutcomes, isAfterHours } = require('../../../shared/call-outcomes');

function fail(status, message) {
  const e = new Error(message);
  e.status = status;
  return e;
}
function cleanText(v, max) {
  const s = v === undefined || v === null ? '' : String(v).trim();
  return s === '' ? null : max ? s.slice(0, max) : s;
}

const DIRECTIONS = ['INCOMING', 'OUTGOING', 'MISSED', 'REJECTED'];
const DIRECTION_LABEL = { INCOMING: 'ورودی', OUTGOING: 'خروجی', MISSED: 'بی‌پاسخ', REJECTED: 'قطع شد' };
const UNANSWERED = ['MISSED', 'REJECTED'];
const PAIRING_MINUTES = 15;
// تماس طولانی‌تر از این (ثانیه) با سرنخ «جدید»، پیشنهاد تغییر مرحله را نشان می‌دهد
const MEANINGFUL_CALL_SEC = 30;

function hashToken(t) {
  return crypto.createHash('sha256').update(String(t)).digest('hex');
}

function toDate(v) {
  if (v === undefined || v === null || v === '') return null;
  const d = typeof v === 'number' || /^\d{10,}$/.test(String(v)) ? new Date(Number(v)) : new Date(v);
  return isNaN(d.getTime()) ? null : d;
}

const LEAD_CLOSED = ['فروش موفق', 'فروش ناموفق'];
const tehranDayStart = (ms) => Math.floor((ms + 12600000) / 86400000) * 86400000 - 12600000;

function fmtDuration(sec) {
  const s = Math.max(0, Number(sec) || 0);
  const m = Math.floor(s / 60);
  const r = s % 60;
  return toFaDigits(m + ':' + String(r).padStart(2, '0'));
}
function toFaDigits(s) {
  return String(s).replace(/\d/g, (d) => '۰۱۲۳۴۵۶۷۸۹'[d]);
}

// ---------------------------------------------------------------
// خطوط تلفن (فقط مدیر)
// ---------------------------------------------------------------
function lineOut(l) {
  return {
    id: l.id,
    name: l.name,
    branch: l.branch || '',
    simNumber: l.simNumber || '',
    paired: !!l.tokenHash,
    isActive: l.isActive,
    pairingCode: l.pairingCode && l.pairingExpiresAt && l.pairingExpiresAt > new Date() ? l.pairingCode : null,
    pairingExpiresAt: l.pairingExpiresAt ? l.pairingExpiresAt.getTime() : null,
    lastSeenAt: l.lastSeenAt ? l.lastSeenAt.getTime() : null,
    appVersion: l.appVersion || '',
    lineType: l.lineType || 'mobile',
    createdAt: l.createdAt.getTime(),
  };
}

async function listLines() {
  const rows = await prisma.phoneLine.findMany({ orderBy: { createdAt: 'asc' } });
  // تعداد تماس هر خط: خطی که تماس دارد حذف نمی‌شود (بایگانی می‌شود)، پس رابط باید
  // از همان اول همین را بگوید، نه اینکه بعد از زدن «حذف» معلوم شود.
  const counts = await prisma.callLog.groupBy({ by: ['phoneLineId'], _count: { _all: true } });
  const byLine = new Map(counts.map((c) => [c.phoneLineId, c._count._all]));
  return rows.map((r) => Object.assign(lineOut(r), { calls: byLine.get(r.id) || 0 }));
}

async function newPairingCode() {
  for (let i = 0; i < 20; i++) {
    const code = String(crypto.randomInt(100000, 1000000));
    const taken = await prisma.phoneLine.findUnique({ where: { pairingCode: code } });
    if (!taken) return code;
  }
  throw fail(500, 'ساخت کد جفت‌سازی ممکن نشد، دوباره تلاش کنید');
}

async function createLine(body) {
  const name = cleanText(body.name, 120);
  if (!name) throw fail(400, 'نام خط را وارد کنید (مثلاً «خط ۱ — فروش»)');
  const row = await prisma.phoneLine.create({
    data: {
      name,
      branch: cleanText(body.branch, 120),
      simNumber: cleanText(normalizePhone(body.simNumber), 32),
      pairingCode: await newPairingCode(),
      pairingExpiresAt: new Date(Date.now() + PAIRING_MINUTES * 60000),
    },
  });
  return lineOut(row);
}

// حذف خط تلفن از CRM. تماس‌های ثبت‌شده‌ی آن خط هرگز پاک نمی‌شوند:
// اگر خط سابقه‌ی تماس داشته باشد فقط «بایگانی» می‌شود (غیرفعال + اتصال گوشی باطل)،
// و اگر هیچ تماسی نداشته باشد کامل حذف می‌شود.
async function removeLine(id) {
  const line = await prisma.phoneLine.findUnique({ where: { id } });
  if (!line) throw fail(404, 'خط پیدا نشد');
  const calls = await prisma.callLog.count({ where: { phoneLineId: id } });
  if (calls > 0) {
    await prisma.phoneLine.update({
      where: { id },
      data: { isActive: false, tokenHash: null, pairingCode: null, pairingExpiresAt: null },
    });
    return { removed: false, calls, message: 'این خط ' + calls + ' تماس ثبت‌شده دارد؛ تماس‌ها نگه داشته شد و خط بایگانی (غیرفعال) شد و اتصال گوشی باطل گردید.' };
  }
  await prisma.phoneLine.delete({ where: { id } });
  return { removed: true, calls: 0, message: 'خط حذف شد.' };
}

async function updateLine(id, body) {
  const data = {};
  if (body.name !== undefined) {
    data.name = cleanText(body.name, 120);
    if (!data.name) throw fail(400, 'نام خط را وارد کنید');
  }
  if (body.branch !== undefined) data.branch = cleanText(body.branch, 120);
  if (body.simNumber !== undefined) data.simNumber = cleanText(normalizePhone(body.simNumber), 32);
  if (body.isActive !== undefined) data.isActive = !!body.isActive;
  const row = await prisma.phoneLine.update({ where: { id }, data }).catch(() => { throw fail(404, 'خط پیدا نشد'); });
  return lineOut(row);
}

// کد تازه (برای نصب دوباره‌ی اپ یا گوشی جدید). توکن قبلی تا جفت شدن دوباره معتبر می‌ماند.
async function regeneratePairing(id) {
  const row = await prisma.phoneLine
    .update({ where: { id }, data: { pairingCode: await newPairingCode(), pairingExpiresAt: new Date(Date.now() + PAIRING_MINUTES * 60000) } })
    .catch(() => { throw fail(404, 'خط پیدا نشد'); });
  return lineOut(row);
}

// ابطال: گوشی دیگر نمی‌تواند چیزی بفرستد تا دوباره با کد جدید جفت شود
async function revokeLine(id) {
  const row = await prisma.phoneLine
    .update({ where: { id }, data: { tokenHash: null, pairingCode: null, pairingExpiresAt: null } })
    .catch(() => { throw fail(404, 'خط پیدا نشد'); });
  return lineOut(row);
}

// ---------------------------------------------------------------
// دستگاه: جفت‌سازی و احراز هویت با توکن
// ---------------------------------------------------------------
async function pairDevice(body) {
  const code = toEnDigits(String((body && body.code) || '')).replace(/\D/g, '');
  if (!code) throw fail(400, 'کد جفت‌سازی را وارد کنید');
  const line = await prisma.phoneLine.findUnique({ where: { pairingCode: code } });
  if (!line || !line.isActive || !line.pairingExpiresAt || line.pairingExpiresAt < new Date()) {
    throw fail(400, 'کد جفت‌سازی نامعتبر است یا منقضی شده — از CRM یک کد تازه بگیرید');
  }
  const token = crypto.randomBytes(32).toString('hex');
  await prisma.phoneLine.update({
    where: { id: line.id },
    data: {
      tokenHash: hashToken(token),
      pairingCode: null,
      pairingExpiresAt: null,
      lastSeenAt: new Date(),
      appVersion: cleanText(body.appVersion, 32),
    },
  });
  return { token, line: { id: line.id, name: line.name } };
}

async function lineFromToken(token, appVersion) {
  if (!token) return null;
  const line = await prisma.phoneLine.findUnique({ where: { tokenHash: hashToken(token) } });
  if (!line || !line.isActive) return null;
  // «آخرین اتصال» حداکثر دقیقه‌ای یک بار نوشته می‌شود
  const stale = !line.lastSeenAt || Date.now() - line.lastSeenAt.getTime() > 60000;
  const v = cleanText(appVersion, 32);
  if (stale || (v && v !== line.appVersion)) {
    await prisma.phoneLine.update({ where: { id: line.id }, data: { lastSeenAt: new Date(), appVersion: v || line.appVersion } });
  }
  return line;
}

// گزینه‌های ثابت فرم ثبت سرنخ (همان public/index.html)
const LEAD_FORM_OPTIONS = {
  contactMethods: ['تماس تلفنی', 'واتساپ', 'تلگرام', 'پیامک', 'ایمیل'],
  payments: ['نقدی', 'اقساطی', 'هر دو'],
  deliveries: ['پیش‌فروش', 'تحویل فوری'],
  bodyTypes: ['سدان', 'هاچبک', 'کراس‌اوور', 'شاسی‌بلند', 'وانت', 'سایر'],
  availability: ['موجود', 'ناموجود'],
};

// formHash: اگر گوشی همین نسخه‌ی گزینه‌های فرم را دارد، دوباره فرستاده نمی‌شود (اینترنت ضعیف / VPN)
function leadFormPart(form, clientHash) {
  const hash = crypto.createHash('sha1').update(JSON.stringify(form)).digest('hex').slice(0, 16);
  return clientHash && clientHash === hash ? { formHash: hash } : { formHash: hash, leadForm: form };
}

async function bootstrap(line, formHash) {
  const [users, channels, tags] = await Promise.all([
    prisma.user.findMany({ where: { isActive: true }, select: { id: true, fullName: true }, orderBy: { fullName: 'asc' } }),
    settingsService.getChannelOptions(),
    leadService.knownTags(),
  ]);
  return {
    line: { id: line.id, name: line.name, simNumber: line.simNumber || '' },
    operators: users.map((u) => ({ id: u.id, name: u.fullName })),
    heardFrom: channels.filter((c) => c.active).map((c) => c.name),
    outcomes: CALL_OUTCOMES,
    // vehicles خالی می‌ماند تا نسخه‌های قدیمی اپ گوشی خطا ندهند (CRM نمونه محصول خودرویی ندارد)
    ...leadFormPart(Object.assign({ tags, vehicles: [] }, LEAD_FORM_OPTIONS), formHash),
    serverTime: Date.now(),
  };
}

// ---------------------------------------------------------------
// تطبیق شماره با سرنخ و خلاصه‌ی امن برای گوشی مشترک
// (فقط نام، مرحله، خودرو، کارشناس — نه یادداشت‌ها و بودجه)
// ---------------------------------------------------------------
async function leadsByPhones(phones) {
  const list = [...new Set(phones.filter(Boolean))];
  if (!list.length) return new Map();
  const rows = await prisma.lead.findMany({
    where: { phone: { in: list } },
    orderBy: { updatedAt: 'desc' },
    include: { owner: { select: { fullName: true } } },
  });
  const map = new Map();
  for (const r of rows) if (!map.has(r.phone)) map.set(r.phone, summarizeLead(r));
  return map;
}

function summarizeLead(r) {
  return {
    id: r.id,
    name: r.customerName || '',
    stage: r.status,
    vehicle: '',
    ownerName: r.owner ? r.owner.fullName : '',
  };
}

async function lookup(phone) {
  const n = normalizePhone(phone);
  if (!n) return null;
  const map = await leadsByPhones([n]);
  return map.get(n) || null;
}

// limit: گوشی مخاطبین را در دسته‌های کوچک می‌گیرد تا روی اینترنت ضعیف نصفه نماند
async function contactsSince(since, limit, afterId) {
  const d = toDate(since);
  const take = Math.min(Math.max(Number(limit) || 5000, 50), 5000);
  // مکان‌نما = (updatedAt, id) تا سرنخ‌های هم‌زمان (مثلاً ورود اکسل) در مرز صفحه‌ها جا نیفتند
  const after = cleanText(afterId, 64);
  const where = !d ? {} : after ? { OR: [{ updatedAt: { gt: d } }, { updatedAt: d, id: { gt: after } }] } : { updatedAt: { gt: d } };
  const rows = await prisma.lead.findMany({
    where,
    select: { id: true, customerName: true, phone: true, kycStatus: true, updatedAt: true },
    orderBy: [{ updatedAt: 'asc' }, { id: 'asc' }],
    take,
  });
  const last = rows[rows.length - 1];
  return {
    contacts: rows.filter((r) => r.phone).map((r) => ({ id: r.id, name: r.customerName || '', phone: r.phone, verified: r.kycStatus === 'approved', updatedAt: r.updatedAt.getTime() })),
    more: rows.length === take,
    next: last ? { since: last.updatedAt.getTime(), afterId: last.id } : null,
    serverTime: Date.now(),
  };
}

// ---------------------------------------------------------------
// دریافت تماس‌ها از گوشی (دسته‌ای، بی‌خطر برای ارسال دوباره)
// ---------------------------------------------------------------
async function ingestBatch(line, calls) {
  if (!Array.isArray(calls)) throw fail(400, 'فهرست تماس‌ها نامعتبر است');
  if (calls.length > 500) throw fail(400, 'حداکثر ۵۰۰ تماس در هر ارسال');
  const clean = [];
  const errors = [];
  const contactNames = new Map();
  for (const c of calls) {
    const externalId = cleanText(c && c.externalId, 64);
    const startedAt = toDate(c && c.startedAt);
    const direction = String((c && c.direction) || '').toUpperCase();
    const phoneRaw = cleanText(c && c.phone, 64) || '';
    if (!externalId || !startedAt || !DIRECTIONS.includes(direction)) {
      errors.push({ externalId: externalId || null, error: 'invalid' });
      continue;
    }
    clean.push({
      externalId,
      startedAt,
      direction,
      phoneRaw,
      phoneNormalized: normalizePhone(phoneRaw) || phoneRaw || 'unknown',
      durationSec: Math.max(0, Math.round(Number(c.durationSec) || 0)),
    });
    // نام ذخیره‌شده در دفترچه‌تلفن گوشی (فقط برای نمایش؛ فرم ثبت آن را جایگزین می‌کند)
    contactNames.set(externalId, cleanText(c.contactName, 191));
  }
  const leadMap = await leadsByPhones(clean.map((c) => c.phoneNormalized));
  const results = [];
  for (const c of clean) {
    const lead = leadMap.get(c.phoneNormalized) || null;
    // بعضی گوشی‌ها یک تماس را دو بار (با _ID متفاوت، همان ثانیه) در تاریخچه می‌نویسند؛
    // همان خط + شماره + نوع + زمان شروع = همان تماس
    const existing =
      (await prisma.callLog.findUnique({ where: { phoneLineId_externalId: { phoneLineId: line.id, externalId: c.externalId } } })) ||
      (await prisma.callLog.findFirst({
        where: { phoneLineId: line.id, phoneNormalized: c.phoneNormalized, direction: c.direction, startedAt: c.startedAt },
      }));
    let row;
    if (existing) {
      // ارسال دوباره: اطلاعات ثبت‌شده توسط کارشناس دست نمی‌خورد
      row = await prisma.callLog.update({
        where: { id: existing.id },
        data: {
          durationSec: Math.max(existing.durationSec, c.durationSec),
          leadId: existing.leadId || (lead && lead.id) || null,
          // تا فرم ثبت نشده، نام تازه‌ی دفترچه‌تلفن جایگزین می‌شود؛ بعد از ثبت، نام فرم می‌ماند
          callerName:
            existing.logStatus === 'UNLOGGED'
              ? contactNames.get(c.externalId) || existing.callerName || null
              : existing.callerName || contactNames.get(c.externalId) || null,
        },
      });
    } else {
      row = await prisma.callLog.create({
        data: Object.assign({ phoneLineId: line.id, leadId: lead ? lead.id : null, callerName: contactNames.get(c.externalId) || null }, c),
      });
    }
    // رسیدن خود تماس یعنی مکالمه تمام شده — نمای زنده‌ی این خط بسته می‌شود
    try { require('./liveCallService').endForLine(line.id, c.phoneNormalized); } catch (e) { /* مهم نیست */ }
    // «فرم همزمان با مکالمه»: اگر کارشناس وسط تماس فرم را پر کرده باشد، همین حالا روی تماس می‌نشیند
    if (row.logStatus === 'UNLOGGED' && !UNANSWERED.includes(c.direction)) {
      const live = require('./liveCallService');
      const draft = live.getDraft(c.phoneNormalized);
      if (draft && (draft.outcomes || []).length) {
        try {
          await applyDraft(row.id, draft);
          live.clearDraft(c.phoneNormalized);
          row = await prisma.callLog.findUnique({ where: { id: row.id } });
        } catch (e) {
          // اگر ثبت خودکار نشد، تماس عادی «ثبت‌نشده» می‌ماند و کارشناس دستی ثبت می‌کند
        }
      }
    }
    // کارشناس روی بی‌پاسخ «زنگ زدم — ثبت مکالمه» زده و تماس برگشتی دیرتر از گوشی رسیده:
    // همان محتوا روی تماس برگشتی هم می‌نشیند تا دوباره ثبت نشود
    if (row.logStatus === 'UNLOGGED' && !UNANSWERED.includes(c.direction) && c.durationSec > 0) {
      const copied = await copyFromLoggedMissed(row).catch(() => false);
      if (copied) row = await prisma.callLog.findUnique({ where: { id: row.id } });
    }
    // سرنخِ بی‌نام + نام ذخیره‌شده در دفترچه‌تلفن گوشی → نام سرنخ پر می‌شود
    if (lead && !String(lead.name || '').trim() && contactNames.get(c.externalId)) {
      await prisma.lead.update({ where: { id: lead.id }, data: { customerName: contactNames.get(c.externalId), updatedAt: new Date() } });
      lead.name = contactNames.get(c.externalId);
    }
    // تماس برگشتی خودکار: اگر بعد از بی‌پاسخ، با همین شماره تماس خروجیِ وصل‌شده گرفته شد (از هر خطی)
    // یا خود مشتری دوباره زنگ زد و جواب گرفت، بی‌پاسخ‌های قبلی «تماس برگشتی گرفته شد» می‌شوند.
    if ((c.direction === 'OUTGOING' || c.direction === 'INCOMING') && c.durationSec > 0) {
      await prisma.callLog.updateMany({
        where: { phoneNormalized: c.phoneNormalized, direction: { in: UNANSWERED }, callbackDone: false, startedAt: { lt: c.startedAt } },
        data: { callbackDone: true },
      });
    }
    await syncCallFollowup(row.id).catch(() => {});
    await closeDueFollowup(row.id).catch(() => {});
    results.push({ externalId: c.externalId, id: row.id, logStatus: row.logStatus, lead });
  }
  return { results, errors };
}

// ---------------------------------------------------------------
// ثبت اطلاعات پاپ‌آپ (از گوشی یا از صفحه‌ی «تماس‌ها» در CRM)
// ---------------------------------------------------------------
// فیلدهای اضافه‌ی فرم ثبت سرنخ در پاپ‌آپ گوشی (فقط برای شماره‌ی تازه)
function leadDetails(l) {
  if (!l || typeof l !== 'object') return {};
  const out = {};
  if (Array.isArray(l.tags)) out.tags = l.tags.map(String).filter(Boolean).slice(0, 20);
  if (Array.isArray(l.contactMethods) && l.contactMethods.length) out.contactMethods = l.contactMethods.map(String).slice(0, 10);
  for (const k of ['priceFrom', 'priceTo']) if (l[k] !== undefined && l[k] !== null && l[k] !== '') out[k] = toEnDigits(String(l[k])).replace(/[^0-9.]/g, '') || null;
  for (const k of ['payment', 'delivery', 'currentCar']) if (l[k]) out[k] = cleanText(l[k], 191);
  return out;
}

function hasLeadDetails(l) {
  const d = leadDetails(l);
  return Object.keys(d).some((k) => (Array.isArray(d[k]) ? d[k].length && k !== 'contactMethods' : !!d[k]));
}

// ساخت پرونده از تماس؛ اگر شماره قبلاً پرونده داشت، همان را برمی‌گرداند (بن‌بست نشود)
async function createLeadOrAttach(body, operator, phone) {
  try {
    const created = await leadService.createLead(operator, body, operator.id, operator.branchId);
    return { leadId: created.lead ? created.lead.id : created.id, created: true };
  } catch (e) {
    if (e && e.status === 409) {
      const dup = await prisma.lead.findFirst({ where: { phone }, orderBy: { updatedAt: 'desc' }, select: { id: true } });
      if (dup) return { leadId: dup.id, created: false };
    }
    throw e;
  }
}

// بی‌پاسخ و تماس برگشتیِ همان شماره یک کارند — ثبت یکی، دیگری را هم «انجام‌شده» می‌کند.
// تماس صحبت‌شده ← بی‌پاسخ‌های ثبت‌نشده‌ی قبلی (تا ۷ روز): فقط بسته می‌شوند (بدون اقدام می‌مانند)،
// نتیجه‌ی مکالمه (outcomes/note/...) روی خودشان کپی نمی‌شود — آن نتیجه مال تماسی است که واقعاً برقرار شده.
// بی‌پاسخ ← تماس‌های صحبت‌شده‌ی ثبت‌نشده‌ی بعدی: این یکی برعکس، همان محتوای فرم را می‌گیرد (دستیِ خودِ کارشناس است).
async function logLinkedCalls(call, data) {
  const missed = UNANSWERED.includes(call.direction);
  if (!missed && !(call.durationSec > 0)) return 0;
  const where = missed
    ? { direction: { in: ['INCOMING', 'OUTGOING'] }, durationSec: { gt: 0 }, startedAt: { gt: call.startedAt, lte: new Date(call.startedAt.getTime() + 7 * 86400000) } }
    : { direction: { in: UNANSWERED }, startedAt: { lt: call.startedAt, gte: new Date(call.startedAt.getTime() - 7 * 86400000) } };
  const applyData = missed
    ? data
    : { operatorUserId: data.operatorUserId, callerName: data.callerName, heardFrom: data.heardFrom, leadId: data.leadId };
  const r = await prisma.callLog.updateMany({
    where: Object.assign({ phoneNormalized: call.phoneNormalized, logStatus: 'UNLOGGED', id: { not: call.id } }, where),
    data: Object.assign({}, applyData, { logStatus: 'LOGGED', ...(missed ? {} : { callbackDone: true }) }),
  });
  if (missed && r.count) {
    // بی‌پاسخی که تماس برگشتی‌اش هم ثبت شد
    await prisma.callLog.update({ where: { id: call.id }, data: { callbackDone: true } });
  }
  return r.count;
}

// بی‌پاسخی که حدود زمان همین تماس ثبت شده (۷ روز گذشته، ثبت از ۲ ساعت قبل از شروع تماس به بعد)
// و بینشان تماس ثبت‌شده‌ی دیگری نیست → محتوایش روی تماس برگشتیِ تازه‌رسیده کپی می‌شود.
async function copyFromLoggedMissed(row) {
  const at = row.startedAt;
  const missed = await prisma.callLog.findFirst({
    where: {
      phoneNormalized: row.phoneNormalized, direction: { in: UNANSWERED }, logStatus: 'LOGGED',
      startedAt: { lt: at, gte: new Date(at.getTime() - 7 * 86400000) },
      updatedAt: { gte: new Date(at.getTime() - 2 * 3600000) },
    },
    orderBy: { startedAt: 'desc' },
  });
  if (!missed) return false;
  const between = await prisma.callLog.count({
    where: {
      phoneNormalized: row.phoneNormalized, direction: { in: ['INCOMING', 'OUTGOING'] }, logStatus: 'LOGGED',
      startedAt: { gt: missed.startedAt, lt: at }, id: { not: row.id },
    },
  });
  if (between) return false;
  await prisma.callLog.update({
    where: { id: row.id },
    data: {
      operatorUserId: missed.operatorUserId, callerName: missed.callerName, heardFrom: missed.heardFrom,
      note: missed.note, outcomes: missed.outcomes, productNote: missed.productNote, followUpAt: missed.followUpAt,
      leadId: missed.leadId || row.leadId, logStatus: 'LOGGED',
    },
  });
  return true;
}

// پیش‌نویس «تماس جاری» روی یک تماس ثبت‌شده می‌نشیند. days=0 یعنی بدون پیگیری.
async function applyDraft(callId, draft) {
  const days = Number(draft.days) || 0;
  const fu = days > 0 ? new Date(Date.now() + days * 86400000) : null;
  if (fu) fu.setHours(10, 0, 0, 0);
  return logCall(callId, {
    operatorUserId: draft.userId,
    callerName: draft.name,
    heardFrom: draft.heardFrom,
    note: draft.note,
    outcomes: draft.outcomes,
    productNote: draft.productNote,
    followUpAt: fu ? fu.toISOString() : '',
  }, { defaultOperatorId: draft.userId, explicitNext: true });
}

// اگر تماس قبل از ثبت فرم از گوشی رسیده باشد، فرم همان لحظه روی آن ثبت می‌شود
async function applyDraftToRecent(phone, draft) {
  const row = await prisma.callLog.findFirst({
    where: {
      phoneNormalized: phone, logStatus: 'UNLOGGED', direction: { in: ['INCOMING', 'OUTGOING'] },
      startedAt: { gte: new Date(Date.now() - 60 * 60 * 1000) },
    },
    orderBy: { startedAt: 'desc' },
    select: { id: true },
  });
  if (!row) return false;
  await applyDraft(row.id, draft);
  return true;
}

async function logCall(callId, body, opts) {
  const b = body || {};
  const call = await prisma.callLog.findUnique({ where: { id: callId }, include: { line: true } });
  if (!call) throw fail(404, 'تماس پیدا نشد');
  if (opts && opts.lineId && call.phoneLineId !== opts.lineId) throw fail(404, 'تماس پیدا نشد');

  const operatorUserId = cleanText(b.operatorUserId, 64) || (opts && opts.defaultOperatorId) || null;
  if (!operatorUserId) throw fail(400, 'پاسخ‌دهنده را انتخاب کنید');
  const operator = await prisma.user.findFirst({ where: { id: operatorUserId, isActive: true } });
  if (!operator) throw fail(400, 'پاسخ‌دهنده نامعتبر است');

  const callerName = cleanText(b.callerName, 191);
  const heardFrom = cleanText(b.heardFrom, 64);
  const note = cleanText(b.note, 4000);
  const outcomes = parseOutcomes(b.outcomes);
  const productNote = cleanText(b.productNote, 191);
  let followUpAt = null;
  if (b.followUpAt !== undefined && b.followUpAt !== null && b.followUpAt !== '') {
    followUpAt = toDate(b.followUpAt);
    if (!followUpAt) throw fail(400, 'تاریخ پیگیری معتبر نیست');
  }

  // سرنخ: اگر هنوز وصل نیست، دوباره بر اساس شماره جست‌وجو (شاید در این فاصله ثبت شده)
  let leadId = call.leadId;
  if (!leadId && call.phoneNormalized) {
    const found = await prisma.lead.findFirst({ where: { phone: call.phoneNormalized }, orderBy: { updatedAt: 'desc' }, select: { id: true } });
    if (found) leadId = found.id;
  }

  let createdLead = false;
  let leadUpdate = null; // به‌روزرسانی پرونده‌ی موجود با خود ثبت تماس در یک تراکنش
  let namedLead = false;
  if (leadId) {
    const lead = await prisma.lead.findUnique({ where: { id: leadId } });
    const data = { updatedAt: new Date() };
    // نامی که کارشناس در فرم می‌نویسد، نام پرونده را هم درست می‌کند (مثلاً «بدون نام» یا نام ناقص)
    if (callerName && callerName !== lead.customerName) data.customerName = callerName;
    if (!lead.channel && heardFrom) data.channel = heardFrom;
    if (followUpAt) {
      data.nextFollowUpDate = followUpAt;
      data.nextFollowUpNote = ('پیگیری تماس' + (note ? ': ' + note : '')).slice(0, 190);
    }
    leadUpdate = prisma.lead.update({ where: { id: leadId }, data });
    // شماره‌ی خام (بدون نام) اسم گرفت — در «آمار کار کارشناسان» شمرده می‌شود
    namedLead = !!(callerName && !String(lead.customerName || '').trim());
  } else if ((callerName || heardFrom || note || outcomes.length || productNote || hasLeadDetails(b.lead)) && call.phoneNormalized && call.phoneNormalized !== 'unknown') {
    // سرنخ تازه از تماس: مسئول = پاسخ‌دهنده، منبع = نحوه‌ی آشنایی (یا «تماس تلفنی»)
    // اگر همین شماره از قبل پرونده داشته باشد، createLead خطای «تکراری» می‌دهد؛
    // در ثبت تماس نباید بن‌بست شود — تماس به همان پرونده وصل می‌شود.
    const created = await createLeadOrAttach(
      {
        name: callerName || '',
        phone: call.phoneNormalized,
        channel: heardFrom || 'تماس تلفنی',
        contactMethods: ['تماس تلفنی'],
        notes: note,
        // همه‌ی فیلدهای فرم ثبت سرنخ CRM که از پاپ‌آپ گوشی آمده
        ...leadDetails(b.lead),
        nextFollowUpDate: followUpAt ? followUpAt.toISOString() : '',
        nextFollowUpNote: followUpAt ? ('پیگیری تماس' + (note ? ': ' + note : '')).slice(0, 190) : '',
      },
      operator,
      call.phoneNormalized
    );
    leadId = created.leadId;
    createdLead = created.created;
  }

  const callUpdate = prisma.callLog.update({
    where: { id: call.id },
    data: {
      operatorUserId: operator.id,
      callerName,
      heardFrom,
      note,
      outcomes: outcomes.join(',') || null,
      productNote,
      followUpAt,
      leadId: leadId || null,
      logStatus: 'LOGGED',
      // تماس بی‌پاسخی که ثبت شد، یعنی زنگ زدیم و صحبت کردیم: «تماس برگشتی» هم انجام شده است
      ...(UNANSWERED.includes(call.direction) ? { callbackDone: true } : {}),
    },
    include: CALL_INCLUDE,
  });
  const row = leadUpdate ? (await prisma.$transaction([leadUpdate, callUpdate]))[1] : await callUpdate;
  if (namedLead) await require('./auditService').log(leadId, operator.id, 'named', callerName);
  // کارهای جانبی: خطایشان ثبت تماس را خراب نمی‌کند، ولی در لاگ می‌ماند
  const warn = (what) => (e) => { console.error('[ثبت تماس] ' + what + ' ناموفق (' + call.id + '):', e && e.message); return null; };
  await logLinkedCalls(call, {
    operatorUserId: operator.id, callerName, heardFrom, note,
    outcomes: outcomes.join(',') || null, productNote, followUpAt, leadId: leadId || null,
  }).catch(warn('کپی روی بی‌پاسخ‌ها'));
  if (leadId) {
    await require('./auditService').log(leadId, operator.id, 'call_logged', [DIRECTION_LABEL[call.direction]].concat(outcomes.map(outcomeLabel)).concat(productNote ? ['📦 ' + productNote] : []).concat(followUpAt ? ['📅 پیگیری بعدی: ' + require('../../../shared/jalali').formatDate(followUpAt)] : []).join(' · ').slice(0, 190));
  }
  await syncCallFollowup(row.id).catch(warn('پیگیری تماس'));
  await closeDueFollowup(row.id).catch(warn('بستن پیگیری سررسید'));
  // «فقط قیمت پرسید»: دومین استعلام پیامک، سومین استعلام تماس عارضه‌یابی فردا
  let priceInquiry = null;
  if (leadId && outcomes.includes('price_inquiry')) {
    priceInquiry = await require('./priceInquiryService')
      .apply(leadId, call.phoneNormalized, operator.id, { explicitNext: !!followUpAt || !!(opts && opts.explicitNext) })
      .catch(warn('استعلام قیمت'));
  }
  return { call: callOut(row), createdLead, priceInquiry };
}

// ---------------------------------------------------------------
// خواندن برای CRM (صفحه‌ی «تماس‌ها»، پرونده‌ی سرنخ، گزارش‌ها)
// ---------------------------------------------------------------
const CALL_INCLUDE = {
  line: { select: { id: true, name: true } },
  operator: { select: { id: true, fullName: true } },
  lead: { select: { id: true, customerName: true, ownerId: true, owner: { select: { fullName: true } } } },
};

function callOut(c) {
  return {
    id: c.id,
    lineId: c.phoneLineId,
    lineName: c.line ? c.line.name : '',
    phone: c.phoneNormalized && c.phoneNormalized !== 'unknown' ? c.phoneNormalized : c.phoneRaw,
    direction: c.direction,
    directionLabel: DIRECTION_LABEL[c.direction] || c.direction,
    startedAt: c.startedAt.getTime(),
    durationSec: c.durationSec,
    durationLabel: fmtDuration(c.durationSec),
    leadId: c.leadId,
    leadName: c.lead ? c.lead.customerName || '' : '',
    leadOwnerName: c.lead && c.lead.owner ? c.lead.owner.fullName : '',
    operatorUserId: c.operatorUserId,
    operatorName: c.operator ? c.operator.fullName : '',
    callerName: c.callerName || '',
    heardFrom: c.heardFrom || '',
    note: c.note || '',
    outcomes: parseOutcomes(c.outcomes),
    outcomeLabels: parseOutcomes(c.outcomes).map(outcomeLabel),
    productNote: c.productNote || '',
    // بی‌پاسخِ بیرون از ساعت کاری: باید در ساعت کاری با او تماس گرفته شود
    afterHours: UNANSWERED.includes(c.direction) && isAfterHours(c.startedAt),
    followUpAt: c.followUpAt ? c.followUpAt.getTime() : null,
    logStatus: c.logStatus,
    dismissReason: c.dismissReason || '',
    callbackDone: c.callbackDone,
  };
}

// کارشناس: تماس‌هایی که خودش جواب داده، تماس‌های سرنخ‌های خودش، و تماس‌های ثبت‌نشده‌ی
// ناشناس (تا روی گوشی مشترک کسی بتواند تکمیلشان کند). مدیر: همه.
function scopeWhere(user) {
  if (can(user, 'all_leads')) return {};
  return { OR: [{ operatorUserId: user.id }, { lead: { ownerId: user.id } }, { logStatus: 'UNLOGGED', leadId: null }] };
}

function listWhere(user, q) {
  const and = [scopeWhere(user)];
  const from = toDate(q.from);
  const to = toDate(q.to);
  if (from || to) and.push({ startedAt: Object.assign({}, from ? { gte: from } : {}, to ? { lte: to } : {}) });
  if (q.lineId) and.push({ phoneLineId: String(q.lineId) });
  if (q.operatorId) and.push({ operatorUserId: String(q.operatorId) });
  if (q.direction && DIRECTIONS.includes(String(q.direction))) and.push({ direction: String(q.direction) });
  if (q.logStatus === 'LOGGED' || q.logStatus === 'UNLOGGED') and.push({ logStatus: q.logStatus });
  if (q.tab === 'unlogged') and.push({ logStatus: 'UNLOGGED', direction: { in: ['INCOMING', 'OUTGOING'] } });
  if (q.tab === 'missed') and.push({ direction: { in: UNANSWERED }, callbackDone: false });
  // CRM نمونه: «ثبت شد»، «ثبت نشد» (تماس به‌دردنخور) و «تماس برگشتی گرفته شد»
  if (q.tab === 'logged') and.push({ logStatus: 'LOGGED' });
  if (q.tab === 'dismissed') and.push({ logStatus: 'DISMISSED' });
  if (q.tab === 'callback') and.push({ direction: { in: UNANSWERED }, callbackDone: true });
  if (q.q) {
    const n = normalizePhone(q.q);
    const t = String(q.q).trim();
    and.push({ OR: [n ? { phoneNormalized: { contains: n.replace(/^0/, '') } } : null, { callerName: { contains: t } }, { note: { contains: t } }, { lead: { customerName: { contains: t } } }].filter(Boolean) });
  }
  return { AND: and };
}

async function listCalls(user, q) {
  const dir = q && q.sort === 'asc' ? 'asc' : 'desc';
  const where = listWhere(user, q || {});
  const rows = await prisma.callLog.findMany({ where, include: CALL_INCLUDE, orderBy: { startedAt: dir }, take: 500 });
  const [unlogged, missedOpen] = await Promise.all([
    prisma.callLog.count({ where: { AND: [scopeWhere(user), { logStatus: 'UNLOGGED', direction: { in: ['INCOMING', 'OUTGOING'] } }] } }),
    prisma.callLog.count({ where: { AND: [scopeWhere(user), { direction: { in: UNANSWERED }, callbackDone: false }] } }),
  ]);
  return { calls: await withPriceInquiries(rows.map(callOut)), counts: { unlogged, missedOpen }, summary: await callSummary(where), workHours: WORK_HOURS };
}

// خلاصه‌ی همان تماس‌هایی که با فیلترهای فعلی دیده می‌شوند (برای کارت‌های بالای صفحه)
async function callSummary(where) {
  const [byDir, answered, unlogged, missedOpen] = await Promise.all([
    prisma.callLog.groupBy({ by: ['direction'], where, _count: { _all: true }, _sum: { durationSec: true } }),
    prisma.callLog.count({ where: { AND: [where, { durationSec: { gt: 0 } }] } }),
    prisma.callLog.count({ where: { AND: [where, { logStatus: 'UNLOGGED', direction: { in: ['INCOMING', 'OUTGOING'] } }] } }),
    prisma.callLog.count({ where: { AND: [where, { direction: { in: UNANSWERED }, callbackDone: false }] } }),
  ]);
  const d = { INCOMING: 0, OUTGOING: 0, MISSED: 0, REJECTED: 0 };
  let total = 0;
  let talkSec = 0;
  for (const g of byDir) {
    d[g.direction] = g._count._all;
    total += g._count._all;
    talkSec += g._sum.durationSec || 0;
  }
  return { total, incoming: d.INCOMING, outgoing: d.OUTGOING, missed: d.MISSED + d.REJECTED, answered, talkSec, unlogged, missedOpen };
}

async function getCall(user, id) {
  const row = await prisma.callLog.findFirst({ where: { AND: [scopeWhere(user), { id }] }, include: CALL_INCLUDE });
  if (!row) throw fail(404, 'تماس پیدا نشد');
  return callOut(row);
}

// «ثبت نشد»: تماس به‌دردنخور (مزاحم، اشتباه، تبلیغاتی…) — از «بلاتکلیف» بیرون می‌رود و نام کارشناس می‌ماند.
// برگرداندن (dismissed=false) دوباره بلاتکلیفش می‌کند.
async function markDismissed(user, id, dismissed, reason) {
  const call = await getCall(user, id);
  if (call.logStatus === 'LOGGED') throw fail(400, 'این تماس قبلاً ثبت شده است');
  const row = await prisma.callLog.update({
    where: { id },
    data: dismissed
      ? { logStatus: 'DISMISSED', operatorUserId: user.id, dismissReason: cleanText(reason, 4000) || null }
      : { logStatus: 'UNLOGGED', dismissReason: null },
    include: CALL_INCLUDE,
  });
  return callOut(row);
}

async function markCallback(user, id, done) {
  await getCall(user, id);
  const row = await prisma.callLog.update({ where: { id }, data: { callbackDone: !!done }, include: CALL_INCLUDE });
  return callOut(row);
}

// تماس «خروجی» گوشی کاری با مشتریِ ثبت‌شده = یک «پیگیری» کارشناس در پرونده (همان «ثبت پیگیری» دستی).
// تماس ورودی (مشتری خودش زنگ زده) پیگیریِ کارشناس نیست؛ جدا در گزارش تماس‌ها می‌آید.
//  - تماس وصل‌شده (مدت > ۰) خودکار «جواب داد» ثبت می‌شود — اول به نام کارشناس مسئول مشتری
//    (گوشی مشترک است)، و وقتی پاپ‌آپ پر شد به نام پاسخ‌دهنده‌ی واقعی و با خلاصه‌ی مکالمه.
//  - تماس بی‌جواب فقط وقتی پاپ‌آپش ثبت شود «جواب نداد» می‌شود (بعضی گوشی‌ها مدت را دیر می‌نویسند).
// کلید یکتایی بدون ستون اضافه: همان سرنخ + زمان شروع تماس = followupDate.
async function syncCallFollowup(callId) {
  const c = await prisma.callLog.findUnique({ where: { id: callId }, include: { lead: { select: { id: true, ownerId: true } }, operator: { select: { id: true, role: true, permissions: true } } } });
  if (!c || !c.lead || c.direction !== 'OUTGOING') return null;
  const answered = c.durationSec > 0;
  if (!answered && c.logStatus !== 'LOGGED') return null;
  const userId = c.operator ? await creditUserId(c.operator, c.lead.ownerId) : c.lead.ownerId;
  const label = '📞 تماس خروجی از گوشی کاری' + (answered ? ' · ' + fmtDuration(c.durationSec) : '') + (c.operatorUserId ? '' : ' ' + UNCONFIRMED_MARK);
  const content = c.note ? label + ' — ' + c.note : label;
  const outcome = answered ? 'جواب داد' : 'جواب نداد';
  const existing = await prisma.followup.findFirst({ where: { leadId: c.leadId, followupDate: c.startedAt } });
  if (existing) {
    if (existing.userId !== userId || existing.content !== content || existing.outcome !== outcome) {
      const data = { userId, content, outcome };
      // تأییدِ تماسِ بی‌صاحب (پر شدن فرم) = لحظه‌ی ثبت؛ امتیازش همان روز حساب می‌شود
      if (String(existing.content).includes(UNCONFIRMED_MARK) && c.operatorUserId) data.createdAt = new Date();
      await prisma.followup.update({ where: { id: existing.id }, data });
    }
    return existing.id;
  }
  const f = await prisma.followup.create({ data: { leadId: c.leadId, userId, followupDate: c.startedAt, content, outcome } });
  await prisma.lead.update({ where: { id: c.leadId }, data: { updatedAt: new Date() } });
  return f.id;
}

// تماس وصل‌شده با مشتری (ورودی یا خروجی) = همان «پیگیری بعدی» که موعدش رسیده بود انجام شد؛
// تاریخ پیگیری پاک می‌شود تا مشتری بی‌دلیل در «پیگیری عقب‌افتاده» نماند.
// فقط وقتی موعد (روزش) تا لحظه‌ی تماس رسیده باشد؛ تاریخِ آینده یا تاریخی که در همین فرم تماس انتخاب شده دست نمی‌خورد.
async function closeDueFollowup(callId) {
  const c = await prisma.callLog.findUnique({
    where: { id: callId },
    select: { durationSec: true, startedAt: true, lead: { select: { id: true, status: true, nextFollowUpDate: true, purchaseFollowStep: true } } },
  });
  if (!c || !c.lead || !(c.durationSec > 0) || !c.lead.nextFollowUpDate) return false;
  if (tehranDayStart(c.lead.nextFollowUpDate.getTime()) > c.startedAt.getTime()) return false;
  // مشتریِ خریدکرده هیچ‌وقت بی‌قدم‌بعدی نمی‌ماند: همین تماس قدم بعدیِ چرخه را می‌گذارد
  const nextCycle = Cycle.advance(c.lead.purchaseFollowStep, new Date());
  if (nextCycle) {
    await prisma.lead.update({ where: { id: c.lead.id }, data: nextCycle });
    return true;
  }
  if (LEAD_CLOSED.includes(c.lead.status)) return false;
  await prisma.lead.update({ where: { id: c.lead.id }, data: { nextFollowUpDate: null, nextFollowUpNote: null } });
  return true;
}

// تماس‌های یک سرنخ برای تایم‌لاین پرونده
async function callsForLead(leadId) {
  const rows = await prisma.callLog.findMany({ where: { leadId }, include: CALL_INCLUDE, orderBy: { startedAt: 'desc' }, take: 200 });
  return withPriceInquiries(rows.map(callOut));
}

// چند بار این شماره «فقط استعلام قیمت» گرفته (برای نشان «استعلام تکراری»)
// زمان همه‌ی استعلام‌های قیمتِ هر شماره — برای «کل» و «همان روز» روی کارت تماس
async function priceInquiryTimes(phones) {
  const list = [...new Set(phones.filter((p) => p && p !== 'unknown'))];
  if (!list.length) return new Map();
  // بی‌پاسخ‌هایی که نتیجه‌شان از تماس برگشتی کپی شده نباید دوباره شمرده شوند (logLinkedCalls)
  const rows = await prisma.callLog.findMany({
    where: { phoneNormalized: { in: list }, outcomes: { contains: 'price_inquiry' }, direction: { notIn: UNANSWERED } },
    select: { phoneNormalized: true, startedAt: true },
  });
  const out = new Map();
  for (const r of rows) {
    if (!out.has(r.phoneNormalized)) out.set(r.phoneNormalized, []);
    out.get(r.phoneNormalized).push(startOfTodayTehran(r.startedAt.getTime()));
  }
  return out;
}

// priceInquiries = کل دوره‌ها؛ priceInquiriesDay = همان روزِ این تماس (به وقت تهران)
async function withPriceInquiries(calls) {
  const times = await priceInquiryTimes(calls.map((c) => c.phone));
  for (const c of calls) {
    const days = times.get(c.phone) || [];
    const day = startOfTodayTehran(c.startedAt);
    c.priceInquiries = days.length;
    c.priceInquiriesDay = days.filter((d) => d === day).length;
  }
  return calls;
}

// ---------------------------------------------------------------
// گزارش‌ها
// ---------------------------------------------------------------
const WEEKDAYS = ['شنبه', 'یکشنبه', 'دوشنبه', 'سه‌شنبه', 'چهارشنبه', 'پنجشنبه', 'جمعه'];

async function report(q) {
  const from = toDate(q.from) || new Date(Date.now() - 30 * 86400000);
  const to = toDate(q.to) || new Date();
  const rows = await prisma.callLog.findMany({
    where: { startedAt: { gte: from, lte: to } },
    include: { operator: { select: { id: true, fullName: true } }, line: { select: { id: true, name: true } }, lead: { select: { channel: true } } },
    orderBy: { startedAt: 'asc' },
    take: 50000,
  });

  // هر کارشناس
  const ops = {};
  for (const c of rows) {
    const key = c.operator ? c.operator.id : '_none';
    const o = (ops[key] = ops[key] || { name: c.operator ? c.operator.fullName : 'ثبت‌نشده (بدون پاسخ‌دهنده)', calls: 0, talkSec: 0, answered: 0, logged: 0, unlogged: 0 });
    o.calls++;
    if (c.durationSec > 0) { o.answered++; o.talkSec += c.durationSec; }
    if (c.logStatus === 'LOGGED') o.logged++; else o.unlogged++;
  }
  const perOperator = Object.values(ops).map((o) => Object.assign(o, { avgSec: o.answered ? Math.round(o.talkSec / o.answered) : 0 }))
    .sort((a, b) => b.calls - a.calls);

  // هر خط: ساعت و روز هفته (به وقت تهران)
  const lines = {};
  for (const c of rows) {
    const key = c.line ? c.line.id : '_';
    const l = (lines[key] = lines[key] || { name: c.line ? c.line.name : '—', total: 0, byHour: Array(24).fill(0), byWeekday: Array(7).fill(0) });
    const t = new Date(c.startedAt.getTime() + 3.5 * 3600000); // Asia/Tehran (UTC+3:30)
    l.total++;
    l.byHour[t.getUTCHours()]++;
    l.byWeekday[(t.getUTCDay() + 1) % 7]++; // شنبه = ۰
  }

  // بی‌پاسخ‌ها: درصد تماس برگشتی و میانگین زمان تا تماس برگشتی
  const missed = rows.filter((c) => UNANSWERED.includes(c.direction));
  const outgoingAnswered = rows.filter((c) => c.direction === 'OUTGOING' && c.durationSec > 0);
  let waits = [];
  for (const m of missed) {
    const back = outgoingAnswered.find((o) => o.phoneNormalized === m.phoneNormalized && o.startedAt > m.startedAt);
    if (back) waits.push((back.startedAt - m.startedAt) / 60000);
  }
  const missedReport = {
    total: missed.length,
    calledBack: missed.filter((m) => m.callbackDone).length,
    callbackRate: missed.length ? Math.round((missed.filter((m) => m.callbackDone).length / missed.length) * 100) : 0,
    avgMinutesToCallback: waits.length ? Math.round(waits.reduce((s, x) => s + x, 0) / waits.length) : null,
  };

  // نحوه‌ی آشنایی (تماس‌های ثبت‌شده)
  const heard = {};
  for (const c of rows) {
    if (c.logStatus !== 'LOGGED') continue;
    const k = c.heardFrom || (c.lead && c.lead.channel) || 'نامشخص';
    heard[k] = (heard[k] || 0) + 1;
  }

  return {
    from: from.getTime(),
    to: to.getTime(),
    totals: { calls: rows.length, talkSec: rows.reduce((t, c) => t + (c.durationSec || 0), 0), answered: rows.filter((c) => c.durationSec > 0).length, unlogged: rows.filter((c) => c.logStatus === 'UNLOGGED' && !UNANSWERED.includes(c.direction)).length },
    perOperator,
    perLine: Object.values(lines),
    weekdays: WEEKDAYS,
    missed: missedReport,
    heardFrom: Object.entries(heard).map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count),
  };
}

// تنظیمات نسخه‌ی اپ (برای پیام به‌روزرسانی در گوشی)
async function appVersion() {
  const row = await prisma.setting.findUnique({ where: { key: 'androidApp' } });
  let v = {};
  try { v = row ? JSON.parse(row.value) : {}; } catch (e) { v = {}; }
  return { versionCode: Number(v.versionCode) || 0, versionName: v.versionName || '', url: v.url || '', notes: v.notes || '' };
}

module.exports = {
  applyDraftToRecent,
  callOut,
  CALL_INCLUDE,
  syncCallFollowup,
  closeDueFollowup,
  DIRECTIONS,
  MEANINGFUL_CALL_SEC,
  hashToken,
  listLines,
  createLine,
  updateLine,
  regeneratePairing,
  revokeLine,
  pairDevice,
  lineFromToken,
  bootstrap,
  lookup,
  contactsSince,
  ingestBatch,
  logCall,
  listCalls,
  getCall,
  markCallback,
  markDismissed,
  callsForLead,
  report,
  appVersion,
  removeLine,
};
