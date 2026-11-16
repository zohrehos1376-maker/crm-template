package com.example.crmcalls

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.telephony.TelephonyManager
import kotlin.concurrent.thread

/** زنگ خوردن ← کارت مشتری؛ قطع تماس ← خواندن تاریخچه و باز کردن فرم ثبت */
class CallStateReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != TelephonyManager.ACTION_PHONE_STATE_CHANGED) return
        val ctx = context.applicationContext
        if (!Prefs.get(ctx).paired) return
        CallMonitorService.start(ctx)
        val state = intent.getStringExtra(TelephonyManager.EXTRA_STATE)
        @Suppress("DEPRECATION")
        val number = intent.getStringExtra(TelephonyManager.EXTRA_INCOMING_NUMBER)
        when (state) {
            TelephonyManager.EXTRA_STATE_RINGING -> {
                LiveCall.report(ctx, "ringing", number)
                if (!number.isNullOrBlank()) {
                    val pending = goAsync()
                    thread {
                        try {
                            CallerCard.showFor(ctx, number)
                        } finally {
                            pending.finish()
                        }
                    }
                }
            }
            TelephonyManager.EXTRA_STATE_OFFHOOK -> {
                LiveCall.report(ctx, "talking", number)
                CallerCard.hideLater(10_000L)
            }
            TelephonyManager.EXTRA_STATE_IDLE -> {
                LiveCall.report(ctx, "idle", null)
                CallerCard.hide()
                // اول ارسال، بعد زمان‌بندی پشتیبان: اگر زمان‌بندی خطا بدهد نباید جلوی ارسال را بگیرد.
                // روی سامسونگ سرویس خوابانده می‌شود و WorkManager ساعت‌ها عقب می‌افتد؛
                // ولی همین گیرنده سر وقت اجرا می‌شود.
                PostCall.run(ctx)
                try { Work.afterCall(ctx) } catch (e: Exception) { }
                // چند ثانیه فرایند را زنده نگه می‌داریم تا تلاش‌های اول انجام شود؛ بیشتر از این
                // نمی‌شود، چون اندروید گیرنده‌ی کند را می‌بندد. بقیه روی نخ خودش ادامه می‌دهد.
                val pending = goAsync()
                thread {
                    try { Thread.sleep(8000) } catch (e: InterruptedException) { }
                    pending.finish()
                }
            }
        }
    }
}

class BootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        val ctx = context.applicationContext
        if (!Prefs.get(ctx).paired) return
        Work.schedulePeriodic(ctx)
        Work.uploadSoon(ctx)
        CallMonitorService.start(ctx)
    }
}
