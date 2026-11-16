'use strict';
/**
 * مرحله‌ی مشتری (یک وضعیت انحصاری برای هر مشتری) و «اقدام بعدی».
 *
 * داده از جاهای موجود خوانده می‌شود — چیزی دوباره ثبت نمی‌شود:
 *   kycStatus: none → awaiting (لینک رفت) → pending (فرم آمد) → approved / rejected
 *   kycRejectNotifiedAt: رد به مشتری اطلاع داده شد
 *   firstPurchaseAt: اولین خرید
 *   lastActivityAt: آخرین تماس/پیگیری (برای تشخیص غیرفعال)
 *
 * فقط مشتریِ همکار (jobType دارد یا احراز شروع شده) مرحله می‌گیرد؛
 * خرده‌فروش فعلاً بی‌مرحله است (تصمیم کاربر، ۱۴۰۵/۰۸/۰۷).
 */

var Cycle = require('./purchase-cycle');

var INACTIVE_DAYS = 60;

// ترتیب = ترتیب قیف فروش
var STAGES = [
  { code: 'inquiry',       label: 'تماس اولیه / استعلام',   tone: 'new',     action: 'لینک فرم احراز را بفرست',        actionKey: 'kyc_send' },
  { code: 'form_sent',     label: 'منتظر مدارک',              tone: 'wait',    action: 'یادآوری پر کردن فرم',             actionKey: 'kyc_remind' },
  // لید فرم همکاری سایت که مشخصاتش آمده ولی عکس مدرک ندارد — لینکی هم فرستاده نشده
  { code: 'docs_needed',   label: 'منتظر مدارک',              tone: 'wait',    action: 'درخواست مدارک از مشتری',          actionKey: 'kyc_send' },
  { code: 'form_review',   label: 'منتظر تأیید کارشناس',      tone: 'review',  action: 'مدارک را ببین: تأیید یا رد',      actionKey: 'kyc_review' },
  { code: 'rejected',      label: 'رد شد — باید اطلاع دهید',  tone: 'bad',     action: 'اطلاع رد به مشتری (پیامک/تماس)',  actionKey: 'kyc_reject_notify' },
  { code: 'rejected_done', label: 'رد شد — اطلاع داده شد',    tone: 'off',     action: '',                                 actionKey: '' },
  { code: 'approved',      label: 'احراز شده — پیگیری',       tone: 'ok',      action: 'لیست قیمت بفرست یا تماس بگیر',    actionKey: 'followup' },
  { code: 'bought',        label: 'خرید کرد',                 tone: 'done',    action: 'پیگیری خرید بعدی',                actionKey: 'followup' },
  { code: 'inactive',      label: 'غیرفعال',                  tone: 'off',     action: 'تماس احیا',                        actionKey: 'followup' }
];

var BY_CODE = STAGES.reduce(function (m, s) { m[s.code] = s; return m; }, {});

function daysSince(d, now) {
  if (!d) return null;
  return (now.getTime() - new Date(d).getTime()) / 86400000;
}

/** آیا این مشتری اصلاً مرحله دارد؟ (همکار یا کسی که احراز برایش شروع شده) */
function hasStage(lead) {
  if (!lead) return false;
  var kyc = lead.kycStatus || 'none';
  return kyc !== 'none' || !!lead.jobType || !!lead.shopName;
}

/**
 * مرحله‌ی فعلی. lead: { kycStatus, kycRejectNotifiedAt, firstPurchaseAt, lastActivityAt, jobType, shopName }
 * برمی‌گرداند null اگر مشتری مرحله نداشته باشد (خرده‌فروش).
 */
function stageOf(lead, now) {
  if (!hasStage(lead)) return null;
  var at = now ? new Date(now) : new Date();
  if (lead.firstPurchaseAt) return BY_CODE.bought;

  var kyc = lead.kycStatus || 'none';
  if (kyc === 'rejected') return lead.kycRejectNotifiedAt ? BY_CODE.rejected_done : BY_CODE.rejected;
  if (kyc === 'pending') return BY_CODE.form_review;
  // «awaiting» دو حالت دارد: لینک فرستاده شده (یادآوری) یا لید از فرم سایت آمده و فقط عکس مدرک کم است
  if (kyc === 'awaiting') return lead.kycToken ? BY_CODE.form_sent : BY_CODE.docs_needed;
  // مشتری خودش فرم سایت را پر کرده (کانال ورود یا سابقه‌ی «ورود از فرم سایت») ولی هنوز
  // عکس مدرکی نرسیده: دیگر «تماس اولیه» نیست و نباید بنویسیم «لینک فرم احراز را بفرست».
  if (kyc === 'none' && (lead.fromSiteForm || /فرم همکاری سایت/.test(String(lead.channel || '')))) return BY_CODE.docs_needed;
  if (kyc === 'approved') {
    var idle = daysSince(lead.lastActivityAt, at);
    if (idle !== null && idle >= INACTIVE_DAYS) return BY_CODE.inactive;
    return BY_CODE.approved;
  }
  return BY_CODE.inquiry;
}

/** { code, label, tone, action, actionKey } یا null */
function describe(lead, now) {
  var s = stageOf(lead, now);
  if (!s) return null;
  // مشتریِ خریدکرده: «اقدام بعدی» همان قدم چرخه‌ی بعد از خرید است، نه یک جمله‌ی کلی
  var action = s.action;
  if (s.code === 'bought' && lead && Cycle.isStep(lead.purchaseFollowStep)) {
    action = Cycle.noteOf(lead.purchaseFollowStep);
  }
  return { code: s.code, label: s.label, tone: s.tone, action: action, actionKey: s.actionKey };
}

/** شمارش هر پله برای نوار فیلتر و قیف فروش */
function counts(leads, now) {
  var out = {};
  STAGES.forEach(function (s) { out[s.code] = 0; });
  (leads || []).forEach(function (l) {
    var s = stageOf(l, now);
    if (s) out[s.code] += 1;
  });
  return out;
}

/** قیف فروش: چند نفر به هر پله رسیده‌اند (تجمعی، برای مدیر فروش) */
function funnel(leads, now) {
  var c = counts(leads, now);
  var reachedForm = c.form_sent + c.docs_needed + c.form_review + c.rejected + c.rejected_done + c.approved + c.bought + c.inactive;
  var reachedReview = c.form_review + c.rejected + c.rejected_done + c.approved + c.bought + c.inactive;
  var reachedApproved = c.approved + c.bought + c.inactive;
  return [
    { label: 'تماس اولیه', n: c.inquiry + reachedForm },
    { label: 'فرم فرستاده شد', n: reachedForm },
    { label: 'فرم آمد', n: reachedReview },
    { label: 'تأیید شد', n: reachedApproved },
    { label: 'خرید کرد', n: c.bought }
  ];
}

module.exports = { STAGES: STAGES, INACTIVE_DAYS: INACTIVE_DAYS, hasStage: hasStage, stageOf: stageOf, describe: describe, counts: counts, funnel: funnel };
