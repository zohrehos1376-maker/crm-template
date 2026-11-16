package com.example.crmcalls

import android.content.Context
import java.util.concurrent.atomic.AtomicBoolean

/**
 * بعد از قطع تماس: تا وقتی خودِ تماس از تاریخچه‌ی گوشی خوانده و به CRM فرستاده نشود، تلاش ادامه دارد.
 *
 * چرا این‌جا و نه فقط داخل سرویس: روی سامسونگ، اندروید سرویسِ همیشه‌روشن را می‌خواباند و
 * WorkManager را ساعت‌ها عقب می‌اندازد؛ ولی گیرنده‌ی «وضعیت تلفن» سر وقت اجرا می‌شود
 * (گزارش زنده‌ی همان گوشی‌ها بی‌نقص می‌رسد). پس همان گیرنده هم می‌تواند ارسال را شروع کند.
 */
object PostCall {
    private val running = AtomicBoolean(false)

    /** فاصله‌ی تلاش‌ها: دو چیز دیر می‌آیند — نوشته‌شدن ردیف تماس در گوشی، و برگشتن دیتا بعد از مکالمه */
    private val WAITS = longArrayOf(0L, 3_000L, 7_000L, 15_000L, 30_000L, 45_000L, 60_000L, 120_000L)

    /** اگر تلاشی در جریان باشد چیزی شروع نمی‌شود؛ همان حلقه تماس تازه را هم برمی‌دارد. */
    fun run(ctx0: Context, onDone: (() -> Unit)? = null) {
        val ctx = ctx0.applicationContext
        if (!Prefs.get(ctx).paired || !running.compareAndSet(false, true)) {
            onDone?.invoke()
            return
        }
        kotlin.concurrent.thread {
            try {
                // شرط پایان «صف ارسال خالی است» کافی نیست: تا وقتی ردیف تماس در تاریخچه‌ی
                // گوشی نوشته نشده، صف هم طبیعتاً خالی است. پس تا تماسِ تازه‌ای واقعاً خوانده
                // نشود، تلاش ادامه پیدا می‌کند.
                var gotNew = false
                var sent = false
                for (wait in WAITS) {
                    try {
                        if (wait > 0L) Thread.sleep(wait)
                    } catch (e: InterruptedException) {
                        break
                    }
                    try {
                        if (Syncer.collect(ctx).isNotEmpty()) gotNew = true
                    } catch (e: Exception) { }
                    try { Syncer.upload(ctx, 15000) } catch (e: Exception) { }
                    // کارت ثبت تماس منتظر تلاش‌های بعدی نماند. هر دور صدا زده می‌شود چون فقط
                    // سراغ تماس‌هایی می‌رود که هنوز کارت نگرفته‌اند — تماس تازه هم جا نمی‌ماند.
                    try { Syncer.promptAfterCall(ctx) } catch (e: Exception) { }
                    if (gotNew && !LocalDb.get(ctx).hasUnsynced()) { sent = true; break }
                }
                if (!sent) {
                    // آخرین پناه: WorkManager به‌محض وصل شدن اینترنت می‌فرستد
                    try { Work.uploadSoon(ctx) } catch (e: Exception) { }
                    // دیگر خاموش نماند: کارشناس در صفحه‌ی اصلی اپ می‌بیند چه شد
                    if (!gotNew) Prefs.get(ctx).lastError =
                        "تماس آخر در تاریخچه‌ی گوشی پیدا نشد (۴ دقیقه صبر شد) — اپ را باز کنید تا فرستاده شود"
                }
            } finally {
                running.set(false)
                onDone?.invoke()
            }
        }
    }
}
