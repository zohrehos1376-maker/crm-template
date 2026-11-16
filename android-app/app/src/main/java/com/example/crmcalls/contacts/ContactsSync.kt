package com.example.crmcalls.contacts

import android.Manifest
import android.accounts.Account
import android.accounts.AccountManager
import android.content.ContentProviderOperation
import android.content.ContentResolver
import android.content.Context
import android.content.pm.PackageManager
import android.net.Uri
import android.provider.ContactsContract
import android.provider.ContactsContract.CommonDataKinds.Phone
import android.provider.ContactsContract.CommonDataKinds.StructuredName
import androidx.core.content.ContextCompat
import com.example.crmcalls.Api
import com.example.crmcalls.CachedContact
import com.example.crmcalls.LocalDb
import com.example.crmcalls.PhoneUtil
import com.example.crmcalls.Prefs
import com.example.crmcalls.str

/**
 * مخاطبین مشتری‌ها زیر حساب جداگانه‌ی «CRM DEMO CRM» با نام «نام مشتری | نمونه».
 * مشتری احرازشده در CRM: «نام مشتری ✅ | نمونه» — در واتساپ، تلگرام و صفحه‌ی تماس هم دیده می‌شود.
 * فقط ردیف‌های همین حساب خوانده/نوشته می‌شوند؛ به مخاطبین شخصی گوشی دست نمی‌خورد.
 * با جدا شدن گوشی از CRM یا قطع اتصال، مخاطبین سر جایشان می‌مانند (فقط با حذف خود اپ پاک می‌شوند).
 */
object ContactsSync {
    const val ACCOUNT_TYPE = "com.example.crmcalls.account"
    const val ACCOUNT_NAME = "CRM DEMO CRM"
    private const val SUFFIX = " | نمونه"
    private const val VERIFIED = " ✅"
    // با عوض شدن شکل نام‌ها، همه‌ی مخاطبین یک بار از اول نوشته می‌شوند
    private const val FORMAT = 2

    private class Item(val leadId: String, val name: String, val phone: String, val verified: Boolean)

    fun account() = Account(ACCOUNT_NAME, ACCOUNT_TYPE)

    private fun canWrite(ctx: Context) =
        ContextCompat.checkSelfPermission(ctx, Manifest.permission.WRITE_CONTACTS) == PackageManager.PERMISSION_GRANTED &&
            ContextCompat.checkSelfPermission(ctx, Manifest.permission.READ_CONTACTS) == PackageManager.PERMISSION_GRANTED

    fun ensureAccount(ctx: Context): Account {
        val am = AccountManager.get(ctx)
        val acc = account()
        if (am.getAccountsByType(ACCOUNT_TYPE).none { it.name == ACCOUNT_NAME }) {
            am.addAccountExplicitly(acc, null, null)
            ContentResolver.setIsSyncable(acc, ContactsContract.AUTHORITY, 1)
            ContentResolver.setSyncAutomatically(acc, ContactsContract.AUTHORITY, false)
        }
        return acc
    }

    fun removeAccount(ctx: Context) {
        try {
            val am = AccountManager.get(ctx)
            for (a in am.getAccountsByType(ACCOUNT_TYPE)) am.removeAccountExplicitly(a)
        } catch (e: Exception) {
        }
    }

    private fun asSyncAdapter(uri: Uri): Uri = uri.buildUpon()
        .appendQueryParameter(ContactsContract.CALLER_IS_SYNCADAPTER, "true")
        .appendQueryParameter(ContactsContract.RawContacts.ACCOUNT_NAME, ACCOUNT_NAME)
        .appendQueryParameter(ContactsContract.RawContacts.ACCOUNT_TYPE, ACCOUNT_TYPE)
        .build()

    /** همگام‌سازی افزایشی: فقط سرنخ‌هایی که از آخرین بار تغییر کرده‌اند */
    fun run(ctx: Context) {
        val p = Prefs.get(ctx)
        if (!p.paired) return
        if (p.contactsFormat < FORMAT) {
            p.contactsSince = 0L
            p.contactsAfterId = ""
            p.contactsFormat = FORMAT
        }
        val db = LocalDb.get(ctx)
        val write = canWrite(ctx)
        var existing: MutableMap<String, Long>? = null
        var rounds = 0
        // دسته‌های کوچک ۳۰۰تایی: روی اینترنت ضعیف هر دسته جدا ذخیره می‌شود و کار نصفه نمی‌ماند
        while (rounds++ < 100) {
            var q = "/contacts?limit=300&since=" + p.contactsSince
            if (p.contactsAfterId.isNotEmpty()) q += "&afterId=" + java.net.URLEncoder.encode(p.contactsAfterId, "UTF-8")
            val r = Api.call(ctx, "GET", q, null, 45000)
            val arr = r.optJSONArray("contacts") ?: break
            val cache = ArrayList<CachedContact>()
            val items = ArrayList<Item>()
            for (i in 0 until arr.length()) {
                val o = arr.getJSONObject(i)
                val phone = PhoneUtil.normalize(o.str("phone"))
                val id = o.str("id")
                if (phone.isEmpty() || id.isEmpty()) continue
                cache.add(CachedContact(phone, id, o.str("name")))
                items.add(Item(id, o.str("name"), phone, o.optBoolean("verified", false)))
            }
            db.upsertContacts(cache)
            if (write && items.isNotEmpty()) {
                ensureAccount(ctx)
                val map = existing ?: loadExisting(ctx).also { existing = it }
                writeContacts(ctx, items, map)
            }
            val next = r.optJSONObject("next")
            if (next != null) {
                p.contactsSince = next.optLong("since", p.contactsSince)
                p.contactsAfterId = next.str("afterId")
            }
            if (!r.optBoolean("more", false)) break
        }
    }

