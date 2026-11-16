// پرونده‌ی مشتری CRM نمونه: سابقه‌ی یک‌جای همه‌ی عملیات، گروه پشتیبان، «ترجیح تماس» و «در حال کار توسط…»
const { prisma } = require('../../../shared/prisma');
function fail(status, message) {
  const e = new Error(message);
  e.status = status;
  return e;
}
const F = require('../../../shared/customer-file');
const W = require('../../../shared/workdesk');
const Stage = require('../../../shared/customer-stage');
const Cycle = require('../../../shared/purchase-cycle');
const auditService = require('./auditService');
const leadService = require('./leadService');

const presence = F.createPresence();

// شمار تماس‌ها بر اساس شماره (نه فقط اتصال به پرونده) تا تماس‌های قبل از ساخت پرونده هم حساب شوند
async function callCounts(leads) {
  const since = new Date(Date.now() - F.PREFERS_CALLS_DAYS * 86400000);
  const phones = [...new Set(leads.map((l) => l.phone).filter(Boolean))];
  const [all, recent] = phones.length ? await Promise.all([
    prisma.callLog.groupBy({ by: ['phoneNormalized'], where: { phoneNormalized: { in: phones } }, _count: { _all: true }, _max: { startedAt: true } }),
    prisma.callLog.groupBy({ by: ['phoneNormalized'], where: { phoneNormalized: { in: phones }, startedAt: { gte: since } }, _count: { _all: true } }),
  ]) : [[], []];
  const byPhone = {};
  all.forEach((r) => { byPhone[r.phoneNormalized] = { total: r._count._all, last30: 0, lastAt: r._max.startedAt ? r._max.startedAt.getTime() : null }; });
  recent.forEach((r) => { if (byPhone[r.phoneNormalized]) byPhone[r.phoneNormalized].last30 = r._count._all; });
  const out = {};
  leads.forEach((l) => { out[l.id] = byPhone[l.phone] || { total: 0, last30: 0, lastAt: null }; });
  return out;
}

// برای فهرست مشتریان و میز کار: «ترجیح تماس» و «در حال کار توسط» هر مشتری
async function badgesFor(user, leads) {
  const ids = leads.map((l) => l.id);
  if (!ids.length) return {};
  const counts = await callCounts(leads);
  const busy = presence.forLeads(ids, user.id);
  const out = {};
  leads.forEach((l) => {
    out[l.id] = { calls30: counts[l.id].last30, prefersCalls: F.prefersCalls(!!l.supportGroupPlatform, counts[l.id].last30), presence: busy[l.id] || null };
  });
  return out;
}

