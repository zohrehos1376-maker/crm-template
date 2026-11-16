package com.example.crmcalls

import java.util.Calendar
import java.util.Locale

/** تاریخ شمسی (الگوریتم ۳۳ ساله‌ی jdf — دقیق برای سال‌های ۱۳۰۰ تا ۱۵۰۰) */
object Jalali {
    val MONTHS = arrayOf(
        "فروردین", "اردیبهشت", "خرداد", "تیر", "مرداد", "شهریور",
        "مهر", "آبان", "آذر", "دی", "بهمن", "اسفند"
    )

    fun fa(s: String): String {
        val sb = StringBuilder(s.length)
        for (c in s) sb.append(if (c in '0'..'9') '۰' + (c - '0') else c)
        return sb.toString()
    }

    fun fa(n: Int): String = fa(n.toString())

    fun fromGregorian(gy: Int, gm: Int, gd: Int): IntArray {
        val gdm = intArrayOf(0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334)
        val gy2 = if (gm > 2) gy + 1 else gy
        var days = 355666 + 365 * gy + (gy2 + 3) / 4 - (gy2 + 99) / 100 + (gy2 + 399) / 400 + gd + gdm[gm - 1]
        var jy = -1595 + 33 * (days / 12053)
        days %= 12053
        jy += 4 * (days / 1461)
        days %= 1461
        if (days > 365) {
            jy += (days - 1) / 365
            days = (days - 1) % 365
        }
        val jm: Int
        val jd: Int
        if (days < 186) {
            jm = 1 + days / 31
            jd = 1 + days % 31
        } else {
            jm = 7 + (days - 186) / 30
            jd = 1 + (days - 186) % 30
        }
        return intArrayOf(jy, jm, jd)
    }

    fun toGregorian(jy: Int, jm: Int, jd: Int): IntArray {
        val jy2 = jy + 1595
        var days = -355668 + 365 * jy2 + (jy2 / 33) * 8 + ((jy2 % 33) + 3) / 4 + jd +
            (if (jm < 7) (jm - 1) * 31 else (jm - 7) * 30 + 186)
        var gy = 400 * (days / 146097)
        days %= 146097
        if (days > 36524) {
            days--
            gy += 100 * (days / 36524)
            days %= 36524
            if (days >= 365) days++
        }
        gy += 4 * (days / 1461)
        days %= 1461
        if (days > 365) {
            gy += (days - 1) / 365
            days = (days - 1) % 365
        }
        var gd = days + 1
        val leap = (gy % 4 == 0 && gy % 100 != 0) || gy % 400 == 0
        val sal = intArrayOf(0, 31, if (leap) 29 else 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31)
        var gm = 0
        while (gm < 13 && gd > sal[gm]) {
            gd -= sal[gm]
            gm++
        }
        return intArrayOf(gy, gm, gd)
    }

    fun isLeap(jy: Int): Boolean {
        val g = toGregorian(jy, 12, 30)
        val back = fromGregorian(g[0], g[1], g[2])
        return back[0] == jy && back[1] == 12 && back[2] == 30
    }

    fun monthLength(jy: Int, jm: Int): Int = when {
        jm <= 6 -> 31
        jm <= 11 -> 30
        isLeap(jy) -> 30
        else -> 29
    }

    fun of(ms: Long): IntArray {
        val c = Calendar.getInstance()
        c.timeInMillis = ms
        return fromGregorian(c.get(Calendar.YEAR), c.get(Calendar.MONTH) + 1, c.get(Calendar.DAY_OF_MONTH))
    }

    /** میلی‌ثانیه‌ی ساعت [hour] در روز شمسی داده‌شده (به وقت گوشی) */
    fun toMillis(jy: Int, jm: Int, jd: Int, hour: Int = 10): Long {
        val g = toGregorian(jy, jm, jd)
        val c = Calendar.getInstance()
        c.set(g[0], g[1] - 1, g[2], hour, 0, 0)
        c.set(Calendar.MILLISECOND, 0)
        return c.timeInMillis
    }

    fun formatDate(ms: Long): String {
        val j = of(ms)
        return fa(String.format(Locale.US, "%04d/%02d/%02d", j[0], j[1], j[2]))
    }

    fun formatLong(ms: Long): String {
        val j = of(ms)
        return fa(j[2]) + " " + MONTHS[j[1] - 1] + " " + fa(j[0])
    }

    fun formatTime(ms: Long): String {
        val c = Calendar.getInstance()
        c.timeInMillis = ms
        return fa(String.format(Locale.US, "%02d:%02d", c.get(Calendar.HOUR_OF_DAY), c.get(Calendar.MINUTE)))
    }

    fun formatDateTime(ms: Long): String = formatDate(ms) + " " + formatTime(ms)

    fun duration(sec: Int): String {
        val h = sec / 3600
        val m = (sec % 3600) / 60
        val s = sec % 60
        return fa(
            if (h > 0) String.format(Locale.US, "%d:%02d:%02d", h, m, s)
            else String.format(Locale.US, "%d:%02d", m, s)
        )
    }

    fun startOfToday(): Long {
        val c = Calendar.getInstance()
        c.set(Calendar.HOUR_OF_DAY, 0)
        c.set(Calendar.MINUTE, 0)
        c.set(Calendar.SECOND, 0)
        c.set(Calendar.MILLISECOND, 0)
        return c.timeInMillis
    }
}
