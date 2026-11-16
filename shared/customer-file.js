// پرونده‌ی مشتری CRM نمونه — منطق خالص (بدون دیتابیس) تا آزمایش خودکار داشته باشد:
// گروه پشتیبان، «ترجیح تماس»، «در حال کار توسط…» و ادغام سابقه‌ی عملیات.

// پیام‌رسان‌هایی که گروه پشتیبان مشتری روی آن‌ها ساخته می‌شود
const SUPPORT_PLATFORMS = [
  { code: 'whatsapp', label: 'واتساپ' },
  { code: 'telegram', label: 'تلگرام' },
  { code: 'eitaa', label: 'ایتا' },
  { code: 'bale', label: 'بله' },
  { code: 'rubika', label: 'روبیکا' },
  { code: 'other', label: 'سایر' },
];

// مشتری‌ای که گروه پشتیبان دارد ولی در ۳۰ روز اخیر دست‌کم این تعداد تماس گرفته، با تماس راحت‌تر است
const PREFERS_CALLS_MIN = 5;
const PREFERS_CALLS_DAYS = 30;

function prefersCalls(hasSupportGroup, callsInWindow) {
  return !!hasSupportGroup && Number(callsInWindow) >= PREFERS_CALLS_MIN;
}

// اعتبارسنجی و پاک‌سازی ورودی گروه پشتیبان. خروجی: ستون‌های دیتابیس یا خطا
function cleanSupportGroup(body) {
  const b = body || {};
  const platform = String(b.platform || '').trim();
  if (!platform) return { value: { supportGroupPlatform: null, supportGroupName: null, supportGroupLink: null, supportGroupMembers: null } };
  if (!SUPPORT_PLATFORMS.some((p) => p.code === platform)) return { error: 'پیام‌رسان گروه پشتیبان معتبر نیست' };
  const name = String(b.name || '').trim().slice(0, 120);
  if (!name) return { error: 'نام گروه پشتیبان را بنویسید' };
  const link = String(b.link || '').trim().slice(0, 300);
  if (link && !/^(https?:\/\/|tg:\/\/|whatsapp:\/\/)/i.test(link)) return { error: 'لینک گروه باید با http یا https شروع شود' };
  const members = [...new Set((Array.isArray(b.members) ? b.members : String(b.members || '').split(',')).map((x) => String(x).trim()).filter(Boolean))].slice(0, 30);
  return { value: { supportGroupPlatform: platform, supportGroupName: name, supportGroupLink: link || null, supportGroupMembers: members.length ? members.join(',') : null } };
}

function memberIds(raw) {
  return String(raw || '').split(',').map((x) => x.trim()).filter(Boolean);
}

// «در حال کار توسط…»: کارشناسی که فرمی روی پرونده باز کرده؛ هر ۳۰ ثانیه تمدید، بعد از ۲ دقیقه خودکار پاک.
// در حافظه‌ی همان برنامه نگه داشته می‌شود (سرور یک پردازش دارد)، پس به دیتابیس بار اضافه نمی‌دهد.
const PRESENCE_TTL_MS = 120000;
const PRESENCE_ACTIONS = { followup: 'ثبت پیگیری', call: 'ثبت تماس', kyc: 'احراز همکاری', tasks: 'ثبت وظیفه / ارجاع', report: 'گزارش به مدیر', sms: 'ارسال پیامک', edit: 'ویرایش مشخصات', view: 'بررسی پرونده' };