async function info(user, leadId) {
  const lead = await leadService.getOwnedLead(user, leadId);
  const row = await prisma.lead.findUnique({ where: { id: leadId }, select: { supportGroupPlatform: true, supportGroupName: true, supportGroupLink: true, supportGroupMembers: true, kycStatus: true, kycReason: true, kycRejectNotifiedAt: true, firstPurchaseAt: true, purchaseFollowStep: true, jobType: true, shopName: true, nextFollowUpDate: true, nextFollowUpNote: true, channel: true, status: true, cancelReason: true, _count: { select: { kycDocuments: true } } } });
  const fromSiteForm = !!(await prisma.leadAudit.count({ where: { leadId, action: 'intake' } }));
  const rawKyc = row.kycStatus || 'none';
  const shownKyc = rawKyc === 'none' && (fromSiteForm || /فرم همکاری سایت/.test(String(row.channel || ''))) ? 'awaiting' : rawKyc;
  const ids = F.memberIds(row.supportGroupMembers);
  const members = ids.length ? await prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, fullName: true } }) : [];
  const stats = (await callCounts([{ id: leadId, phone: lead.phone }]))[leadId];
  return {
    leadId: lead.id,
    supportGroup: row.supportGroupPlatform ? {
      platform: row.supportGroupPlatform, platformLabel: (F.SUPPORT_PLATFORMS.find((p) => p.code === row.supportGroupPlatform) || {}).label || row.supportGroupPlatform,
      name: row.supportGroupName || '', link: row.supportGroupLink || '', members: members.map((m) => ({ id: m.id, name: m.fullName })),
    } : null,
    calls: stats,
    prefersCalls: F.prefersCalls(!!row.supportGroupPlatform, stats.last30),
    prefersCallsMin: F.PREFERS_CALLS_MIN,
    presence: presence.get(leadId, user.id),
    platforms: F.SUPPORT_PLATFORMS,
    // مرحله‌ی مشتری و اقدام بعدی (shared/customer-stage.js) — فقط برای همکارها پر است
    stage: Stage.describe(Object.assign({}, row, { fromSiteForm, lastActivityAt: await lastActivityAt(leadId, stats.lastAt) })),
    kycReason: row.kycReason || '',
    // تیک احراز + مدارک + قدم بعدی، تا کارشناس بدون باز کردن بخش‌های دیگر ببیند
    // «وضعیت نمایشی»: مشتریِ فرم سایت عملاً منتظر مدارک است، حتی اگر در دیتابیس هنوز «احراز نشده» باشد
    kyc: { status: shownKyc, raw: row.kycStatus || 'none', label: W.labelOf(W.KYC_STATUSES, shownKyc), documents: row._count.kycDocuments, steps: W.KYC_STATUSES, fromSiteForm },
    notes: await notesOf(leadId),
    nextFollowUp: row.nextFollowUpDate ? Object.assign({ at: row.nextFollowUpDate.getTime(), note: row.nextFollowUpNote || '' }, await followUpSource(leadId, row.nextFollowUpDate)) : null,
    // پیگیری متوقف شده؟ (فقط با دکمه‌ی کارشناس و با دلیل)
    followStopped: row.status === STOPPED ? { reason: row.cancelReason || '' } : null,
  };
}

// آخرین حرکت روی پرونده: جدیدترین تماس یا پیگیری (برای تشخیص «غیرفعال»)
async function lastActivityAt(leadId, lastCallAt) {
  const fu = await prisma.followup.findFirst({ where: { leadId }, orderBy: { createdAt: 'desc' }, select: { createdAt: true } });
  const times = [lastCallAt ? new Date(lastCallAt).getTime() : null, fu ? fu.createdAt.getTime() : null].filter(Boolean);
  return times.length ? new Date(Math.max.apply(null, times)) : null;
}

// پله‌ی «رد شد»: کارشناس به مشتری اطلاع داد (پیامک/تماس) — پله بسته می‌شود
async function markRejectNotified(user, leadId, how) {
  const lead = await leadService.getOwnedLead(user, leadId);
  if (lead.kycStatus !== 'rejected') throw fail(400, 'این مشتری در مرحله‌ی «رد شد» نیست.');
  const at = new Date();
  await prisma.lead.update({ where: { id: leadId }, data: { kycRejectNotifiedAt: at, updatedAt: at } });
  await auditService.log(leadId, user.id, 'kyc_reject_notified', 'اطلاع رد احراز به مشتری داده شد' + (how ? ' (' + String(how).slice(0, 60) + ')' : ''), null);
  return { ok: true, notifiedAt: at };
}

// توقف پیگیری با دلیل — تنها راه بسته شدن پرونده (تصمیم کاربر، ۱۴۰۵/۰۸/۱۲).
// هیچ روال خودکاری پرونده را نمی‌بندد؛ فقط کارشناس، آن هم با نوشتن دلیل.
const STOPPED = 'فروش ناموفق';
async function stopFollowUp(user, leadId, reason) {
  await leadService.getOwnedLead(user, leadId);
  const why = String(reason || '').trim();
  if (why.length < 3) throw fail(400, 'دلیل توقف پیگیری را بنویسید');
  const at = new Date();
  await prisma.lead.update({
    where: { id: leadId },
    data: { status: STOPPED, cancelReason: why.slice(0, 500), nextFollowUpDate: null, nextFollowUpNote: null, purchaseFollowStep: null, updatedAt: at },
  });
  await auditService.log(leadId, user.id, 'follow_stopped', 'پیگیری متوقف شد — ' + why.slice(0, 160), null);
  return { ok: true, reason: why };
}

