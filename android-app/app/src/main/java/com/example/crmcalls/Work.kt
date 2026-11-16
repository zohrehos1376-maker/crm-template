package com.example.crmcalls

import android.content.Context
import androidx.work.BackoffPolicy
import androidx.work.Constraints
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.Worker
import androidx.work.WorkerParameters
import androidx.work.workDataOf
import com.example.crmcalls.contacts.ContactsSync
import java.util.concurrent.TimeUnit

object Work {
    private val online = Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build()

    /** پشتیبان: هر ۱۵ دقیقه (حداقلِ اندروید) */
    fun schedulePeriodic(ctx: Context) {
        val req = PeriodicWorkRequestBuilder<SyncWorker>(15, TimeUnit.MINUTES)
            .setConstraints(online)
            .setInputData(workDataOf("mode" to "periodic"))
            .build()
        WorkManager.getInstance(ctx).enqueueUniquePeriodicWork("periodic", ExistingPeriodicWorkPolicy.KEEP, req)
    }

    /** چند ثانیه بعد از قطع تماس (تا تاریخچه‌ی تماس گوشی نوشته شود) */
    fun afterCall(ctx: Context) {
        val req = OneTimeWorkRequestBuilder<SyncWorker>()
            .setInitialDelay(2, TimeUnit.SECONDS)
            .setInputData(workDataOf("mode" to "afterCall"))
            // setExpedited این‌جا نباشد: WorkManager کار «فوری» با تأخیر اولیه را نمی‌پذیرد و
            // موقع ساختن استثنا می‌دهد — استثنایی که جلوی ارسال بعد از تماس را می‌گرفت.
            .build()
        WorkManager.getInstance(ctx).enqueueUniqueWork("afterCall", ExistingWorkPolicy.REPLACE, req)
    }

    /** ارسال صف به محض وصل شدن اینترنت */
    fun uploadSoon(ctx: Context) {
        val req = OneTimeWorkRequestBuilder<SyncWorker>()
            .setConstraints(online)
            .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 30, TimeUnit.SECONDS)
            .setInputData(workDataOf("mode" to "upload"))
            .build()
        WorkManager.getInstance(ctx).enqueueUniqueWork("upload", ExistingWorkPolicy.REPLACE, req)
    }

    fun cancelAll(ctx: Context) {
        WorkManager.getInstance(ctx).cancelAllWork()
    }
}

class SyncWorker(ctx: Context, params: WorkerParameters) : Worker(ctx, params) {

    /** هر بار همگام‌سازی دوره‌ای: اگر نسخه‌ی تازه‌ای منتشر شده باشد، یک‌بار نوتیف می‌دهد */
    private fun checkUpdate(ctx: Context, p: Prefs) {
        try {
            val r = Api.request(p.server, p.token, "GET", "/app-version", null, 10000)
            val code = r.optInt("versionCode", 0)
            if (code > BuildConfig.VERSION_CODE && code != p.updateNotified) {
                Notifs.update(ctx, r.optString("versionName"))
                p.updateNotified = code
            }
        } catch (e: Exception) {
            // اینترنت نبود یا خطا — دفعه‌ی بعد
        }
    }


    override fun doWork(): Result {
        val ctx = applicationContext
        val p = Prefs.get(ctx)
        if (!p.paired) return Result.success()
        // اگر اندروید سرویسِ رصد تماس را خوابانده بود، همین‌جا دوباره روشنش کن
        try { CallMonitorService.start(ctx) } catch (e: Exception) { }
        val mode = inputData.getString("mode") ?: "periodic"

        Syncer.collect(ctx)
        if (mode == "afterCall") {
            // بعضی گوشی‌ها تاریخچه را با تأخیر می‌نویسند
            var tries = 0
            while (!Syncer.hasPendingPrompt(ctx) && tries++ < 5) {
                Thread.sleep(3000)
                Syncer.collect(ctx)
            }
            // تلاش سریع برای گرفتن نام مشتری از CRM پیش از باز کردن فرم
            try {
                Syncer.upload(ctx, 8000)
            } catch (e: Exception) {
                // آفلاین: فرم باز می‌شود و بعداً ارسال می‌شود
            }
            Syncer.notifyMissed(ctx)
            Syncer.promptAfterCall(ctx)
        } else {
            Syncer.notifyMissed(ctx)
            // اگر قطع تماس دیده نشده بود (اپ بسته بود)، کارت ثبت همین حالا
            Syncer.promptAfterCall(ctx)
        }

        return try {
            Syncer.upload(ctx)
            if (mode == "periodic") {
                Syncer.refreshBootstrap(ctx, false)
                ContactsSync.run(ctx)
                checkUpdate(ctx, p)
            }
            Result.success()
        } catch (e: ApiException) {
            if (e.code != 401) p.lastError = Api.friendly(e)
            if (e.code >= 500 && mode == "upload") Result.retry() else Result.success()
        } catch (e: Exception) {
            p.lastError = Api.friendly(e)
            if (mode == "upload") {
                Result.retry()
            } else {
                Work.uploadSoon(ctx)
                Result.success()
            }
        }
    }
}
