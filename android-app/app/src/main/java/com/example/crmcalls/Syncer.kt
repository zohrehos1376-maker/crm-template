package com.example.crmcalls

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject

/**
 * منطق همگام‌سازی تماس‌ها:
 *  ۱. خواندن ردیف‌های تازه‌ی تاریخچه‌ی تماس (فقط سیم‌کارت کاری) و ذخیره در صف محلی
 *  ۲. ارسال دسته‌ای به CRM (ارسال تکراری بی‌خطر است)
 *  ۳. ارسال فرم‌های ثبت‌شده‌ای که منتظر مانده‌اند
 */
object Syncer {
    private const val LOOKBACK_MS = 6 * 3600_000L
    private const val FIRST_RUN_MS = 24 * 3600_000L

    /** تماس‌های تازه‌ای که به صف اضافه شدند */
    @Synchronized
    fun collect(ctx: Context): List<LocalCall> {
        val p = Prefs.get(ctx)
        if (!p.paired) return emptyList()
        // بی‌صدا نماند: بدون این دسترسی اپ هیچ تماسی نمی‌بیند، ولی گزارش زنده سالم کار
        // می‌کند و همه‌چیز درست به نظر می‌رسد. اندروید گاهی خودش این دسترسی را پس می‌گیرد.
        if (!CallLogSource.hasPermission(ctx)) {
            p.lastError = "دسترسی «تاریخچه‌ی تماس» داده نشده — هیچ تماسی به CRM نمی‌رود. چک‌لیست راه‌اندازی را باز کنید."
            return emptyList()
        }
        val db = LocalDb.get(ctx)
        val now = System.currentTimeMillis()
        // تماس طولانی با زمان شروعِ قدیمی‌تر ممکن است دیرتر در تاریخچه بیاید؛ ۶ ساعت عقب‌تر هم خوانده می‌شود.
        // همیشه دست‌کم ۶ ساعت اخیر خوانده می‌شود: اگر نشانگر به هر دلیلی جلو افتاده باشد
        // (ردیف با تاریخ آینده در تاریخچه‌ی گوشی)، تماس‌های تازه دیگر پشتش گم نمی‌شوند.
        val since = if (p.callCursor > 0) minOf(p.callCursor, now) - LOOKBACK_MS else now - FIRST_RUN_MS
        val rows = CallLogSource.readSince(ctx, since)
        val sims = Sims.list(ctx)
        var cursor = p.callCursor
        var skippedSim = 0
        val added = ArrayList<LocalCall>()
        for (r in rows) {
            // نشانگر هرگز از «حالا» جلو نزند
            if (r.date > cursor && r.date <= now) cursor = r.date
            val dir = CallLogSource.direction(r.type) ?: continue
            if (!Sims.accepts(sims, p.simSubId, r.accountId)) { skippedSim++; continue }
            val ext = "${r.id}-${r.date}"
            if (db.get(ext) == null && db.existsSame(r.number, dir, r.date)) continue
            if (db.insertIfNew(ext, r.number, dir, r.date, r.duration.toInt())) {
                db.get(ext)?.let { added.add(it) }
            } else {
                db.updateDurationIfLonger(ext, r.duration.toInt())
            }
        }
        if (cursor > p.callCursor) p.callCursor = cursor
        // تماسی بود ولی روی سیم‌کارت دیگر — کارشناس باید بداند چرا در CRM نیست
        p.skippedOtherSim = skippedSim
        db.prune(now - 30L * 24 * 3600_000L)
        return added
    }

    @Synchronized
    fun upload(ctx: Context, timeoutMs: Int = 30000) {
        val p = Prefs.get(ctx)
        if (!p.paired) return
        val db = LocalDb.get(ctx)
        // نامی که بعد از ارسال تماس در دفترچه‌تلفن ذخیره شده هم به CRM برسد (۳ روز اخیر)
        for (c in db.since(System.currentTimeMillis() - 3 * 86_400_000L)) {
            if (c.synced != LocalDb.SYNC_YES) continue
            val n = PhoneBook.nameFor(ctx, c.phone)
            if (n.isNotBlank() && n != db.sentName(c.externalId)) db.markUnsynced(c.externalId)
        }
        var guard = 0
        while (guard++ < 20) {
            val batch = db.unsynced(200)
            if (batch.isEmpty()) break
            val arr = JSONArray()
            val names = HashMap<String, String>()
            for (c in batch) {
                names[c.externalId] = PhoneBook.nameFor(ctx, c.phone)
                arr.put(
                    JSONObject()
                        .put("externalId", c.externalId)
                        .put("phone", c.phone)
                        .put("direction", c.direction)
                        .put("startedAt", c.startedAt)
                        .put("durationSec", c.durationSec)
                        .put("contactName", names[c.externalId] ?: "")
                )
            }
            val res = Api.call(ctx, "POST", "/calls/batch", JSONObject().put("calls", arr), timeoutMs)
            val results = res.optJSONArray("results") ?: JSONArray()
            for (i in 0 until results.length()) {
                val o = results.getJSONObject(i)
                val lead = o.optJSONObject("lead")
                db.markSynced(o.str("externalId"), o.str("id"), lead?.toString(), LocalDb.SYNC_YES)
                db.setSentName(o.str("externalId"), names[o.str("externalId")] ?: "")
                if (lead != null) {
                    val ph = PhoneUtil.normalize(batch.find { it.externalId == o.str("externalId") }?.phone)
                    if (ph.isNotEmpty()) db.upsertContacts(listOf(CachedContact(ph, lead.str("id"), lead.str("name"))))
                }
            }
            val errors = res.optJSONArray("errors") ?: JSONArray()
            for (i in 0 until errors.length()) {
                val id = errors.getJSONObject(i).str("externalId")
                if (id.isNotEmpty()) db.markSynced(id, null, null, LocalDb.SYNC_REJECTED)
            }
            if (results.length() == 0 && errors.length() == 0) break
        }
        for ((call, json) in db.pendingLogs()) {
            try {
                Api.call(ctx, "POST", "/calls/${call.serverId}/log", JSONObject(json), timeoutMs)
                db.setLogState(call.externalId, LocalDb.LOG_DONE)
                Notifs.cancel(ctx, call.externalId)
            } catch (e: ApiException) {
                if (e.code == 401) throw e
                // خطای دائمی (مثلاً پاسخ‌دهنده غیرفعال شده) — ثبت نمی‌شود ولی صف هم گیر نمی‌کند
                if (e.code in 400..499) {
                    db.setLogState(call.externalId, LocalDb.LOG_NONE)
                    p.lastError = "ثبت تماس ${call.phone}: ${e.message}"
                } else {
                    throw e
                }
            }
        }
        p.lastSyncAt = System.currentTimeMillis()
        p.lastError = ""
    }

