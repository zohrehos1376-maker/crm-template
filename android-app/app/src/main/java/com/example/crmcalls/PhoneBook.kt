package com.example.crmcalls

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.net.Uri
import android.provider.ContactsContract
import androidx.core.content.ContextCompat

/**
 * نام ذخیره‌شده در دفترچه‌تلفن گوشی برای یک شماره — فقط خواندن؛
 * هیچ‌وقت مخاطب شخصی را تغییر نمی‌دهد.
 */
object PhoneBook {
    private const val SUFFIX = " | نمونه"

    fun nameFor(ctx: Context, phone: String?): String {
        if (phone.isNullOrBlank()) return ""
        if (ContextCompat.checkSelfPermission(ctx, Manifest.permission.READ_CONTACTS) != PackageManager.PERMISSION_GRANTED) return ""
        return try {
            val uri = Uri.withAppendedPath(ContactsContract.PhoneLookup.CONTENT_FILTER_URI, Uri.encode(phone))
            ctx.contentResolver.query(uri, arrayOf(ContactsContract.PhoneLookup.DISPLAY_NAME), null, null, null)?.use { c ->
                var fallback = ""
                while (c.moveToNext()) {
                    val n = (c.getString(0) ?: "").trim()
                    if (n.isEmpty()) continue
                    // مخاطب شخصی بر مخاطبی که خود اپ از CRM ساخته مقدم است
                    if (!n.endsWith(SUFFIX)) return n
                    if (fallback.isEmpty()) fallback = n.removeSuffix(SUFFIX).trim()
                }
                fallback
            } ?: ""
        } catch (e: Exception) {
            ""
        }
    }
}
