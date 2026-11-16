// احراز هویت همکار (تعمیرکار / قطعه‌فروش):
//   ارسال لینک ← مشتری فرم و مدرک می‌فرستد ← کارشناس تأیید یا رد (با دلیل و پیامک اصلاح) ← بازگشایی با دلیل
// وضعیت روی leads.kyc_status؛ هر قدم در سابقه‌ی پرونده (lead_audits) ثبت می‌شود.
// فایل مدرک‌ها در data/uploads/kyc (بیرون از public و گیت)؛ فقط کاربر واردشده با دسترسی به پرونده می‌بیند.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { prisma } = require('../../../shared/prisma');
const { can } = require('../../../shared/permissions');
const { normalizePhone } = require('../../../shared/phone');
const { KYC_STATUSES, labelOf } = require('../../../shared/workdesk');
const leadService = require('./leadService');
const audit = require('./auditService');
const scripts = require('./scriptService');
const sms = require('../../core/services/smsService');

const UPLOAD_DIR = path.join(__dirname, '../../../data/uploads/kyc');
const TOKEN_DAYS = 14;
const docImage = require('../../../shared/doc-image');
const JOB_TYPES = ['تعمیرکار', 'قطعه‌فروش', 'تعمیرکار و قطعه‌فروش', 'مصرف‌کننده', 'سایر'];

function fail(status, message) {
  const e = new Error(message);
  e.status = status;
  return e;
}
// متنی که فقط «؟» است یعنی سایت با کدگذاری غیر UTF-8 فرستاده (مثل «??? ?????»)؛
// چنین متنی به پرونده‌ی مشتری راه پیدا نکند.
const txt = (v, n) => {
  const t = String(v === undefined || v === null ? '' : v).trim();
  return /^[?\s]+$/.test(t) ? '' : t.slice(0, n);
};

function publicBase(req) {
  if (process.env.PUBLIC_BASE_URL) return process.env.PUBLIC_BASE_URL.replace(/\/+$/, '');
  return req.protocol + '://' + req.get('host');
}

async function newToken(leadId) {
  const token = crypto.randomBytes(16).toString('hex');
  await prisma.lead.update({ where: { id: leadId }, data: { kycToken: token, kycTokenExpiresAt: new Date(Date.now() + TOKEN_DAYS * 86400000) } });
  return token;
}

async function sendTemplate(lead, user, topic, vars, fallback, custom) {
  const tpl = await scripts.byTopic(topic);
  const body = scripts.fill(custom || (tpl ? tpl.body : fallback), Object.assign({ نام: lead.customerName || 'همکار' }, vars));
  const r = await sms.send({ phone: lead.phone, body, leadId: lead.id, userId: user && user.id, topic });
  return r;
}

const KYC_SMS = {
  approve: ['kyc_approved', '{نام} عزیز، همکاری شما با CRM نمونه تأیید شد.'],
  reject: ['kyc_rejected', '{نام} عزیز، مدارک شما نیاز به اصلاح دارد: {دلیل}\n{لینک}'],
  link: ['kyc_link', '{نام} عزیز، لطفاً مشخصات و مدارک همکاری را از این لینک بفرستید:\n{لینک}'],
  remind: ['kyc_remind', '{نام} عزیز، فرم احراز همکاری هنوز تکمیل نشده است:\n{لینک}'],
};

// متن پیامکِ هر چهار اقدام (تأیید/رد/ارسال لینک/یادآوری) پیش از ثبت به کارشناس نشان داده می‌شود
// تا ویرایش یا لغوش کند؛ {لینک} همین‌طور می‌ماند و موقع ارسال با لینک واقعی پر می‌شود
async function smsPreview(user, leadId, action, reason) {
  (action === 'approve' || action === 'reject') ? requireReview(user) : requireSend(user);
  const def = KYC_SMS[action];
  if (!def) throw fail(400, 'نوع پیامک نامعتبر است');
  const lead = await leadService.getOwnedLead(user, leadId);
  const tpl = await scripts.byTopic(def[0]);
  const body = scripts.fill(tpl ? tpl.body : def[1], { نام: lead.customerName || 'همکار', دلیل: txt(reason, 1200), لینک: '{لینک}' });
  return { body, phone: lead.phone };
}

// sendSms=false یعنی کارشناس گفت پیامک نرود؛ smsBody متن ویرایش‌شده‌ی کارشناس است
function smsChoice(opts) {
  const o = opts || {};
  return { send: o.sendSms !== false, body: txt(o.smsBody, 1000) };
}