function createPresence(now) {
  const clock = now || (() => Date.now());
  const map = new Map();
  const alive = (leadId) => {
    const p = map.get(leadId);
    if (p && clock() - p.at > PRESENCE_TTL_MS) { map.delete(leadId); return null; }
    return p || null;
  };
  return {
    // اگر کس دیگری همین الان روی پرونده است، جای او را نمی‌گیرد و او را برمی‌گرداند
    set(leadId, user, action) {
      const cur = alive(leadId);
      if (cur && cur.userId !== user.id) return cur;
      map.set(leadId, { userId: user.id, name: user.fullName, action, label: PRESENCE_ACTIONS[action] || 'بررسی پرونده', at: clock() });
      return null;
    },
    // حضور دیگران (نه خودِ کاربر)
    get(leadId, userId) {
      const cur = alive(leadId);
      return cur && cur.userId !== userId ? cur : null;
    },
    clear(leadId, userId) {
      const cur = map.get(leadId);
      if (cur && cur.userId === userId) map.delete(leadId);
    },
    forLeads(ids, userId) {
      const out = {};
      ids.forEach((id) => { const p = this.get(id, userId); if (p) out[id] = { name: p.name, label: p.label }; });
      return out;
    },
  };
}

// ادغام سابقه: رخدادهای «سابقه‌ی تغییرات» (همه‌ی کارها با نام انجام‌دهنده) + تماس‌های خطوط شرکت.
// ثبت تماس هم در سابقه‌ی تغییرات هست و هم در تماس‌ها؛ برای تکرار نشدن، از تماس‌ها فقط
// تماس‌هایی می‌آیند که هنوز ثبت نشده‌اند (بی‌پاسخ یا بدون گزارش کارشناس).
// سوابقی که در پرونده نشان داده نمی‌شوند (اطلاعاتشان جای دیگری هست):
// - جابه‌جایی تاریخ پیگیری بعدی (خود پیگیری‌ها جدا ثبت می‌شوند)
// - «فروش به مشتری احراز‌نشده» کنار کارت خرید (دلیلش روی همان کارت هست)
// - یادداشت‌های جدا (کادر «یادداشت‌ها»)
// پیامک‌های سامانه از جدول sms_logs می‌آیند؛ خلاصه‌ی «پیامک فرستاده شد» در خود کارت احراز هست
const FOLLOWUP_FIELDS = ['nextFollowUpDate', 'nextFollowUpNote'];
function timelineNoise(a, audits) {
  const fields = (a.changes || []).map((c) => c.field);
  if (a.action === 'updated' && fields.length && fields.every((f) => FOLLOWUP_FIELDS.includes(f))) return true;
  if (a.action === 'note' || a.action === 'note_deleted') return true; // یادداشت‌ها فقط در کادر «یادداشت‌ها» دیده می‌شوند
  if (a.action === 'sale_unverified') {
    return audits.some((p) => (p.action === 'purchase' || p.action === 'first_purchase') && Math.abs(p.createdAt - a.createdAt) < 10000);
  }
  return false;
}

const SMS_TOPIC = {
  kyc_link: 'لینک احراز همکاری', kyc_remind: 'یادآوری تکمیل مدارک',
  kyc_approved: 'تأیید همکاری', kyc_rejected: 'رد مدارک', 'آزمایش': 'پیامک آزمایشی',
};
const SMS_STATUS = { sent: 'فرستاده شد ✓', failed: 'نرسید ✗', manual: 'دستی — باید خودتان بفرستید' };

