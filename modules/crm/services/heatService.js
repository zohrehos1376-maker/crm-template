// 🌤 لید گرم — بدون فرمول امتیازی (خواست کاربر ۱۴۰۵/۰۸/۲۱). مشتری وقتی «گرم» است که در
// ۷ روز اخیر دست‌کم «دو نشانه‌ی متفاوت» از قصد خرید داشته باشد (یک نشانه کافی نیست):
//   - استعلام قیمت / محصول ناموجود خواست / سفارش داد (نتیجه‌ی ثبت‌شده‌ی تماس)
//   - مراجعه‌ی حضوری (پیگیری با نتیجه‌ی «مراجعه حضوری»)
//   - دست‌کم ۲ بار خودش تماس گرفته / مکالمه‌ی طولانی (۳ دقیقه یا بیشتر)
// «داغ» حذف شد. چیزی ذخیره نمی‌شود؛ هر بار از داده‌های ثبت‌شده حساب می‌شود.
const { prisma } = require('../../../shared/prisma');

const WINDOW_DAYS = 7;
const MIN_SIGNALS = 2; // کمتر از دو نشانه‌ی متفاوت = گرم نیست
const DAY = 86400000;
const CLOSED = ['فروش موفق', 'فروش ناموفق'];
// نتیجه‌ی تماس‌هایی که نشانه‌ی قصد خریدند (کدها در shared/call-outcomes.js)
const BUY_OUTCOMES = { order: 'سفارش داد', price_inquiry: 'استعلام قیمت گرفت', out_of_stock: 'محصول ناموجود خواست' };
const LONG_TALK_SEC = 180;

const fa = (n) => String(n).replace(/\d/g, (d) => '۰۱۲۳۴۵۶۷۸۹'[d]);
const ago = (ms) => {
  const days = Math.floor((Date.now() - ms) / DAY);
  return days <= 0 ? 'امروز' : days === 1 ? 'دیروز' : fa(days) + ' روز پیش';
};

// leads: [{ id, status }] → Map(id → { level: 'warm', at, reasons })
async function heatFor(leads) {
  const open = leads.filter((l) => l && l.id && !CLOSED.includes(l.status));
  const out = new Map();
  if (!open.length) return out;
  const ids = open.map((l) => l.id);
  const since = new Date(Date.now() - WINDOW_DAYS * DAY);
  const [calls, visits] = await Promise.all([
    prisma.callLog.findMany({
      where: { leadId: { in: ids }, startedAt: { gte: since } },
      select: { leadId: true, direction: true, outcomes: true, durationSec: true, startedAt: true },
    }),
    prisma.followup.findMany({
      where: { leadId: { in: ids }, followupDate: { gte: since }, outcome: 'مراجعه حضوری' },
      select: { leadId: true, followupDate: true },
    }),
  ]);

  // هر مشتری: آخرین تاریخ هر نشانه + شمار تماس‌های خودش
  const acc = {};
  const get = (id) => (acc[id] = acc[id] || { signals: new Map(), inbound: 0, inboundLast: 0 });
  for (const c of calls) {
    const a = get(c.leadId);
    const at = c.startedAt.getTime();
    for (const code of String(c.outcomes || '').split(',')) {
      if (BUY_OUTCOMES[code]) a.signals.set(code, Math.max(a.signals.get(code) || 0, at));
    }
    // مشتری خودش زنگ زده (حتی بی‌پاسخ) — روی هم یک نشانه حساب می‌شود
    if (c.direction !== 'OUTGOING') { a.inbound++; a.inboundLast = Math.max(a.inboundLast, at); }
    if (c.durationSec >= LONG_TALK_SEC) a.signals.set('talk', Math.max(a.signals.get('talk') || 0, at));
  }
  for (const v of visits) {
    const a = get(v.leadId);
    a.signals.set('visit', Math.max(a.signals.get('visit') || 0, v.followupDate.getTime()));
  }

  const LABEL = Object.assign({ visit: 'مراجعه‌ی حضوری', talk: 'مکالمه‌ی طولانی' }, BUY_OUTCOMES);
  for (const l of open) {
    const a = acc[l.id];
    if (!a) continue;
    const reasons = [];
    let last = 0;
    for (const [code, at] of a.signals) {
      reasons.push(LABEL[code] + ' — ' + ago(at));
      last = Math.max(last, at);
    }
    // تماس خود مشتری فقط وقتی «نشانه‌ی جدا» است که تکرار شده باشد؛ یک تماس ورودی همان تماسی
    // است که نتیجه‌اش (استعلام قیمت و…) بالا شمرده شد و نباید دوبار حساب شود
    if (a.inbound >= 2) {
      reasons.push(fa(a.inbound) + ' بار خودش تماس گرفته — آخری ' + ago(a.inboundLast));
      last = Math.max(last, a.inboundLast);
    }
    // گرم فقط با ترکیب چند نشانه‌ی متفاوت در همین هفته
    if (reasons.length >= MIN_SIGNALS) out.set(l.id, { level: 'warm', at: last, reasons });
  }
  return out;
}

// به فهرست سرنخ‌ها (خروجی toLeadOut) فیلد heat اضافه می‌کند
async function attachHeat(list) {
  const map = await heatFor(list);
  for (const l of list) l.heat = map.get(l.id) || null;
  return list;
}

module.exports = { heatFor, attachHeat, WINDOW_DAYS, MIN_SIGNALS };
