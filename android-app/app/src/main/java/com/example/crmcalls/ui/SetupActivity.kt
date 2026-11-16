package com.example.crmcalls.ui

import android.Manifest
import android.annotation.SuppressLint
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.PowerManager
import android.provider.Settings
import android.view.LayoutInflater
import android.widget.LinearLayout
import android.widget.TextView
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import com.google.android.material.button.MaterialButton
import com.example.crmcalls.Prefs
import com.example.crmcalls.R
import com.example.crmcalls.Sims
import com.example.crmcalls.Work
import kotlin.concurrent.thread

/** وضعیت هر مورد راه‌اندازی — صفحه‌ی اصلی هم از همین برای هشدار استفاده می‌کند */
object Checks {
    fun granted(ctx: Context, vararg perms: String) =
        perms.all { ContextCompat.checkSelfPermission(ctx, it) == PackageManager.PERMISSION_GRANTED }

    fun callPerms(ctx: Context) = granted(ctx, Manifest.permission.READ_CALL_LOG, Manifest.permission.READ_PHONE_STATE)
    fun contactPerms(ctx: Context) = granted(ctx, Manifest.permission.READ_CONTACTS, Manifest.permission.WRITE_CONTACTS)
    fun notifPerm(ctx: Context) = Build.VERSION.SDK_INT < 33 || granted(ctx, Manifest.permission.POST_NOTIFICATIONS)
    fun overlay(ctx: Context) = Settings.canDrawOverlays(ctx)
    /** اندروید Go (گوشی کم‌حافظه) از اندروید ۱۰ این قابلیت را کاملاً خاموش کرده و روشن‌شدنی نیست */
    fun overlayBlocked(ctx: Context): Boolean {
        if (Build.VERSION.SDK_INT < 29 || overlay(ctx)) return false
        val am = ctx.getSystemService(android.app.ActivityManager::class.java) ?: return false
        return am.isLowRamDevice
    }
    fun battery(ctx: Context): Boolean {
        val pm = ctx.getSystemService(PowerManager::class.java) ?: return true
        return pm.isIgnoringBatteryOptimizations(ctx.packageName)
    }

    fun simChosen(ctx: Context) = Prefs.get(ctx).simChosen

    fun missingCount(ctx: Context): Int {
        var n = 0
        if (!callPerms(ctx)) n++
        if (!contactPerms(ctx)) n++
        if (!notifPerm(ctx)) n++
        if (!overlay(ctx) && !overlayBlocked(ctx)) n++
        if (!battery(ctx)) n++
        if (!simChosen(ctx)) n++
        if (!Prefs.get(ctx).autostartConfirmed) n++
        return n
    }
}

class SetupActivity : AppCompatActivity() {
    companion object {
        const val EXTRA_FIRST_RUN = "firstRun"
    }

    private lateinit var list: LinearLayout