    /** نام کارشناس‌ها و گزینه‌های نحوه‌ی آشنایی (حداکثر هر ساعت یک بار، مگر force) */
    fun refreshBootstrap(ctx: Context, force: Boolean) {
        val p = Prefs.get(ctx)
        if (!p.paired) return
        if (!force && System.currentTimeMillis() - p.bootstrapAt < 3600_000L && p.operators().isNotEmpty()) return
        // فهرست مدل‌ها/برچسب‌ها فقط وقتی عوض شده دوباره می‌آید (اینترنت ضعیف / VPN)
        val known = if (p.leadForm().has("vehicles")) p.formHash else ""
        val r = Api.call(ctx, "GET", "/bootstrap?formHash=" + java.net.URLEncoder.encode(known, "UTF-8"), null, 30000)
        r.optJSONObject("line")?.let {
            p.lineName = it.str("name")
            p.lineId = it.str("id")
        }
        val ops = JSONArray()
        val list = r.optJSONArray("operators") ?: JSONArray()
        for (i in 0 until list.length()) {
            val o = list.getJSONObject(i)
            ops.put(JSONObject().put("id", o.str("id")).put("name", o.str("name")))
        }
        p.operatorsJson = ops.toString()
        p.heardFromJson = (r.optJSONArray("heardFrom") ?: JSONArray()).toString()
        r.optJSONObject("leadForm")?.let {
            p.leadFormJson = it.toString()
            p.formHash = r.str("formHash")
        }
        p.bootstrapAt = System.currentTimeMillis()
    }

    /** تماس‌های پاسخ‌داده‌ی ۱۰ دقیقه‌ی اخیر که هنوز کارت ثبت برایشان نیامده */
    fun hasPendingPrompt(ctx: Context): Boolean =
        LocalDb.get(ctx).unprompted(System.currentTimeMillis() - 10 * 60_000L).any { it.answered || it.unanswered }

    /** بعد از قطع تماس: کارت/فرم ثبت برای آخرین تماسِ پاسخ‌داده */
    @Synchronized
    fun promptAfterCall(ctx: Context): Boolean {
        val db = LocalDb.get(ctx)
        val recent = db.unprompted(System.currentTimeMillis() - 10 * 60_000L).filter { it.answered }
        val fresh = recent.maxByOrNull { it.startedAt } ?: return false
        // تماس‌های قدیمی‌ترِ همین فاصله فقط اعلان دارند؛ کارت برای آخرین تماس است
        for (old in recent) if (old.externalId != fresh.externalId) {
            db.setPrompted(old.externalId)
            Notifs.logPrompt(ctx, old)
        }
        db.setPrompted(fresh.externalId)
        Notifs.logPrompt(ctx, fresh)
        val name = anyName(ctx, fresh)
        val dir = if (fresh.direction == "INCOMING") "ورودی" else "خروجی"
        PromptCard.show(ctx, fresh, "ثبت تماس $dir — " + name.ifBlank { fresh.phone })
        return true
    }

    /** تماس بی‌پاسخ تازه (یک ساعت اخیر): فقط اعلان با دکمه‌ی «تماس بگیر» */
    @Synchronized
    fun notifyMissed(ctx: Context) {
        val db = LocalDb.get(ctx)
        for (c in db.unprompted(System.currentTimeMillis() - 60 * 60_000L)) {
            if (!c.unanswered) continue
            db.setPrompted(c.externalId)
            Notifs.missed(ctx, c, anyName(ctx, c))
        }
    }

    /** نام برای نمایش: اول CRM، بعد دفترچه‌تلفن گوشی */
    fun anyName(ctx: Context, c: LocalCall): String = displayName(ctx, c).ifBlank { PhoneBook.nameFor(ctx, c.phone) }

    /** نام مشتری از پاسخ CRM یا حافظه‌ی محلی مخاطبین CRM */
    fun displayName(ctx: Context, c: LocalCall): String {
        val fromLead = try {
            if (c.leadJson != null) JSONObject(c.leadJson).str("name") else ""
        } catch (e: Exception) {
            ""
        }
        if (fromLead.isNotBlank()) return fromLead
        val n = PhoneUtil.normalize(c.phone)
        return if (n.isEmpty()) "" else LocalDb.get(ctx).contactByPhone(n)?.name ?: ""
    }
}