// چه کسی و کِی «پیگیری بعدی» فعلی را گذاشته — اول تماسی که همین تاریخ را ثبت کرده، بعد سابقه‌ی پرونده
async function followUpSource(leadId, date) {
  const call = await prisma.callLog.findFirst({
    where: { leadId, followUpAt: date }, orderBy: { startedAt: 'desc' },
    select: { startedAt: true, operator: { select: { fullName: true } } },
  });
  if (call) return { by: call.operator ? call.operator.fullName : '', setAt: call.startedAt.getTime(), via: 'ثبت تماس' };
  const moved = await prisma.leadAudit.findFirst({ where: { leadId, action: 'followup_moved' }, orderBy: { createdAt: 'desc' }, select: { createdAt: true, summary: true, userId: true } });
  if (moved && String(moved.summary || '').includes(require('../../../shared/jalali').formatDate(date))) {
    const u = moved.userId ? await prisma.user.findUnique({ where: { id: moved.userId }, select: { fullName: true } }) : null;
    return { by: u ? u.fullName : '', setAt: moved.createdAt.getTime(), via: 'تغییر از پرونده' };
  }
  const audits = await prisma.leadAudit.findMany({
    where: { leadId, changes: { contains: 'nextFollowUpDate' } }, orderBy: { createdAt: 'desc' }, take: 20,
    select: { createdAt: true, changes: true, userId: true },
  });
  for (const a of audits) {
    let ch = [];
    try { ch = JSON.parse(a.changes) || []; } catch (e) { /* */ }
    const c = ch.find((x) => x && x.field === 'nextFollowUpDate');
    if (c && c.to && Math.abs(new Date(c.to) - date) < 86400000) {
      const u = a.userId ? await prisma.user.findUnique({ where: { id: a.userId }, select: { fullName: true } }) : null;
      return { by: u ? u.fullName : '', setAt: a.createdAt.getTime(), via: '' };
    }
  }
  return {};
}

// تغییر یا حذف «پیگیری بعدی» از خود پرونده (پیگیری اشتباه، مثلاً ۳ روزِ پیش‌فرضی که عوض نشده بود)
async function setNextFollowUp(user, leadId, body) {
  const lead = await leadService.getOwnedLead(user, leadId);
  const b = body || {};
  const at = new Date();
  if (b.remove) {
    await prisma.lead.update({ where: { id: leadId }, data: { nextFollowUpDate: null, nextFollowUpNote: null, updatedAt: at } });
    await auditService.log(leadId, user.id, 'followup_removed', 'پیگیری بعدی حذف شد' + (lead.nextFollowUpNote ? ' — ' + String(lead.nextFollowUpNote).slice(0, 150) : ''), null);
    return { ok: true };
  }
  const d = new Date(Number(b.date));
  if (!b.date || isNaN(d)) throw fail(400, 'تاریخ پیگیری معتبر نیست');
  d.setHours(10, 0, 0, 0);
  const note = b.note !== undefined ? String(b.note || '').trim().slice(0, 190) : lead.nextFollowUpNote;
  await prisma.lead.update({ where: { id: leadId }, data: { nextFollowUpDate: d, nextFollowUpNote: note || null, updatedAt: at } });
  await auditService.log(leadId, user.id, 'followup_moved', 'پیگیری بعدی: ' + require('../../../shared/jalali').formatDate(d) + (note ? ' — ' + note.slice(0, 140) : ''), null);
  return { ok: true };
}

