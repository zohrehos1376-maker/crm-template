// دریافت سرنخ و سفارش از «وردست» (اینستاگرام و …) با وب‌هوک — مستندات: https://vardast.chat/docs/webhooks
//   امضا: X-Vardast-Signature = v1=HMAC_SHA256(secret, "{X-Vardast-Timestamp}.{بدنه‌ی خام}") (چند امضا با کاما هنگام تعویض کلید)
//   زمان: بیشتر از ۳۰۰ ثانیه اختلاف ← رد
//   webhook.verification ← مقدار data.challenge در بدنه‌ی پاسخ برگردانده می‌شود
//   تکراری: بر اساس شناسه‌ی رویداد (جدول webhook_events)
// کلید فقط در .env: VARDAST_WEBHOOK_SECRET
const crypto = require('crypto');
const { prisma } = require('../../../shared/prisma');
const { normalizePhone } = require('../../../shared/phone');
const leadService = require('./leadService');
const audit = require('./auditService');

const PLATFORM = { IG: 'اینستاگرام', INSTAGRAM: 'اینستاگرام', TG: 'تلگرام', TELEGRAM: 'تلگرام', WA: 'واتساپ', WHATSAPP: 'واتساپ' };
const txt = (v, n) => String(v === undefined || v === null ? '' : v).trim().slice(0, n);

function fail(status, message) {
  const e = new Error(message);
  e.status = status;
  return e;
}

function configured() {
  return String(process.env.VARDAST_WEBHOOK_SECRET || '').length >= 8;
}

function verify(headers, raw) {
  if (!configured()) throw fail(503, 'vardast webhook not configured');
  const ts = Number(headers['x-vardast-timestamp']);
  if (!ts || Math.abs(Date.now() / 1000 - ts) > 300) throw fail(401, 'stale timestamp');
  const expected = crypto.createHmac('sha256', process.env.VARDAST_WEBHOOK_SECRET).update(ts + '.' + raw).digest('hex');
  const sigs = String(headers['x-vardast-signature'] || '').split(',').map((s) => s.trim().replace(/^v1=/, ''));
  const exp = Buffer.from(expected);
  const ok = sigs.some((s) => s.length === expected.length && crypto.timingSafeEqual(Buffer.from(s), exp));
  if (!ok) throw fail(401, 'bad signature');
}

// خلاصه‌ی سفارش (قالب دقیق order.created در مستندات نیامده؛ هر فیلد معمولی خوانده می‌شود)
function orderSummary(d) {
  const items = Array.isArray(d.items) ? d.items : Array.isArray(d.order_items) ? d.order_items : [];
  const itemText = items
    .map((i) => [i.title || i.name || i.product || '', i.quantity || i.qty ? '×' + (i.quantity || i.qty) : ''].filter(Boolean).join(' '))
    .filter(Boolean)
    .join('، ');
  const address = typeof d.address === 'string' ? d.address : d.address ? [d.address.city, d.address.address || d.address.line1].filter(Boolean).join(' - ') : '';
  return { itemText, address };
}

// خلاصه‌ای که هوش مصنوعی وردست از گفت‌وگو می‌نویسد (فیلد comment؛ نام‌های دیگر هم احتیاطاً خوانده می‌شود)
function aiComment(d) {
  const raw = d.comment || d.summary || d.description || d.note || d.ai_summary || d.conversation_summary || '';
  return txt(typeof raw === 'string' ? raw : '', 1000);
}

// سرنخ وردست مثل فرم سایت باید همان روز در فهرست کارها بیفتد (اولین کارش: زنگ بزن)
async function remindCall(leadId, note) {
  const lead = await prisma.lead.findUnique({ where: { id: leadId }, select: { nextFollowUpDate: true, status: true } });
  if (!lead || lead.status === 'فروش ناموفق') return;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  if (lead.nextFollowUpDate && lead.nextFollowUpDate <= today) return;
  await prisma.lead.update({ where: { id: leadId }, data: { nextFollowUpDate: today, nextFollowUpNote: note.slice(0, 190), updatedAt: new Date() } });
}

