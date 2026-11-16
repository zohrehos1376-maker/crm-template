package com.example.crmcalls

import android.app.Activity
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.Settings
import androidx.core.content.FileProvider
import java.io.File
import java.net.HttpURLConnection
import java.net.URL
import kotlin.concurrent.thread

/**
 * به‌روزرسانی داخل خود اپ: فایل نسخه‌ی تازه از همان سرور CRM گرفته می‌شود
 * (همان آدرس و همان گواهی سنجاق‌شده، پس با اینترنت ملی هم کار می‌کند؛ مرورگر و گوگل‌پلی لازم نیست)
 * و بعد صفحه‌ی نصب اندروید باز می‌شود.
 */
object Updater {

    fun download(activity: Activity, url: String, onProgress: (String) -> Unit) {
        thread {
            try {
                val dir = File(activity.cacheDir, "updates")
                dir.mkdirs()
                dir.listFiles()?.forEach { it.delete() }
                val file = File(dir, "crm-template-call.apk")
                val conn = URL(url).openConnection() as HttpURLConnection
                conn.connectTimeout = 20000
                conn.readTimeout = 60000
                conn.instanceFollowRedirects = true
                val total = conn.contentLength.toLong()
                conn.inputStream.use { input ->
                    file.outputStream().use { out ->
                        val buf = ByteArray(32 * 1024)
                        var done = 0L
                        var n = input.read(buf)
                        while (n > 0) {
                            out.write(buf, 0, n)
                            done += n
                            if (total > 0) {
                                val pct = (done * 100 / total).toInt()
                                activity.runOnUiThread { onProgress("در حال دریافت به‌روزرسانی… " + Jalali.fa("$pct") + "٪") }
                            }
                            n = input.read(buf)
                        }
                    }
                }
                conn.disconnect()
                activity.runOnUiThread {
                    onProgress("آماده‌ی نصب — روی «نصب» بزنید")
                    install(activity, file)
                }
            } catch (e: Exception) {
                activity.runOnUiThread { onProgress("دریافت به‌روزرسانی نشد — اینترنت را بررسی کنید و دوباره بزنید") }
            }
        }
    }

    private fun install(activity: Activity, file: File) {
        // اندروید ۸ به بالا: یک‌بار باید اجازه‌ی «نصب برنامه‌ی ناشناس» به اپ داده شود
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && !activity.packageManager.canRequestPackageInstalls()) {
            try {
                activity.startActivity(
                    Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:" + activity.packageName))
                )
                return
            } catch (e: Exception) {
                // اگر این صفحه باز نشد، نصب عادی را امتحان کن
            }
        }
        val uri: Uri = FileProvider.getUriForFile(activity, activity.packageName + ".files", file)
        val intent = Intent(Intent.ACTION_VIEW)
            .setDataAndType(uri, "application/vnd.android.package-archive")
            .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK)
        try {
            activity.startActivity(intent)
        } catch (e: Exception) {
        }
    }
}
