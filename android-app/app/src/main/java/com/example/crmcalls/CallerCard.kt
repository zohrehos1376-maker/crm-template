package com.example.crmcalls

import android.annotation.SuppressLint
import android.content.Context
import android.graphics.PixelFormat
import android.os.Handler
import android.os.Looper
import android.provider.Settings
import android.view.ContextThemeWrapper
import android.view.Gravity
import android.view.LayoutInflater
import android.view.View
import android.view.WindowManager
import android.widget.TextView
import org.json.JSONObject
import java.net.URLEncoder

/**
 * کارت شناور هنگام زنگ خوردن: نام، مرحله و درخواست مشتری.
 * (CRM نمونه مشتری مختص یک کارشناس ندارد، پس کارشناس مسئول نشان داده نمی‌شود.)
 * فقط همین خلاصه (گوشی مشترک است — یادداشت و بودجه نمایش داده نمی‌شود).
 */
object CallerCard {
    private val main = Handler(Looper.getMainLooper())
    private var view: View? = null

    @Volatile
    private var currentNumber: String? = null

    private val hideRunnable = Runnable { removeNow() }

    @Volatile
    private var appCtx: Context? = null

    /** روی نخ پس‌زمینه صدا زده می‌شود */
    fun showFor(ctx: Context, number: String) {
        // اندروید Go «نمایش روی برنامه‌های دیگر» را ندارد؛ آنجا همین خلاصه با اعلان نشان داده می‌شود
        val overlay = Settings.canDrawOverlays(ctx)
        appCtx = ctx.applicationContext
        val norm = PhoneUtil.normalize(number)
        if (norm.isEmpty() || norm == currentNumber) return
        currentNumber = norm
        val local = LocalDb.get(ctx).contactByPhone(norm)
        if (overlay) main.post { render(ctx, norm, local?.name, null, loading = true, offline = false) }

        var lead: JSONObject? = null
        var offline = false
        try {
            val r = Api.call(ctx, "GET", "/lookup?phone=" + URLEncoder.encode(norm, "UTF-8"), null, 2500)
            lead = r.optJSONObject("lead")
        } catch (e: Exception) {
            offline = true
        }
        if (currentNumber != norm) return
        val l = lead
        if (overlay) main.post { render(ctx, norm, local?.name, l, loading = false, offline = offline) }
        else postNotice(ctx, norm, local?.name, l, offline)
    }

    private fun postNotice(ctx: Context, phone: String, localName: String?, lead: JSONObject?, offline: Boolean) {
        val title: String
        val lines = ArrayList<String>()
        if (lead != null) {
            title = "📞 " + lead.str("name").ifBlank { "مشتری بدون نام" }
            listOf(lead.str("stage"), lead.str("vehicle")).filter { it.isNotBlank() }.joinToString(" · ").let { if (it.isNotBlank()) lines.add(it) }
        } else if (!localName.isNullOrBlank()) {
            title = "📞 " + localName
            if (offline) lines.add("از حافظه‌ی گوشی — بدون اینترنت")
        } else {
            title = if (offline) "📞 تماس — اطلاعاتی نیست (بدون اینترنت)" else "📞 مشتری جدید — در CRM نیست"
        }
        lines.add(phone)
        Notifs.caller(ctx, title, lines.joinToString("\n"))
    }

    @SuppressLint("InflateParams")
    private fun render(ctx: Context, phone: String, localName: String?, lead: JSONObject?, loading: Boolean, offline: Boolean) {
        if (currentNumber != phone) return
        val wm = ctx.getSystemService(WindowManager::class.java) ?: return
        val v: View = view ?: run {
            val nv: View = LayoutInflater.from(ContextThemeWrapper(ctx, R.style.Theme_Crm)).inflate(R.layout.overlay_card, null)
            nv.setOnClickListener { hide() }
            val lp = WindowManager.LayoutParams(
                WindowManager.LayoutParams.MATCH_PARENT,
                WindowManager.LayoutParams.WRAP_CONTENT,
                WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY,
                WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or
                    WindowManager.LayoutParams.FLAG_NOT_TOUCH_MODAL or
                    WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED,
                PixelFormat.TRANSLUCENT
            )
            lp.gravity = Gravity.TOP
            lp.y = (90 * ctx.resources.displayMetrics.density).toInt()
            try {
                wm.addView(nv, lp)
            } catch (e: Exception) {
                return
            }
            view = nv
            nv
        }
        val tvName = v.findViewById<TextView>(R.id.ocName)
        val tvInfo = v.findViewById<TextView>(R.id.ocInfo)
        val tvOwner = v.findViewById<TextView>(R.id.ocOwner)
        val tvPhone = v.findViewById<TextView>(R.id.ocPhone)
        tvPhone.text = phone

        if (lead != null) {
            tvName.text = lead.str("name").ifBlank { "مشتری بدون نام" }
            tvInfo.text = listOf(lead.str("stage"), lead.str("vehicle")).filter { it.isNotBlank() }.joinToString(" · ")
            tvOwner.text = ""
        } else if (!localName.isNullOrBlank()) {
            tvName.text = localName
            tvInfo.text = if (loading) "در حال دریافت از CRM…" else if (offline) "(از حافظه‌ی گوشی — بدون اینترنت)" else ""
            tvOwner.text = ""
        } else {
            tvName.text = if (loading) "در حال جست‌وجو در CRM…" else if (offline) "اطلاعاتی نیست (بدون اینترنت)" else "مشتری جدید — در CRM نیست"
            tvInfo.text = ""
            tvOwner.text = ""
        }
        tvInfo.visibility = if (tvInfo.text.isNullOrBlank()) View.GONE else View.VISIBLE
        tvOwner.visibility = if (tvOwner.text.isNullOrBlank()) View.GONE else View.VISIBLE

        main.removeCallbacks(hideRunnable)
        main.postDelayed(hideRunnable, 60_000L)
    }

    fun hide() {
        currentNumber = null
        appCtx?.let { Notifs.cancelCaller(it) }
        main.post { removeNow() }
    }

    fun hideLater(ms: Long) {
        main.removeCallbacks(hideRunnable)
        main.postDelayed(hideRunnable, ms)
    }

    private fun removeNow() {
        currentNumber = null
        val v = view ?: return
        view = null
        try {
            v.context.getSystemService(WindowManager::class.java)?.removeView(v)
        } catch (e: Exception) {
        }
    }
}
