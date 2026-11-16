// پیدا کردن و یکی کردن سرنخ‌های تکراری (همان شماره، چند سرنخ).
// ادغام در یک تراکنش: همه‌ی پیگیری‌ها، تاریخچه‌ی وضعیت، خودروها، کارت‌های پیگیری گروهی و تماس‌ها
// به سرنخ اصلی منتقل می‌شوند؛ فیلدهای خالیِ اصلی از بقیه پر می‌شوند؛ بعد تکراری‌ها حذف می‌شوند.
// پیش از حذف، تصویر کامل سرنخ‌های حذف‌شده در یک فایل JSON کنار پشتیبان‌ها نگه داشته می‌شود
// (BACKUP_DIR/lead-merges) تا در صورت اشتباه، دستی قابل برگرداندن باشد.
const fs = require('fs');
const path = require('path');
const { prisma } = require('../../../shared/prisma');
const { normalizePhone } = require('../../../shared/phone');

// هرچه جلوتر، برای «سرنخ اصلی» پیشنهادی بهتر
const STATUS_RANK = { 'فروش موفق': 6, 'مراجعه حضوری': 5, 'در حال پیگیری': 4, 'تماس اولیه/ارسال پیام': 3, 'جدید': 2, 'فروش ناموفق': 1 };

function fail(status, message) {
  const e = new Error(message);
  e.status = status;
  return e;
}

const arr = (v) => (Array.isArray(v) ? v : []);
const blank = (v) => v === null || v === undefined || String(v).trim() === '';
// BigInt و تاریخ برای JSON
const plain = (o) => JSON.parse(JSON.stringify(o, (k, v) => (typeof v === 'bigint' ? v.toString() : v)));

async function findDuplicates() {
  const leads = await prisma.lead.findMany({
    select: {
      id: true,
      customerName: true,
      phone: true,
      status: true,
      channel: true,
      notes: true,
      createdAt: true,
      updatedAt: true,
      owner: { select: { fullName: true } },
      _count: { select: { followups: true, pipelineItems: true, callLogs: true, vehicles: true } },
    },
  });
  const groups = new Map();
  for (const l of leads) {
    const key = normalizePhone(l.phone);
    if (!key || key.length < 8) continue;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(l);
  }
  const out = [];
  for (const [phone, list] of groups) {
    if (list.length < 2) continue;
    const rows = list.map((l) => {
      const activity = l._count.followups + l._count.pipelineItems + l._count.callLogs;
      return {
        id: l.id,
        name: l.customerName || '',
        phone: l.phone,
        status: l.status,
        channel: l.channel || '',
        notes: (l.notes || '').slice(0, 160),
        ownerName: l.owner ? l.owner.fullName : '',
        createdAt: l.createdAt.getTime(),
        updatedAt: l.updatedAt.getTime(),
        counts: l._count,
        activity,
      };
    });
    // پیشنهاد اصلی: وضعیت جلوتر، بعد فعالیت بیشتر، بعد قدیمی‌تر
    rows.sort(
      (a, b) =>
        (STATUS_RANK[b.status] || 0) - (STATUS_RANK[a.status] || 0) || b.activity - a.activity || a.createdAt - b.createdAt
    );
    out.push({ phone, suggestedPrimaryId: rows[0].id, leads: rows });
  }
  out.sort((a, b) => b.leads.length - a.leads.length || a.phone.localeCompare(b.phone));
  return { groups: out, totalExtra: out.reduce((n, g) => n + g.leads.length - 1, 0) };
}

