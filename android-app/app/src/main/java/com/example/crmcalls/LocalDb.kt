package com.example.crmcalls

import android.content.ContentValues
import android.content.Context
import android.database.Cursor
import android.database.sqlite.SQLiteDatabase
import android.database.sqlite.SQLiteOpenHelper

data class LocalCall(
    val externalId: String,
    val phone: String,
    val direction: String,
    val startedAt: Long,
    val durationSec: Int,
    val serverId: String?,
    val leadJson: String?,
    val synced: Int,
    val logState: Int,
    val prompted: Boolean
) {
    val answered: Boolean
        get() = (direction == "INCOMING" || direction == "OUTGOING") && durationSec > 0
    /** ثبت دستی از فهرست: هر تماس ورودی/خروجی (حتی صفر ثانیه) */
    val loggable: Boolean
        get() = direction == "INCOMING" || direction == "OUTGOING"
    val unanswered: Boolean
        get() = direction == "MISSED" || direction == "REJECTED"
}

data class CachedContact(val phone: String, val leadId: String, val name: String)

/**
 * صف آفلاین: تماس‌ها اول این‌جا ذخیره و بعد به CRM فرستاده می‌شوند؛
 * فرم ثبت تماس هم اگر اینترنت نباشد این‌جا می‌ماند تا بعداً ارسال شود.
 */
class LocalDb private constructor(ctx: Context) : SQLiteOpenHelper(ctx, "crm.db", null, 2) {

    companion object {
        @Volatile
        private var inst: LocalDb? = null

        fun get(ctx: Context): LocalDb = inst ?: synchronized(this) {
            inst ?: LocalDb(ctx.applicationContext).also { inst = it }
        }

        const val SYNC_NO = 0
        const val SYNC_YES = 1
        const val SYNC_REJECTED = 2

        const val LOG_NONE = 0
        const val LOG_PENDING = 1
        const val LOG_DONE = 2

        private const val COLS =
            "external_id, phone, direction, started_at, duration_sec, server_id, lead_json, synced, log_state, prompted"
    }

    override fun onCreate(db: SQLiteDatabase) {
        db.execSQL(
            "CREATE TABLE calls (" +
                "external_id TEXT PRIMARY KEY, phone TEXT NOT NULL, direction TEXT NOT NULL, " +
                "started_at INTEGER NOT NULL, duration_sec INTEGER NOT NULL, server_id TEXT, lead_json TEXT, " +
                "synced INTEGER NOT NULL DEFAULT 0, log_state INTEGER NOT NULL DEFAULT 0, log_json TEXT, " +
                "prompted INTEGER NOT NULL DEFAULT 0, sent_name TEXT)"
        )
        db.execSQL("CREATE INDEX calls_started ON calls(started_at)")
        db.execSQL("CREATE TABLE contacts (phone TEXT PRIMARY KEY, lead_id TEXT NOT NULL, name TEXT NOT NULL)")
    }

    override fun onUpgrade(db: SQLiteDatabase, oldVersion: Int, newVersion: Int) {
        // نسخه‌ی ۲: نامِ دفترچه‌تلفن که آخرین بار برای هر تماس به CRM فرستاده شده
        if (oldVersion < 2) db.execSQL("ALTER TABLE calls ADD COLUMN sent_name TEXT")
    }

    private fun row(c: Cursor) = LocalCall(
        externalId = c.getString(0),
        phone = c.getString(1) ?: "",
        direction = c.getString(2),
        startedAt = c.getLong(3),
        durationSec = c.getInt(4),
        serverId = c.getString(5),
        leadJson = c.getString(6),
        synced = c.getInt(7),
        logState = c.getInt(8),
        prompted = c.getInt(9) == 1
    )

    private fun query(sql: String, args: Array<String>? = null): List<LocalCall> =
        readableDatabase.rawQuery(sql, args).use { c ->
            val out = ArrayList<LocalCall>()
            while (c.moveToNext()) out.add(row(c))
            out
        }

    fun insertIfNew(externalId: String, phone: String, direction: String, startedAt: Long, durationSec: Int): Boolean {
        val v = ContentValues()
        v.put("external_id", externalId)
        v.put("phone", phone)
        v.put("direction", direction)
        v.put("started_at", startedAt)
        v.put("duration_sec", durationSec)
        return writableDatabase.insertWithOnConflict("calls", null, v, SQLiteDatabase.CONFLICT_IGNORE) != -1L
    }

    /** همان تماس با _ID دیگر (بعضی گوشی‌ها تماس را دو بار در تاریخچه می‌نویسند) */
    fun existsSame(phone: String, direction: String, startedAt: Long): Boolean =
        readableDatabase.rawQuery(
            "SELECT 1 FROM calls WHERE phone = ? AND direction = ? AND started_at = ? LIMIT 1",
            arrayOf(phone, direction, startedAt.toString())
        ).use { it.moveToFirst() }

    /** بعضی گوشی‌ها تماس خروجی را اول با مدت صفر می‌نویسند و بعد مدت را پر می‌کنند */
    fun updateDurationIfLonger(externalId: String, durationSec: Int): Boolean {
        val v = ContentValues()
        v.put("duration_sec", durationSec)
        v.put("synced", SYNC_NO)
        return writableDatabase.update("calls", v, "external_id = ? AND duration_sec < ?", arrayOf(externalId, durationSec.toString())) > 0
    }