function mergeTimeline(audits, calls, smsList) {
  const items = [];
  const list = audits || [];
  // کارت «ثبت تماس» یادداشت و پیگیریِ همان تماس را هم نشان می‌دهد: نزدیک‌ترین تماس ثبت‌شده‌ی همان کارشناس قبل از ثبت
  const logged = (calls || []).filter((c) => c.logStatus === 'LOGGED' && c.durationSec > 0).sort((x, y) => y.startedAt - x.startedAt);
  const used = new Set();
  const callOf = (a) => logged.find((c) => !used.has(c.id) && c.startedAt <= a.createdAt + 60000 && (!a.userName || !c.operatorName || c.operatorName === a.userName));
  list.filter((a) => !timelineNoise(a, list)).forEach((a) => {
    const changes = (a.changes || []).filter((c) => !FOLLOWUP_FIELDS.includes(c.field));
    let note = '';
    if (a.action === 'call_logged') {
      const c = callOf(a);
      if (c) {
        used.add(c.id);
        note = [c.note ? '📝 ' + c.note : '', c.followUpAt && !String(a.summary || '').includes('📅') ? '📅 پیگیری بعدی: ' + jdate(c.followUpAt) : ''].filter(Boolean).join('\n');
      }
    }
    // ویرایشی که فقط مرحله را عوض کرده «تغییر مرحله» است، نه «اصلاح مشخصات»
    const stageOnly = a.action === 'updated' && changes.length && changes.every((c) => c.field === 'status');
    const hid = (f) => { const c = (a.changes || []).find((x) => x.field === f); return c ? c.to : ''; };
    const fuKind = hid('_fuKind'), fuNext = hid('_fuNext');
    const extra = fuNext ? '📅 پیگیری بعدی: ' + jdate(new Date(fuNext).getTime()) : '';
    items.push({
      extra,
      id: 'a-' + a.id, kind: a.action, label: (stageOnly ? 'تغییر مرحله' : a.actionLabel) + (fuKind ? ' · ' + fuKind : ''), who: a.userName, at: a.createdAt, text: [a.summary || '', note].filter(Boolean).join('\n'),
      changes,
    });
  });
  // بی‌پاسخ‌ها همیشه دیده می‌شوند — حتی بعد از بسته شدن با تماس برگشتی (logStatus=LOGGED می‌شود ولی
  // محتوایی ندارند، چون نتیجه‌ی مکالمه مال خودِ تماس برگشتی است، نه بی‌پاسخ)؛ بقیه‌ی تماس‌های ثبت‌شده
  // همان خلاصه‌ای را دارند که در سابقه («call_logged») آمده، پس دوباره نشان داده نمی‌شوند.
  (calls || []).filter((c) => {
    const missed = c.direction === 'MISSED' || c.direction === 'REJECTED' || (c.direction === 'INCOMING' && !c.durationSec);
    return missed || c.logStatus !== 'LOGGED';
  }).forEach((c) => {
    const missed = c.direction === 'MISSED' || c.direction === 'REJECTED' || (c.direction === 'INCOMING' && !c.durationSec);
    items.push({
      id: 'c-' + c.id, kind: missed ? (c.callbackDone ? 'call_missed_done' : 'call_missed') : 'call',
      label: missed ? 'تماس بی‌پاسخ · ' + (c.callbackDone ? 'تماس برگشتی گرفته شد ✓' : 'بدون تماس برگشتی')
        : (c.direction === 'OUTGOING' ? 'تماس خروجی' : 'تماس ورودی') + ' · ' + minutes(c.durationSec),
      who: c.operatorName || (missed ? 'بدون پاسخ' : 'گزارش‌نشده'), at: c.startedAt, text: c.note || '', changes: [],
    });
  });
  // پیامک‌های سامانه: متن کامل در سابقه می‌ماند (مثلاً لینک احراز که برای مشتری رفته)
  (smsList || []).forEach((s) => {
    items.push({
      id: 's-' + s.id, kind: 'sms', label: 'پیامک' + (SMS_TOPIC[s.topic] ? ' · ' + SMS_TOPIC[s.topic] : ''),
      who: s.by || 'سیستم', at: s.at, text: s.body || '', changes: [],
      extra: (SMS_STATUS[s.status] || s.status) + (s.error ? ' — ' + s.error : ''),
    });
  });
  return items.sort((x, y) => y.at - x.at);
}

function jdate(ms) {
  try { return require('./jalali').formatDate(new Date(ms)); } catch (e) { return new Date(ms).toISOString().slice(0, 10); }
}

function minutes(sec) {
  const s = Math.max(0, Number(sec) || 0);
  return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0') + ' دقیقه';
}

module.exports = { SUPPORT_PLATFORMS, PREFERS_CALLS_MIN, PREFERS_CALLS_DAYS, PRESENCE_TTL_MS, PRESENCE_ACTIONS, prefersCalls, cleanSupportGroup, memberIds, createPresence, mergeTimeline, minutes };
