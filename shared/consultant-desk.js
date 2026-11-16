// منطق خالص «میز کار مشاور» (بدون دیتابیس، با آزمون خودکار): ساختن ردیف‌ها از تماس‌ها و ورودی‌های فرم/وردست،
// تشخیص «منتظر پاسخ»، آمار امروز هر منبع، فیلتر و جست‌وجو.
const LATE_MINUTES = 30;
const MISSED = ['MISSED', 'REJECTED'];

function leadInfo(l, queueId) {
  if (!l) return { leadId: null, name: '', city: '', shop: '', job: '', kyc: 'none', owner: '', inQueue: false, supportGroup: null };
  return {
    leadId: l.id, name: l.customerName || '', city: l.city || '', shop: l.shopName || '', job: l.jobType || '', kyc: l.kycStatus || 'none',
    owner: l.ownerId === queueId ? '' : (l.owner ? l.owner.fullName : ''), inQueue: l.ownerId === queueId, supportGroup: l.supportGroupPlatform || null,
  };
}

function isVardast(lead) {
  const tags = Array.isArray(lead.tags) ? lead.tags : [];
  return tags.includes('وردست') || /وردست/.test(lead.channel || '');
}

// calls: خروجی callOut + logStatus/callbackDone؛ intakes: { id, at, summary, lead }
// doneMap: leadId → { at, by, note } آخرین «رسیدگی شد» فرم/لید (note = اقدامی که ثبت شد)
function buildRows(calls, intakes, leadsByPhone, queueId, doneMap) {
  const rows = [];
  calls.forEach((c) => {
    const missed = MISSED.includes(c.direction);
    const lead = leadsByPhone.get(c.phone) || null;
    rows.push(Object.assign(leadInfo(lead, queueId), {
      id: 'call-' + c.id, callId: c.id, type: 'call', at: c.startedAt, phone: c.phone,
      name: (lead && lead.customerName) || c.callerName || c.leadName || '',
      direction: c.direction, directionLabel: c.directionLabel, durationSec: c.durationSec, durationLabel: c.durationLabel,
      line: c.lineName, operator: c.operatorName, note: c.note, outcomes: c.outcomeLabels || [],
      missed, unlogged: !missed && c.logStatus === 'UNLOGGED', callbackDone: !!c.callbackDone,
      // تا وقتی محتوای مکالمه ثبت نشده، تماس «منتظر» می‌ماند — نه بی‌پاسخِ بی‌تماس، نه تماسِ ثبت‌نشده از فهرست بیرون نمی‌رود
      waiting: (missed && !c.callbackDone) || (!missed && c.logStatus === 'UNLOGGED'), call: c,
    }));
  });
  intakes.forEach((a) => {
    // نوع ردیف از خود ورودی است (فرم یا وردست)، نه از برچسب پرونده — مشتری قدیمی هم در تب درست بیاید
    const vardast = a.action ? a.action === 'intake_vardast' : isVardast(a.lead);
    rows.push(Object.assign(leadInfo(a.lead, queueId), {
      id: 'intake-' + a.id, type: vardast ? 'vardast' : 'form', at: a.at, phone: a.lead.phone, source: a.lead.channel || a.summary || '',
      // خلاصه‌ی گفت‌وگوی وردست (کامنت هوش مصنوعی) — کارشناس باید قبل از تماس ببیندش
      note: a.summary || '',
      // پرونده پیش از این ورودی در CRM بوده؟ (بیش از یک دقیقه قبل ساخته شده)
      existing: !!(a.leadCreatedAt && a.leadCreatedAt < a.at - 60000),
    }));
    const r = rows[rows.length - 1];
    const d = doneMap && doneMap[a.lead.id];
    r.done = !!(d && d.at >= a.at);
    r.doneBy = r.done ? d.by : '';
    r.doneNote = r.done ? (d.note || '') : '';
    // مسئول پرونده حذف شده: هر ورودیِ رسیدگی‌نشده منتظر است
    r.waiting = !r.done;
    r.doing = false;
  });
  // تعداد تماس هر شماره در همین بازه، برای «سابقه‌ی این شماره»
  const perPhone = {};
  rows.forEach((r) => { if (r.type === 'call' && r.phone) perPhone[r.phone] = (perPhone[r.phone] || 0) + 1; });
  rows.forEach((r) => { r.phoneCalls = perPhone[r.phone] || 0; });
  return rows.sort((x, y) => y.at - x.at);
}

function startOfTodayTehran(now) {
  // تهران UTC+3:30 بدون ساعت تابستانی
  const t = (now || Date.now()) + 3.5 * 3600000;
  return t - (t % 86400000) - 3.5 * 3600000;
}

function stats(rows, now) {
  const today = startOfTodayTehran(now);
  const out = { call: { today: 0, waiting: 0 }, form: { today: 0, waiting: 0 }, vardast: { today: 0, waiting: 0 }, waiting: 0, unlogged: 0 };
  rows.forEach((r) => {
    if (r.at >= today) out[r.type].today++;
    if (r.waiting) { out[r.type].waiting++; out.waiting++; }
    if (r.unlogged) out.unlogged++;
  });
  return out;
}

function filter(rows, kind, q, status) {
  const text = String(q || '').trim().toLowerCase();
  return rows.filter((r) => {
    if (kind === 'waiting' && !r.waiting) return false;
    if (kind === 'unlogged' && !r.unlogged) return false;
    if (['call', 'form', 'vardast'].includes(kind) && r.type !== kind) return false;
    if (status === 'waiting' && !r.waiting) return false;
    if (status === 'doing' && !r.doing) return false;
    if (status === 'done' && !r.done) return false;
    if (!text) return true;
    return [r.name, r.phone, r.city, r.shop, r.operator, r.owner].join(' ').toLowerCase().includes(text);
  });
}

module.exports = { LATE_MINUTES, buildRows, stats, filter, startOfTodayTehran };