function requireReview(user) {
  if (!can(user, 'kyc_review')) throw fail(403, 'تأیید و رد مدارک به دسترسی «تأیید و رد مدارک احراز» نیاز دارد');
}
function requireSend(user) {
  if (!can(user, 'kyc_send') && !can(user, 'kyc_review')) throw fail(403, 'ارسال لینک احراز به دسترسی «ارسال لینک احراز» نیاز دارد');
}

async function sendLink(user, leadId, req, opts) {
  requireSend(user);
  const choice = smsChoice(opts);
  const lead = await leadService.getOwnedLead(user, leadId);
  if (lead.kycStatus === 'approved') throw fail(409, 'این همکار احراز شده است');
  const link = publicBase(req) + '/kyc/' + (await newToken(lead.id));
  if (lead.kycStatus === 'none' || lead.kycStatus === 'rejected') {
    await prisma.lead.update({ where: { id: lead.id }, data: { kycStatus: 'awaiting', updatedAt: new Date() } });
  }
  const r = choice.send ? await sendTemplate(lead, user, KYC_SMS.link[0], { لینک: link }, KYC_SMS.link[1], choice.body) : null;
  await audit.log(lead.id, user.id, 'kyc_link', r ? smsNote(r) : 'لینک ساخته شد — پیامک فرستاده نشد (به انتخاب کارشناس)');
  return { link, sms: r };
}

async function remind(user, leadId, req, opts) {
  requireSend(user);
  const choice = smsChoice(opts);
  const lead = await leadService.getOwnedLead(user, leadId);
  if (lead.kycStatus !== 'awaiting' && lead.kycStatus !== 'rejected') throw fail(409, 'یادآوری فقط برای پرونده‌ای که منتظر مدارک است');
  const token = lead.kycToken && lead.kycTokenExpiresAt > new Date() ? lead.kycToken : await newToken(lead.id);
  const link = publicBase(req) + '/kyc/' + token;
  const r = choice.send ? await sendTemplate(lead, user, KYC_SMS.remind[0], { لینک: link }, KYC_SMS.remind[1], choice.body) : null;
  await audit.log(lead.id, user.id, 'kyc_remind', r ? smsNote(r) : 'پیامک فرستاده نشد (به انتخاب کارشناس)');
  return { link, sms: r };
}

function smsNote(r) {
  return r.status === 'sent' ? 'پیامک فرستاده شد' : r.status === 'manual' ? 'پیامک دستی (پنل پیامک تنظیم نشده)' : 'خطای پیامک: ' + (r.error || '');
}

// اطلاع‌رسانی به مشتری (تصمیم کاربر ۱۴۰۵/۰۸/۲۱): اگر پیامک واقعاً رفته باشد، دیگر یادآوری
// تماس گذاشته نمی‌شود. اگر پیامک نرفت (خطا، پنل وصل نیست، یا کارشناس «بدون پیامک» را زد)،
// همان روز هشدار روی پرونده می‌نشیند تا با پیامک یا تماس خبر داده شود.
function smsDelivered(r) { return !!(r && r.status === 'sent'); }
async function notifyCustomer(leadId, r, what) {
  if (smsDelivered(r)) return;
  const why = !r ? 'پیامک فرستاده نشد' : r.status === 'manual' ? 'پنل پیامک وصل نیست' : 'پیامک نرسید';
  await remindCall(leadId, '⚠️ اطلاع به مشتری انجام نشد (' + why + ') — ' + what + ' را با پیامک یا تماس خبر دهید');
}

async function remindCall(leadId, note) {
  const lead = await prisma.lead.findUnique({ where: { id: leadId }, select: { nextFollowUpDate: true } });
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  if (lead && lead.nextFollowUpDate && lead.nextFollowUpDate <= today) return;
  await prisma.lead.update({ where: { id: leadId }, data: { nextFollowUpDate: today, nextFollowUpNote: note.slice(0, 190), updatedAt: new Date() } });
}

