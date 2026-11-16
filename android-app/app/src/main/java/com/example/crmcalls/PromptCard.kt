package com.example.crmcalls

import android.annotation.SuppressLint
import android.content.Context
import android.content.Intent
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
import com.google.android.material.button.MaterialButton
import com.example.crmcalls.ui.LogCallActivity

/**
 * کارت «ثبت تماس» بعد از قطع تماس، روی صفحه.
 * اندروید ۱۵ باز کردن صفحه از پس‌زمینه را فقط وقتی اجازه می‌دهد که اپ پنجره‌ی شناورِ
 * دیدنی داشته باشد؛ پس اول این کارت نشان داده می‌شود و بعد فرم خودکار باز می‌شود.
 * اگر گوشی باز هم اجازه نداد، کارت می‌ماند و با یک ضربه فرم باز می‌شود.
 */
object PromptCard {
    private val main = Handler(Looper.getMainLooper())
    private var view: View? = null
    private val hideRunnable = Runnable { removeNow() }

    fun show(ctx: Context, c: LocalCall, title: String) {
        val app = ctx.applicationContext
        main.post { showNow(app, c.externalId, title) }
    }

    @SuppressLint("InflateParams")
    private fun showNow(ctx: Context, externalId: String, title: String) {
        if (!Settings.canDrawOverlays(ctx)) return
        removeNow()
        val wm = ctx.getSystemService(WindowManager::class.java) ?: return
        val v = LayoutInflater.from(ContextThemeWrapper(ctx, R.style.Theme_Crm)).inflate(R.layout.overlay_prompt, null)
        v.findViewById<TextView>(R.id.opTitle).text = title
        v.findViewById<MaterialButton>(R.id.opLog).setOnClickListener {
            removeNow()
            open(ctx, externalId)
        }
        v.findViewById<MaterialButton>(R.id.opLater).setOnClickListener { removeNow() }
        val lp = WindowManager.LayoutParams(
            WindowManager.LayoutParams.MATCH_PARENT,
            WindowManager.LayoutParams.WRAP_CONTENT,
            WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY,
            WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or WindowManager.LayoutParams.FLAG_NOT_TOUCH_MODAL,
            PixelFormat.TRANSLUCENT
        )
        lp.gravity = Gravity.TOP
        lp.y = (70 * ctx.resources.displayMetrics.density).toInt()
        try {
            wm.addView(v, lp)
        } catch (e: Exception) {
            open(ctx, externalId)
            return
        }
        view = v
        // حالا که پنجره‌ی شناور دیده می‌شود، فرم را خودکار باز کن
        main.postDelayed({ if (view === v) open(ctx, externalId) }, 500L)
        main.removeCallbacks(hideRunnable)
        main.postDelayed(hideRunnable, 3 * 60_000L)
    }

    private fun open(ctx: Context, externalId: String) {
        try {
            ctx.startActivity(LogCallActivity.intent(ctx, externalId).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
        } catch (e: Exception) {
        }
    }

    /** وقتی فرم واقعاً باز شد، کارت برداشته می‌شود */
    fun hide() {
        main.post { removeNow() }
    }

    private fun removeNow() {
        main.removeCallbacks(hideRunnable)
        val v = view ?: return
        view = null
        try {
            v.context.getSystemService(WindowManager::class.java)?.removeView(v)
        } catch (e: Exception) {
        }
    }
}
