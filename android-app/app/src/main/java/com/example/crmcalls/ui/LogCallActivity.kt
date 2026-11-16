package com.example.crmcalls.ui

import android.content.Context
import android.content.Intent
import android.os.Bundle
import android.view.LayoutInflater
import android.view.View
import android.widget.ArrayAdapter
import android.widget.TextView
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import androidx.core.widget.doAfterTextChanged
import com.google.android.material.button.MaterialButton
import com.google.android.material.chip.Chip
import com.google.android.material.chip.ChipGroup
import com.google.android.material.textfield.MaterialAutoCompleteTextView
import com.google.android.material.textfield.TextInputEditText
import com.google.android.material.textfield.TextInputLayout
import com.example.crmcalls.Jalali
import com.example.crmcalls.LocalCall
import com.example.crmcalls.LocalDb
import com.example.crmcalls.Notifs
import com.example.crmcalls.PhoneBook
import com.example.crmcalls.PhoneUtil
import com.example.crmcalls.Prefs
import com.example.crmcalls.PromptCard
import com.example.crmcalls.R
import com.example.crmcalls.Syncer
import com.example.crmcalls.Work
import com.example.crmcalls.str
import org.json.JSONArray
import org.json.JSONObject
import kotlin.concurrent.thread

/**
 * فرم بعد از تماس: پاسخ‌دهنده (اجباری)، نام مشتری، نحوه‌ی آشنایی، خلاصه، تاریخ پیگیری شمسی.
 * اگر شماره در CRM نباشد، همه‌ی فیلدهای فرم «ثبت سرنخ» CRM هم نشان داده می‌شود.
 * اول در گوشی ذخیره می‌شود، بعد (یا هر وقت اینترنت آمد) به CRM می‌رود.
 */
class LogCallActivity : AppCompatActivity() {
    companion object {
        private const val EXTRA_ID = "externalId"

        fun intent(ctx: Context, externalId: String): Intent =
            Intent(ctx, LogCallActivity::class.java).putExtra(EXTRA_ID, externalId)
    }

    private var call: LocalCall? = null
    private var followUp: Long? = null
    private var hasLead = false
    private var retriedBootstrap = false

    /** محصولات درخواستیِ اضافه‌شده (مثل لیست محصولات فرم CRM) */
    private val vehicles = ArrayList<JSONObject>()
    /** مدل‌های هر کمپانی: مدل ← تیپ */
    private var models: Map<String, String> = emptyMap()