async function approve(user, leadId, opts) {
  const choice = smsChoice(opts);
  requireReview(user);
  const lead = await leadService.getOwnedLead(user, leadId);
  if (lead.kycStatus !== 'pending') throw fail(409, 'فقط پرونده‌ی «در انتظار بررسی» تأیید می‌شود');
  if (!(await prisma.kycDocument.count({ where: { leadId } }))) throw fail(409, 'هنوز مدرکی دریافت نشده است');
  // فقط اگر هنوز «در انتظار» است (دو بازبین هم‌زمان: یکی تأیید و دیگری رد نکند)
  const done = await prisma.lead.updateMany({
    where: { id: leadId, kycStatus: 'pending' },
    data: { kycStatus: 'approved', kycReason: null, kycReviewedAt: new Date(), kycReviewedBy: user.id, kycToken: null, kycTokenExpiresAt: null, updatedAt: new Date() },
  });
  if (!done.count) throw fail(409, 'این پرونده همین الان توسط همکار دیگری بررسی شد');
  const r = choice.send ? await sendTemplate(lead, user, KYC_SMS.approve[0], {}, KYC_SMS.approve[1], choice.body) : null;
  await audit.log(leadId, user.id, 'kyc_approved', r ? smsNote(r) : 'پیامک فرستاده نشد (به انتخاب کارشناس)');
  await notifyCustomer(leadId, r, 'تأیید همکاری');
  return { status: 'approved', sms: r };
}

async function reject(user, leadId, reason, req, opts) {
  const choice = smsChoice(opts);
  requireReview(user);
  const why = txt(reason, 1200);
  if (!why) throw fail(400, 'دلیل رد مدارک را بنویسید');
  const lead = await leadService.getOwnedLead(user, leadId);
  if (lead.kycStatus !== 'pending') throw fail(409, 'فقط پرونده‌ی «در انتظار بررسی» رد می‌شود');
  const done = await prisma.lead.updateMany({ where: { id: leadId, kycStatus: 'pending' }, data: { kycStatus: 'rejected', kycReason: why, kycReviewedAt: new Date(), kycReviewedBy: user.id, updatedAt: new Date() } });
  if (!done.count) throw fail(409, 'این پرونده همین الان توسط همکار دیگری بررسی شد');
  const link = publicBase(req) + '/kyc/' + (await newToken(leadId));
  const r = choice.send ? await sendTemplate(lead, user, KYC_SMS.reject[0], { دلیل: why, لینک: link }, KYC_SMS.reject[1], choice.body) : null;
  await audit.log(leadId, user.id, 'kyc_rejected', why + (r ? '' : ' · پیامک فرستاده نشد (به انتخاب کارشناس)'));
  await notifyCustomer(leadId, r, 'دلیل رد مدارک');
  return { status: 'rejected', link, sms: r };
}

async function reopen(user, leadId, reason) {
  requireReview(user);
  const why = txt(reason, 1200);
  if (!why) throw fail(400, 'دلیل بازگشایی را بنویسید');
  const lead = await leadService.getOwnedLead(user, leadId);
  if (lead.kycStatus !== 'approved') throw fail(409, 'فقط پرونده‌ی احرازشده بازگشایی می‌شود');
  await prisma.lead.update({ where: { id: leadId }, data: { kycStatus: 'pending', kycReason: why, updatedAt: new Date() } });
  await audit.log(leadId, user.id, 'kyc_reopened', why);
  return { status: 'pending' };
}

// مدرکِ لینکی فایلی روی سرور ما ندارد؛ کارشناس آن را مستقیم از سایت باز می‌کند.
function docOut(d) {
  let name = '';
  try { name = d.sourceUrl ? decodeURIComponent(String(d.sourceUrl).split('/').pop() || '').slice(0, 80) : ''; } catch (e) { name = ''; }
  return {
    id: d.id,
    mime: d.mime,
    size: d.size,
    // نسخه‌ی محلی دارد → از سرور خودمان باز شود؛ وگرنه از سایت
    url: d.fileName ? null : d.sourceUrl || null,
    siteUrl: d.sourceUrl || null,
    name,
    createdAt: d.createdAt.getTime(),
  };
}

// مدارک چند پرونده با یک پرس‌وجو (به‌جای یک درخواست برای هر کارت) — leadId ← فهرست مدارک
async function docsByLead(leadIds) {
  const out = new Map(leadIds.map((id) => [id, []]));
  if (!leadIds.length) return out;
  const rows = await prisma.kycDocument.findMany({ where: { leadId: { in: leadIds } }, orderBy: { createdAt: 'desc' } });
  rows.forEach((d) => out.get(d.leadId).push(docOut(d)));
  return out;
}

async function documents(user, leadId) {
  const lead = await leadService.getOwnedLead(user, leadId);
  const rows = await prisma.kycDocument.findMany({ where: { leadId }, orderBy: { createdAt: 'desc' } });
  // linkSent: آیا لینک فرم برای مشتری فرستاده شده؟ (لید فرم همکاری سایت لینک نگرفته، خودش فرم را پر کرده)
  return { linkSent: !!lead.kycToken, docs: rows.map(docOut) };
}

