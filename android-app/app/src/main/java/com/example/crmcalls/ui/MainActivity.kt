package com.example.crmcalls.ui

import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.view.LayoutInflater
import android.view.View
import android.widget.LinearLayout
import android.widget.TextView
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import com.google.android.material.button.MaterialButton
import com.google.android.material.chip.Chip
import com.google.android.material.chip.ChipGroup
import com.example.crmcalls.PhoneUtil
import com.example.crmcalls.Updater
import com.example.crmcalls.Api
import com.example.crmcalls.BuildConfig
import com.example.crmcalls.CallMonitorService
import com.example.crmcalls.Jalali
import com.example.crmcalls.LocalCall
import com.example.crmcalls.LocalDb
import com.example.crmcalls.Prefs
import com.example.crmcalls.R
import com.example.crmcalls.Syncer
import com.example.crmcalls.Work
import com.example.crmcalls.contacts.ContactsSync
import com.example.crmcalls.str
import org.json.JSONObject
import kotlin.concurrent.thread

/** صفحه‌ی اصلی: وضعیت اتصال، نام خط، آخرین همگام‌سازی، صف ارسال، تماس‌های امروز */
class MainActivity : AppCompatActivity() {
    private lateinit var tvLine: TextView
    private lateinit var tvSim: TextView
    private lateinit var tvStatus: TextView
    private lateinit var tvLastSync: TextView
    private lateinit var tvQueue: TextView
    private lateinit var tvSetupWarn: TextView
    private lateinit var tvUpdate: TextView
    private lateinit var tvTodayEmpty: TextView
    private lateinit var listToday: LinearLayout
    // بازه‌ی فهرست تماس‌ها: ۰ = امروز، -۱ = دیروز، ۷ و ۳۰ = چند روز اخیر (گوشی تماس‌های ۳۰ روز را نگه می‌دارد)
    private var rangeDays = 0
    private var busy = false

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)
        tvLine = findViewById(R.id.tvLine)
        tvSim = findViewById(R.id.tvSim)
        tvStatus = findViewById(R.id.tvStatus)
        tvLastSync = findViewById(R.id.tvLastSync)
        tvQueue = findViewById(R.id.tvQueue)
        tvSetupWarn = findViewById(R.id.tvSetupWarn)
        tvUpdate = findViewById(R.id.tvUpdate)
        tvTodayEmpty = findViewById(R.id.tvTodayEmpty)
        listToday = findViewById(R.id.listToday)
        val chips = findViewById<ChipGroup>(R.id.rangeChips)
        for ((days, label) in listOf(0 to "امروز", -1 to "دیروز", 7 to "۷ روز اخیر", 30 to "۳۰ روز اخیر")) {
            val chip = LayoutInflater.from(this).inflate(R.layout.chip_choice, chips, false) as Chip
            chip.text = label
            chip.isCheckable = true
            chip.isChecked = days == rangeDays
            chip.setOnClickListener {
                rangeDays = days
                render(null)
            }
            chips.addView(chip)
        }
        findViewById<TextView>(R.id.tvVersion).text = "نسخه‌ی " + Jalali.fa(BuildConfig.VERSION_NAME)

        findViewById<MaterialButton>(R.id.btnSync).setOnClickListener { refresh(full = true) }
        findViewById<MaterialButton>(R.id.btnSetup).setOnClickListener { startActivity(Intent(this, SetupActivity::class.java)) }
        tvSetupWarn.setOnClickListener { startActivity(Intent(this, SetupActivity::class.java)) }
        findViewById<MaterialButton>(R.id.btnUnpair).setOnClickListener { confirmUnpair() }
    }

    override fun onResume() {
        super.onResume()
        if (!Prefs.get(this).paired) {
            startActivity(Intent(this, PairActivity::class.java))
            finish()
            return
        }
        CallMonitorService.start(this)
        render(null)
        refresh(full = false)
    }

    private fun refresh(full: Boolean) {
        if (busy) return
        busy = true
        tvStatus.text = "در حال همگام‌سازی…"
        tvStatus.setTextColor(ContextCompat.getColor(this, R.color.ink_soft))
        thread {
            var err: String? = null
            var update: JSONObject? = null
            try {
                Syncer.collect(this)
                Syncer.upload(this)
                Syncer.refreshBootstrap(this, true)
                if (full) ContactsSync.run(this)
                update = Api.call(this, "GET", "/app-version")
            } catch (e: Exception) {
                err = Api.friendly(e)
                Work.uploadSoon(this)
            }
            runOnUiThread {
                busy = false
                if (isFinishing || isDestroyed) return@runOnUiThread
                if (!Prefs.get(this).paired) {
                    startActivity(Intent(this, PairActivity::class.java))
                    finish()
                    return@runOnUiThread
                }
                render(err)
                showUpdate(update)
            }
        }
    }

    private fun render(err: String?) {
        val p = Prefs.get(this)
        val db = LocalDb.get(this)
        tvLine.text = "خط: " + p.lineName.ifBlank { "—" }
        tvSim.text = "سیم‌کارت کاری: " + if (p.simSubId < 0) "همه‌ی سیم‌کارت‌ها" else p.simLabel
        if (err != null) {
            tvStatus.text = "✕ $err"
            tvStatus.setTextColor(ContextCompat.getColor(this, R.color.bad))
        } else if (!busy) {
            tvStatus.text = "✓ متصل به CRM"
            tvStatus.setTextColor(ContextCompat.getColor(this, R.color.ok))
        }
        tvLastSync.text = "آخرین همگام‌سازی: " + if (p.lastSyncAt > 0) Jalali.formatDateTime(p.lastSyncAt) else "هنوز انجام نشده"
        val q = db.queueCount()
        tvQueue.text = if (q > 0) "در صف ارسال: " + Jalali.fa(q) else "صف ارسال خالی است"

        val missing = Checks.missingCount(this)
        // چرا تماسی در CRM نیست؟ دو علت خاموش: دسترسی تاریخچه، و تماس روی سیم‌کارت دیگر
        val skipped = p.skippedOtherSim
        tvSetupWarn.visibility = if (missing > 0 || skipped > 0) View.VISIBLE else View.GONE
        tvSetupWarn.text = when {
            !Checks.callPerms(this) -> "دسترسی «تاریخچه‌ی تماس» داده نشده — هیچ تماسی به CRM نمی‌رود. بزنید"
            missing > 0 -> Jalali.fa(missing) + " مورد از چک‌لیست راه‌اندازی مانده — بزنید"
            else -> Jalali.fa(skipped) + " تماس روی سیم‌کارت کاری نبود و به CRM نرفت — بزنید"
        }

        val dayMs = 24 * 3600_000L
        val start = Jalali.startOfToday()
        val (from, to) = when (rangeDays) {
            0 -> Pair(start, Long.MAX_VALUE)
            -1 -> Pair(start - dayMs, start)
            else -> Pair(start - (rangeDays - 1) * dayMs, Long.MAX_VALUE)
        }
        val calls = db.between(from, to)
        // برای «تماس برگشتی»: هر تماس خروجیِ وصل‌شده بعد از بی‌پاسخ، با همان شماره
        val later = db.since(from).filter { it.direction == "OUTGOING" && it.durationSec > 0 }
        findViewById<TextView>(R.id.tvCallsTitle).text = "تماس‌ها (" + Jalali.fa(calls.size) + ")"
        tvTodayEmpty.text = when (rangeDays) {
            0 -> "امروز هنوز تماسی روی خط کاری نبوده است."
            -1 -> "دیروز تماسی روی خط کاری نبوده است."
            else -> "در این بازه تماسی روی خط کاری نبوده است."
        }
        tvTodayEmpty.visibility = if (calls.isEmpty()) View.VISIBLE else View.GONE
        listToday.removeAllViews()
        val inflater = LayoutInflater.from(this)
        for (c in calls) {
            val calledBack = c.unanswered && later.any {
                it.startedAt > c.startedAt && PhoneUtil.normalize(it.phone) == PhoneUtil.normalize(c.phone)
            }
            listToday.addView(callRow(inflater, c, rangeDays != 0, calledBack))
        }
    }

    private fun callRow(inflater: LayoutInflater, c: LocalCall, withDate: Boolean, calledBack: Boolean): View {
        val v = inflater.inflate(R.layout.item_call, listToday, false)
        val (icon, label) = when (c.direction) {
            "INCOMING" -> Pair("↙", "ورودی")
            "OUTGOING" -> Pair("↗", "خروجی")
            "MISSED" -> Pair("✕", "بی‌پاسخ")
            else -> Pair("⛔", "ردشده")
        }
        v.findViewById<TextView>(R.id.icDir).text = icon
        val name = Syncer.anyName(this, c)
        v.findViewById<TextView>(R.id.icTitle).text = if (name.isBlank()) c.phone else "$name — ${c.phone}"
        val meta = StringBuilder(label + " · " + if (withDate) Jalali.formatDateTime(c.startedAt) else Jalali.formatTime(c.startedAt))
        if (c.durationSec > 0) meta.append(" · ").append(Jalali.duration(c.durationSec))
        v.findViewById<TextView>(R.id.icMeta).text = meta
        val st = v.findViewById<TextView>(R.id.icState)
        when {
            c.logState == LocalDb.LOG_DONE -> {
                st.text = "✓ ثبت شد"
                st.setTextColor(ContextCompat.getColor(this, R.color.ok))
            }
            c.logState == LocalDb.LOG_PENDING -> {
                st.text = "در صف ارسال"
                st.setTextColor(ContextCompat.getColor(this, R.color.ink_soft))
            }
            c.loggable -> {
                st.text = "ثبت کنید ›"
                st.setTextColor(ContextCompat.getColor(this, R.color.brand))
            }
            c.unanswered && calledBack -> {
                st.text = "✓ زنگ زده شد"
                st.setTextColor(ContextCompat.getColor(this, R.color.ok))
            }
            c.unanswered -> {
                st.text = "↩ زنگ بزنید ›"
                st.setTextColor(ContextCompat.getColor(this, R.color.bad))
            }
            c.synced == LocalDb.SYNC_NO -> {
                st.text = "ارسال نشده"
                st.setTextColor(ContextCompat.getColor(this, R.color.ink_soft))
            }
            else -> st.text = ""
        }
        if (c.loggable && c.logState == LocalDb.LOG_NONE) {
            v.setOnClickListener { startActivity(LogCallActivity.intent(this, c.externalId)) }
        } else if (c.unanswered) {
            v.setOnClickListener { startActivity(Intent(Intent.ACTION_DIAL, Uri.parse("tel:" + c.phone))) }
        }
        return v
    }

    private fun showUpdate(r: JSONObject?) {
        if (r == null) return
        val code = r.optInt("versionCode", 0)
        val url = r.str("url")
        if (code > BuildConfig.VERSION_CODE && url.isNotBlank()) {
            tvUpdate.visibility = View.VISIBLE
            tvUpdate.text = "نسخه‌ی تازه‌ی اپ آماده است (" + Jalali.fa(r.str("versionName")) + ") — برای دریافت بزنید"
            // اگر از روی نوتیف «به‌روزرسانی» آمده باشد، خودش شروع می‌کند
            if (intent?.getBooleanExtra("startUpdate", false) == true) {
                intent.removeExtra("startUpdate")
                tvUpdate.text = "در حال دریافت به‌روزرسانی…"
                Updater.download(this, url) { msg -> tvUpdate.text = msg }
            }
            tvUpdate.setOnClickListener {
                // داخل خود اپ دانلود و نصب می‌شود (مرورگر لازم نیست)
                tvUpdate.text = "در حال دریافت به‌روزرسانی…"
                Updater.download(this, url) { msg -> tvUpdate.text = msg }
            }
        } else {
            tvUpdate.visibility = View.GONE
        }
    }

    private fun confirmUnpair() {
        AlertDialog.Builder(this)
            .setTitle("جدا کردن گوشی")
            .setMessage("اتصال این گوشی به CRM قطع می‌شود. مخاطبین «| نمونه» روی گوشی می‌مانند و تماس‌های ارسال‌نشده بعد از اتصال دوباره فرستاده می‌شوند. ادامه می‌دهید؟")
            .setPositiveButton("جدا کن") { _, _ ->
                Api.unpair(this)
                startActivity(Intent(this, PairActivity::class.java))
                finish()
            }
            .setNegativeButton("انصراف", null)
            .show()
    }
}
