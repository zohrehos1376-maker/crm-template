// «میز کار مشاور»، «فرم‌های همکاری» و «لیدهای وردست» CRM نمونه (جدا از app.js) — یک سازنده برای هر سه.
// هر ردیف: منبع، زمان انتظار (بعد از ۳۰ دقیقه قرمز)، مشتری، وضعیت و دکمه‌ی کار لازم.
(function () {
  "use strict";
  var A = window.CrmApp;
  if (!A) return;
  var api = A.api, esc = A.esc, toast = A.toast, $ = A.$;
  var fa = function (v) { return Jalali.toFaDigits(String(v)); };
  var SRC = { call: { label: "📞 تماس", cls: "missed" }, form: { label: "🌐 فرم همکاری سایت", cls: "form" }, vardast: { label: "💬 وردست", cls: "vardast" } };
  var KYC = { none: "احراز نشده", awaiting: "منتظر مدارک", pending: "منتظر تأیید کارشناس", approved: "احراز شده", rejected: "مدارک رد شده" };
  var age = function (ms) {
    var m = Math.max(0, Math.round((Date.now() - ms) / 60000));
    return { m: m, text: m < 60 ? fa(m) + " دقیقه" : m < 1440 ? fa(Math.floor(m / 60)) + " ساعت" : fa(Math.floor(m / 1440)) + " روز" };
  };
  var dayLabel = function (ms) { return new Intl.DateTimeFormat("fa-IR", { weekday: "long", day: "numeric", month: "long", timeZone: "Asia/Tehran" }).format(new Date(ms)); };
  var timeLabel = function (ms) { return new Intl.DateTimeFormat("fa-IR", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Tehran" }).format(new Date(ms)); };
  var cell = function (label, value) { return '<div class="cd-cell"><span>' + esc(label) + "</span><b>" + (value || '<i class="cell-sub">—</i>') + "</b></div>"; };

  // «رسیدگی شد» فقط با ثبت اقدام: کارشناس می‌گوید چه کاری برای این لید انجام شده
  var DONE_ACTIONS = ["تماس گرفتم و صحبت شد", "تماس گرفتم، جواب نداد", "پیام دادم (واتساپ / تلگرام)", "لینک احراز همکاری فرستادم", "منتظر مدارک است", "سفارش ثبت شد", "قیمت دادم، فکر می‌کند", "بی‌ربط / تکراری بود", "سایر (در توضیح بنویسید)"];
  var doneOpen = null; // leadId فرمی که باز است
  function doneFormHtml(leadId) {
    if (doneOpen !== leadId) return "";
    return '<div class="cf-box">' +
      '<div class="cf-row">' +
      '<label class="cf-f"><span>چه اقدامی انجام شد؟ <b class="req">*</b></span><select id="cdDoneAct" data-combo="done_action">' +
      DONE_ACTIONS.map(function (x) { return '<option value="' + esc(x) + '">' + esc(x) + "</option>"; }).join("") +
      "</select></label>" +
      '<label class="cf-f cf-span2"><span>توضیح (اختیاری)</span><textarea id="cdDoneNote" rows="1" placeholder="هر چیزی که در فهرست بالا نیست"></textarea></label>' +
      "</div>" +
      '<div class="cf-err" id="cdDoneErr" hidden></div>' +
      '<div class="cf-btns"><button type="button" class="btn btn-primary btn-sm" data-cd-done-save="' + esc(leadId) + '">ثبت اقدام ✓</button>' +
      '<button type="button" class="btn btn-ghost btn-sm" data-cd-done-cancel>انصراف</button>' +
      '<span class="hint" style="margin:0">در سابقه‌ی پرونده به نام شما ثبت می‌شود</span></div></div>';
  }


  // تب وردست: به‌جای «رسیدگی شد»، همان سه سؤالِ «کارهای من» — چه شد؟ · توضیح · قدم بعدی
  var VD_RESULTS = [
    { code: "price", label: "قیمت دادم" },
    { code: "order", label: "سفارش داد" },
    { code: "noanswer", label: "جواب نداد" },
    { code: "irrelevant", label: "بی‌ربط بود" }
  ];
  var VD_NEXT = [
    { code: "followup", days: 1, label: "پیگیری فردا" },
    { code: "followup", days: 3, label: "پیگیری ۳ روز دیگر" },
    { code: "followup", days: 7, label: "پیگیری هفته‌ی بعد" },
    { code: "bought", days: 0, label: "خرید کرد" },
    { code: "close", days: 0, label: "بستن با دلیل" }
  ];
  function vardastFormHtml(leadId) {
    if (doneOpen !== leadId) return "";
    return '<div class="cf-box"><div class="cf-row">' +
      '<label class="cf-f"><span>چه شد؟ <b class="req">*</b></span><select id="vdRes" data-combo="vardast_result" data-combo-noadd>' +
      VD_RESULTS.map(function (x) { return '<option value="' + x.code + '">' + esc(x.label) + "</option>"; }).join("") + "</select></label>" +
      '<label class="cf-f"><span>قدم بعدی <b class="req">*</b></span><select id="vdNext" data-combo="vardast_next" data-combo-noadd>' +
      VD_NEXT.map(function (x, i) { return '<option value="' + i + '">' + esc(x.label) + "</option>"; }).join("") + "</select></label>" +
      '<label class="cf-f cf-span2"><span>توضیح (برای «بستن با دلیل» اجباری است)</span><textarea id="vdNote" rows="1" placeholder="خلاصه‌ی مکالمه"></textarea></label>' +
      "</div>" +
      '<div class="cf-err" id="vdErr" hidden></div>' +
      '<div class="cf-btns"><button type="button" class="btn btn-primary btn-sm" data-vd-save="' + esc(leadId) + '">ثبت نتیجه ✓</button>' +
      '<button type="button" class="btn btn-ghost btn-sm" data-cd-done-cancel>انصراف</button>' +
      '<span class="hint" style="margin:0">در سابقه‌ی پرونده به نام شما ثبت می‌شود</span></div></div>';
  }

  function rowHtml(r, late) {
    var a = age(r.at);
    var tags = ['<span class="wait-src ' + SRC[r.type].cls + '">' + SRC[r.type].label + "</span>"];
    if (r.waiting) tags.push('<span class="wait-age' + (a.m >= late ? " late" : "") + '">' + a.text + " منتظر</span>");
    // «در حال رسیدگی / رسیدگی شد» برداشته شد (docs/lead-stages-plan.md): مرحله‌ی خود مشتری ملاک است
    if (r.unlogged) tags.push('<span class="cst wait">⏳ بلاتکلیف</span>');
    if (r.done) tags.push('<span class="cst ok">✓ نتیجه ثبت شد' + (r.doneBy ? " — " + esc(r.doneBy) : "") + "</span>");
    if (r.type !== "call") tags.push(r.existing
      ? '<span class="file-badge" style="background:#dbeafe;color:#1e3a8a">👤 از قبل در CRM بود</span>'
      : '<span class="file-badge" style="background:#dcfce7;color:#14532d">✨ مشتری تازه</span>');
    if (r.presence) tags.push('<span class="file-badge" style="background:#fbbf24;color:#422006">🔒 ' + esc(r.presence.name) + ": " + esc(r.presence.label) + "</span>");
    if (r.prefersCalls) tags.push('<span class="file-badge prefers">📞 ترجیح تماس</span>');
    else if (r.supportGroup) tags.push('<span class="file-badge group">گروه پشتیبان دارد</span>');
    if (r.phoneCalls > 1) tags.push('<span class="cell-sub">' + fa(r.phoneCalls) + " تماس در این بازه</span>");
    var status = r.type === "call"
      ? (r.missed ? '<span style="color:#dc2626">بی‌پاسخ' + (r.callbackDone ? " · تماس برگشتی ✓" : "") + "</span>" : esc(r.directionLabel) + " · " + esc(fa(r.durationLabel || "")))
      : esc(r.source || "—");
    var acts = [];
    if (r.leadId) acts.push('<button type="button" class="btn btn-ghost btn-sm" data-cd-open="' + esc(r.leadId) + '">پرونده</button>');
    // تماس بی‌پاسخ: «زنگ زدم» هم فرم ثبت را باز می‌کند تا پرونده ساخته شود و متن مکالمه نوشته شود (حذف نمی‌شود)
    if (r.waiting && r.type === "call") acts.push('<a class="btn btn-ghost btn-sm" href="tel:' + esc(r.phone) + '">تماس</a>');
    if (r.unlogged || (r.type === "call" && !r.leadId) || (r.waiting && r.type === "call")) acts.push('<button type="button" class="btn btn-primary btn-sm" data-cd-log="' + esc(r.callId) + '">' + (r.waiting && r.type === "call" ? (r.leadId ? "زنگ زدم — ثبت مکالمه" : "زنگ زدم — ثبت مکالمه و ساخت پرونده") : r.leadId ? "ثبت تماس" : "ثبت تماس و ساخت پرونده") + "</button>");
    if (r.waiting && r.inQueue) acts.push('<button type="button" class="btn btn-primary btn-sm" data-cd-claim="' + esc(r.leadId) + '">برمی‌دارم</button>');
    if (r.type === "vardast" && r.leadId) acts.push('<button type="button" class="btn ' + (r.done ? "btn-ghost" : "btn-primary") + ' btn-sm" data-cd-done="' + esc(r.leadId) + '">' + (r.done ? "ثبت نتیجه‌ی دوباره" : "زنگ زدم — ثبت نتیجه") + "</button>");
    var name = r.name || "بدون نام";
    return '<article class="cd-row' + (r.waiting && a.m >= late ? " late" : r.waiting ? " wait" : "") + '">' +
      '<div class="cd-tags">' + tags.join("") + "</div><div class=\"cd-grid\">" +
      '<div class="cd-who">' + (r.leadId ? '<button type="button" class="cd-name" data-cd-open="' + esc(r.leadId) + '">' + esc(name) + "</button>" : '<b class="cd-name">' + esc(name) + "</b>") +
      '<div><a class="cd-phone" href="tel:' + esc(r.phone) + '" dir="ltr">' + esc(fa(r.phone || "")) + '</a> <button type="button" class="cd-copy" title="کپی شماره" data-cd-copy="' + esc(r.phone) + '">⧉</button></div></div>' +
      cell("زمان", esc(timeLabel(r.at))) + cell(r.type === "call" ? "وضعیت تماس" : "منبع", status) + cell("احراز", esc(KYC[r.kyc] || r.kyc)) +
      cell("شهر / رسته", esc([r.city, r.job].filter(Boolean).join(" · "))) + cell("کارشناس", esc(r.operator || r.owner)) +
      cell("خط / فروشگاه", esc([r.line, r.shop].filter(Boolean).join(" · "))) +
      '<div class="cd-acts">' + acts.join("") + "</div></div>" +
      ((r.note || (r.outcomes && r.outcomes.length)) ? '<div class="cd-note"><span class="cell-sub">یادداشت: </span>' + esc([(r.outcomes || []).join("، "), r.note].filter(Boolean).join(" — ")) + "</div>" : "") +
      (r.done && r.doneNote ? '<div class="cd-note"><span class="cell-sub">نتیجه: </span>' + esc(r.doneNote) + "</div>" : "") +
      (r.leadId ? (r.type === "vardast" ? vardastFormHtml(r.leadId) : doneFormHtml(r.leadId)) : "") +
      "</article>";
  }

  // cfg: { tab, p (پیشوند شناسه‌ها), type (فقط یک منبع؛ خالی = همه) }
  function makeDesk(cfg) {
    if (!$(cfg.p + "List")) return null;
    var P = function (x) { return $(cfg.p + x); };
    var CHIPS = cfg.type
      ? [{ k: "all", label: "همه" }]
      : [{ k: "waiting", label: "⏰ منتظر پاسخ" }, { k: "all", label: "همه" }, { k: "call", label: "تماس‌ها" }, { k: "unlogged", label: "تماس بلاتکلیف" }, { k: "form", label: "فرم‌های همکاری" }, { k: "vardast", label: "لیدهای وردست" }];
    var sel = cfg.type ? "all" : "waiting", timer = null, last = null;

    function render(d) {
      var s = d.stats;
      if (P("Cards")) {
        var card = function (k, label, st, foot) {
          return '<button type="button" class="cd-card' + (sel === k ? " on" : "") + '" data-cd-kind="' + k + '"><span class="wait-src ' + (SRC[k] ? SRC[k].cls : "form") + '">' + label + "</span>" +
            "<b>" + fa(st.today) + '</b><span class="cell-sub">امروز</span><span class="' + (st.waiting ? "cd-alert" : "cell-sub") + '">' + (st.waiting ? fa(st.waiting) + " منتظر" : foot) + "</span></button>";
        };
        P("Cards").innerHTML = card("call", "📞 تماس‌ها", s.call, "همه پاسخ گرفته‌اند") + card("form", "🌐 فرم همکاری سایت", s.form, "همه مسئول دارند") + card("vardast", "💬 وردست", s.vardast, "همه مسئول دارند") +
          '<button type="button" class="cd-card' + (sel === "unlogged" ? " on" : "") + '" data-cd-kind="unlogged"><span class="wait-src" style="background:#64748b">⏳ تماس بلاتکلیف</span><b>' + fa(s.unlogged) + '</b><span class="cell-sub">فرم تماس را ثبت کنید</span></button>';
      }
      P("Kinds").innerHTML = CHIPS.map(function (x) {
        var n = x.k === "waiting" ? (cfg.type ? s[cfg.type].waiting : s.waiting) : x.k === "unlogged" ? s.unlogged : null;
        return '<button type="button" class="chip' + (sel === x.k ? " active" : "") + '" data-cd-kind="' + x.k + '">' + esc(x.label) + (n ? " (" + fa(n) + ")" : "") + "</button>";
      }).join("");
      if (!d.rows.length) { P("List").innerHTML = '<div class="empty-state" style="padding:24px;text-align:center;color:var(--ink-faint)">' + (sel === "waiting" ? "چیزی منتظر نمانده 👌" : "موردی پیدا نشد") + "</div>"; return; }
      var html = "", day = "";
      d.rows.forEach(function (r) {
        var dl = dayLabel(r.at);
        if (dl !== day) { day = dl; html += '<div class="cd-day">' + esc(dl) + "</div>"; }
        // تماس‌ها دقیقاً مثل صفحه‌ی «تماس‌ها»: همان ردیف، همان دکمه‌ها، همان فرم درجا
        html += r.type === "call" ? A.callRowHtml(r.call) : rowHtml(r, d.lateMinutes);
      });
      P("List").innerHTML = html + (d.total > d.rows.length ? '<div class="hint">' + fa(d.rows.length) + " از " + fa(d.total) + " مورد؛ بازه را کوتاه‌تر کنید یا جست‌وجو کنید.</div>" : "");
    }
    var ctx = {
      find: function (id) { var row = (last && last.rows || []).filter(function (x) { return x.callId === id; })[0]; return row && row.call; },
      rerender: function () { if (last) render(last); },
      refresh: function () { load(); A.refreshLeadLists(); },
    };
    A.bindCallRows($(cfg.p + "List"), ctx);

    function load() {
      clearTimeout(timer);
      var q = cfg.type ? "kind=" + cfg.type + "&status=" + (sel === "all" ? "" : sel) : "kind=" + sel;
      api("/workdesk/desk?" + q + "&days=" + P("Days").value + "&q=" + encodeURIComponent(P("Q").value.trim()))
        .then(function (d) { last = d; render(d); })
        .catch(function (e) { P("List").innerHTML = '<div class="hint">' + esc(e.message) + "</div>"; })
        .finally(function () { timer = setTimeout(function () { if (A.state.activeTab === cfg.tab && $("overlay").hidden && !A.state.calls.openId && !doneOpen) load(); }, 30000); });
    }
    $(cfg.tab === "consultant" ? "panel-consultant" : "panel-" + cfg.tab).addEventListener("click", function (e) {
      var k = e.target.closest("[data-cd-kind]");
      if (k) { sel = k.getAttribute("data-cd-kind"); load(); return; }
      rowClick(e, {
        render: function () { if (last) render(last); },
        load: load,
        call: function (id) { var row = last && last.rows.filter(function (x) { return x.callId === id; })[0]; return row && row.call; },
      });
    });
    var qTimer = null;
    P("Q").addEventListener("input", function () { clearTimeout(qTimer); qTimer = setTimeout(load, 350); });
    P("Days").addEventListener("change", load);
    return { tab: cfg.tab, load: load, stop: function () { clearTimeout(timer); } };
  }

  // دکمه‌های کارت فرم/وردست — همین تابع در «کارهای من» هم استفاده می‌شود
  // ctx: { render(): بازکشیدن فهرست، load(): خواندن دوباره از سرور، call(id): تماسِ همان ردیف }
  function rowClick(e, ctx) {
    // شناسه‌ها ممکن است در دو تب تکرار شوند؛ خانه‌ها از همان کارتی خوانده می‌شوند که دکمه‌اش زده شد
    var inCard = function (btn, sel) { var a = btn.closest("article"); return a ? a.querySelector(sel) : null; };
    var o = e.target.closest("[data-cd-open]");
    if (o) { A.openLeadModal(o.getAttribute("data-cd-open")); return true; }
    var c = e.target.closest("[data-cd-copy]");
    if (c) { if (navigator.clipboard) navigator.clipboard.writeText(c.getAttribute("data-cd-copy")).then(function () { toast("شماره کپی شد"); }); return true; }
    var l = e.target.closest("[data-cd-log]");
    if (l) { var call = ctx.call && ctx.call(l.getAttribute("data-cd-log")); if (call) A.openCallLog(call); return true; }
    // «رسیدگی شد» دو مرحله است: باز کردن فرم اقدام، بعد ثبت
    var dn = e.target.closest("[data-cd-done]");
    if (dn) { var lid = dn.getAttribute("data-cd-done"); doneOpen = doneOpen === lid ? null : lid; ctx.render(); return true; }
    if (e.target.closest("[data-cd-done-cancel]")) { doneOpen = null; ctx.render(); return true; }
    var ds = e.target.closest("[data-cd-done-save]");
    if (ds) {
      var act = inCard(ds, "#cdDoneAct").value;
      var why = inCard(ds, "#cdDoneNote").value.trim();
      if (/^سایر/.test(act) && !why) {
        var box = inCard(ds, "#cdDoneErr");
        box.textContent = "توضیح اقدام را بنویسید";
        box.hidden = false;
        toast("توضیح اقدام را بنویسید", true);
        return true;
      }
      ds.disabled = true;
      api("/workdesk/leads/" + ds.getAttribute("data-cd-done-save") + "/intake-done", { method: "POST", body: { note: [/^سایر/.test(act) ? "" : act, why].filter(Boolean).join(" — ") } })
        .then(function () { toast("اقدام ثبت شد"); doneOpen = null; ctx.load(); A.refreshLeadLists(); })
        .catch(function (err) { toast(err.message, true); ds.disabled = false; });
      return true;
    }
    var vs = e.target.closest("[data-vd-save]");
    if (vs) {
      var pickNext = VD_NEXT[Number(inCard(vs, "#vdNext").value) || 0];
      var vnote = inCard(vs, "#vdNote").value.trim();
      var vb = inCard(vs, "#vdErr");
      if (pickNext.code === "close" && !vnote) { vb.textContent = "دلیل بستن پرونده را بنویسید"; vb.hidden = false; return true; }
      vs.disabled = true;
      api("/workdesk/mydesk/act", {
        method: "POST",
        body: { leadId: vs.getAttribute("data-vd-save"), result: inCard(vs, "#vdRes").value, note: vnote, next: pickNext.code, days: pickNext.days },
      })
        .then(function (r2) { toast(r2.message || "ثبت شد"); doneOpen = null; ctx.load(); A.refreshLeadLists(); })
        .catch(function (err) { vb.textContent = err.message; vb.hidden = false; vs.disabled = false; });
      return true;
    }
    var b = e.target.closest("[data-cd-claim]");
    if (!b) return false;
    b.disabled = true;
    api("/workdesk/leads/" + b.getAttribute("data-cd-claim") + "/claim", { method: "POST", body: {} })
      .then(function () { toast("شما مسئول رسیدگی شدید"); ctx.load(); A.refreshLeadLists(); })
      .catch(function (err) { toast(err.message, true); b.disabled = false; });
    return true;
  }

  // تب «فرم‌های همکاری» میز خودش را دارد (public/js/kyc-desk.js): فقط تأیید یا رد فرم
  var desks = [makeDesk({ tab: "consultant", p: "cd" }), makeDesk({ tab: "vardast", p: "vd", type: "vardast" })].filter(Boolean);
  window.CrmDesk = {
    onTab: function (id) { desks.forEach(function (d) { if (d.tab === id) d.load(); else d.stop(); }); },
    refresh: function () { desks.forEach(function (d) { if (d.tab === A.state.activeTab) d.load(); }); },
  };
  window.CrmDesk.onTab(A.state.activeTab);
  // برای «کارهای من»: همان کارت و همان فرم تب وردست
  window.CrmDeskRow = {
    rowHtml: function (r) { return rowHtml(r, 30); },
    click: rowClick,
    isOpen: function () { return !!doneOpen; },
  };
})();
