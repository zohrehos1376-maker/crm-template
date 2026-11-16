package com.example.crmcalls

import android.content.Context
import org.json.JSONObject
import kotlin.concurrent.thread

/**
 * خبر دادن وضعیت لحظه‌ای خط به CRM: زنگ خورد / در حال مکالمه / قطع شد.
 * کارشناس‌ها در «کارهای من» می‌بینند کدام خط با کدام شماره روی خط است و
 * هم‌زمان سراغ یک مشتری نمی‌روند. اگر اینترنت نبود، بی‌سر و صدا رد می‌شود
 * (سرور خودش بعد از ۳ دقیقه بی‌خبری، ردیف را پاک می‌کند).
 */
object LiveCall {
    private var lastShownNumber: String? = null
    private var beat: Thread? = null

    /** تا وقتی مکالمه برقرار است هر ۲۰ ثانیه خبر می‌دهد؛ با قطع شدن، سرور خودش بعد از ۲ دقیقه پاک می‌کند */
    private fun startBeat(ctx: Context, phone: String) {
        stopBeat()
        val app = ctx.applicationContext
        val t = Thread {
            try {
                while (!Thread.currentThread().isInterrupted) {
                    Thread.sleep(20000)
                    val p = Prefs.get(app)
                    if (!p.paired) break
                    val body = JSONObject().put("state", "talking").put("phone", phone)
                        .put("direction", "OUTGOING").put("startedAt", System.currentTimeMillis())
                    try { Api.request(p.server, p.token, "POST", "/active-call", body, timeoutMs = 8000) } catch (e: Exception) { }
                }
            } catch (e: InterruptedException) {
            }
        }
        t.isDaemon = true
        beat = t
        t.start()
    }

    private fun stopBeat() {
        beat?.interrupt()
        beat = null
    }

    fun report(ctx: Context, state: String, number: String?) {
        val app = ctx.applicationContext
        val p = Prefs.get(app)
        if (!p.paired) return
        val phone = when {
            !number.isNullOrBlank() -> PhoneUtil.normalize(number)
            state == "talking" -> lastShownNumber ?: ""
            else -> ""
        }
        if (state != "idle") lastShownNumber = phone else lastShownNumber = null
        if (state == "talking") startBeat(app, phone) else stopBeat()
        val body = JSONObject()
            .put("state", state)
            .put("phone", phone)
            .put("direction", if (state == "ringing") "INCOMING" else "OUTGOING")
            .put("startedAt", System.currentTimeMillis())
        thread {
            try {
                Api.request(p.server, p.token, "POST", "/active-call", body, timeoutMs = 8000)
            } catch (e: Exception) {
                // مهم نیست: نمای زنده است، نه داده‌ی ماندگار
            }
        }
    }
}