async function documentFile(user, docId) {
  const d = await prisma.kycDocument.findUnique({ where: { id: docId } });
  if (!d) throw fail(404, 'مدرک پیدا نشد');
  await leadService.getOwnedLead(user, d.leadId);
  // مدرک بارگذاری‌شده: <hex>.<ext> ؛ نسخه‌ی محلی عکس سایت: site/<hex>.<ext>
  if (!/^(site\/)?[a-f0-9]{32}\.(jpg|png|webp|gif|pdf|mp4|mov)$/.test(String(d.fileName || ''))) throw fail(404, 'فایل مدرک پیدا نشد');
  const p = path.join(UPLOAD_DIR, d.fileName);
  if (!fs.existsSync(p)) throw fail(404, 'فایل مدرک پیدا نشد');
  return { path: p, mime: d.mime };
}

// نسخه‌ی کوچک عکس برای نمایش در صفحه (عکس‌های اصلی گاهی چند مگابایت‌اند و صفحه را کند می‌کردند).
// یک بار ساخته و در data/uploads/kyc/thumbs نگه داشته می‌شود؛ عکس اصلی دست نمی‌خورد.
const THUMB_DIR = path.join(UPLOAD_DIR, 'thumbs');
const THUMB_W = 480;
async function documentThumb(user, docId) {
  const f = await documentFile(user, docId);
  if (!/^image\//.test(f.mime || '')) return f;
  let sharp;
  try { sharp = require('sharp'); } catch (e) { return f; }
  const out = path.join(THUMB_DIR, path.basename(f.path).replace(/\.[a-z0-9]+$/i, '') + '-' + THUMB_W + '.jpg');
  if (!fs.existsSync(out)) {
    try {
      fs.mkdirSync(THUMB_DIR, { recursive: true });
      const tmp = out + '.' + process.pid + '.tmp';
      await sharp(f.path, { failOn: 'none' }).rotate().resize({ width: THUMB_W, height: THUMB_W, fit: 'inside', withoutEnlargement: true })
        .jpeg({ quality: 70, mozjpeg: true }).toFile(tmp);
      fs.renameSync(tmp, out);
    } catch (e) {
      return f; // اگر ساختن نسخه‌ی کوچک نشد، همان عکس اصلی
    }
  }
  return { path: out, mime: 'image/jpeg' };
}

// حذف عکس نامربوط از پرونده (دسترسی «تأیید و رد مدارک»). فایل پاک نمی‌شود، به پوشه‌ی trash می‌رود
// تا اگر اشتباهی حذف شد، برگرداندنش ممکن باشد؛ در سابقه‌ی پرونده هم ثبت می‌شود.
async function removeDocument(user, docId) {
  requireReview(user);
  const d = await prisma.kycDocument.findUnique({ where: { id: String(docId || '') } });
  if (!d) throw fail(404, 'مدرک پیدا نشد');
  await leadService.getOwnedLead(user, d.leadId);
  if (d.fileName && /^(site\/)?[a-f0-9]{32}\.[a-z0-9]+$/.test(d.fileName)) {
    const from = path.join(UPLOAD_DIR, d.fileName);
    const trash = path.join(UPLOAD_DIR, 'trash');
    try {
      fs.mkdirSync(trash, { recursive: true });
      if (fs.existsSync(from)) fs.renameSync(from, path.join(trash, path.basename(d.fileName)));
    } catch (e) { /* حذف از پرونده مهم‌تر است */ }
  }
  await prisma.kycDocument.delete({ where: { id: d.id } });
  const label = d.sourceUrl ? decodeURIComponent(String(d.sourceUrl).split('/').pop() || '').slice(0, 80) : d.fileName;
  await audit.log(d.leadId, user.id, 'kyc_doc_removed', ('عکس حذف شد: ' + (label || 'مدرک')).slice(0, 190));
  return { ok: true };
}

// پرونده‌ها بر اساس وضعیت احراز (برای کارتابل احراز)
// «فرم‌های رسیده»: هر فرم همکاری سایتِ ۳۰ روز اخیر، چه مشتری تازه چه مشتریِ از قبل در CRM
const RECENT_DAYS = 30;
// فرمی که بعد از تأیید احراز رسیده (تکراری) — در فهرست فرم‌ها نمی‌آید
function isRepeatOfApproved(a) {
  return !!(a.lead && a.lead.kycStatus === 'approved' && a.lead.kycReviewedAt && a.lead.kycReviewedAt < a.createdAt);
}

async function recentIntakes() {
  const audits = await prisma.leadAudit.findMany({
    where: { action: 'intake', createdAt: { gte: new Date(Date.now() - RECENT_DAYS * 86400000) } },
    orderBy: { createdAt: 'desc' }, take: 1000, select: { leadId: true, createdAt: true, lead: { select: { kycStatus: true, kycReviewedAt: true } } },
  });
  const latest = new Map();
  audits.forEach((a) => {
    if (latest.has(a.leadId) || isRepeatOfApproved(a)) return;
    latest.set(a.leadId, a.createdAt);
  });
  return latest;
}

const QUEUE_SELECT = { id: true, customerName: true, phone: true, shopName: true, city: true, jobType: true, kycStatus: true, kycReason: true, kycToken: true, kycTokenExpiresAt: true, kycSubmittedAt: true, createdAt: true, channel: true, owner: { select: { fullName: true } }, _count: { select: { kycDocuments: true } } };

// آخرین باری که برای این پرونده‌ها لینک فرم احراز فرستاده یا یادآوری شده (برای تب «احراز نشده»،
// تا کارشناس ببیند قبلاً لینک رفته یا هنوز هیچ اقدامی نشده)
async function lastLinkSent(leadIds) {
  if (!leadIds.length) return new Map();
  const audits = await prisma.leadAudit.findMany({
    where: { leadId: { in: leadIds }, action: { in: ['kyc_link', 'kyc_remind'] } },
    orderBy: { createdAt: 'desc' }, select: { leadId: true, createdAt: true },
  });
  const latest = new Map();
  audits.forEach((a) => { if (!latest.has(a.leadId)) latest.set(a.leadId, a.createdAt); });
  return latest;
}

// شمارنده‌ی قرمز کنار تب‌های «فرم‌های همکاری» و «لیدهای وردست»: چند مشتری از آخرین باری که
// همین کارشناس آن تب را باز کرده فرم/پیام تازه فرستاده‌اند (هر مشتری یک بار شمرده می‌شود)
async function newArrivals(q) {
  const since = (v) => {
    const n = Number(v);
    return new Date(Number.isFinite(n) && n > 0 ? n : Date.now());
  };
  const count = async (action, from) => (await prisma.leadAudit.findMany({
    where: { action, createdAt: { gt: from } }, distinct: ['leadId'], select: { leadId: true }, take: 100,
  })).length;
  const [forms, vardast] = await Promise.all([count('intake', since(q && q.formsSince)), count('intake_vardast', since(q && q.vardastSince))]);
  return { forms, vardast, now: Date.now() };
}

const PAGE_SIZE = 20;

// جست‌وجوی تب روی کل فهرست (نه فقط صفحه‌ی بارشده): نام، شماره، شهر، فروشگاه، کارشناس
function searchWhere(q) {
  const t = txt(q, 60);
  if (!t) return null;
  const digits = t.replace(/[۰-۹]/g, (d) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d))).replace(/[^\d]/g, '');
  const or = [{ customerName: { contains: t } }, { city: { contains: t } }, { shopName: { contains: t } }, { owner: { fullName: { contains: t } } }];
  if (digits.length >= 3) or.push({ phone: { contains: digits } });
  return { OR: or };
}