// یادداشت‌های جدای پرونده (هر کدام با تاریخ و نویسنده) — در سابقه‌ی پرونده با action «note»
async function notesOf(leadId) {
  const rows = await prisma.leadAudit.findMany({ where: { leadId, action: 'note' }, orderBy: { createdAt: 'desc' }, take: 50, select: { id: true, summary: true, userId: true, createdAt: true } });
  const names = await auditService.userNames(rows.map((r) => r.userId));
  return rows.map((r) => ({ id: r.id, text: r.summary || '', by: names.get(r.userId) || '', userId: r.userId, at: r.createdAt.getTime() }));
}
// حذف یادداشت: فقط نویسنده یا مدیر؛ ردیف پاک نمی‌شود، فقط از فهرست بیرون می‌رود (note_deleted)
async function deleteNote(user, leadId, noteId) {
  await leadService.getOwnedLead(user, leadId);
  const row = await prisma.leadAudit.findUnique({ where: { id: String(noteId || '') } });
  if (!row || row.leadId !== leadId || row.action !== 'note') throw fail(404, 'یادداشت پیدا نشد');
  if (user.role !== 'manager' && row.userId !== user.id) throw fail(403, 'فقط نویسنده‌ی یادداشت یا مدیر می‌تواند آن را حذف کند');
  await prisma.leadAudit.update({ where: { id: row.id }, data: { action: 'note_deleted' } });
  return { notes: await notesOf(leadId) };
}
async function addNote(user, leadId, text) {
  await leadService.getOwnedLead(user, leadId);
  const t = String(text || '').trim();
  if (t.length < 2) throw fail(400, 'متن یادداشت را بنویسید');
  if (t.length > 190) throw fail(400, 'یادداشت حداکثر ۱۹۰ حرف است');
  await auditService.log(leadId, user.id, 'note', t, null);
  await prisma.lead.update({ where: { id: leadId }, data: { updatedAt: new Date() } });
  return { notes: await notesOf(leadId) };
}

// ادامه‌ی پیگیری پرونده‌ی متوقف‌شده: قدم بعدی برای امروز
async function resumeFollowUp(user, leadId, note) {
  await leadService.getOwnedLead(user, leadId);
  const at = new Date();
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  await prisma.lead.update({
    where: { id: leadId },
    data: { status: 'در حال پیگیری', cancelReason: null, nextFollowUpDate: today, nextFollowUpNote: String(note || 'ادامه‌ی پیگیری').slice(0, 190), updatedAt: at },
  });
  await auditService.log(leadId, user.id, 'follow_resumed', 'پیگیری دوباره شروع شد', null);
  return { ok: true };
}

// پله‌ی «خرید کرد» / «ثبت فروش موفق»: هر خرید با شماره و مبلغ فاکتور (ریال) در سابقه‌ی پرونده می‌ماند
// شماره فاکتور: رقم فارسی به انگلیسی، تا ۴۰ نویسه
function cleanInvoice(v) {
  return String(v || '').replace(/[۰-۹]/g, (d) => '۰۱۲۳۴۵۶۷۸۹'.indexOf(d)).trim().slice(0, 40) || null;
}

async function markPurchased(user, leadId, saleReason, sale) {
  const lead = await leadService.getOwnedLead(user, leadId);
  const at = new Date();
  // فروش به مشتری احراز‌نشده ممنوع نیست، ولی دلیلش اجباری است و روی همان کارت خرید می‌ماند (_saleReason)
  const why = String(saleReason || '').trim();
  if (lead.kycStatus !== 'approved' && why.length < 3) throw fail(400, 'این مشتری احراز نشده است؛ دلیل ثبت فروش را بنویسید');
  const s = sale || {};
  const model = String(s.soldModel || '').trim().slice(0, 190) || null;
  const company = String(s.soldCompany || '').trim().slice(0, 190) || null;
  const priceNum = Number(String(s.soldPrice === undefined || s.soldPrice === null ? '' : s.soldPrice).replace(/[^0-9]/g, ''));
  const price = priceNum > 0 ? BigInt(Math.round(priceNum)) : null;
  const invoice = cleanInvoice(s.invoice);
  // هر خرید (اولی یا بعدی) چرخه‌ی پیگیری را از اول شروع می‌کند: ۲ روز بعد پیگیری ارسال
  const data = Object.assign({ firstPurchaseAt: lead.firstPurchaseAt || at, lastPurchaseAt: at, updatedAt: at }, Cycle.start(at));
  if (sale) Object.assign(data, { status: 'فروش موفق', cancelReason: null, soldModel: model, soldCompany: company, soldPrice: price });
  await prisma.$transaction(async (tx) => {
    await tx.lead.update({ where: { id: leadId }, data });
    if (sale && lead.status !== 'فروش موفق') {
      await tx.leadStatusHistory.create({ data: { leadId, oldStatus: lead.status, newStatus: 'فروش موفق', changedBy: user.id } });
    }
  });
  // جزئیات خرید در فیلدهای «_sale…» سابقه ذخیره می‌شود (کارت خرید در پرونده از آن‌ها ساخته می‌شود)
  const details = [];
  if (invoice) details.push({ field: '_saleInvoice', label: 'شماره فاکتور', from: '', to: invoice });
  if (model) details.push({ field: '_saleModel', label: 'محصول', from: '', to: [company, model].filter(Boolean).join(' ') });
  if (price) details.push({ field: '_salePrice', label: 'مبلغ فاکتور (ریال)', from: '', to: String(price) });
  if (why) details.push({ field: '_saleReason', label: 'دلیل فروش بدون احراز', from: '', to: why.slice(0, 160) });
  if (lead.firstPurchaseAt) {
    await auditService.log(leadId, user.id, 'purchase', 'خرید تازه ثبت شد — چرخه‌ی پیگیری از اول', details);
    return { ok: true, purchasedAt: lead.firstPurchaseAt, repeat: true };
  }
  await auditService.log(leadId, user.id, 'first_purchase', 'اولین خرید مشتری ثبت شد', details);
  return { ok: true, purchasedAt: at };
}

