// «الان در حال مکالمه» — نمای زنده‌ی تماس‌های جاری هر خط، تا دو کارشناس هم‌زمان
// سراغ یک مشتری نروند (مثلاً تماس برگشتی یک شماره‌ی بی‌پاسخ).
// در حافظه نگه داشته می‌شود (داده‌ی لحظه‌ای است، بعد از ری‌استارت لازم نیست بماند).
const { prisma } = require('../../../shared/prisma');
const { normalizePhone } = require('../../../shared/phone');
const { EventEmitter } = require('events');

// هر تغییر وضعیت فوراً به مرورگرهای باز اعلام می‌شود (بدون معطلی و بدون صدا زدن مکرر سرور)
const bus = new EventEmitter();
bus.setMaxListeners(100);
function notify() { bus.emit('change'); scheduleExpiry(); }

// اپ هر ۲۰ ثانیه «هنوز روی خط است» می‌فرستد؛ اگر ضربان نیاید یعنی تماس تمام شده.
// ولی نسخه‌های قدیمی اپ ضربان ندارند: تا وقتی ضربان واقعی ندیده‌ایم مهلت بلند است،
// وگرنه کارت وسط مکالمه پاک می‌شود.
const TTL = { talking: 35 * 1000, talkingNoBeat: 5 * 60 * 1000, ringing: 60 * 1000, calling: 3 * 60 * 1000 };
function ttlOf(v) {
  if (v.state === 'ended') return ENDED_TTL;
  if (v.state === 'talking') return v.beatSeen ? TTL.talking : TTL.talkingNoBeat;
  return TTL[v.state] || TTL.talking;
}
const live = new Map(); // lineId → { lineId, lineName, phone, state, direction, at, operatorName }

const ENDED_TTL = 12 * 1000;
function clean() {
  const now = Date.now();
  let changed = false;
  for (const [k, v] of live) {
    const limit = ttlOf(v);
    if (v.state === 'ended' ? now - v.endedAt > limit : now - v.at > limit) { live.delete(k); changed = true; }
  }
  return changed;
}

// ردیفی که مهلتش تمام می‌شود باید خودش برود؛ وگرنه کارت «تازه تمام شد» تا رفرش بعدی روی صفحه می‌ماند.
let expiryTimer = null;
function scheduleExpiry() {
  clearTimeout(expiryTimer);
  expiryTimer = null;
  const now = Date.now();
  let next = Infinity;
  for (const v of live.values()) {
    const base = v.state === 'ended' ? v.endedAt : v.at;
    next = Math.min(next, base + ttlOf(v) - now);
  }
  if (next === Infinity) return;
  expiryTimer = setTimeout(() => {
    expiryTimer = null;
    if (clean()) notify();
    else scheduleExpiry();
  }, Math.max(250, next + 50));
  if (expiryTimer.unref) expiryTimer.unref();
}

// اپ گوشی خبر می‌دهد: زنگ خورد / وصل شد / قطع شد
function set(line, body) {
  const b = body || {};
  const state = String(b.state || '').toLowerCase(); // ringing | talking | idle
  // پایان تماس: ردیف فوراً پاک نمی‌شود؛ ۲۵ ثانیه به شکل «تازه تمام شد» می‌ماند تا
  // کارشناسی که همان لحظه نگاه نکرده هم ببیند چه کسی با چه شماره‌ای صحبت کرد.
  if (state === 'idle' || !state) {
    const cur = live.get(line.id);
    if (cur && cur.state !== 'ended') { live.set(line.id, Object.assign({}, cur, { state: 'ended', endedAt: Date.now(), at: Date.now() })); notify(); }
    return { ok: true };
  }
  const phone = normalizePhone(b.phone) || String(b.phone || '').slice(0, 32);
  const next = state === 'ringing' ? 'ringing' : 'talking';
  // زمان شروع را خودِ سرور می‌گذارد، نه گوشی: ساعت گوشی‌ها چند دقیقه عقب/جلو است و
  // ضربانِ هر ۲۰ ثانیه هم زمان شروع را دوباره می‌فرستد. فقط وقتی تماس تازه است صفر می‌شود.
  const prev = live.get(line.id);
  const same = prev && prev.phone === phone && prev.state === next && prev.state !== 'ended';
  // ضربان واقعی = خبری که دست‌کم ۱۵ ثانیه بعد از شروع تماس رسیده باشد. دو خبرِ همان
  // ابتدای تماس (گیرنده + سرویس) ضربان نیستند.
  const beatSeen = !!(same && (prev.beatSeen || Date.now() - prev.startedAt > 15000));
  live.set(line.id, {
    lineId: line.id,
    lineName: line.name || '',
    phone,
    state: next,
    direction: String(b.direction || '').toUpperCase() === 'OUTGOING' ? 'OUTGOING' : 'INCOMING',
    at: Date.now(),
    startedAt: same ? prev.startedAt : Date.now(),
    beatSeen,
  });
  notify();
  return { ok: true };
}

// کارشناس در CRM روی «رسیدگی» یا شماره زد: یعنی دارد با این شماره تماس می‌گیرد.
// (تماس خروجی را اپ گوشی با شماره نمی‌شناسد؛ این‌طور هم‌کاران زودتر خبردار می‌شوند.)
function claim(user, body) {
  const phone = normalizePhone((body || {}).phone) || String((body || {}).phone || '');
  if (!phone) return { ok: true };
  const key = 'crm:' + user.id + ':' + phone;
  if (String((body || {}).release) === 'true' || (body || {}).release === true) { live.delete(key); notify(); return { ok: true }; }
  live.set(key, {
    lineId: key,
    lineName: 'CRM',
    phone,
    state: 'calling',
    direction: 'OUTGOING',
    at: Date.now(),
    startedAt: Date.now(),
    by: user.fullName || user.username || '',
    byId: user.id,
  });
  notify();
  return { ok: true };
}