// opts: { offset, limit, q } — هر بار یک صفحه (پیش‌فرض ۲۰ کارت) تا با زیاد شدن فرم‌ها تب سنگین نشود
async function queue(user, status, opts) {
  const o = opts || {};
  const offset = Math.max(0, Number(o.offset) || 0);
  const limit = Math.min(Math.max(Number(o.limit) || PAGE_SIZE, 1), 200);
  const search = searchWhere(o.q);
  const recent = await recentIntakes();
  let rows;
  let total;
  if (status === 'recent') {
    let ids = [...recent.keys()];
    if (search && ids.length) {
      const hit = await prisma.lead.findMany({ where: { AND: [{ id: { in: ids } }, search] }, select: { id: true } });
      const ok = new Set(hit.map((h) => h.id));
      ids = ids.filter((id) => ok.has(id));
    }
    total = ids.length;
    const page = ids.slice(offset, offset + limit);
    rows = page.length ? await prisma.lead.findMany({ where: { id: { in: page } }, select: QUEUE_SELECT }) : [];
    rows.sort((a, b) => recent.get(b.id) - recent.get(a.id));
  } else {
    const base = { kycStatus: KYC_STATUSES.some((s) => s.code === status) ? status : 'pending' };
    const where = search ? { AND: [base, search] } : base;
    [total, rows] = await Promise.all([
      prisma.lead.count({ where }),
      prisma.lead.findMany({ where, orderBy: [{ kycSubmittedAt: 'desc' }, { updatedAt: 'desc' }, { id: 'asc' }], skip: offset, take: limit, select: QUEUE_SELECT }),
    ]);
  }
  const [linkSentAt, docs, counts] = await Promise.all([
    lastLinkSent(rows.map((l) => l.id)),
    docsByLead(rows.filter((l) => l._count.kycDocuments).map((l) => l.id)),
    prisma.lead.groupBy({ by: ['kycStatus'], _count: { _all: true } }),
  ]);
  return {
    total,
    offset,
    hasMore: offset + rows.length < total,
    leads: rows.map((l) => ({
      receivedAt: recent.has(l.id) ? recent.get(l.id).getTime() : null,
      // پرونده پیش از رسیدن فرم در CRM بوده؟
      existing: recent.has(l.id) ? l.createdAt.getTime() < recent.get(l.id).getTime() - 60000 : null,
      id: l.id,
      name: l.customerName || '',
      phone: l.phone,
      shopName: l.shopName || '',
      city: l.city || '',
      jobType: l.jobType || '',
      kycStatus: l.kycStatus,
      kycLabel: labelOf(KYC_STATUSES, l.kycStatus),
      kycReason: l.kycReason || '',
      submittedAt: l.kycSubmittedAt ? l.kycSubmittedAt.getTime() : null,
      createdAt: l.createdAt.getTime(),
      channel: l.channel || '',
      ownerName: l.owner ? l.owner.fullName : '',
      documents: l._count.kycDocuments,
      docs: docs.get(l.id) || [],
      // لینک فرم احراز برایش فرستاده شده؟ (توکن فعال یا سابقه‌ی ارسال/یادآوری)
      linkSent: !!(l.kycToken && l.kycTokenExpiresAt && l.kycTokenExpiresAt > new Date()) || linkSentAt.has(l.id),
      linkSentAt: linkSentAt.has(l.id) ? linkSentAt.get(l.id).getTime() : null,
    })),
    counts: Object.assign(Object.fromEntries(counts.map((c) => [c.kycStatus, c._count._all])), { recent: recent.size }),
  };
}