async function timeline(user, leadId) {
  const lead = await leadService.getOwnedLead(user, leadId);
  const [audits, calls, smsRows] = await Promise.all([
    auditService.listForLead(leadId),
    prisma.callLog.findMany({ where: { OR: [{ leadId }, { phoneNormalized: lead.phone }] }, orderBy: { startedAt: 'desc' }, take: 200, include: { operator: { select: { fullName: true } } } }),
    prisma.smsLog.findMany({ where: { leadId }, orderBy: { createdAt: 'desc' }, take: 100 }),
  ]);
  const smsNames = await auditService.userNames(smsRows.map((s) => s.userId));
  return F.mergeTimeline(audits, calls.map((c) => ({
    id: c.id, direction: c.direction, durationSec: c.durationSec, logStatus: c.logStatus, callbackDone: c.callbackDone,
    operatorName: c.operator ? c.operator.fullName : '', startedAt: c.startedAt.getTime(), note: c.note || '',
    followUpAt: c.followUpAt ? c.followUpAt.getTime() : null,
  })), smsRows.map((s) => ({
    id: s.id, at: s.createdAt.getTime(), topic: s.topic || '', body: s.body, status: s.status, error: s.error || '',
    by: s.userId ? smsNames.get(s.userId) || '' : 'سیستم',
  })));
}

async function updateSupportGroup(user, leadId, body) {
  await leadService.getOwnedLead(user, leadId);
  const r = F.cleanSupportGroup(body);
  if (r.error) throw fail(400, r.error);
  const before = await prisma.lead.findUnique({ where: { id: leadId }, select: { supportGroupPlatform: true, supportGroupName: true } });
  await prisma.lead.update({ where: { id: leadId }, data: Object.assign({}, r.value, { updatedAt: new Date() }) });
  const label = (code) => (F.SUPPORT_PLATFORMS.find((p) => p.code === code) || {}).label || '—';
  const fmt = (p, n) => (p ? label(p) + ' — ' + n : 'ندارد');
  await auditService.log(leadId, user.id, 'support_group', r.value.supportGroupPlatform ? fmt(r.value.supportGroupPlatform, r.value.supportGroupName) : 'برداشتن گروه پشتیبان',
    [{ field: 'supportGroup', label: 'گروه پشتیبان', from: fmt(before.supportGroupPlatform, before.supportGroupName), to: fmt(r.value.supportGroupPlatform, r.value.supportGroupName) }]);
  return info(user, leadId);
}

