package com.example.crmcalls

import android.content.Context
import android.content.SharedPreferences
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKeys
import org.json.JSONArray

data class Operator(val id: String, val name: String)

/**
 * تنظیمات اپ. توکن دستگاه رمزنگاری‌شده (EncryptedSharedPreferences) نگه داشته می‌شود.
 */
class Prefs private constructor(private val sp: SharedPreferences) {

    companion object {
        @Volatile
        private var inst: Prefs? = null

        fun get(ctx: Context): Prefs = inst ?: synchronized(this) {
            inst ?: Prefs(open(ctx.applicationContext)).also { inst = it }
        }

        private fun open(ctx: Context): SharedPreferences = try {
            val key = MasterKeys.getOrCreate(MasterKeys.AES256_GCM_SPEC)
            EncryptedSharedPreferences.create(
                "crm_secure",
                key,
                ctx,
                EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
                EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM
            )
        } catch (e: Exception) {
            // بعضی گوشی‌ها Keystore خراب دارند — اپ نباید از کار بیفتد
            ctx.getSharedPreferences("crm_plain", Context.MODE_PRIVATE)
        }
    }

    private fun str(k: String) = sp.getString(k, "") ?: ""
    private fun putStr(k: String, v: String) = sp.edit().putString(k, v).apply()
    private fun putLong(k: String, v: Long) = sp.edit().putLong(k, v).apply()

    var server: String
        get() = str("server")
        set(v) = putStr("server", v)

    var token: String
        get() = str("token")
        set(v) {
            sp.edit().putString("token", v).commit()
        }

    var lineId: String
        get() = str("lineId")
        set(v) = putStr("lineId", v)

    var lineName: String
        get() = str("lineName")
        set(v) = putStr("lineName", v)

    /** subscriptionId سیم‌کارت کاری؛ ‎-1 یعنی همه‌ی سیم‌کارت‌ها */
    var simSubId: Int
        get() = sp.getInt("simSubId", -1)
        set(v) {
            sp.edit().putInt("simSubId", v).apply()
        }

    var simLabel: String
        get() = str("simLabel")
        set(v) = putStr("simLabel", v)

    var simChosen: Boolean
        get() = sp.getBoolean("simChosen", false)
        set(v) {
            sp.edit().putBoolean("simChosen", v).apply()
        }

    /** زمان (DATE) آخرین ردیف تاریخچه‌ی تماس که خوانده شده */
    var callCursor: Long
        get() = sp.getLong("callCursor", 0L)
        set(v) = putLong("callCursor", v)

    var contactsSince: Long
        get() = sp.getLong("contactsSince", 0L)
        set(v) = putLong("contactsSince", v)

    /** شکل نام مخاطبین (۲ = با تیک احراز) */
    var contactsFormat: Int
        get() = sp.getInt("contactsFormat", 1)
        set(v) = sp.edit().putInt("contactsFormat", v).apply()

    var lastSyncAt: Long
        get() = sp.getLong("lastSyncAt", 0L)
        set(v) = putLong("lastSyncAt", v)

    var bootstrapAt: Long
        get() = sp.getLong("bootstrapAt", 0L)
        set(v) = putLong("bootstrapAt", v)

    var lastError: String
        get() = str("lastError")
        set(v) = putStr("lastError", v)

    /** تماس‌هایی که در آخرین خواندن، چون روی سیم‌کارت کاری نبودند کنار گذاشته شدند */
    var skippedOtherSim: Int
        get() = sp.getInt("skippedOtherSim", 0)
        set(v) { sp.edit().putInt("skippedOtherSim", v).apply() }

    /** آخرین نسخه‌ای که برایش نوتیف «به‌روزرسانی» فرستاده شده (تا تکرار نشود) */
    var updateNotified: Int
        get() = sp.getInt("updateNotified", 0)
        set(v) { sp.edit().putInt("updateNotified", v).apply() }

    var lastOperatorId: String
        get() = str("lastOperatorId")
        set(v) = putStr("lastOperatorId", v)

    var autostartConfirmed: Boolean
        get() = sp.getBoolean("autostartConfirmed", false)
        set(v) {
            sp.edit().putBoolean("autostartConfirmed", v).apply()
        }

    var operatorsJson: String
        get() = str("operators")
        set(v) = putStr("operators", v)

    var heardFromJson: String
        get() = str("heardFrom")
        set(v) = putStr("heardFrom", v)

    /** گزینه‌های فرم ثبت سرنخ (مدل‌های گوشی، برچسب‌ها، …) از CRM */
    var leadFormJson: String
        get() = str("leadForm")
        set(v) = putStr("leadForm", v)

    var formHash: String
        get() = str("formHash")
        set(v) = putStr("formHash", v)

    /** مکان‌نمای همگام‌سازی مخاطبین: (contactsSince, contactsAfterId) */
    var contactsAfterId: String
        get() = str("contactsAfterId")
        set(v) = putStr("contactsAfterId", v)

    fun leadForm(): org.json.JSONObject = try {
        org.json.JSONObject(leadFormJson)
    } catch (e: Exception) {
        org.json.JSONObject()
    }

    val paired: Boolean
        get() = token.isNotEmpty() && server.isNotEmpty()

    fun operators(): List<Operator> = try {
        val a = JSONArray(operatorsJson)
        (0 until a.length()).map { i ->
            val o = a.getJSONObject(i)
            Operator(o.optString("id"), o.optString("name"))
        }
    } catch (e: Exception) {
        emptyList()
    }

    fun heardFrom(): List<String> = try {
        val a = JSONArray(heardFromJson)
        (0 until a.length()).map { a.getString(it) }
    } catch (e: Exception) {
        emptyList()
    }

    /** جدا شدن از CRM: آدرس سرور می‌ماند، بقیه پاک می‌شود */
    fun clearPairing() {
        val keepServer = server
        sp.edit().clear().commit()
        server = keepServer
    }
}