// فهرست زنده برای CRM — با نام مشتری (اگر پرونده دارد) و کارشناس مسئول
async function list() {
  clean();
  const rows = [...live.values()];
  // ساعت کامپیوتر کارشناس ممکن است چند دقیقه جلو/عقب باشد؛ مرورگر با همین «حالا»ی
  // سرور اختلاف را حساب می‌کند تا مدت مکالمه درست نشان داده شود.
  if (!rows.length) return { calls: [], now: Date.now() };
  const phones = [...new Set(rows.map((r) => r.phone).filter(Boolean))];
  const leads = phones.length
    ? await prisma.lead.findMany({ where: { phone: { in: phones } }, select: { id: true, customerName: true, phone: true, owner: { select: { fullName: true } } } })
    : [];
  const byPhone = new Map(leads.map((l) => [l.phone, l]));
  return {
    now: Date.now(),
    calls: rows.map((r) => {
      const lead = byPhone.get(r.phone);
      const d = drafts.get(r.phone);
      return Object.assign({}, r, {
        leadId: lead ? lead.id : null,
        name: lead ? lead.customerName : '',
        owner: lead && lead.owner ? lead.owner.fullName : '',
        draft: d ? { by: d.by, userId: d.userId, outcomes: d.outcomes, note: d.note, name: d.name, heardFrom: d.heardFrom, productNote: d.productNote, days: d.days } : null,
      });
    }).sort((a, b) => a.startedAt - b.startedAt),
  };
}

// شماره‌هایی که همین حالا روی خط‌اند (برای نشان دادن «الان دارند زنگ می‌زنند» روی ردیف‌ها)
function busyPhones() {
  clean();
  return [...live.values()].map((r) => r.phone).filter(Boolean);
}

// ---------------------------------------------------------------
// «فرم همزمان با مکالمه»: کارشناس وسط تماس فرم را پر می‌کند؛ پیش‌نویس این‌جا می‌ماند و
// به‌محض اینکه تماس از گوشی برسد، خودکار روی همان تماس ثبت می‌شود (دوباره‌کاری ندارد).
const drafts = new Map(); // phone → { by, userId, name, outcomes, note, productNote, next, days, at }
const DRAFT_TTL = 45 * 60 * 1000;

function cleanDrafts() {
  const now = Date.now();
  for (const [k, v] of drafts) if (now - v.at > DRAFT_TTL) drafts.delete(k);
}

async function saveDraft(user, body) {
  cleanDrafts();
  const b = body || {};
  const phone = normalizePhone(b.phone) || String(b.phone || '').slice(0, 32);
  const bad = (msg) => { const e = new Error(msg); e.status = 400; return e; };
  if (!phone) throw bad('شماره‌ی تماس مشخص نیست');
  if (!Array.isArray(b.outcomes) || !b.outcomes.length) throw bad('نتیجه‌ی تماس را انتخاب کنید');
  // پاسخ‌دهنده را خود کارشناس انتخاب می‌کند (پیش‌فرض: خودش)
  let operator = user;
  if (b.operatorUserId && b.operatorUserId !== user.id) {
    const u = await prisma.user.findUnique({ where: { id: String(b.operatorUserId) }, select: { id: true, fullName: true, username: true, isActive: true } });
    if (!u || !u.isActive) throw bad('پاسخ‌دهنده پیدا نشد');
    operator = u;
  }
  const draft = {
    phone,
    userId: operator.id,
    by: operator.fullName || operator.username || '',
    name: String(b.name || '').slice(0, 191),
    outcomes: Array.isArray(b.outcomes) ? b.outcomes.slice(0, 6) : [],
    note: String(b.note || '').slice(0, 4000),
    productNote: String(b.productNote || '').slice(0, 191),
    heardFrom: String(b.heardFrom || '').slice(0, 64),
    days: Number(b.days) >= 0 ? Number(b.days) : 3,
    at: Date.now(),
  };
  // تماس قبلاً از گوشی رسیده؟ همین حالا روی آن ثبت شود؛ وگرنه پیش‌نویس منتظر رسیدن تماس می‌ماند
  if (await require('./callService').applyDraftToRecent(phone, draft)) {
    drafts.delete(phone);
    notify();
    return { ok: true, applied: true };
  }
  drafts.set(phone, draft);
  notify();
  return { ok: true, applied: false };
}

function getDraft(phone) {
  cleanDrafts();
  return drafts.get(normalizePhone(phone) || String(phone || '')) || null;
}
function clearDraft(phone) {
  drafts.delete(normalizePhone(phone) || String(phone || ''));
  notify();
}

// وقتی خودِ تماس از گوشی رسید یعنی مکالمه تمام شده — نوار بالای صفحه همان لحظه بسته می‌شود
// (بعضی گوشی‌ها پیام «قطع شد» را نمی‌فرستند).
function endForLine(lineId, phone) {
  const p = normalizePhone(phone) || String(phone || '');
  let changed = false;
  for (const [k, cur] of live) {
    // همان خط، یا هر ردیفی که با همین شماره باز مانده (مثلاً «کارشناس دارد تماس می‌گیرد»)
    const sameLine = k === lineId;
    const samePhone = p && cur.phone === p;
    if (!sameLine && !samePhone) continue;
    if (cur.state === 'ended') continue;
    if (cur.state === 'calling') { live.delete(k); changed = true; continue; }
    live.set(k, Object.assign({}, cur, { state: 'ended', endedAt: Date.now(), at: Date.now() }));
    changed = true;
  }
  if (changed) notify();
}

module.exports = { set, claim, list, busyPhones, bus, saveDraft, getDraft, clearDraft, endForLine };