function setPresence(user, leadId, action) {
  return presence.set(String(leadId), user, F.PRESENCE_ACTIONS[action] ? action : 'view');
}
// ویرایش هر کارت سابقه‌ی پرونده (✏️ پایین هر کارت). متن اصلی بار اول در «_original» می‌ماند و
// نام ویرایش‌کننده و زمان در «_edited» ثبت می‌شود تا معلوم باشد کارت دست خورده است.
async function editTimelineItem(user, leadId, itemId, body) {
  const lead = await leadService.getOwnedLead(user, leadId);
  const b = body || {};
  const text = String(b.text === undefined || b.text === null ? '' : b.text).trim();
  const id = String(itemId || '');
  const stamp = (user.fullName || user.username || '') + ' · ' + at();
  function at() { return new Date().toISOString(); }

  if (id.startsWith('c-')) {
    const call = await prisma.callLog.findUnique({ where: { id: id.slice(2) } });
    if (!call || (call.leadId !== lead.id && call.phoneNormalized !== lead.phone)) throw fail(404, 'این کارت پیدا نشد');
    await prisma.callLog.update({ where: { id: call.id }, data: { note: text.slice(0, 1000) || null } });
    await auditService.log(lead.id, user.id, 'record_edited', 'یادداشت تماس ویرایش شد: ' + text.slice(0, 150), null);
    return { ok: true };
  }
  if (!id.startsWith('a-')) throw fail(404, 'این کارت پیدا نشد');
  const row = await prisma.leadAudit.findUnique({ where: { id: id.slice(2) } });
  if (!row || row.leadId !== lead.id) throw fail(404, 'این کارت پیدا نشد');
  let changes = [];
  try { changes = row.changes ? JSON.parse(row.changes) : []; } catch (e) { changes = []; }
  const fu = changes.find((c) => c.field === '_followupId');
  if (fu && (row.action === 'followup' || row.action === 'followup_edited')) {
    // کارت پیگیری: خود پیگیری ویرایش می‌شود (همان مسیر قبلی)
    await leadService.editFollowup(user, lead.id, fu.to, { content: text });
    return { ok: true };
  }
  const setChange = (field, label, to) => {
    changes = changes.filter((c) => c.field !== field);
    if (to) changes.push({ field, label, from: '', to });
  };
  if (!changes.some((c) => c.field === '_original')) setChange('_original', 'متن اصلی', row.summary || '—');
  setChange('_edited', 'ویرایش', stamp);
  const sale = row.action === 'purchase' || row.action === 'first_purchase';
  const leadData = {};
  if (sale) {
    if (b.saleModel !== undefined) setChange('_saleModel', 'محصول', String(b.saleModel || '').trim().slice(0, 190));
    if (b.saleInvoice !== undefined) setChange('_saleInvoice', 'شماره فاکتور', cleanInvoice(b.saleInvoice) || '');
    if (b.salePrice !== undefined) {
      const n = Number(String(b.salePrice || '').replace(/[۰-۹]/g, (d) => '۰۱۲۳۴۵۶۷۸۹'.indexOf(d)).replace(/[^0-9]/g, ''));
      setChange('_salePrice', 'مبلغ فاکتور (ریال)', n > 0 ? String(Math.round(n)) : '');
    }
    // اگر این آخرین خرید مشتری است، مدل و مبلغ روی خود پرونده هم اصلاح می‌شود (برای گزارش‌ها)
    const last = await prisma.leadAudit.findFirst({ where: { leadId: lead.id, action: { in: ['purchase', 'first_purchase'] } }, orderBy: { createdAt: 'desc' }, select: { id: true } });
    if (last && last.id === row.id) {
      const m = changes.find((c) => c.field === '_saleModel');
      const pr = changes.find((c) => c.field === '_salePrice');
      leadData.soldModel = m ? m.to : null;
      leadData.soldPrice = pr ? BigInt(pr.to) : null;
    }
  }
  await prisma.leadAudit.update({ where: { id: row.id }, data: { summary: text ? text.slice(0, 190) : row.summary, changes: JSON.stringify(changes) } });
  if (Object.keys(leadData).length) await prisma.lead.update({ where: { id: lead.id }, data: leadData });
  return { ok: true };
}