// ---------------- بخش عمومی (بدون ورود): فرم احراز با لینک ----------------
async function leadByToken(token) {
  if (!/^[a-f0-9]{32}$/.test(String(token || ''))) throw fail(404, 'لینک نامعتبر است');
  const lead = await prisma.lead.findUnique({ where: { kycToken: token } });
  if (!lead || !lead.kycTokenExpiresAt || lead.kycTokenExpiresAt < new Date()) throw fail(404, 'این لینک منقضی شده است؛ از کارشناس CRM نمونه لینک تازه بخواهید');
  return lead;
}

async function publicForm(token) {
  const l = await leadByToken(token);
  return {
    name: l.customerName || '',
    shopName: l.shopName || '',
    city: l.city || '',
    jobType: l.jobType || '',
    status: l.kycStatus,
    reason: l.kycStatus === 'rejected' ? l.kycReason || '' : '',
    jobTypes: JOB_TYPES,
  };
}

// هر عکس پیش از ذخیره: HEIC ← JPEG و فشرده (shared/doc-image)؛ PDF همان‌طور می‌ماند
async function saveFiles(files) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
  const out = [];
  for (const f of files || []) {
    if (!docImage.acceptable(f.buffer, f.mimetype, f.originalname)) throw fail(400, 'فقط عکس (jpg، png، webp، heic) یا PDF قبول می‌شود');
    let r;
    try { r = await docImage.prepare(f.buffer, f.mimetype, f.originalname); } catch (e) { throw fail(400, e.message); }
    const fileName = crypto.randomBytes(16).toString('hex') + docImage.EXT[r.mime];
    fs.writeFileSync(path.join(UPLOAD_DIR, fileName), r.buf);
    out.push({ fileName, mime: r.mime, size: r.buf.length });
  }
  return out;
}

// آدرس عکس‌هایی که روی خود سایت مانده‌اند. CRM فایل را نمی‌گیرد و ذخیره نمی‌کند،
// فقط آدرس را نگه می‌دارد تا کارشناس با یک کلیک بازش کند.
const MAX_DOC_URLS = 10;
const { isAllowedDocUrl } = require('../../../shared/doc-url');
function docUrls(v) {
  let list = v;
  if (typeof list === 'string') {
    const t = list.trim();
    // هم آرایه‌ی JSON قبول می‌شود، هم یک آدرس تنها، هم چند آدرس جداشده با کاما یا فاصله
    if (t.startsWith('[')) { try { list = JSON.parse(t); } catch (e) { list = t.split(','); } }
    else list = t.replace(/\s+/g, ',').split(',');
  }
  if (!Array.isArray(list)) return [];
  const out = [];
  for (const raw of list) {
    const u = String(raw || '').trim();
    if (!u || u.length > 1000 || !isAllowedDocUrl(u)) continue;
    if (!out.includes(u)) out.push(u);
    if (out.length >= MAX_DOC_URLS) break;
  }
  return out;
}

