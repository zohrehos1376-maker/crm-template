// پرونده‌ی مشتری CRM نمونه (جدا از app.js): سابقه‌ی یک‌جای همه‌ی عملیات با نام کارشناس، گروه پشتیبان،
// «📞 ترجیح تماس» و «🔒 در حال کار توسط…». از امکانات app.js از طریق window.CrmApp استفاده می‌کند.
(function () {
  "use strict";
  var A = window.CrmApp;
  if (!A) return;
  var api = A.api, esc = A.esc, toast = A.toast, $ = A.$;
  var fa = function (v) { return Jalali.toFaDigits(String(v)); };

  var cur = null;          // مشتری باز
  var info = null;         // آخرین اطلاعات پرونده
  var myAction = "";       // کاری که من الان روی پرونده انجام می‌دهم
  var beatTimer = null, pollTimer = null, editing = false;
  var peeked = false;   // «به هر حال ببینم» را زده‌ام؟

  // ---------------- مرحله‌ی مشتری و «اقدام بعدی» ----------------
  // منطق در shared/customer-stage.js است؛ اینجا فقط نمایش و دکمه‌ی همان پله.
  function stageBanner(st) {
    return '<div class="cstage cstage-' + esc(st.tone) + '"><span class="cstage-dot"></span>' +
      '<span class="cstage-label">' + esc(st.label) + "</span></div>";
  }
  // هر پله به یک دکمه‌ی واقعی وصل است
  var STAGE_BTN = {
    kyc_send: { text: "ارسال لینک فرم احراز", pane: "kyc" }, // در مرحله‌ی «منتظر عکس مدرک» هم همین لینک، برای فرستادن عکس مدرک
    kyc_remind: { text: "یادآوری پر کردن فرم", pane: "kyc" },
    kyc_review: { text: "دیدن مدارک: تأیید یا رد", pane: "kyc" },
    kyc_reject_notify: { text: "اطلاع رد به مشتری دادم ✓", post: "reject-notified" },
    followup: { text: "ثبت پیگیری", focus: "m_fu" },
  };
  // نوار وضعیت احراز: هر چهار حالت کنار هم در یک خط، حالتِ فعلی روشن
  // (نام‌ها کوتاه نوشته می‌شوند تا نوار نشکند؛ نام کامل روی هر پله به‌صورت tooltip هست)
  var KYC_SHORT = { none: "احراز نشده", awaiting: "منتظر مدارک", pending: "منتظر تأیید", approved: "احراز شده", rejected: "رد شد" };
  function kycBar() {
    var ky = info && info.kyc;
    if (!ky) return "";
    var ICON = { none: "", awaiting: "📄", pending: "🕓", approved: "✅", rejected: "❌" };
    var order = ky.status === "rejected" ? ["none", "awaiting", "pending", "rejected"] : ["none", "awaiting", "pending", "approved"];
    var at = order.indexOf(ky.status);
    var steps = order.map(function (code, i) {
      var st = (ky.steps || []).filter(function (x) { return x.code === code; })[0];
      var cls = code === ky.status ? "on" : i < at ? "done" : "todo";
      return '<span class="kyc-step ' + cls + " kyc-" + esc(code) + '" title="' + esc(st ? st.label : code) + '">' +
        (ICON[code] ? ICON[code] + " " : "") + esc(KYC_SHORT[code] || code) + "</span>";
    }).join('<span class="kyc-arrow">←</span>');
    return '<div class="kyc-bar" data-open-pane="kyc" title="باز کردن بخش احراز همکاری">' +
      '<div class="kyc-steps">' + steps + "</div>" +
      '<span class="kyc-docs">' + (ky.documents ? "📎 " + fa(ky.documents) + " مدرک" : "بدون مدرک") + "</span></div>";
  }

  // توقف/ادامه‌ی پیگیری — تنها راه بسته شدن پرونده، همیشه با دلیل
  function stopLine() {
    if (!info) return "";
    if (info.followStopped) {
      return '<div class="file-next stopped">⏸ پیگیری متوقف شده' +
        (info.followStopped.reason ? " — " + esc(info.followStopped.reason) : "") +
        ' <button type="button" class="btn btn-ghost btn-sm" data-follow="resume">شروع دوباره‌ی پیگیری</button></div>';
    }
    return '<div class="file-stop"><button type="button" class="btn btn-ghost btn-sm" data-follow="stop">⏸ توقف پیگیری (با دلیل)</button></div>';
  }

  // «پیگیری بعدی» باید در خود پرونده دیده شود؛ نبودنش هشدار است (هیچ مشتری بدون قدم بعدی)
  function nextFollowLine() {
    var n = info && info.nextFollowUp;
    if (!n) return '<div class="file-next none">⚠️ این پرونده قدم بعدی ندارد — یک پیگیری ثبت کنید</div>';
    var d = new Date(n.at), today = new Date();
    today.setHours(0, 0, 0, 0);
    var tone = d < today ? "late" : d.getTime() === today.getTime() ? "today" : "soon";
    var when = tone === "today" ? "امروز" : fa(Jalali.formatDate(d));
    return '<div class="file-next ' + tone + '">📅 پیگیری بعدی: <b>' + esc(when) + "</b>" +
      (n.note ? " — " + esc(n.note) : "") + (tone === "late" ? " <b>(عقب افتاده)</b>" : "") +
      (n.by || n.setAt ? '<div class="file-next-src">ثبت‌شده' + (n.by ? " توسط " + esc(n.by) : "") + (n.setAt ? " در " + esc(fa(Jalali.formatDate(new Date(n.setAt)))) : "") + (n.via ? " (" + esc(n.via) + ")" : "") + "</div>" : "") +
      '<div class="file-next-acts"><button type="button" class="btn btn-ghost btn-sm" data-nextfu="edit">✏️ تغییر تاریخ</button>' +
      '<button type="button" class="btn btn-ghost btn-sm" data-nextfu="remove">🗑 حذف پیگیری</button></div>' +
      '<div class="file-next-edit" hidden><input type="text" id="cfNextDate" inputmode="numeric" placeholder="۱۴۰۵/۰۸/۰۱" value="' + esc(fa(Jalali.formatDate(d))) + '">' +
      '<input type="text" id="cfNextNote" placeholder="موضوع پیگیری" value="' + esc(n.note || "") + '">' +
      '<button type="button" class="btn btn-primary btn-sm" data-nextfu="save">ذخیره</button></div></div>';
  }

  function renderNextAction() {
    var el = $("m_nextAction");
    if (!el) return;
    var st = info && info.stage;
    if (!st || !st.action) { el.innerHTML = ""; return; }
    var btn = STAGE_BTN[st.actionKey];
    // مشتریِ فرم سایت مشخصاتش را فرستاده و فقط عکس مدرک کم دارد — دکمه نباید بگوید «ارسال فرم احراز»
    if (btn && st.code === "docs_needed") btn = { text: "درخواست عکس مدرک", pane: "kyc" };
    el.innerHTML = '<div class="next-action">' +
      '<div class="next-action-head">اقدام بعدی</div>' +
      "<div>" + esc(st.action) + "</div>" +
      (st.code === "rejected" && info.kycReason ? '<div class="cell-sub">دلیل رد: ' + esc(info.kycReason) + "</div>" : "") +
      '<div class="next-action-btns">' +
      (btn ? '<button type="button" class="btn btn-primary btn-sm" data-cstage="go">' + esc(btn.text) + "</button>" : "") +
      // از پله‌ی «تأیید شده» به «خرید کرد» فقط با ثبت دستی کارشناس می‌رویم
      (st.code === "approved" || st.code === "inactive" ? '<button type="button" class="btn btn-sm btn-sale" data-cstage="bought">خرید کرد 🛒</button>' : "") +
      "</div></div>";
  }
  document.addEventListener("click", function (e) {
    if (e.target.closest('[data-presence="peek"]')) { peeked = true; renderInfo(); return; }
    var nf = e.target.closest("[data-nextfu]");
    if (nf && cur) {
      var act = nf.getAttribute("data-nextfu"), box = nf.closest(".file-next");
      if (act === "edit") { box.querySelector(".file-next-edit").hidden = false; return; }
      var body;
      if (act === "remove") {
        if (!window.confirm("پیگیری بعدی این مشتری حذف شود؟")) return;
        body = { remove: true };
      } else {
        var dd = Jalali.parseDate($("cfNextDate").value);
        if (!dd) { toast("تاریخ را به شکل ۱۴۰۵/۰۸/۰۱ بنویسید", true); return; }
        body = { date: dd.getTime(), note: $("cfNextNote").value };
      }
      nf.disabled = true;
      api("/workdesk/leads/" + cur.id + "/next-followup", { method: "POST", body: body })
        .then(function () { toast(act === "remove" ? "پیگیری حذف شد" : "پیگیری بعدی ذخیره شد"); loadInfo(); loadTimeline(); if (A.refreshLeadLists) A.refreshLeadLists(); })
        .catch(function (err) { toast(err.message, true); nf.disabled = false; });
      return;
    }
    var f = e.target.closest("[data-follow]");
    if (f && cur) {
      var id = cur.id;
      if (f.getAttribute("data-follow") === "stop") {
        var why = window.prompt("چرا پیگیری این مشتری متوقف می‌شود؟ (حتماً بنویسید)", "");
        if (why === null) return;
        if (String(why).trim().length < 3) { toast("دلیل توقف پیگیری را بنویسید", true); return; }
        f.disabled = true;
        api("/workdesk/leads/" + id + "/stop-followup", { method: "POST", body: { reason: why } })
          .then(function () { toast("پیگیری متوقف شد"); loadInfo(); loadTimeline(); if (A.refreshLeadLists) A.refreshLeadLists(); })
          .catch(function (err) { toast(err.message, true); f.disabled = false; });
      } else {
        f.disabled = true;
        api("/workdesk/leads/" + id + "/resume-followup", { method: "POST", body: {} })
          .then(function () { toast("پیگیری دوباره شروع شد — قدم بعدی: امروز"); loadInfo(); loadTimeline(); if (A.refreshLeadLists) A.refreshLeadLists(); })
          .catch(function (err) { toast(err.message, true); f.disabled = false; });
      }
      return;
    }
    var p = e.target.closest("[data-open-pane]");
    if (p && window.CrmWorkdesk) { window.CrmWorkdesk.openPane(p.getAttribute("data-open-pane")); return; }
    var b = e.target.closest("[data-cstage]");
    if (!b || !cur || !info || !info.stage) return;
    var what = b.getAttribute("data-cstage");
    if (what === "bought") {
      if (!window.confirm("ثبت شود که این مشتری خرید کرده است؟")) return;
      var saleReason = "";
      if (info.kyc && info.kyc.raw !== "approved") {
        saleReason = window.prompt("⚠ این مشتری احراز نشده است. برای ثبت فروش، دلیلش را بنویسید: (با قیمت آزاد می‌فروشیم / مشتری قدیمی و شناخته‌شده است / مدارکش در راه است)", "");
        if (saleReason === null) return;
        if (String(saleReason).trim().length < 3) { toast("دلیل فروش به مشتری احراز‌نشده را بنویسید", true); return; }
      }
      b.disabled = true;
      api("/workdesk/leads/" + cur.id + "/purchased", { method: "POST", body: { saleReason: saleReason } })
        .then(function () { toast("خرید مشتری ثبت شد"); loadInfo(); if (A.refreshLeadLists) A.refreshLeadLists(); })
        .catch(function (err) { toast(err.message, true); b.disabled = false; });
      return;
    }
    var btn = STAGE_BTN[info.stage.actionKey];
    if (!btn) return;
    if (btn.post) {
      var how = window.prompt("چطور به مشتری اطلاع دادید؟ (پیامک / تماس / پیام)", "پیامک");
      if (how === null) return;
      b.disabled = true;
      api("/workdesk/leads/" + cur.id + "/" + btn.post, { method: "POST", body: { how: how } })
        .then(function () { toast("اطلاع رد ثبت شد"); loadInfo(); loadTimeline(); })
        .catch(function (err) { toast(err.message, true); b.disabled = false; });
    } else if (btn.pane && window.CrmWorkdesk) {
      window.CrmWorkdesk.openPane(btn.pane);
    } else if (btn.focus && $(btn.focus)) {
      $(btn.focus).scrollIntoView({ block: "center" });
    }
  });

  // ---------------- اطلاعات پرونده: نشان‌ها، گروه پشتیبان، حضور دیگران ----------------
  // یادداشت‌های جدای پرونده: جدیدترین بالا، هر کدام با تاریخ و نویسنده
  function renderNotes() {
    var el = $("m_notesList");
    if (!el) return;
    el.innerHTML = (info.notes || []).map(function (n) {
      var me = A.state.user || {};
      var del = me.role === "manager" || n.userId === me.id ? '<button type="button" class="note-del" title="حذف یادداشت" data-note-del="' + esc(n.id) + '">✕</button>' : "";
      return '<div class="note-item">' + del + '<div class="note-meta">' + esc(fa(Jalali.formatDate(new Date(n.at)))) + (n.by ? " · " + esc(n.by) : "") + "</div>" + esc(n.text) + "</div>";
    }).join("");
  }
  document.addEventListener("click", function (e) {
    var nd = e.target.closest("[data-note-del]");
    if (nd && cur) {
      if (!window.confirm("این یادداشت حذف شود؟")) return;
      nd.disabled = true;
      api("/workdesk/leads/" + cur.id + "/notes/" + nd.getAttribute("data-note-del"), { method: "DELETE" })
        .then(function (r) { info.notes = r.notes; renderNotes(); toast("یادداشت حذف شد"); })
        .catch(function (err) { toast(err.message, true); nd.disabled = false; });
      return;
    }
    if (!e.target.closest("#m_noteSave") || !cur) return;
    var box = $("m_noteNew"), btn = $("m_noteSave"), t = box.value.trim();
    if (t.length < 2) { toast("متن یادداشت را بنویسید", true); return; }
    btn.disabled = true;
    api("/workdesk/leads/" + cur.id + "/notes", { method: "POST", body: { text: t } })
      .then(function (r) { box.value = ""; info.notes = r.notes; renderNotes(); loadTimeline(); toast("یادداشت ثبت شد"); })
      .catch(function (err) { toast(err.message, true); })
      .then(function () { btn.disabled = false; });
  });

  function renderInfo() {
    if (!info) return;
    renderNotes();
    var badges = [];
    if (info.prefersCalls) badges.push('<span class="file-badge prefers" title="گروه پشتیبان دارد ولی در ۳۰ روز اخیر ' + fa(info.calls.last30) + ' بار تماس گرفته — با تماس راحت‌تر است">📞 ترجیح تماس</span>');
    badges.push('<span class="file-badge">' + fa(info.calls.total) + " تماس · " + fa(info.calls.last30) + " در ۳۰ روز</span>");
    var sg = info.supportGroup;
    var box;
    if (editing) {
      box = '<div class="sg-box"><div class="sg-head">گروه پشتیبان <button type="button" class="btn btn-ghost btn-sm" data-sg="cancel">انصراف</button></div>' +
        '<div class="field"><label>پیام‌رسان</label><select id="sg_platform"><option value="">بدون گروه پشتیبان</option>' +
        info.platforms.map(function (p) { return '<option value="' + p.code + '"' + (sg && sg.platform === p.code ? " selected" : "") + ">" + esc(p.label) + "</option>"; }).join("") + "</select></div>" +
        '<div class="field"><label>نام گروه</label><input type="text" id="sg_name" maxlength="120" value="' + esc(sg ? sg.name : "") + '" placeholder="مثلاً: CRM نمونه — موبایل رضایی"></div>' +
        '<button type="button" class="btn btn-primary btn-sm" data-sg="save">ذخیره‌ی گروه پشتیبان</button></div>';
    } else {
      box = '<div class="sg-box"><div class="sg-head">گروه پشتیبان <button type="button" class="btn btn-ghost btn-sm" data-sg="edit">' + (sg ? "ویرایش" : "تعیین گروه") + "</button></div>" +
        (sg
          ? '<div><span class="file-badge group">' + esc(sg.platformLabel) + "</span> <b>" + esc(sg.name) + "</b></div>"
          : '<div class="cell-sub">این مشتری هنوز گروه پشتیبان ندارد.</div>') + "</div>";
    }
    $("m_fileInfo").innerHTML = (info.stage ? stageBanner(info.stage) : "") + '<div class="file-badges">' + badges.join("") + "</div>" + kycBar() + nextFollowLine() + box + stopLine();
    renderNextAction();
    var modal = document.querySelector("#overlay .modal-file") || document.querySelector("#overlay .modal");
    if (info.presence && !peeked) {
      $("m_presence").innerHTML =
        '<div class="presence-lock" role="status"><div class="presence-lock-box">🔒' +
        '<div class="presence-lock-name">' + esc(info.presence.name) + " در حال کار روی این پرونده است</div>" +
        '<div class="presence-lock-what">' + esc(info.presence.label) + "</div>" +
        '<div class="presence-lock-hint">برای جلوگیری از پیگیری تکراری، با او هماهنگ کنید.</div>' +
        '<button type="button" class="btn btn-ghost btn-sm" data-presence="peek">به هر حال ببینم</button></div></div>';
      if (modal) modal.classList.add("is-locked");
    } else {
      $("m_presence").innerHTML = info.presence
        ? '<div class="presence-banner" role="status">🔒 ' + esc(info.presence.name) + " همین الان روی این پرونده کار می‌کند (" + esc(info.presence.label) + ")</div>"
        : "";
      if (modal) modal.classList.remove("is-locked");
    }
  }
  function loadInfo() {
    if (!cur) return Promise.resolve();
    var id = cur.id;
    return api("/workdesk/leads/" + id + "/file").then(function (r) { if (cur && cur.id === id) { info = r; if (!editing) renderInfo(); } }).catch(function () {});
  }

  document.addEventListener("click", function (e) {
    var b = e.target.closest("[data-sg]");
    if (!b || !cur) return;
    var act = b.getAttribute("data-sg");
    if (act === "edit") {
      editing = true;
      renderInfo();
      busy("edit");
    } else if (act === "cancel") {
      editing = false; renderInfo();
    } else if (act === "save") {
      b.disabled = true;
      api("/workdesk/leads/" + cur.id + "/support-group", { method: "PUT", body: { platform: $("sg_platform").value, name: $("sg_name").value } })
        .then(function (r) { info = r; editing = false; renderInfo(); loadTimeline(); toast("گروه پشتیبان ثبت شد"); })
        .catch(function (err) { toast(err.message, true); b.disabled = false; });
    }
  });

  // ---------------- سابقه‌ی همه‌ی عملیات ----------------
  var tlItems = [];
  var tlEditId = null; // کارتی که الان در حال ویرایش است (شناسه‌ی x.id)
  var tlOpenSale = null; // کارت خریدی که جزئیاتش باز است

  // فیلدهای مخفی سابقه (با «_» شروع می‌شوند) در فهرست تغییرات نمایش داده نمی‌شوند
  function hidden(f) { return f && f.charAt(0) === "_"; }
  function chg(x, f) { var c = (x.changes || []).find(function (c) { return c.field === f; }); return c ? c.to : ""; }
  function rial(v) { return fa(String(v).replace(/\B(?=(\d{3})+(?!\d))/g, ",")) + " ریال"; }
  function editIcon(x) {
    if (x.kind === "sms") return ""; // متن پیامکِ رفته قابل ویرایش نیست
    return '<button type="button" class="tl-edit-btn" data-tl-edit="' + esc(x.id) + '" title="ویرایش این کارت" aria-label="ویرایش">✏️</button>';
  }
  function editedNote(x) {
    var e = chg(x, "_edited");
    if (!e) return "";
    var parts = e.split(" · ");
    return '<div class="tl-edited" title="متن اصلی: ' + esc(chg(x, "_original")) + '">✎ ویرایش‌شده' +
      (parts[0] ? " توسط " + esc(parts[0]) : "") + (parts[1] ? " — " + esc(A.fmtDateTime(parts[1])) : "") + "</div>";
  }

  // کارت خرید: مبلغ همیشه دیده می‌شود، با کلیک جزئیات (شماره فاکتور، کارشناس، دلیل) باز می‌شود
  function saleCardHtml(x) {
    var price = chg(x, "_salePrice"), model = chg(x, "_saleModel"), invoice = chg(x, "_saleInvoice"), why = chg(x, "_saleReason");
    var open = tlOpenSale === x.id;
    return '<div class="tl-item tl-' + esc(x.kind) + ' tl-sale" data-tl-sale="' + esc(x.id) + '" role="button" tabindex="0" title="جزئیات خرید">' +
      '<div class="tl-top"><b>🛒 ' + esc(fa(x.label)) + '</b><span class="tl-time">' + esc(A.fmtDateTime(x.at)) + "</span></div>" +
      '<div class="tl-sale-price">' + (price ? "💰 " + esc(rial(price)) : '<span class="cell-sub">مبلغ ثبت نشده</span>') + "</div>" +
      (open ? '<div class="tl-sale-details">' +
        (invoice ? '<div>🧾 شماره فاکتور: <b dir="ltr">' + esc(invoice) + "</b></div>" : "") +
        (model ? "<div>📦 محصول: <b>" + esc(model) + "</b></div>" : "") +
        "<div>💰 مبلغ فاکتور: <b>" + esc(price ? rial(price) : "—") + "</b></div>" +
        "<div>👤 ثبت‌کننده: " + esc(x.who || "—") + "</div>" +
        "<div>🕓 زمان: " + esc(A.fmtDateTime(x.at)) + "</div>" +
        (why ? "<div>⚠ فروش بدون احراز — دلیل: " + esc(why) + "</div>" : "") +
        (x.text ? '<div class="cell-sub">' + esc(x.text) + "</div>" : "") + "</div>"
        : '<div class="cell-sub">برای جزئیات کلیک کنید</div>') +
      editedNote(x) + editIcon(x) + deleteSaleIcon(x) + "</div>";
  }

  // 🗑 حذف فروش: فقط مدیر یا ثبت‌کننده‌ی همان فروش (سرور هم همین را چک می‌کند)
  function deleteSaleIcon(x) {
    var me = A.state && A.state.user;
    if (!me || (me.role !== "manager" && me.fullName !== x.who)) return "";
    return '<button type="button" class="tl-del-btn" data-tl-del-sale="' + esc(x.id) + '" title="حذف این فروش" aria-label="حذف فروش">🗑</button>';
  }
  // فروشی که حذف شده: در سابقه می‌ماند ولی خط‌خورده، با دلیل و نام حذف‌کننده
  function deletedSaleHtml(x) {
    var price = chg(x, "_salePrice"), by = chg(x, "_deletedBy").split(" · ");
    return '<div class="tl-item tl-sale-deleted"><div class="tl-top"><b>🗑 فروش حذف‌شده</b><span class="tl-time">' + esc(A.fmtDateTime(x.at)) + "</span></div>" +
      '<div class="tl-sale-price"><s>' + (price ? esc(rial(price)) : "مبلغ ثبت نشده") + "</s>" + (chg(x, "_saleModel") ? " · " + esc(chg(x, "_saleModel")) : "") + "</div>" +
      '<div class="cell-sub">ثبت: ' + esc(x.who || "—") + " · حذف: " + esc(by[0] || "—") + (by[1] ? " — " + esc(A.fmtDateTime(by[1])) : "") + "</div>" +
      '<div class="tl-text">دلیل حذف: ' + esc(chg(x, "_deleteReason")) + "</div></div>";
  }

  function timelineItemHtml(x) {
    if (x.kind === "purchase_deleted") return deletedSaleHtml(x);
    if (tlEditId === x.id) return timelineEditHtml(x);
    if (x.kind === "first_purchase" || x.kind === "purchase") return saleCardHtml(x);
    var changes = (x.changes || []).filter(function (c) { return !hidden(c.field); })
      .map(function (c) { return esc(c.label) + ": " + esc(c.from) + " ← <b>" + esc(c.to) + "</b>"; }).join("<br>");
    return '<div class="tl-item tl-' + esc(x.kind) + '"><div class="tl-top"><b>' + esc(fa(x.label)) + '</b><span class="tl-time">' + esc(A.fmtDateTime(x.at)) + "</span></div>" +
      '<div class="tl-who">👤 ' + esc(x.who) + "</div>" +
      (x.text ? '<div class="tl-text">' + esc(x.text) + "</div>" : "") +
      (x.extra ? '<div class="tl-text">' + esc(fa(x.extra)) + "</div>" : "") +
      (changes ? '<div class="tl-text cell-sub">' + changes + "</div>" : "") +
      editedNote(x) + editIcon(x) + "</div>";
  }

  function timelineEditHtml(x) {
    var sale = x.kind === "first_purchase" || x.kind === "purchase";
    var price = chg(x, "_salePrice");
    return '<div class="tl-item tl-' + esc(x.kind) + ' fu-editing"><div class="tl-top"><b>' + esc(fa(x.label)) + "</b></div><div class=\"cf-box\">" +
      (sale ? '<div class="cf-row">' +
        '<label class="cf-f"><span>شماره فاکتور</span><input type="text" id="tlEdInvoice" maxlength="40" dir="ltr" value="' + esc(chg(x, "_saleInvoice")) + '"></label>' +
        '<label class="cf-f"><span>مبلغ فاکتور (ریال)</span><input type="text" id="tlEdPrice" inputmode="numeric" dir="ltr" value="' + esc(price ? String(price).replace(/\B(?=(\d{3})+(?!\d))/g, ",") : "") + '"></label></div>' : "") +
      '<div class="cf-row"><label class="cf-f cf-span2"><span>' + (x.id.indexOf("c-") === 0 ? "یادداشت تماس" : "متن") + '</span><textarea id="tlEdText">' + esc(x.text || "") + "</textarea></label></div>" +
      '<div class="cf-btns">' +
      '<button type="button" class="btn btn-primary btn-sm" data-tl-save="' + esc(x.id) + '">ذخیره</button>' +
      '<button type="button" class="btn btn-ghost btn-sm" data-tl-cancel>انصراف</button>' +
      "</div></div></div>";
  }

  // دسته‌های سابقه برای فیلتر، و کارهای کم‌اهمیت که یک خط کوچک خاکستری نشان داده می‌شوند
  var TL_GROUPS = [
    { k: "", label: "همه" },
    { k: "calls", label: "تماس/پیگیری", re: /^(call|followup|manager_followup|sms)/ },
    { k: "sale", label: "فروش", re: /^(first_purchase|purchase|sale_)/ },
    { k: "kyc", label: "احراز", re: /^(kyc|intake)/ },
    { k: "changes", label: "تغییرات", minor: true },
  ];
  var TL_MINOR = /^(created|updated|owner_changed|claimed|named|record_edited|support_group|followup_moved|followup_removed|follow_stopped|follow_resumed|task_|report|desk_done|intake_done|intake_files_skipped|kyc_doc_removed|customer|phone|shop|city|job|channel)/;
  var tlFilter = "";
  function tlMinor(x) { return TL_MINOR.test(x.kind || ""); }
  function tlMatch(x) {
    if (!tlFilter) return true;
    var g = TL_GROUPS.filter(function (g) { return g.k === tlFilter; })[0];
    if (g.minor) return tlMinor(x);
    return !tlMinor(x) && g.re.test(x.kind || "");
  }
  function minorHtml(x) {
    var bits = [x.text].concat((x.changes || []).filter(function (c) { return !hidden(c.field); }).map(function (c) { return c.label + ": " + c.to; })).filter(Boolean).join(" · ");
    return '<div class="tl-minor"><span>' + esc(fa(A.fmtDateTime(x.at))) + "</span> · <b>" + esc(fa(x.label)) + "</b> · " + esc(x.who) + (bits ? " — " + esc(fa(bits)) : "") + "</div>";
  }
  function renderTimeline() {
    var chips = '<div class="tl-filter">' + TL_GROUPS.map(function (g) {
      return '<button type="button" class="chip' + (tlFilter === g.k ? " active" : "") + '" data-tl-filter="' + g.k + '">' + esc(g.label) + "</button>";
    }).join("") + "</div>";
    var list = tlItems.filter(tlMatch);
    $("m_timeline").innerHTML = chips + (list.length
      ? list.map(function (x) { return tlMinor(x) && tlEditId !== x.id ? minorHtml(x) : timelineItemHtml(x); }).join("")
      : '<div class="cell-sub">' + (tlItems.length ? "در این دسته موردی نیست." : "هنوز عملیاتی روی این مشتری ثبت نشده است.") + "</div>");
  }
  document.addEventListener("click", function (e) {
    var b = e.target.closest("[data-tl-filter]");
    if (!b) return;
    tlFilter = b.getAttribute("data-tl-filter");
    renderTimeline();
  });

  // ---------------- استعلام‌های قیمت: کل دوره‌ها + جدا جدا برای هر روز ----------------
  var piOpenDay = null;
  var piData = null;
  function renderPriceInq() {
    var box = $("m_priceInq");
    if (!box) return;
    var d = piData;
    box.hidden = !d || !d.total;
    if (box.hidden) return;
    var hhmm = function (ms) { return new Intl.DateTimeFormat("fa-IR", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Tehran" }).format(new Date(ms)); };
    // x.day = نیمه‌شبِ تهران؛ چند ساعت جلوتر می‌رویم تا در هر منطقه‌ی زمانیِ مرورگر همان روز خوانده شود
    var day = function (ms) { return Jalali.formatDate(new Date(ms + 3.5 * 3600000 + 60000), { faDigits: true }); };
    box.innerHTML = '<div class="section-title">💲 استعلام‌های قیمت</div>' +
      '<div class="pi-sum">کل: <b>' + fa(d.total) + " بار</b> در " + fa(d.days.length) + " روز مختلف</div>" +
      d.days.map(function (x) {
        var open = piOpenDay === x.day;
        var ops = x.calls.map(function (c) { return c.operatorName; }).filter(function (v, i, a) { return v && a.indexOf(v) === i; });
        return '<div class="pi-day' + (x.count >= 3 ? " pi-hot" : "") + '">' +
          '<button type="button" class="pi-row" data-pi-day="' + x.day + '">' +
          "<b>" + esc(day(x.day)) + "</b><span>" + fa(x.count) + " بار</span>" +
          '<span class="cell-sub">' + esc(x.calls.map(function (c) { return hhmm(c.at); }).join("، ")) + (ops.length ? " — " + esc(ops.join("، ")) : "") + "</span></button>" +
          (open ? '<div class="pi-calls">' + x.calls.map(function (c) {
            return '<div class="pi-call"><b>' + esc(hhmm(c.at)) + "</b> " + esc(c.operatorName || "—") +
              ((c.note || c.productNote) ? '<div class="cell-sub">' + (c.productNote ? "📦 " + esc(c.productNote) + " — " : "") + esc(c.note) + "</div>" : "") + "</div>";
          }).join("") + "</div>" : "") + "</div>";
      }).join("");
  }
  function loadPriceInq() {
    if (!cur) return;
    var id = cur.id;
    api("/workdesk/leads/" + id + "/price-inquiries")
      .then(function (r) { if (cur && cur.id === id) { piData = r; renderPriceInq(); } })
      .catch(function () { piData = null; renderPriceInq(); });
  }
  document.addEventListener("click", function (e) {
    var b = e.target.closest("[data-pi-day]");
    if (!b) return;
    var d = Number(b.getAttribute("data-pi-day"));
    piOpenDay = piOpenDay === d ? null : d;
    renderPriceInq();
  });

  function loadTimeline() {
    if (!cur) return;
    var id = cur.id;
    tlEditId = null;
    loadPriceInq();
    api("/workdesk/leads/" + id + "/timeline").then(function (r) {
      if (!cur || cur.id !== id) return;
      tlItems = r.items || [];
      renderTimeline();
    }).catch(function () { $("m_timeline").innerHTML = '<div class="cell-sub">دریافت سابقه انجام نشد.</div>'; });
  }

  document.addEventListener("click", function (e) {
    var editBtn = e.target.closest("[data-tl-edit]");
    if (editBtn) { e.stopPropagation(); tlEditId = editBtn.getAttribute("data-tl-edit"); renderTimeline(); var t = $("tlEdText"); if (t) t.focus(); return; }
    if (e.target.closest("[data-tl-cancel]")) { tlEditId = null; renderTimeline(); return; }
    var saveBtn = e.target.closest("[data-tl-save]");
    if (saveBtn && cur) {
      var itemId = saveBtn.getAttribute("data-tl-save");
      var body = { text: (($("tlEdText") || {}).value || "").trim() };
      if ($("tlEdInvoice")) body.saleInvoice = $("tlEdInvoice").value.trim();
      if ($("tlEdPrice")) body.salePrice = $("tlEdPrice").value;
      saveBtn.disabled = true;
      api("/workdesk/leads/" + cur.id + "/timeline/" + encodeURIComponent(itemId), { method: "PATCH", body: body })
        .then(function () { tlEditId = null; toast("کارت ویرایش شد"); loadTimeline(); loadInfo(); if (A.refreshLeadLists) A.refreshLeadLists(); })
        .catch(function (err) { toast(err.message, true); saveBtn.disabled = false; });
      return;
    }
    var del = e.target.closest("[data-tl-del-sale]");
    if (del && cur) {
      e.stopPropagation();
      if (!window.confirm("این فروش از پرونده حذف شود؟ (در گزارش‌ها دیگر شمرده نمی‌شود)")) return;
      var why = window.prompt("دلیل حذف فروش را بنویسید (مثلاً: اشتباهی ثبت شد / مشتری مرجوع کرد)", "");
      if (why === null) return;
      if (String(why).trim().length < 3) { toast("دلیل حذف فروش را بنویسید", true); return; }
      del.disabled = true;
      api("/workdesk/leads/" + cur.id + "/sales/" + encodeURIComponent(del.getAttribute("data-tl-del-sale")), { method: "DELETE", body: { reason: why } })
        .then(function () { toast("فروش حذف شد"); loadTimeline(); loadInfo(); if (A.refreshLeadLists) A.refreshLeadLists(); if (A.openLeadModal) A.openLeadModal(cur.id); })
        .catch(function (err) { toast(err.message, true); del.disabled = false; });
      return;
    }
    var c = e.target.closest("[data-tl-sale]");
    if (c) {
      var id = c.getAttribute("data-tl-sale");
      tlOpenSale = tlOpenSale === id ? null : id;
      renderTimeline();
    }
  });
  // مبلغ در فرم ویرایش هم هنگام تایپ سه‌رقم‌سه‌رقم جدا می‌شود (رقم فارسی هم قبول است)
  document.addEventListener("input", function (e) {
    if (e.target.id !== "tlEdPrice") return;
    var d = e.target.value.replace(/[۰-۹]/g, function (x) { return "۰۱۲۳۴۵۶۷۸۹".indexOf(x); }).replace(/[^0-9]/g, "");
    e.target.value = d.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  });

  // ---------------- «در حال کار توسط…» ----------------
  function beat() {
    if (!cur || !myAction) return;
    var id = cur.id;
    api("/workdesk/leads/" + id + "/presence", { method: "POST", body: { action: myAction } })
      .then(function (r) { if (info && cur && cur.id === id && r.presence) { info.presence = { name: r.presence.name, label: r.presence.label }; renderInfo(); } })
      .catch(function () {});
  }
  function busy(action) {
    if (!cur) return;
    myAction = action;
    beat();
    clearInterval(beatTimer);
    beatTimer = setInterval(beat, 30000);
  }
  function release(lead) {
    clearInterval(beatTimer); beatTimer = null;
    if (lead && myAction) api("/workdesk/leads/" + lead.id + "/presence", { method: "DELETE" }).catch(function () {});
    myAction = "";
  }
  // هر کاری که روی پرونده شروع شود، «در حال کار» من را اعلام می‌کند
  var PANE_ACTION = { kyc: "kyc", tasks: "tasks", report: "report", sms: "sms", owner: "view" };
  document.addEventListener("click", function (e) {
    if (!cur || $("overlay").hidden) return;
    if (e.target.closest(".fu-kind")) busy("followup");
    else if (e.target.closest("#m_editToggle")) busy("edit");
    else {
      var p = e.target.closest("[data-wd-pane]");
      if (p) busy(PANE_ACTION[p.getAttribute("data-wd-pane")] || "view");
    }
  });

  // ---------------- نشان‌های فهرست مشتریان ----------------
  function decorateRows(container) {
    var rows = container ? container.querySelectorAll("[data-id]") : [];
    var ids = Array.prototype.map.call(rows, function (r) { return r.getAttribute("data-id"); });
    if (!ids.length) return;
    api("/workdesk/badges", { method: "POST", body: { ids: ids } }).then(function (r) {
      Array.prototype.forEach.call(rows, function (row) {
        var b = r.badges[row.getAttribute("data-id")];
        var cell = row.querySelector("td");
        if (!b || !cell || cell.querySelector(".file-badges")) return;
        var html = (b.prefersCalls ? '<span class="file-badge prefers">📞 ترجیح تماس</span>' : "") +
          (b.presence ? '<span class="file-badge" style="background:#fbbf24;color:#422006">🔒 ' + esc(b.presence.name) + "</span>" : "");
        if (html) cell.insertAdjacentHTML("beforeend", '<div class="file-badges" style="margin-top:4px">' + html + "</div>");
      });
    }).catch(function () {});
  }

  window.CrmFile = {
    onLead: function (lead) {
      if (cur && cur.id !== lead.id) release(cur);
      cur = lead; editing = false; info = null;
      $("m_fileInfo").innerHTML = ""; $("m_presence").innerHTML = ""; if ($("m_nextAction")) $("m_nextAction").innerHTML = "";
      $("m_timeline").innerHTML = '<div class="cell-sub">در حال دریافت سابقه…</div>';
      piData = null; piOpenDay = null; renderPriceInq();
      peeked = false;
      loadInfo(); loadTimeline();
      busy("view");
      clearInterval(pollTimer);
      pollTimer = setInterval(function () { if ($("overlay").hidden) return; loadInfo(); }, 15000);
    },
    onClose: function () { release(cur); clearInterval(pollTimer); cur = null; },
    refresh: function () { loadInfo(); loadTimeline(); },
    decorateRows: decorateRows,
  };
})();