// حذف فروشِ ثبت‌شده از پرونده (اشتباه ثبت شده بود). کارت خرید پاک نمی‌شود: به «فروش حذف‌شده» تبدیل
// می‌شود (با دلیل و نام حذف‌کننده) و از گزارش‌ها بیرون می‌رود؛ وضعیت خرید پرونده از خریدهای باقی‌مانده دوباره ساخته می‌شود.
// فقط مدیر یا همان کسی که فروش را ثبت کرده.
async function deleteSale(user, leadId, itemId, reason) {
  const lead = await leadService.getOwnedLead(user, leadId);
  const why = String(reason || '').trim();
  if (why.length < 3) throw fail(400, 'دلیل حذف فروش را بنویسید');
  const id = String(itemId || '').replace(/^a-/, '');
  const row = await prisma.leadAudit.findUnique({ where: { id } });
  if (!row || row.leadId !== lead.id || !['purchase', 'first_purchase'].includes(row.action)) throw fail(404, 'این فروش پیدا نشد');
  if (user.role !== 'manager' && row.userId !== user.id) throw fail(403, 'فقط مدیر یا ثبت‌کننده‌ی همین فروش می‌تواند آن را حذف کند');
  let changes = [];
  try { changes = row.changes ? JSON.parse(row.changes) : []; } catch (e) { changes = []; }
  changes = changes.filter((c) => c.field !== '_deletedBy' && c.field !== '_deleteReason')
    .concat([{ field: '_deletedBy', label: 'حذف', from: '', to: (user.fullName || '') + ' · ' + new Date().toISOString() },
      { field: '_deleteReason', label: 'دلیل حذف', from: '', to: why.slice(0, 190) }]);

  await prisma.$transaction(async (tx) => {
    await tx.leadAudit.update({ where: { id }, data: { action: 'purchase_deleted', changes: JSON.stringify(changes) } });
    const rest = await tx.leadAudit.findMany({ where: { leadId: lead.id, action: { in: ['purchase', 'first_purchase'] } }, orderBy: { createdAt: 'asc' } });
    const data = { updatedAt: new Date() };
    if (!rest.length) {
      // هیچ خریدی نماند: پرونده به حالت قبل از خرید برمی‌گردد و چرخه‌ی پیگیری بعد از خرید بسته می‌شود
      Object.assign(data, { firstPurchaseAt: null, lastPurchaseAt: null, soldModel: null, soldCompany: null, soldPrice: null, purchaseFollowStep: null });
      if (lead.status === 'فروش موفق') {
        data.status = 'در حال پیگیری';
        await tx.leadStatusHistory.create({ data: { leadId: lead.id, oldStatus: lead.status, newStatus: data.status, changedBy: user.id } });
      }
      if (Cycle.isStep(lead.purchaseFollowStep)) { data.nextFollowUpDate = null; data.nextFollowUpNote = null; }
    } else {
      const first = rest[0], last = rest[rest.length - 1];
      // اولین خریدِ باقی‌مانده «خرید اول» حساب می‌شود (برای گزارش‌ها)
      if (first.action !== 'first_purchase') await tx.leadAudit.update({ where: { id: first.id }, data: { action: 'first_purchase' } });
      let lc = [];
      try { lc = last.changes ? JSON.parse(last.changes) : []; } catch (e) { lc = []; }
      const get = (f) => { const c = lc.find((x) => x.field === f); return c ? c.to : null; };
      Object.assign(data, { firstPurchaseAt: first.createdAt, lastPurchaseAt: last.createdAt, soldModel: get('_saleModel'), soldPrice: get('_salePrice') ? BigInt(get('_salePrice')) : null });
      // اگر همان آخرین خرید حذف شد، چرخه‌ی پیگیری از خرید قبلی دوباره حساب می‌شود
      if (row.createdAt >= last.createdAt) Object.assign(data, Cycle.start(last.createdAt));
    }
    await tx.lead.update({ where: { id: lead.id }, data });
  });
  return { ok: true };
}

function clearPresence(user, leadId) { presence.clear(String(leadId), user.id); }
function getPresence(user, leadId) { return presence.get(String(leadId), user.id); }

module.exports = { addNote, deleteNote, setNextFollowUp,
  stopFollowUp,
  resumeFollowUp, info, timeline, updateSupportGroup, badgesFor, setPresence, clearPresence, getPresence, markRejectNotified, markPurchased, editTimelineItem, deleteSale };
