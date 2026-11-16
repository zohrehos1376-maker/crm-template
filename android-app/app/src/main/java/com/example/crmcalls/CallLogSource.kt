package com.example.crmcalls

import android.Manifest
import android.annotation.SuppressLint
import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import android.provider.CallLog
import android.telecom.TelecomManager
import android.telephony.SubscriptionManager
import android.telephony.TelephonyManager
import androidx.core.content.ContextCompat

data class RawCall(
    val id: Long,
    val number: String,
    val type: Int,
    val date: Long,
    val duration: Long,
    val accountId: String?
)

/** خواندن تاریخچه‌ی تماس گوشی (فقط خواندن — چیزی در گوشی تغییر نمی‌کند) */
object CallLogSource {

    fun hasPermission(ctx: Context) =
        ContextCompat.checkSelfPermission(ctx, Manifest.permission.READ_CALL_LOG) == PackageManager.PERMISSION_GRANTED

    fun readSince(ctx: Context, sinceMs: Long): List<RawCall> {
        if (!hasPermission(ctx)) return emptyList()
        val proj = arrayOf(
            CallLog.Calls._ID,
            CallLog.Calls.NUMBER,
            CallLog.Calls.TYPE,
            CallLog.Calls.DATE,
            CallLog.Calls.DURATION,
            CallLog.Calls.PHONE_ACCOUNT_ID
        )
        val out = ArrayList<RawCall>()
        try {
            ctx.contentResolver.query(
                CallLog.Calls.CONTENT_URI,
                proj,
                "${CallLog.Calls.DATE} > ?",
                arrayOf(sinceMs.toString()),
                "${CallLog.Calls.DATE} ASC"
            )?.use { c ->
                while (c.moveToNext()) {
                    out.add(RawCall(c.getLong(0), c.getString(1) ?: "", c.getInt(2), c.getLong(3), c.getLong(4), c.getString(5)))
                }
            }
        } catch (e: SecurityException) {
            return emptyList()
        }
        return out
    }

    fun direction(type: Int): String? = when (type) {
        CallLog.Calls.INCOMING_TYPE -> "INCOMING"
        CallLog.Calls.OUTGOING_TYPE -> "OUTGOING"
        CallLog.Calls.MISSED_TYPE, CallLog.Calls.VOICEMAIL_TYPE -> "MISSED"
        CallLog.Calls.REJECTED_TYPE, CallLog.Calls.BLOCKED_TYPE -> "REJECTED"
        else -> null
    }
}

data class SimInfo(val subId: Int, val label: String, val accountIds: Set<String>)

/** سیم‌کارت‌های گوشی و تشخیص این‌که هر تماس روی کدام سیم بوده */
object Sims {

    private fun hasPhoneState(ctx: Context) =
        ContextCompat.checkSelfPermission(ctx, Manifest.permission.READ_PHONE_STATE) == PackageManager.PERMISSION_GRANTED

    @SuppressLint("MissingPermission", "HardwareIds")
    fun list(ctx: Context): List<SimInfo> {
        if (!hasPhoneState(ctx)) return emptyList()
        val sm = ctx.getSystemService(SubscriptionManager::class.java) ?: return emptyList()
        val subs = try {
            sm.activeSubscriptionInfoList ?: emptyList()
        } catch (e: SecurityException) {
            emptyList()
        }
        val tm = ctx.getSystemService(TelephonyManager::class.java)
        val telecom = ctx.getSystemService(TelecomManager::class.java)
        val handles = try {
            telecom?.callCapablePhoneAccounts ?: emptyList()
        } catch (e: SecurityException) {
            emptyList()
        }
        return subs.map { s ->
            val ids = HashSet<String>()
            ids.add(s.subscriptionId.toString())
            val icc = try {
                s.iccId ?: ""
            } catch (e: Exception) {
                ""
            }
            if (icc.isNotEmpty()) ids.add(icc)
            for (h in handles) {
                val match = if (Build.VERSION.SDK_INT >= 30) {
                    try {
                        tm?.getSubscriptionId(h) == s.subscriptionId
                    } catch (e: Exception) {
                        false
                    }
                } else {
                    h.id == s.subscriptionId.toString() || (icc.isNotEmpty() && h.id.startsWith(icc))
                }
                if (match) ids.add(h.id)
            }
            val name = (s.displayName?.toString() ?: "").ifBlank { "سیم‌کارت" }
            val number = try {
                @Suppress("DEPRECATION")
                s.number ?: ""
            } catch (e: Exception) {
                ""
            }
            val label = "اسلات ${Jalali.fa(s.simSlotIndex + 1)} — $name" + if (number.isNotBlank()) " ($number)" else ""
            SimInfo(s.subscriptionId, label, ids)
        }
    }

    /** آیا تماسی با این PHONE_ACCOUNT_ID روی سیم‌کارت کاری بوده؟ */
    fun accepts(sims: List<SimInfo>, chosenSubId: Int, accountId: String?): Boolean {
        if (chosenSubId < 0 || sims.size <= 1) return true
        if (accountId.isNullOrEmpty()) return true
        val mine = sims.find { it.subId == chosenSubId } ?: return true
        if (mine.accountIds.any { it.equals(accountId, ignoreCase = true) }) return true
        // اگر متعلق به سیم دیگر است رد می‌شود؛ اگر هیچ‌کدام را نشناختیم، از دست نمی‌رود
        val other = sims.any { it.subId != chosenSubId && it.accountIds.any { id -> id.equals(accountId, ignoreCase = true) } }
        return !other
    }
}
