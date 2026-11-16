package com.example.crmcalls

import android.Manifest
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import android.telephony.PhoneStateListener
import android.telephony.TelephonyCallback
import android.telephony.TelephonyManager
import androidx.core.app.NotificationCompat
import androidx.core.app.ServiceCompat
import androidx.core.content.ContextCompat
import com.example.crmcalls.ui.MainActivity

/**
 * سرویس همیشه‌روشن با اعلان ثابت «CRM نمونه تماس فعال است» تا اندروید اپ را نبندد
 * و پایان هر تماس بی‌درنگ تشخیص داده شود (علاوه بر گیرنده‌ی PHONE_STATE).
 */
class CallMonitorService : Service() {
    companion object {
        private const val CH = "monitor"
        private const val NOTIF_ID = 7001

        fun start(ctx: Context) {
            if (!Prefs.get(ctx).paired) return
            try {
                ContextCompat.startForegroundService(ctx, Intent(ctx, CallMonitorService::class.java))
            } catch (e: Exception) {
                // اندروید شروع سرویس از پس‌زمینه را نپذیرفت — دفعه‌ی بعد که اپ باز شود
            }
        }

        fun stop(ctx: Context) {
            ctx.stopService(Intent(ctx, CallMonitorService::class.java))
        }
    }

    private var tm: TelephonyManager? = null
    private var callback: Any? = null
    private var lastState = TelephonyManager.CALL_STATE_IDLE

    override fun onBind(intent: Intent?): IBinder? = null

    // دیده‌بان تاریخچه‌ی تماس: هر وقت اندروید تماسی (حتی بی‌پاسخ) در تاریخچه بنویسد،
    // همان لحظه به CRM می‌رود — حتی اگر پیام «وضعیت تلفن» به اپ نرسیده باشد.
    private var logObserver: android.database.ContentObserver? = null
    private var lastObserved = 0L

    private fun watchCallLog() {
        if (logObserver != null) return
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.READ_CALL_LOG) != PackageManager.PERMISSION_GRANTED) return
        val obs = object : android.database.ContentObserver(android.os.Handler(android.os.Looper.getMainLooper())) {
            override fun onChange(selfChange: Boolean) {
                val now = System.currentTimeMillis()
                if (now - lastObserved < 1500) return
                lastObserved = now
                syncNow()
            }
        }
        try {
            contentResolver.registerContentObserver(android.provider.CallLog.Calls.CONTENT_URI, true, obs)
            logObserver = obs
        } catch (e: Exception) {
            logObserver = null
        }
    }

    override fun onCreate() {
        super.onCreate()
        val nm = getSystemService(NotificationManager::class.java)
        nm?.createNotificationChannel(
            NotificationChannel(CH, "سرویس CRM نمونه تماس", NotificationManager.IMPORTANCE_MIN).apply {
                description = "اعلان ثابت تا ثبت تماس‌ها قطع نشود"
                setShowBadge(false)
            }
        )
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (!Prefs.get(this).paired) {
            stopSelf()
            return START_NOT_STICKY
        }
        val pi = PendingIntent.getActivity(
            this, 0, Intent(this, MainActivity::class.java),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
        )
        val n = NotificationCompat.Builder(this, CH)
            .setSmallIcon(R.drawable.ic_phone)
            .setContentTitle("CRM نمونه تماس فعال است")
            .setContentText("خط: " + Prefs.get(this).lineName)
            .setOngoing(true)
            .setPriority(NotificationCompat.PRIORITY_MIN)
            .setContentIntent(pi)
            .build()
        try {
            val type = if (Build.VERSION.SDK_INT >= 34) ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE else 0
            ServiceCompat.startForeground(this, NOTIF_ID, n, type)
        } catch (e: Exception) {
            stopSelf()
            return START_NOT_STICKY
        }
        listen()
        watchCallLog()
        return START_STICKY
    }

    private fun onState(state: Int) {
        if (state == TelephonyManager.CALL_STATE_IDLE && lastState != TelephonyManager.CALL_STATE_IDLE) {
            // «قطع شد» را همین‌جا هم خبر می‌دهیم تا کارت تماس جاری در CRM آنی بسته شود
            LiveCall.report(applicationContext, "idle", null)
            CallerCard.hide()
            syncNow()
            try { Work.afterCall(applicationContext) } catch (e: Exception) { }
        } else if (state == TelephonyManager.CALL_STATE_OFFHOOK && lastState != TelephonyManager.CALL_STATE_OFFHOOK) {
            LiveCall.report(applicationContext, "talking", null)
        }
        lastState = state
    }

    /**
     * ارسال مستقیم بعد از قطع تماس — این سرویس همیشه روشن است، پس منتظر زمان‌بندی اندروید نمی‌مانیم
     * و تماس چند ثانیه‌ای در CRM دیده می‌شود (WorkManager به‌عنوان پشتیبان سر جایش است).
     */
    /** ارسال بعد از تماس — منطقش در PostCall است تا گیرنده‌ی وضعیت تلفن هم بتواند اجرایش کند */
    private fun syncNow() = PostCall.run(applicationContext)

    @Suppress("DEPRECATION")
    private fun listen() {
        if (callback != null) return
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.READ_PHONE_STATE) != PackageManager.PERMISSION_GRANTED) return
        val t = getSystemService(TelephonyManager::class.java) ?: return
        tm = t
        try {
            if (Build.VERSION.SDK_INT >= 31) {
                val cb = object : TelephonyCallback(), TelephonyCallback.CallStateListener {
                    override fun onCallStateChanged(state: Int) = onState(state)
                }
                t.registerTelephonyCallback(mainExecutor, cb)
                callback = cb
            } else {
                val l = object : PhoneStateListener() {
                    override fun onCallStateChanged(state: Int, phoneNumber: String?) = onState(state)
                }
                t.listen(l, PhoneStateListener.LISTEN_CALL_STATE)
                callback = l
            }
        } catch (e: Exception) {
            callback = null
        }
    }

    @Suppress("DEPRECATION")
    override fun onDestroy() {
        logObserver?.let { try { contentResolver.unregisterContentObserver(it) } catch (e: Exception) { } }
        logObserver = null
        val t = tm
        val cb = callback
        if (t != null && cb != null) {
            try {
                if (Build.VERSION.SDK_INT >= 31 && cb is TelephonyCallback) t.unregisterTelephonyCallback(cb)
                else if (cb is PhoneStateListener) t.listen(cb, PhoneStateListener.LISTEN_NONE)
            } catch (e: Exception) {
            }
        }
        callback = null
        super.onDestroy()
    }
}
