package com.example.crmcalls.ui

import android.content.Intent
import android.os.Bundle
import android.view.View
import android.widget.ProgressBar
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity
import com.google.android.material.button.MaterialButton
import com.google.android.material.textfield.TextInputEditText
import com.journeyapps.barcodescanner.ScanContract
import com.journeyapps.barcodescanner.ScanOptions
import com.example.crmcalls.Api
import com.example.crmcalls.BuildConfig
import com.example.crmcalls.LocalDb
import com.example.crmcalls.PhoneUtil
import com.example.crmcalls.Prefs
import com.example.crmcalls.R
import com.example.crmcalls.Syncer
import com.example.crmcalls.Work
import com.example.crmcalls.contacts.ContactsSync
import com.example.crmcalls.str
import org.json.JSONObject
import kotlin.concurrent.thread

/** جفت‌سازی با CRM: اسکن QR یا وارد کردن دستی آدرس سرور و کد ۶ رقمی */
class PairActivity : AppCompatActivity() {
    private lateinit var etServer: TextInputEditText
    private lateinit var etCode: TextInputEditText
    private lateinit var tvError: TextView
    private lateinit var progress: ProgressBar
    private lateinit var btnPair: MaterialButton
    private lateinit var btnScan: MaterialButton

    private val scan = registerForActivityResult(ScanContract()) { result ->
        val text = result.contents ?: return@registerForActivityResult
        try {
            val o = JSONObject(text)
            if (o.str("app") != "crm-call") throw IllegalArgumentException()
            etServer.setText(o.str("server"))
            etCode.setText(o.str("code"))
            pair()
        } catch (e: Exception) {
            tvError.text = "این QR مال CRM نمونه نیست. QR داخل CRM ← تنظیمات ← خطوط تلفن را اسکن کنید."
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_pair)
        etServer = findViewById(R.id.etServer)
        etCode = findViewById(R.id.etCode)
        tvError = findViewById(R.id.tvError)
        progress = findViewById(R.id.progress)
        btnPair = findViewById(R.id.btnPair)
        btnScan = findViewById(R.id.btnScan)
        etServer.setText(Prefs.get(this).server.ifBlank { "https://crm.example.com" })

        btnScan.setOnClickListener {
            scan.launch(
                ScanOptions()
                    .setDesiredBarcodeFormats(ScanOptions.QR_CODE)
                    .setPrompt("QR داخل CRM را اسکن کنید")
                    .setBeepEnabled(false)
                    .setOrientationLocked(false)
            )
        }
        btnPair.setOnClickListener { pair() }
    }

    private fun pair() {
        val server = Api.normalizeServer(etServer.text?.toString() ?: "")
        val code = PhoneUtil.toEnDigits(etCode.text?.toString() ?: "").filter { it in '0'..'9' }
        if (server.isEmpty()) {
            tvError.text = "آدرس سرور را وارد کنید"
            return
        }
        if (code.length != 6) {
            tvError.text = "کد ۶ رقمی را وارد کنید"
            return
        }
        setBusy(true)
        tvError.text = ""
        thread {
            var err: String? = null
            try {
                val r = Api.request(
                    server, null, "POST", "/pair",
                    JSONObject().put("code", code).put("appVersion", BuildConfig.VERSION_NAME)
                )
                val token = r.str("token")
                if (token.isEmpty()) throw IllegalStateException("پاسخ سرور نامعتبر بود")
                val p = Prefs.get(this)
                // تماس‌های ارسال‌نشده‌ی اتصال قبلی و مخاطبین می‌مانند و با اتصال تازه فرستاده/به‌روز می‌شوند
                LocalDb.get(this).clearSynced()
                p.server = server
                p.token = token
                p.callCursor = 0L
                p.contactsSince = 0L
                r.optJSONObject("line")?.let {
                    p.lineId = it.str("id")
                    p.lineName = it.str("name")
                }
                try {
                    Syncer.refreshBootstrap(this, true)
                } catch (e: Exception) {
                }
                Work.schedulePeriodic(this)
                try {
                    ContactsSync.ensureAccount(this)
                } catch (e: Exception) {
                }
            } catch (e: Exception) {
                err = Api.friendly(e)
            }
            runOnUiThread {
                if (isFinishing || isDestroyed) return@runOnUiThread
                setBusy(false)
                if (err != null) {
                    tvError.text = err
                } else {
                    startActivity(Intent(this, SetupActivity::class.java).putExtra(SetupActivity.EXTRA_FIRST_RUN, true))
                    finish()
                }
            }
        }
    }

    private fun setBusy(b: Boolean) {
        progress.visibility = if (b) View.VISIBLE else View.GONE
        btnPair.isEnabled = !b
        btnScan.isEnabled = !b
    }
}