    private fun loadExisting(ctx: Context): MutableMap<String, Long> {
        val map = HashMap<String, Long>()
        ctx.contentResolver.query(
            asSyncAdapter(ContactsContract.RawContacts.CONTENT_URI),
            arrayOf(ContactsContract.RawContacts._ID, ContactsContract.RawContacts.SOURCE_ID),
            "${ContactsContract.RawContacts.ACCOUNT_TYPE} = ? AND ${ContactsContract.RawContacts.ACCOUNT_NAME} = ? AND ${ContactsContract.RawContacts.DELETED} = 0",
            arrayOf(ACCOUNT_TYPE, ACCOUNT_NAME),
            null
        )?.use { c ->
            while (c.moveToNext()) {
                val src = c.getString(1)
                if (src != null) map[src] = c.getLong(0)
            }
        }
        return map
    }

    private fun writeContacts(ctx: Context, items: List<Item>, existing: MutableMap<String, Long>) {
        val dataUri = asSyncAdapter(ContactsContract.Data.CONTENT_URI)
        val rawUri = asSyncAdapter(ContactsContract.RawContacts.CONTENT_URI)
        var ops = ArrayList<ContentProviderOperation>()

        fun flush() {
            if (ops.isEmpty()) return
            try {
                ctx.contentResolver.applyBatch(ContactsContract.AUTHORITY, ops)
            } catch (e: Exception) {
            }
            ops = ArrayList()
        }

        for (item in items) {
            val leadId = item.leadId
            val phone = item.phone
            val display = item.name.ifBlank { "مشتری" } + (if (item.verified) VERIFIED else "") + SUFFIX
            val rawId = existing[leadId]
            if (rawId != null) {
                ops.add(
                    ContentProviderOperation.newUpdate(dataUri)
                        .withSelection(
                            "${ContactsContract.Data.RAW_CONTACT_ID} = ? AND ${ContactsContract.Data.MIMETYPE} = ?",
                            arrayOf(rawId.toString(), StructuredName.CONTENT_ITEM_TYPE)
                        )
                        .withValue(StructuredName.DISPLAY_NAME, display)
                        .withValue(StructuredName.GIVEN_NAME, null)
                        .withValue(StructuredName.FAMILY_NAME, null)
                        .build()
                )
                ops.add(
                    ContentProviderOperation.newUpdate(dataUri)
                        .withSelection(
                            "${ContactsContract.Data.RAW_CONTACT_ID} = ? AND ${ContactsContract.Data.MIMETYPE} = ?",
                            arrayOf(rawId.toString(), Phone.CONTENT_ITEM_TYPE)
                        )
                        .withValue(Phone.NUMBER, phone)
                        .build()
                )
            } else {
                val back = ops.size
                ops.add(
                    ContentProviderOperation.newInsert(rawUri)
                        .withValue(ContactsContract.RawContacts.ACCOUNT_TYPE, ACCOUNT_TYPE)
                        .withValue(ContactsContract.RawContacts.ACCOUNT_NAME, ACCOUNT_NAME)
                        .withValue(ContactsContract.RawContacts.SOURCE_ID, leadId)
                        .build()
                )
                ops.add(
                    ContentProviderOperation.newInsert(dataUri)
                        .withValueBackReference(ContactsContract.Data.RAW_CONTACT_ID, back)
                        .withValue(ContactsContract.Data.MIMETYPE, StructuredName.CONTENT_ITEM_TYPE)
                        .withValue(StructuredName.DISPLAY_NAME, display)
                        .build()
                )
                ops.add(
                    ContentProviderOperation.newInsert(dataUri)
                        .withValueBackReference(ContactsContract.Data.RAW_CONTACT_ID, back)
                        .withValue(ContactsContract.Data.MIMETYPE, Phone.CONTENT_ITEM_TYPE)
                        .withValue(Phone.NUMBER, phone)
                        .withValue(Phone.TYPE, Phone.TYPE_WORK)
                        .build()
                )
                existing[leadId] = -1L // در همین دور دوباره ساخته نشود
            }
            if (ops.size >= 300) flush()
        }
        flush()
    }
}