function profileData(b) {
  const data = {};
  if (txt(b.name, 191)) data.customerName = txt(b.name, 191);
  for (const [k, n] of [['shopName', 191], ['city', 100]]) if (txt(b[k], n)) data[k] = txt(b[k], n);
  if (JOB_TYPES.includes(b.jobType)) data.jobType = b.jobType;
  const nid = String(b.nationalId || '').replace(/[^0-9۰-۹]/g, '');
  if (nid) data.nationalId = nid.slice(0, 16);
  return data;
}

async function publicSubmit(token, body, files) {
  const lead = await leadByToken(token);
  if (!files || !files.length) throw fail(400, 'تصویر مدرک (جواز کسب یا کارت ملی) را انتخاب کنید');
  const saved = await saveFiles(files);
  const data = Object.assign(profileData(body || {}), { kycStatus: 'pending', kycSubmittedAt: new Date(), kycToken: null, kycTokenExpiresAt: null, updatedAt: new Date() });
  await prisma.$transaction([
    prisma.kycDocument.createMany({ data: saved.map((s) => Object.assign({ leadId: lead.id }, s)) }),
    prisma.lead.update({ where: { id: lead.id }, data }),
  ]);
  await audit.log(lead.id, null, 'kyc_submitted', saved.length + ' مدرک');
  return { ok: true };
}

