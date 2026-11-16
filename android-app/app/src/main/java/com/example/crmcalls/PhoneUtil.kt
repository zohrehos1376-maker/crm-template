package com.example.crmcalls

/** همان قواعد shared/phone.js در CRM: هر شکل نوشتن یک شماره → یک رشته‌ی ثابت */
object PhoneUtil {

    fun toEnDigits(s: String): String {
        val sb = StringBuilder(s.length)
        for (c in s) {
            sb.append(
                when (c) {
                    in '۰'..'۹' -> '0' + (c - '۰')
                    in '٠'..'٩' -> '0' + (c - '٠')
                    else -> c
                }
            )
        }
        return sb.toString()
    }

    fun normalize(raw: String?): String {
        if (raw == null) return ""
        var s = toEnDigits(raw).trim()
        if (s.isEmpty()) return ""
        val plus = s.startsWith("+")
        s = s.filter { it in '0'..'9' }
        if (plus || s.startsWith("0098")) {
            s = when {
                s.startsWith("0098") -> s.substring(4)
                s.startsWith("98") -> s.substring(2)
                else -> s
            }
            val t = s.trimStart('0')
            return if (t.isEmpty()) "" else "0$t"
        }
        if (s.startsWith("98") && s.length == 12) return "0" + s.substring(2)
        if (s.length == 10 && s.startsWith("9")) return "0$s"
        return s
    }
}