    fun sentName(externalId: String): String =
        readableDatabase.rawQuery("SELECT sent_name FROM calls WHERE external_id = ?", arrayOf(externalId)).use {
            if (it.moveToFirst()) it.getString(0) ?: "" else ""
        }

    fun setSentName(externalId: String, name: String) {
        val v = ContentValues()
        v.put("sent_name", name)
        writableDatabase.update("calls", v, "external_id = ?", arrayOf(externalId))
    }

    fun markUnsynced(externalId: String) {
        val v = ContentValues()
        v.put("synced", SYNC_NO)
        writableDatabase.update("calls", v, "external_id = ? AND synced = 1", arrayOf(externalId))
    }

    fun get(externalId: String): LocalCall? =
        query("SELECT $COLS FROM calls WHERE external_id = ?", arrayOf(externalId)).firstOrNull()

    fun unsynced(limit: Int): List<LocalCall> =
        query("SELECT $COLS FROM calls WHERE synced = 0 ORDER BY started_at LIMIT $limit")

    /** هنوز تماسی هست که به CRM نرسیده باشد؟ */
    fun hasUnsynced(): Boolean = unsynced(1).isNotEmpty()

    fun markSynced(externalId: String, serverId: String?, leadJson: String?, state: Int) {
        val v = ContentValues()
        v.put("synced", state)
        if (serverId != null) v.put("server_id", serverId)
        if (leadJson != null) v.put("lead_json", leadJson)
        writableDatabase.update("calls", v, "external_id = ?", arrayOf(externalId))
    }

    fun saveLog(externalId: String, json: String) {
        val v = ContentValues()
        v.put("log_state", LOG_PENDING)
        v.put("log_json", json)
        writableDatabase.update("calls", v, "external_id = ?", arrayOf(externalId))
    }

    /** فرم‌های ثبت‌شده‌ای که هنوز به CRM نرسیده‌اند (تماس باید قبلاً ارسال شده باشد) */
    fun pendingLogs(): List<Pair<LocalCall, String>> =
        readableDatabase.rawQuery(
            "SELECT $COLS, log_json FROM calls WHERE log_state = 1 AND server_id IS NOT NULL ORDER BY started_at",
            null
        ).use { c ->
            val out = ArrayList<Pair<LocalCall, String>>()
            while (c.moveToNext()) out.add(Pair(row(c), c.getString(10) ?: "{}"))
            out
        }

    fun setLogState(externalId: String, state: Int) {
        val v = ContentValues()
        v.put("log_state", state)
        writableDatabase.update("calls", v, "external_id = ?", arrayOf(externalId))
    }

    fun setPrompted(externalId: String) {
        val v = ContentValues()
        v.put("prompted", 1)
        writableDatabase.update("calls", v, "external_id = ?", arrayOf(externalId))
    }

    /** تماس‌های تازه‌ای که هنوز برایشان کارت/اعلان نشان داده نشده (مهم نیست کدام همگام‌سازی آن‌ها را خوانده) */
    fun unprompted(since: Long): List<LocalCall> =
        query(
            "SELECT $COLS FROM calls WHERE prompted = 0 AND log_state = 0 AND started_at + duration_sec * 1000 >= ? ORDER BY started_at",
            arrayOf(since.toString())
        )

    fun since(ts: Long): List<LocalCall> =
        query("SELECT $COLS FROM calls WHERE started_at >= ? ORDER BY started_at DESC", arrayOf(ts.toString()))

    fun between(from: Long, to: Long): List<LocalCall> =
        query("SELECT $COLS FROM calls WHERE started_at >= ? AND started_at < ? ORDER BY started_at DESC", arrayOf(from.toString(), to.toString()))

    fun queueCount(): Int =
        readableDatabase.rawQuery("SELECT COUNT(*) FROM calls WHERE synced = 0 OR log_state = 1", null).use {
            if (it.moveToFirst()) it.getInt(0) else 0
        }

    /** تماس‌های قدیمیِ ارسال‌شده پاک می‌شوند تا حافظه پر نشود */
    fun prune(before: Long) {
        writableDatabase.delete(
            "calls",
            "started_at < ? AND synced != 0 AND log_state != 1",
            arrayOf(before.toString())
        )
    }

    fun upsertContacts(list: List<CachedContact>) {
        val db = writableDatabase
        db.beginTransaction()
        try {
            for (c in list) {
                val v = ContentValues()
                v.put("phone", c.phone)
                v.put("lead_id", c.leadId)
                v.put("name", c.name)
                db.insertWithOnConflict("contacts", null, v, SQLiteDatabase.CONFLICT_REPLACE)
            }
            db.setTransactionSuccessful()
        } finally {
            db.endTransaction()
        }
    }

    fun contactByPhone(phone: String): CachedContact? =
        readableDatabase.rawQuery("SELECT phone, lead_id, name FROM contacts WHERE phone = ?", arrayOf(phone)).use {
            if (it.moveToFirst()) CachedContact(it.getString(0), it.getString(1), it.getString(2)) else null
        }

    /** فقط تماس‌هایی که به CRM رسیده‌اند؛ صف ارسال‌نشده و نام‌های ذخیره‌شده‌ی مخاطبین می‌مانند */
    fun clearSynced() {
        writableDatabase.delete("calls", "synced != 0 AND log_state != 1", null)
    }

    fun clearAll() {
        writableDatabase.delete("calls", null, null)
        writableDatabase.delete("contacts", null, null)
    }
}