async function findOrCreateLead(d, channel, note, intakeSummary) {
  const phone = normalizePhone(d.phone_number || d.phone || (d.customer && d.customer.phone_number));
  if (!phone) return null;
  let lead = await prisma.lead.findFirst({ where: { phone } });
  if (lead) return { lead, created: false };
  const q = await leadService.queueUser();
  const created = await leadService.createLead(
    null,
    { name: txt(d.full_name || d.name || (d.customer && d.customer.full_name), 191), phone, channel, notes: note, tags: ['وردست'], intakeAction: 'intake_vardast', intakeSummary },
    q.id,
    null
  );
  lead = await prisma.lead.findUnique({ where: { id: created.id } });
  return { lead, created: true };
}

// خروجی: { challenge } برای پیام آزمایشی، یا { ok }
async function handle(headers, raw) {
  verify(headers, raw);
  let ev;
  try {
    ev = JSON.parse(raw);
  } catch (e) {
    throw fail(400, 'bad json');
  }
  if (ev.type === 'webhook.verification') return { challenge: String((ev.data && ev.data.challenge) || '') };
  const id = txt(ev.id || headers['x-vardast-event-id'], 120);
  if (!id) throw fail(400, 'missing id');
  if (await prisma.webhookEvent.findUnique({ where: { id } })) return { ok: true, duplicate: true };

  const d = ev.data || {};
  let leadId = null;
  let summary = '';
  if (ev.type === 'lead.created') {
    const channel = PLATFORM[String(d.platform || '').toUpperCase()] || 'وردست';
    const handleText = d.username ? channel + ': @' + txt(d.username, 60) : channel;
    const comment = aiComment(d);
    const note = 'سرنخ وردست — ' + handleText + (comment ? '\nخلاصه‌ی گفت‌وگو: ' + comment : '');
    const entry = (handleText + (comment ? ' — ' + comment : '')).slice(0, 190);
    const r = await findOrCreateLead(d, channel, note, entry);
    if (r) {
      leadId = r.lead.id;
      // خلاصه‌ی گفت‌وگو در سابقه می‌نشیند تا کارشناس بداند مشتری چه خواسته و همان‌جا جوابش را بدهد
      // پرونده‌ی تازه سطر «ورود» را همان موقع ساخت (با همین خلاصه)؛ سطر دوم کارت تکراری در میز کار می‌ساخت
      if (!r.created) await audit.log(leadId, null, 'intake_vardast', entry);
      if (!r.created && comment) {
        const prev = r.lead.notes || '';
        await prisma.lead.update({ where: { id: leadId }, data: { notes: (prev ? prev + '\n' : '') + 'وردست: ' + comment, updatedAt: new Date() } });
      }
    }
    if (leadId) await remindCall(leadId, 'زنگ بزنید — سرنخ ' + handleText + (comment ? ': ' + comment : ''));
    summary = [txt(d.full_name, 80), handleText, comment].filter(Boolean).join(' · ').slice(0, 190);
  } else if (ev.type === 'order.created') {
    const o = orderSummary(d);
    const text = 'سفارش وردست' + (o.itemText ? ': ' + o.itemText : '') + (o.address ? ' — آدرس: ' + o.address : '');
    const r = await findOrCreateLead(d, 'وردست', text, text.slice(0, 190));
    if (r) {
      leadId = r.lead.id;
      if (!r.created) await audit.log(leadId, null, 'intake_vardast', text.slice(0, 190));
      await remindCall(leadId, 'سفارش وردست — تماس بگیرید و سفارش را نهایی کنید');
    }
    summary = text.slice(0, 190);
  } else {
    summary = 'رویداد ناشناخته';
  }
  await prisma.webhookEvent.create({ data: { id, source: 'vardast', type: txt(ev.type, 64) || 'unknown', leadId, summary: summary.slice(0, 190) || null, payload: raw.slice(0, 20000) } });
  return { ok: true };
}

async function recent() {
  const rows = await prisma.webhookEvent.findMany({ where: { source: 'vardast' }, orderBy: { createdAt: 'desc' }, take: 30 });
  return rows.map((r) => ({ id: r.id, type: r.type, leadId: r.leadId, summary: r.summary || '', createdAt: r.createdAt.getTime() }));
}

module.exports = { handle, recent, configured };
