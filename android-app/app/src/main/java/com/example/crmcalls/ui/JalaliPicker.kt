package com.example.crmcalls.ui

import android.content.Context
import android.view.Gravity
import android.view.View
import android.widget.LinearLayout
import android.widget.NumberPicker
import androidx.appcompat.app.AlertDialog
import com.example.crmcalls.Jalali

/** انتخاب تاریخ شمسی با سه چرخ: سال، ماه، روز */
object JalaliPicker {
    fun show(ctx: Context, initialMs: Long, onPick: (Long) -> Unit) {
        val now = Jalali.of(System.currentTimeMillis())
        val init = Jalali.of(initialMs)
        val years = intArrayOf(now[0], now[0] + 1)

        val yp = NumberPicker(ctx)
        yp.minValue = 0
        yp.maxValue = years.size - 1
        yp.displayedValues = years.map { Jalali.fa(it) }.toTypedArray()
        yp.value = if (init[0] == years[1]) 1 else 0
        yp.wrapSelectorWheel = false

        val mp = NumberPicker(ctx)
        mp.minValue = 1
        mp.maxValue = 12
        mp.displayedValues = Jalali.MONTHS
        mp.value = init[1]

        val dp = NumberPicker(ctx)
        dp.minValue = 1

        fun fixDays() {
            val max = Jalali.monthLength(years[yp.value], mp.value)
            val cur = dp.value
            dp.displayedValues = null
            dp.maxValue = max
            dp.displayedValues = (1..max).map { Jalali.fa(it) }.toTypedArray()
            dp.value = minOf(maxOf(cur, 1), max)
        }
        dp.maxValue = 31
        dp.displayedValues = (1..31).map { Jalali.fa(it) }.toTypedArray()
        dp.value = init[2]
        fixDays()
        yp.setOnValueChangedListener { _, _, _ -> fixDays() }
        mp.setOnValueChangedListener { _, _, _ -> fixDays() }

        val row = LinearLayout(ctx)
        row.orientation = LinearLayout.HORIZONTAL
        row.gravity = Gravity.CENTER
        row.layoutDirection = View.LAYOUT_DIRECTION_RTL
        val lp = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f)
        row.addView(dp, lp)
        row.addView(mp, LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1.4f))
        row.addView(yp, LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f))
        val pad = (16 * ctx.resources.displayMetrics.density).toInt()
        row.setPadding(pad, pad, pad, 0)

        AlertDialog.Builder(ctx)
            .setTitle("تاریخ پیگیری")
            .setView(row)
            .setPositiveButton("تأیید") { _, _ ->
                onPick(Jalali.toMillis(years[yp.value], mp.value, dp.value))
            }
            .setNegativeButton("انصراف", null)
            .show()
    }
}
