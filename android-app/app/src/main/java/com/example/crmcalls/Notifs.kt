package com.example.crmcalls

import android.Manifest
import android.annotation.SuppressLint
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import com.example.crmcalls.ui.LogCallActivity

object Notifs {
    const val CH_LOG = "log_call"
    const val CH_MISSED = "missed_call"
    const val CH_UPDATE = "app_update"
    const val CH_CALLER = "caller_info"
    private const val CALLER_ID = 9100

    fun createChannels(ctx: Context) {
        val nm = ctx.getSystemService(NotificationManager::class.java) ?: return
        nm.createNotificationChannel(
            NotificationChannel(CH_LOG, "ثبت تماس", NotificationManager.IMPORTANCE_HIGH).apply {
                description = "یادآوری پر کردن فرم بعد از هر تماس"
            }
        )
        nm.createNotificationChannel(
            NotificationChannel(CH_MISSED, "تماس بی‌پاسخ", NotificationManager.IMPORTANCE_HIGH).apply {
                description = "تماس‌های بی‌پاسخ خط کاری"
            }
        )
        nm.createNotificationChannel(
            NotificationChannel(CH_CALLER, "مشتری در حال تماس", NotificationManager.IMPORTANCE_HIGH).apply {
                description = "نام و مرحله‌ی مشتری هنگام زنگ خوردن (برای گوشی‌هایی که کارت شناور ندارند)"
            }
        )
        nm.createNotificationChannel(
            NotificationChannel(CH_UPDATE, "به‌روزرسانی اپ", NotificationManager.IMPORTANCE_DEFAULT).apply {
                description = "خبر نسخه‌ی تازه‌ی CRM نمونه تماس"
            }
        )
    }

    /** نسخه‌ی تازه آماده است — با زدنش اپ باز می‌شود و خودش دانلود و نصب را شروع می‌کند */
    fun update(ctx: Context, versionName: String) {
        val i = Intent(ctx, com.example.crmcalls.ui.MainActivity::class.java)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP)
            .putExtra("startUpdate", true)
        val pi = PendingIntent.getActivity(ctx, 9001, i, flags)
        val b = NotificationCompat.Builder(ctx, CH_UPDATE)
            .setSmallIcon(R.drawable.ic_phone)
            .setContentTitle("نسخه‌ی تازه‌ی CRM نمونه تماس آماده است")
            .setContentText("نسخه‌ی " + Jalali.fa(versionName) + " — برای نصب بزنید")
            .setAutoCancel(true)
            .setContentIntent(pi)
        post(ctx, 9001, b)
    }

    /** جایگزین کارت شناور روی گوشی‌های اندروید Go: اعلان بالای صفحه با نام و مرحله‌ی مشتری */
    fun caller(ctx: Context, title: String, text: String) {
        val b = NotificationCompat.Builder(ctx, CH_CALLER)
            .setSmallIcon(R.drawable.ic_phone)
            .setContentTitle(title)
            .setContentText(text)
            .setStyle(NotificationCompat.BigTextStyle().bigText(text))
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setCategory(NotificationCompat.CATEGORY_CALL)
            .setOnlyAlertOnce(true)
            .setTimeoutAfter(60_000L)
            .setAutoCancel(true)
        post(ctx, CALLER_ID, b)
    }

    fun cancelCaller(ctx: Context) {
        try {
            NotificationManagerCompat.from(ctx).cancel(CALLER_ID)
        } catch (e: Exception) {
        }
    }

    fun canPost(ctx: Context): Boolean =
        Build.VERSION.SDK_INT < 33 ||
            ContextCompat.checkSelfPermission(ctx, Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED

    private fun idFor(externalId: String) = externalId.hashCode()

    private val flags = PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT

    @SuppressLint("MissingPermission")
    private fun post(ctx: Context, id: Int, b: NotificationCompat.Builder) {
        if (!canPost(ctx)) return
        try {
            NotificationManagerCompat.from(ctx).notify(id, b.build())
        } catch (e: SecurityException) {
        }
    }

    fun logPrompt(ctx: Context, c: LocalCall) {
        val name = Syncer.anyName(ctx, c)
        val who = name.ifBlank { c.phone }
        val dir = if (c.direction == "INCOMING") "ورودی" else "خروجی"
        val pi = PendingIntent.getActivity(ctx, idFor(c.externalId), LogCallActivity.intent(ctx, c.externalId), flags)
        val b = NotificationCompat.Builder(ctx, CH_LOG)
            .setSmallIcon(R.drawable.ic_phone)
            .setContentTitle("ثبت تماس $dir — $who")
            .setContentText("پاسخ‌دهنده و خلاصه‌ی مکالمه را ثبت کنید")
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setCategory(NotificationCompat.CATEGORY_REMINDER)
            .setContentIntent(pi)
            .setAutoCancel(true)
        post(ctx, idFor(c.externalId), b)
    }

    fun missed(ctx: Context, c: LocalCall, name: String) {
        val dial = Intent(Intent.ACTION_DIAL, Uri.parse("tel:" + c.phone))
        val pi = PendingIntent.getActivity(ctx, idFor(c.externalId), dial, flags)
        val who = if (name.isBlank()) c.phone else "$name (${c.phone})"
        val b = NotificationCompat.Builder(ctx, CH_MISSED)
            .setSmallIcon(R.drawable.ic_phone)
            .setContentTitle("تماس بی‌پاسخ — خط کاری")
            .setContentText(who + " · " + Jalali.formatTime(c.startedAt))
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setCategory(NotificationCompat.CATEGORY_MISSED_CALL)
            .setContentIntent(pi)
            .addAction(R.drawable.ic_phone, "تماس بگیر", pi)
            .setAutoCancel(true)
        post(ctx, idFor(c.externalId), b)
    }

    fun cancel(ctx: Context, externalId: String) {
        NotificationManagerCompat.from(ctx).cancel(idFor(externalId))
    }
}
