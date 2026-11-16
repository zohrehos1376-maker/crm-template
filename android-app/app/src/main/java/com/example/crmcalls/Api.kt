package com.example.crmcalls

import android.content.Context
import com.example.crmcalls.contacts.ContactsSync
import org.json.JSONObject
import java.net.ConnectException
import java.net.HttpURLConnection
import java.net.SocketTimeoutException
import java.net.URL
import java.net.UnknownHostException
import javax.net.ssl.SSLException

class ApiException(val code: Int, message: String) : Exception(message)

/** مقدار رشته‌ای امن (null در JSON → رشته‌ی خالی) */
fun JSONObject.str(key: String): String = if (!has(key) || isNull(key)) "" else optString(key)

/**
 * ارتباط با CRM — فقط HTTPS (گواهی سرور در network_security_config سنجاق شده است).
 */
object Api {
    private const val PREFIX = "/api/v1/device"

    fun normalizeServer(input: String): String {
        var s = PhoneUtil.toEnDigits(input).trim().trimEnd('/')
        if (s.isEmpty()) return s
        if (s.startsWith("http://", ignoreCase = true)) s = "https://" + s.substring(7)
        if (!s.startsWith("https://", ignoreCase = true)) s = "https://$s"
        return s
    }

    fun request(
        server: String,
        token: String?,
        method: String,
        path: String,
        body: JSONObject? = null,
        timeoutMs: Int = 30000
    ): JSONObject {
        val conn = URL(server + PREFIX + path).openConnection() as HttpURLConnection
        try {
            conn.requestMethod = method
            conn.connectTimeout = timeoutMs
            conn.readTimeout = timeoutMs
            conn.useCaches = false
            conn.setRequestProperty("Accept", "application/json")
            conn.setRequestProperty("X-App-Version", BuildConfig.VERSION_NAME)
            if (!token.isNullOrEmpty()) conn.setRequestProperty("Authorization", "Bearer $token")
            if (body != null) {
                conn.doOutput = true
                conn.setRequestProperty("Content-Type", "application/json; charset=utf-8")
                conn.outputStream.use { it.write(body.toString().toByteArray(Charsets.UTF_8)) }
            }
            val code = conn.responseCode
            val stream = if (code in 200..299) conn.inputStream else conn.errorStream
            val text = stream?.bufferedReader(Charsets.UTF_8)?.use { it.readText() } ?: ""
            val json = try {
                if (text.isBlank()) JSONObject() else JSONObject(text)
            } catch (e: Exception) {
                JSONObject()
            }
            if (code !in 200..299) {
                throw ApiException(code, json.str("error").ifBlank { "خطای سرور ($code)" })
            }
            return json
        } finally {
            conn.disconnect()
        }
    }

    /**
     * درخواست با توکن همین گوشی.
     * اگر توکن باطل شده باشد (401) هیچ چیز پاک نمی‌شود: مخاطبین و تماس‌های ارسال‌نشده می‌مانند
     * تا بعد از اتصال دوباره فرستاده شوند — یک خطای سرور نباید داده‌ی گوشی را از بین ببرد.
     */
    fun call(ctx: Context, method: String, path: String, body: JSONObject? = null, timeoutMs: Int = 30000): JSONObject {
        val p = Prefs.get(ctx)
        if (!p.paired) throw ApiException(401, "این گوشی هنوز به CRM وصل نشده است")
        try {
            return request(p.server, p.token, method, path, body, timeoutMs)
        } catch (e: ApiException) {
            if (e.code == 401) throw ApiException(401, "اتصال این گوشی در CRM باطل شده — «جدا کردن گوشی» را بزنید و با کد تازه دوباره وصل کنید (مخاطبین و تماس‌ها می‌مانند)")
            throw e
        }
    }

    /** جدا کردن گوشی از CRM: مخاطبین «| نمونه» روی گوشی می‌مانند و تماس‌های ارسال‌نشده هم نگه داشته می‌شوند */
    fun unpair(ctx: Context) {
        CallMonitorService.stop(ctx)
        LocalDb.get(ctx).clearSynced()
        Work.cancelAll(ctx)
        Prefs.get(ctx).clearPairing()
    }

    fun friendly(e: Throwable): String = when (e) {
        is ApiException -> e.message ?: "خطا"
        is SSLException -> "اتصال امن برقرار نشد (گواهی سرور شناخته نشد)"
        is SocketTimeoutException -> "سرور پاسخ نداد — اینترنت را بررسی کنید"
        is UnknownHostException, is ConnectException -> "به سرور وصل نشد — اینترنت را بررسی کنید"
        else -> e.message ?: "خطای ناشناخته"
    }
}