async function merge(user, body) {
  const primaryId = String((body && body.primaryId) || '');
  const ids = [...new Set(arr(body && body.mergeIds).map(String))].filter((x) => x && x !== primaryId);
  if (!primaryId || !ids.length) throw fail(400, 'سرنخ اصلی و دست‌کم یک سرنخ تکراری را انتخاب کنید');

  const include = { vehicles: true, followups: true, statusHistory: true, pipelineItems: { include: { logs: true } }, owner: { select: { fullName: true } } };
  const primary = await prisma.lead.findUnique({ where: { id: primaryId }, include });
  if (!primary) throw fail(404, 'سرنخ اصلی پیدا نشد');
  const dups = await prisma.lead.findMany({ where: { id: { in: ids } }, include });
  if (dups.length !== ids.length) throw fail(404, 'بعضی از سرنخ‌های تکراری پیدا نشدند (شاید قبلاً ادغام شده‌اند)');
  const key = normalizePhone(primary.phone);
  if (dups.some((d) => normalizePhone(d.phone) !== key)) throw fail(400, 'فقط سرنخ‌هایی با شماره‌ی یکسان ادغام می‌شوند');

  // فیلدهای سرنخ اصلی: خالی‌ها از تکراری‌ها پر می‌شوند، فهرست‌ها یکی می‌شوند
  const data = { updatedAt: new Date() };
  const pick = (field) => {
    if (!blank(primary[field])) return;
    const d = dups.find((x) => !blank(x[field]));
    if (d) data[field] = d[field];
  };
  ['customerName', 'channel', 'paymentTerms', 'deliveryType', 'currentCar', 'priceFrom', 'priceTo', 'nextFollowUpDate', 'nextFollowUpNote', 'soldCompany', 'soldModel', 'soldPrice'].forEach(pick);
  const union = (field) => {
    const all = [...arr(primary[field])];
    for (const d of dups) for (const v of arr(d[field])) if (!all.includes(v)) all.push(v);
    if (all.length !== arr(primary[field]).length) data[field] = all;
  };
  union('tags');
  union('preferredContact');
  const notes = [primary.notes].concat(dups.map((d) => d.notes)).filter((n) => !blank(n));
  const uniqueNotes = [...new Set(notes.map((n) => String(n).trim()))];
  if (uniqueNotes.length > 1) data.notes = uniqueNotes.join('\n— — —\n');
  const earliest = [primary.createdAt].concat(dups.map((d) => d.createdAt)).reduce((a, b) => (b < a ? b : a));
  if (earliest < primary.createdAt) data.createdAt = earliest;

  const now = new Date();
  // تصویر کامل تکراری‌ها پیش از هر تغییر — اگر نوشته نشود، ادغام انجام نمی‌شود
  const dir = path.join(process.env.BACKUP_DIR || path.join(__dirname, '../../../data'), 'lead-merges');
  fs.mkdirSync(dir, { recursive: true });
  const snapFile = path.join(dir, now.toISOString().replace(/[:.]/g, '-') + '-' + key + '.json');
  fs.writeFileSync(snapFile, JSON.stringify({ at: now.getTime(), by: user.id, primaryId, phone: key, primaryBefore: plain(primary), removed: plain(dups) }, null, 1));

  await prisma.$transaction(async (tx) => {
    // خودروها (بدون تکرار کمپانی + مدل)
    const have = new Set(primary.vehicles.map((v) => (v.company || '') + '|' + (v.model || '')));
    let pos = primary.vehicles.reduce((m, v) => Math.max(m, v.position), -1) + 1;
    for (const d of dups) {
      for (const v of d.vehicles) {
        const k = (v.company || '') + '|' + (v.model || '');
        if (have.has(k)) continue;
        have.add(k);
        await tx.leadVehicle.update({ where: { id: v.id }, data: { leadId: primaryId, position: pos++ } });
      }
    }

    // پیگیری‌ها — «قدم» تکراری (پیام/تماس ۱/۲/۳) پیگیری آزاد می‌شود تا قید یکتایی نشکند
    const steps = new Set(primary.followups.map((f) => f.step).filter(Boolean));
    for (const d of dups) {
      for (const f of d.followups) {
        const step = f.step && !steps.has(f.step) ? f.step : null;
        if (step) steps.add(step);
        await tx.followup.update({ where: { id: f.id }, data: { leadId: primaryId, step } });
      }
    }

    await tx.leadStatusHistory.updateMany({ where: { leadId: { in: ids } }, data: { leadId: primaryId } });
    await tx.callLog.updateMany({ where: { leadId: { in: ids } }, data: { leadId: primaryId } });

    // کارت‌های پیگیری گروهی: اگر اصلی در همان پیگیری گروهی کارت دارد، سابقه‌ی کارت تکراری به آن منتقل می‌شود
    const byPipeline = new Map(primary.pipelineItems.map((p) => [p.pipelineId, p.id]));
    for (const d of dups) {
      for (const it of d.pipelineItems) {
        const target = byPipeline.get(it.pipelineId);
        if (target) {
          await tx.pipelineItemLog.updateMany({ where: { itemId: it.id }, data: { itemId: target } });
          await tx.pipelineItem.delete({ where: { id: it.id } });
        } else {
          await tx.pipelineItem.update({ where: { id: it.id }, data: { leadId: primaryId } });
          byPipeline.set(it.pipelineId, it.id);
        }
      }
    }

    await tx.lead.update({ where: { id: primaryId }, data });

    // ردپا در تاریخچه‌ی پرونده
    await tx.followup.create({
      data: {
        leadId: primaryId,
        userId: user.id,
        followupDate: now,
        content:
          'ادغام سرنخ‌های تکراری: ' +
          dups.map((d) => '«' + (d.customerName || 'بدون نام') + '» (کارشناس: ' + (d.owner ? d.owner.fullName : '—') + ')').join('، ') +
          ' با این پرونده یکی شد.',
      },
    });

    await tx.lead.deleteMany({ where: { id: { in: ids } } });
  }, { timeout: 30000 });

  return { ok: true, primaryId, merged: ids.length, snapshot: path.basename(snapFile) };
}

module.exports = { findDuplicates, merge };