    private val askPerms = registerForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) {
        render()
        // بعد از گرفتن دسترسی تماس، تماس‌های ۲۴ ساعت اخیر همین حالا خوانده شوند
        Work.uploadSoon(this)
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_setup)
        list = findViewById(R.id.setupList)
        findViewById<MaterialButton>(R.id.btnDone).setOnClickListener {
            startActivity(Intent(this, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP))
            finish()
        }
    }

    override fun onResume() {
        super.onResume()
        render()
    }

    private fun render() {
        list.removeAllViews()
        val p = Prefs.get(this)

        item(
            "تماس‌ها و وضعیت تلفن",
            "برای خواندن تاریخچه‌ی تماس خط کاری و تشخیص زنگ خوردن.",
            Checks.callPerms(this), "اجازه بده"
        ) {
            askPerms.launch(arrayOf(Manifest.permission.READ_CALL_LOG, Manifest.permission.READ_PHONE_STATE))
        }
        item(
            "مخاطبین",
            "مشتری‌های CRM با نام «نام | نمونه» زیر حساب جداگانه‌ی CRM CRM ذخیره می‌شوند. به مخاطبین شخصی دست نمی‌خورد.",
            Checks.contactPerms(this), "اجازه بده"
        ) {
            askPerms.launch(arrayOf(Manifest.permission.READ_CONTACTS, Manifest.permission.WRITE_CONTACTS))
        }
        if (Build.VERSION.SDK_INT >= 33) {
            item(
                "اعلان‌ها",
                "یادآوری ثبت تماس و خبر تماس‌های بی‌پاسخ.",
                Checks.notifPerm(this), "اجازه بده"
            ) {
                askPerms.launch(arrayOf(Manifest.permission.POST_NOTIFICATIONS))
            }
        }
        if (Checks.overlayBlocked(this)) {
            item(
                "نمایش روی برنامه‌های دیگر",
                "این گوشی (اندروید Go) این قابلیت را ندارد و روشن‌شدنی نیست. به‌جای کارت شناور، نام مشتری با اعلان بالای صفحه می‌آید و فرم ثبت تماس با زدن اعلان باز می‌شود. لازم نیست کاری بکنید.",
                true, "اعلان‌ها", "— این گوشی ندارد"
            ) {
                open(Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS).putExtra(Settings.EXTRA_APP_PACKAGE, packageName))
            }
        } else item(
            "نمایش روی برنامه‌های دیگر",
            "برای کارت مشتری هنگام زنگ خوردن و باز شدن خودکار فرم بعد از تماس. در صفحه‌ی باز شده «CRM نمونه تماس» را روشن کنید.",
            Checks.overlay(this), "باز کردن تنظیمات"
        ) {
            open(Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION, Uri.parse("package:$packageName")))
        }
        item(
            "بهینه‌سازی باتری",
            "تا اندروید اپ را در پس‌زمینه نبندد. گزینه‌ی «اجازه دادن / Allow» را بزنید.",
            Checks.battery(this), "غیرفعال کن"
        ) {
            requestBattery()
        }
        item(
            "سیم‌کارت کاری",
            if (p.simChosen) "انتخاب‌شده: " + (if (p.simSubId < 0) "همه‌ی سیم‌کارت‌ها" else p.simLabel)
            else "در گوشی دو سیم‌کارته، فقط تماس‌های سیم‌کارت کاری به CRM فرستاده می‌شود.",
            p.simChosen, if (p.simChosen) "تغییر" else "انتخاب"
        ) {
            chooseSim()
        }
        item(
            "اجرای خودکار (Autostart)",
            autostartGuide(),
            p.autostartConfirmed, if (p.autostartConfirmed) "باز کردن دوباره" else "باز کردن تنظیمات"
        ) {
            openAutostart()
            if (!p.autostartConfirmed) {
                AlertDialog.Builder(this)
                    .setMessage("بعد از روشن کردن اجرای خودکار برای «CRM نمونه تماس»، این‌جا تأیید کنید.")
                    .setPositiveButton("انجام دادم") { _, _ ->
                        p.autostartConfirmed = true
                        render()
                    }
                    .setNegativeButton("هنوز نه", null)
                    .show()
            }
        }
    }

    private fun item(title: String, desc: String, ok: Boolean, action: String, status: String? = null, onClick: () -> Unit) {
        val v = LayoutInflater.from(this).inflate(R.layout.item_setup, list, false)
        v.findViewById<TextView>(R.id.isTitle).text = title
        v.findViewById<TextView>(R.id.isDesc).text = desc
        val st = v.findViewById<TextView>(R.id.isStatus)
        st.text = status ?: if (ok) "✓ انجام شد" else "✕ مانده"
        st.setTextColor(ContextCompat.getColor(this, if (ok) R.color.ok else R.color.bad))
        st.setBackgroundColor(ContextCompat.getColor(this, if (ok) R.color.ok_soft else R.color.bad_soft))
        val b = v.findViewById<MaterialButton>(R.id.isButton)
        b.text = action
        b.setOnClickListener { onClick() }
        list.addView(v)
    }

    private fun open(i: Intent): Boolean = try {
        startActivity(i)
        true
    } catch (e: Exception) {
        false
    }

    @SuppressLint("BatteryLife")
    private fun requestBattery() {
        if (!open(Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS, Uri.parse("package:$packageName")))) {
            open(Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS))
        }
    }

    private fun chooseSim() {
        val sims = Sims.list(this)
        if (sims.isEmpty()) {
            AlertDialog.Builder(this)
                .setMessage("اول دسترسی «تماس‌ها و وضعیت تلفن» را بدهید تا سیم‌کارت‌ها دیده شوند.")
                .setPositiveButton("باشه", null)
                .show()
            return
        }
        val labels = sims.map { it.label } + "همه‌ی سیم‌کارت‌ها"
        AlertDialog.Builder(this)
            .setTitle("سیم‌کارت کاری کدام است؟")
            .setItems(labels.toTypedArray()) { _, which ->
                val p = Prefs.get(this)
                if (which < sims.size) {
                    p.simSubId = sims[which].subId
                    p.simLabel = sims[which].label
                } else {
                    p.simSubId = -1
                    p.simLabel = "همه‌ی سیم‌کارت‌ها"
                }
                p.simChosen = true
                render()
            }
            .show()
    }

    private fun brand(): String = Build.MANUFACTURER.lowercase()

    private fun autostartGuide(): String {
        val b = brand()
        return when {
            b.contains("xiaomi") || b.contains("redmi") || b.contains("poco") ->
                "شیائومی: Security ← Permissions ← Autostart ← «CRM نمونه تماس» را روشن کنید. " +
                    "همچنین در تنظیمات اپ ← Other permissions، گزینه‌های «Display pop-up windows while running in the background» و «Show on lock screen» را روشن کنید."
            b.contains("samsung") ->
                "سامسونگ: Settings ← Battery ← Background usage limits ← Never sleeping apps ← «CRM نمونه تماس» را اضافه کنید."
            b.contains("huawei") || b.contains("honor") ->
                "هواوی: Phone Manager ← App launch ← «CRM نمونه تماس» را روی Manage manually بگذارید و هر سه گزینه را روشن کنید."
            b.contains("oppo") || b.contains("realme") || b.contains("oneplus") ->
                "اوپو/ریلمی: Settings ← Battery ← App battery management ← «CRM نمونه تماس» ← Allow auto-launch و Allow background activity."
            b.contains("vivo") ->
                "ویوو: i Manager ← App manager ← Autostart manager ← «CRM نمونه تماس» را روشن کنید."
            else ->
                "در تنظیمات اپ ← باتری، اجرای پس‌زمینه را برای «CRM نمونه تماس» بدون محدودیت کنید."
        }
    }

    private fun openAutostart() {
        val b = brand()
        val tries = ArrayList<Intent>()
        if (b.contains("xiaomi") || b.contains("redmi") || b.contains("poco")) {
            tries.add(Intent().setComponent(ComponentName("com.miui.securitycenter", "com.miui.permcenter.autostart.AutoStartManagementActivity")))
            tries.add(Intent("miui.intent.action.APP_PERM_EDITOR").putExtra("extra_pkgname", packageName))
        }
        if (b.contains("huawei") || b.contains("honor")) {
            tries.add(Intent().setComponent(ComponentName("com.huawei.systemmanager", "com.huawei.systemmanager.startupmgr.ui.StartupNormalAppListActivity")))
        }
        if (b.contains("oppo") || b.contains("realme")) {
            tries.add(Intent().setComponent(ComponentName("com.coloros.safecenter", "com.coloros.safecenter.permission.startup.StartupAppListActivity")))
        }
        if (b.contains("vivo")) {
            tries.add(Intent().setComponent(ComponentName("com.vivo.permissionmanager", "com.vivo.permissionmanager.activity.BgStartUpManagerActivity")))
        }
        tries.add(Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:$packageName")))
        for (i in tries) if (open(i)) return
    }

    override fun onDestroy() {
        super.onDestroy()
        if (isFinishing && intent.getBooleanExtra(EXTRA_FIRST_RUN, false)) {
            val ctx = applicationContext
            thread { Work.uploadSoon(ctx) }
        }
    }
}