    private lateinit var lcFollow: TextView

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_log_call)
        setFinishOnTouchOutside(false)
        lcFollow = findViewById(R.id.lcFollow)

        findViewById<MaterialButton>(R.id.lcFu1).setOnClickListener { setFollowDays(1) }
        findViewById<MaterialButton>(R.id.lcFu3).setOnClickListener { setFollowDays(3) }
        findViewById<MaterialButton>(R.id.lcFu7).setOnClickListener { setFollowDays(7) }
        findViewById<MaterialButton>(R.id.lcFuPick).setOnClickListener {
            JalaliPicker.show(this, followUp ?: System.currentTimeMillis() + 86_400_000L) { setFollow(it) }
        }
        lcFollow.setOnClickListener { setFollow(null) }
        findViewById<MaterialButton>(R.id.lcSave).setOnClickListener { save() }
        findViewById<MaterialButton>(R.id.lcLater).setOnClickListener { finish() }
        findViewById<MaterialButton>(R.id.lcVehAdd).setOnClickListener { addVehicle(showErrors = true) }
        findViewById<MaterialButton>(R.id.lcTagAdd).setOnClickListener { addNewTag() }

        bind(intent)
    }

    override fun onResume() {
        super.onResume()
        PromptCard.hide()
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        bind(intent)
    }

    private fun bind(i: Intent) {
        val id = i.getStringExtra(EXTRA_ID)
        val c = if (id == null) null else LocalDb.get(this).get(id)
        if (c == null) {
            finish()
            return
        }
        call = c
        followUp = null
        val dir = if (c.direction == "INCOMING") "ورودی" else "خروجی"
        findViewById<TextView>(R.id.lcTitle).text = "ثبت تماس $dir"
        val sub = StringBuilder(c.phone)
        if (c.durationSec > 0) sub.append(" · مدت ").append(Jalali.duration(c.durationSec))
        sub.append(" · ").append(Jalali.formatTime(c.startedAt))
        findViewById<TextView>(R.id.lcSub).text = sub

        // خلاصه‌ی مشتری اگر در CRM هست
        val lead = try {
            if (c.leadJson != null) JSONObject(c.leadJson) else null
        } catch (e: Exception) {
            null
        }
        val localName = Syncer.displayName(this, c)
        val tvLead = findViewById<TextView>(R.id.lcLead)
        hasLead = lead != null || localName.isNotBlank()
        if (lead != null) {
            tvLead.visibility = View.VISIBLE
            tvLead.text = listOf(
                lead.str("name").ifBlank { "مشتری بدون نام" },
                lead.str("stage"),
                lead.str("vehicle")
            ).filter { it.isNotBlank() }.joinToString(" · ")
        } else if (localName.isNotBlank()) {
            tvLead.visibility = View.VISIBLE
            tvLead.text = localName
        } else {
            tvLead.visibility = View.GONE
        }
        val leadHasName = (lead?.str("name") ?: localName).isNotBlank()
        findViewById<TextInputLayout>(R.id.lcNameBox).visibility = if (leadHasName) View.GONE else View.VISIBLE
        findViewById<TextView>(R.id.lcNewLeadHint).visibility = if (hasLead) View.GONE else View.VISIBLE
        findViewById<TextInputLayout>(R.id.lcNoteBox).hint = if (hasLead) "خلاصه‌ی مکالمه" else "توضیحات / خلاصه‌ی مکالمه"
        // شماره در CRM نیست ولی در دفترچه‌تلفن گوشی ذخیره شده → نام همان پیش‌فرض
        findViewById<TextInputEditText>(R.id.lcName).setText(if (hasLead) "" else PhoneBook.nameFor(this, c.phone))
        findViewById<TextInputEditText>(R.id.lcNote).setText("")

        val p = Prefs.get(this)
        fillChips(findViewById(R.id.lcOperators), p.operators().map { Pair(it.id, it.name) }, emptySet())
        fillChips(findViewById(R.id.lcHeard), p.heardFrom().map { Pair(it, it) }, emptySet())
        findViewById<TextView>(R.id.lcHeardTitle).text =
            if (lead != null) "از کجا با ما آشنا شده؟ (اگر در CRM خالی است)" else "از کجا با ما آشنا شده؟"

        bindLeadSection(!hasLead)
        setFollow(null)

        // فهرست کارشناس‌ها یا گزینه‌های فرم هنوز از CRM نیامده — یک بار دریافت و دوباره نمایش
        val needForm = !hasLead && !p.leadForm().has("vehicles")
        if ((p.operators().isEmpty() || needForm) && !retriedBootstrap) {
            retriedBootstrap = true
            if (p.operators().isEmpty()) {
                Toast.makeText(this, "فهرست کارشناس‌ها هنوز از CRM نیامده — اینترنت را بررسی کنید", Toast.LENGTH_LONG).show()
            }
            thread {
                try {
                    Syncer.refreshBootstrap(this, true)
                    runOnUiThread { if (!isFinishing) bind(i) }
                } catch (e: Exception) {
                }
            }
        }
    }

    // ---------------------------------------------------------------
    // فیلدهای فرم «ثبت سرنخ» (فقط برای شماره‌ای که در CRM نیست)
    // ---------------------------------------------------------------
    private fun strings(form: JSONObject, key: String): List<String> {
        val a = form.optJSONArray(key) ?: return emptyList()
        return (0 until a.length()).map { a.optString(it) }.filter { it.isNotBlank() }
    }

    private fun bindLeadSection(show: Boolean) {
        findViewById<View>(R.id.lcLeadSection).visibility = if (show) View.VISIBLE else View.GONE
        if (!show) return
        val form = Prefs.get(this).leadForm()

        vehicles.clear()
        renderVehicles()
        val companies = form.optJSONArray("vehicles") ?: JSONArray()
        val byCompany = HashMap<String, Map<String, String>>()
        for (i in 0 until companies.length()) {
            val o = companies.getJSONObject(i)
            val ms = o.optJSONArray("models") ?: JSONArray()
            byCompany[o.str("company")] = (0 until ms.length()).associate {
                val m = ms.getJSONObject(it)
                m.str("model") to m.str("bodyType")
            }
        }
        val acCompany = findViewById<MaterialAutoCompleteTextView>(R.id.lcVehCompany)
        val acModel = findViewById<MaterialAutoCompleteTextView>(R.id.lcVehModel)
        val acBody = findViewById<MaterialAutoCompleteTextView>(R.id.lcVehBody)
        val acAvail = findViewById<MaterialAutoCompleteTextView>(R.id.lcVehAvail)
        acCompany.setAdapter(ArrayAdapter(this, android.R.layout.simple_list_item_1, byCompany.keys.toList()))
        acCompany.setText("", false)
        acModel.setText("", false)
        acModel.setAdapter(ArrayAdapter(this, android.R.layout.simple_list_item_1, emptyList<String>()))
        models = emptyMap()
        acCompany.doAfterTextChanged { t ->
            // کمپانی از فهرست → مدل‌هایش؛ کمپانی دستی → مدل هم دستی تایپ می‌شود
            models = byCompany[t?.toString()?.trim() ?: ""] ?: emptyMap()
            acModel.setAdapter(ArrayAdapter(this, android.R.layout.simple_list_item_1, models.keys.toList()))
        }
        acModel.doAfterTextChanged { t ->
            val body = models[t?.toString()?.trim() ?: ""]
            if (!body.isNullOrBlank()) acBody.setText(body, false)
        }
        acCompany.setOnClickListener { acCompany.showDropDown() }
        acModel.setOnClickListener { acModel.showDropDown() }
        acBody.setAdapter(ArrayAdapter(this, android.R.layout.simple_list_item_1, listOf("—") + strings(form, "bodyTypes")))
        acBody.setText("", false)
        acAvail.setAdapter(ArrayAdapter(this, android.R.layout.simple_list_item_1, listOf("نامشخص") + strings(form, "availability")))
        acAvail.setText("", false)
        findViewById<TextInputEditText>(R.id.lcVehPackage).setText("")

        findViewById<TextInputEditText>(R.id.lcPriceFrom).setText("")
        findViewById<TextInputEditText>(R.id.lcPriceTo).setText("")
        findViewById<TextInputEditText>(R.id.lcCurrentCar).setText("")
        findViewById<TextInputEditText>(R.id.lcTagNew).setText("")
        fillChips(findViewById(R.id.lcPayment), strings(form, "payments").map { Pair(it, it) }, emptySet())
        fillChips(findViewById(R.id.lcDelivery), strings(form, "deliveries").map { Pair(it, it) }, emptySet())
        val methods = strings(form, "contactMethods").ifEmpty { listOf("تماس تلفنی", "واتساپ", "تلگرام", "پیامک", "ایمیل") }
        fillChips(findViewById(R.id.lcContact), methods.map { Pair(it, it) }, setOf("تماس تلفنی"))
        fillChips(findViewById(R.id.lcTags), strings(form, "tags").map { Pair(it, it) }, emptySet())
    }

    private fun clean(v: String?): String {
        val s = v?.trim() ?: ""
        return if (s == "—" || s == "نامشخص") "" else s
    }

    /** محصول فعلیِ فرم را به لیست اضافه می‌کند؛ false اگر کمپانی/مدل خالی بود */
    private fun addVehicle(showErrors: Boolean): Boolean {
        val acCompany = findViewById<MaterialAutoCompleteTextView>(R.id.lcVehCompany)
        val acModel = findViewById<MaterialAutoCompleteTextView>(R.id.lcVehModel)
        val acBody = findViewById<MaterialAutoCompleteTextView>(R.id.lcVehBody)
        val acAvail = findViewById<MaterialAutoCompleteTextView>(R.id.lcVehAvail)
        val pkg = findViewById<TextInputEditText>(R.id.lcVehPackage)
        val company = clean(acCompany.text?.toString())
        val model = clean(acModel.text?.toString())
        if (company.isEmpty() && model.isEmpty()) {
            if (showErrors) Toast.makeText(this, "کمپانی و مدل را انتخاب یا تایپ کنید", Toast.LENGTH_SHORT).show()
            return false
        }
        vehicles.add(
            JSONObject()
                .put("company", company)
                .put("model", model)
                .put("bodyType", clean(acBody.text?.toString()))
                .put("available", clean(acAvail.text?.toString()))
                .put("package", pkg.text?.toString()?.trim() ?: "")
        )
        acCompany.setText("", false)
        acModel.setText("", false)
        acBody.setText("", false)
        acAvail.setText("", false)
        pkg.setText("")
        renderVehicles()
        return true
    }

    private fun renderVehicles() {
        val g = findViewById<ChipGroup>(R.id.lcVehList)
        g.removeAllViews()
        for ((idx, v) in vehicles.withIndex()) {
            val chip = Chip(this)
            chip.text = listOf(v.str("company"), v.str("model"), v.str("package")).filter { it.isNotBlank() }.joinToString(" ")
            chip.isCloseIconVisible = true
            chip.setOnCloseIconClickListener {
                if (idx < vehicles.size) vehicles.removeAt(idx)
                renderVehicles()
            }
            g.addView(chip)
        }
    }

    private fun addNewTag() {
        val et = findViewById<TextInputEditText>(R.id.lcTagNew)
        val t = et.text?.toString()?.trim() ?: ""
        if (t.isEmpty()) return
        val g = findViewById<ChipGroup>(R.id.lcTags)
        val existing = (0 until g.childCount).map { g.getChildAt(it) as Chip }.find { it.tag == t }
        if (existing != null) {
            existing.isChecked = true
        } else {
            val chip = choiceChip(t, t)
            g.addView(chip)
            chip.isChecked = true
        }
        et.setText("")
    }

    private fun leadPayload(): JSONObject? {
        if (findViewById<View>(R.id.lcLeadSection).visibility != View.VISIBLE) return null
        // اگر محصولی پر شده ولی «افزودن» زده نشده، همان هم ثبت شود
        addVehicle(showErrors = false)
        val o = JSONObject()
        o.put("requestedVehicles", JSONArray(vehicles))
        o.put("tags", JSONArray(checkedTags(findViewById(R.id.lcTags))))
        o.put("contactMethods", JSONArray(checkedTags(findViewById(R.id.lcContact))))
        o.put("priceFrom", PhoneUtil.toEnDigits(findViewById<TextInputEditText>(R.id.lcPriceFrom).text?.toString() ?: "").trim())
        o.put("priceTo", PhoneUtil.toEnDigits(findViewById<TextInputEditText>(R.id.lcPriceTo).text?.toString() ?: "").trim())
        o.put("payment", checkedTag(findViewById(R.id.lcPayment)) ?: "")
        o.put("delivery", checkedTag(findViewById(R.id.lcDelivery)) ?: "")
        o.put("currentCar", findViewById<TextInputEditText>(R.id.lcCurrentCar).text?.toString()?.trim() ?: "")
        return o
    }

    // ---------------------------------------------------------------
    private fun choiceChip(tag: String, label: String): Chip {
        val chip = LayoutInflater.from(this).inflate(R.layout.chip_choice, null, false) as Chip
        chip.text = label
        chip.tag = tag
        chip.isCheckable = true
        return chip
    }

    private fun fillChips(group: ChipGroup, items: List<Pair<String, String>>, checked: Set<String>) {
        group.removeAllViews()
        for ((tag, label) in items) {
            val chip = choiceChip(tag, label)
            group.addView(chip)
            if (tag in checked) chip.isChecked = true
        }
    }

    private fun checkedTag(group: ChipGroup): String? {
        val id = group.checkedChipId
        if (id == View.NO_ID) return null
        return group.findViewById<Chip>(id)?.tag as? String
    }

    private fun checkedTags(group: ChipGroup): List<String> =
        (0 until group.childCount).mapNotNull { group.getChildAt(it) as? Chip }
            .filter { it.isChecked }
            .mapNotNull { it.tag as? String }

    private fun setFollowDays(days: Int) {
        val j = Jalali.of(System.currentTimeMillis() + days * 86_400_000L)
        setFollow(Jalali.toMillis(j[0], j[1], j[2]))
    }

    private fun setFollow(ms: Long?) {
        followUp = ms
        lcFollow.text = if (ms == null) "یادآوری تماس بعدی ندارد" else "⏰ تماس بعدی: " + Jalali.formatLong(ms) + "   (برای حذف بزنید)"
    }

    private fun save() {
        val c = call ?: return
        val operatorId = checkedTag(findViewById(R.id.lcOperators))
        if (operatorId == null) {
            Toast.makeText(this, "پاسخ‌دهنده را انتخاب کنید", Toast.LENGTH_SHORT).show()
            return
        }
        val body = JSONObject()
            .put("operatorUserId", operatorId)
            .put("callerName", findViewById<TextInputEditText>(R.id.lcName).text?.toString()?.trim() ?: "")
            .put("heardFrom", checkedTag(findViewById(R.id.lcHeard)) ?: "")
            .put("note", findViewById<TextInputEditText>(R.id.lcNote).text?.toString()?.trim() ?: "")
        followUp?.let { body.put("followUpAt", it) }
        leadPayload()?.let { body.put("lead", it) }

        LocalDb.get(this).saveLog(c.externalId, body.toString())
        Prefs.get(this).lastOperatorId = operatorId
        Notifs.cancel(this, c.externalId)
        Work.uploadSoon(this)
        Toast.makeText(this, "ثبت شد", Toast.LENGTH_SHORT).show()
        finish()
    }
}