// فرم همکاری سایت (وردپرس) ← webhook با توکن INTAKE_TOKEN. شماره‌ی تازه ← پرونده در «صف بدون مسئول».
async function intakeOnce(body, files) {
  const b = body || {};
  const phone = normalizePhone(b.phone);
  if (!phone) throw fail(400, 'phone required');
  // فرم سایت خودکار است: یک فایل با فرمت ناشناخته نباید کل سرنخ را از بین ببرد.
  // فایل‌های پشتیبانی‌نشده کنار گذاشته می‌شوند و پرونده به هر حال ساخته می‌شود.
  const ok = (files || []).filter((f) => docImage.acceptable(f.buffer, f.mimetype, f.originalname));
  const skipped = (files || []).length - ok.length;
  // راه اصلی: سایت فقط آدرس عکس را می‌فرستد و خود فایل روی سایت می‌ماند
  const urls = docUrls(b.documentUrls !== undefined ? b.documentUrls : b.documentUrl);
  let lead = await prisma.lead.findFirst({ where: { phone } });
  // فرم تکراری از کسی که احرازش از قبل تأیید شده: فقط در سابقه ثبت می‌شود؛ به «فرم‌های همکاری»،
  // فهرست کارها و کارتابل احراز نمی‌آید و مدرک تازه هم اضافه نمی‌شود
  if (lead && lead.kycStatus === 'approved') {
    await audit.log(lead.id, null, 'intake_repeat', (txt(b.source, 64) || 'فرم همکاری سایت') + ' — دوباره فرستاده شد؛ احراز از قبل تأیید شده');
    return { ok: true, leadId: lead.id, repeat: true, documents: 0, links: 0, skipped: 0, received: [], missing: [] };
  }
  if (!lead) {
    const q = await leadService.queueUser();
    const created = await leadService.createLead(
      null,
      { name: txt(b.name, 191), phone, channel: txt(b.source, 64) || 'فرم همکاری سایت', notes: txt(b.note, 4000), shopName: b.shopName, city: b.city, jobType: JOB_TYPES.includes(b.jobType) ? b.jobType : null, intakeAction: 'intake' },
      q.id,
      null
    );
    lead = await prisma.lead.findUnique({ where: { id: created.id } });
  } else {
    await audit.log(lead.id, null, 'intake', txt(b.source, 64) || 'فرم همکاری سایت');
  }
  const saved = ok.length ? await saveFiles(ok) : [];
  const data = profileData(b);
  for (const k of Object.keys(data)) if (lead[k]) delete data[k]; // اطلاعات ثبت‌شده‌ی قبلی بازنویسی نمی‌شود
  // پر کردن فرم سایت یعنی مشتری خودش آمده جلو — همین امروز در فهرست کارها بیفتد،
  // چه پرونده‌ی تازه باشد چه قدیمی. اگر پیگیریِ زودتری دارد، دست نمی‌خورد.
  // مشتری خودش فرم سایت را پر کرده: دیگر «تماس اولیه» نیست و نباید بنویسیم «لینک فرم احراز را بفرست».
  // بدون عکس مدرک → «منتظر مدارک»؛ با عکس → پایین‌تر «منتظر تأیید کارشناس» می‌شود.
  if ((lead.kycStatus || 'none') === 'none') data.kycStatus = 'awaiting';
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  // پرونده‌ای که کارشناس پیگیری‌اش را متوقف کرده، خودکار باز نمی‌شود؛ فقط در سابقه ثبت می‌شود
  if (lead.status !== 'فروش ناموفق' && (!lead.nextFollowUpDate || lead.nextFollowUpDate > today)) {
    data.nextFollowUpDate = today;
    data.nextFollowUpNote = 'فرم همکاری سایت را پر کرد — تماس بگیرید';
  }
  // آدرس‌هایی که از قبل ثبت شده‌اند دوباره اضافه نشوند (ارسال دوباره بی‌خطر است)
  let newUrls = [];
  if (urls.length) {
    const had = await prisma.kycDocument.findMany({ where: { leadId: lead.id, sourceUrl: { in: urls } }, select: { sourceUrl: true } });
    const seen = new Set(had.map((h) => h.sourceUrl));
    newUrls = urls.filter((u) => !seen.has(u));
  }
  if (saved.length || newUrls.length) {
    const rows = saved.map((s) => Object.assign({ leadId: lead.id }, s))
      .concat(newUrls.map((u) => ({ leadId: lead.id, sourceUrl: u, fileName: '', mime: '', size: 0 })));
    await prisma.kycDocument.createMany({ data: rows });
    // نسخه‌ی محلی عکس‌های سایت همان لحظه گرفته می‌شود (منتظر پاسخ نمی‌ماند)
    if (newUrls.length) setImmediate(() => require('./docCacheService').run({ leadId: lead.id }).catch(() => {}));
    if (lead.kycStatus !== 'approved') Object.assign(data, { kycStatus: 'pending', kycSubmittedAt: new Date() });
  }
  // بدون مدرک، وضعیت «احراز نشده» می‌ماند: «منتظر مدارک» فقط وقتی معنی دارد که فرم/لینک
  // برای مشتری فرستاده شده باشد (لید وردست یا فرم بدون پیوست، هنوز چیزی نفرستاده‌ایم).
  if (Object.keys(data).length) await prisma.lead.update({ where: { id: lead.id }, data: Object.assign(data, { updatedAt: new Date() }) });
  // کارشناس باید بداند فایلی آمده ولی قابل باز کردن نبوده
  if (skipped) await audit.log(lead.id, null, 'intake_files_skipped', skipped + ' فایل با فرمت پشتیبانی‌نشده از سایت آمد و ذخیره نشد');
  // فیلدهایی که واقعاً رسیدند — تا توسعه‌دهنده‌ی سایت در پاسخ ببیند چه فرستاده
  // و اگر چیزی جا افتاده خودش بفهمد (مقدارها برگردانده نمی‌شوند، فقط نام فیلدها).
  const FIELDS = ['name', 'phone', 'shopName', 'city', 'jobType', 'nationalId', 'note', 'source'];
  const received = FIELDS.filter((k) => txt(b[k], 500));
  if (urls.length || (files || []).length) received.push('documentUrls');
  const missing = ['name', 'shopName', 'city', 'jobType'].filter((k) => !received.includes(k));
  return {
    ok: true,
    leadId: lead.id,
    documents: saved.length + newUrls.length,
    links: newUrls.length,
    skipped,
    received,
    missing,
  };
}

// هر فرم سایت یک شماره (id) دارد؛ چه سایت بفرستد (POST) چه CRM بخواند (GET)، هر شماره فقط یک‌بار ثبت می‌شود
async function intake(body, files) {
  const b = body || {};
  const entryId = String(b.id || '').trim();
  const key = entryId ? ('wpform:' + entryId).slice(0, 120) : null;
  if (key && (await prisma.webhookEvent.findUnique({ where: { id: key }, select: { id: true } }))) {
    return { ok: true, duplicate: true };
  }
  const r = await intakeOnce(b, files);
  if (key) {
    await prisma.webhookEvent.create({
      data: { id: key, source: 'wpform', type: 'intake', leadId: r.leadId, summary: txt(b.name, 191) || null },
    }).catch(() => {});
  }
  return r;
}

module.exports = { isRepeatOfApproved, docsByLead, newArrivals, leadByToken, sendLink, remind, approve, reject, smsPreview, reopen, documents, documentFile, documentThumb, removeDocument, queue, publicForm, publicSubmit, intake };
