// «کارهای من» — روال ساده‌ی کارشناس: یک فهرست، یک دکمه، سه سؤال.
// سرور: GET /workdesk/mydesk و POST /workdesk/mydesk/act (modules/crm/services/mydeskService.js)
(function () {
  "use strict";
  var A = window.CrmApp;
  if (!A || !document.getElementById("mdLive")) return;
  var api = A.api, esc = A.esc, toast = A.toast, $ = A.$;
  var fa = function (v) { return Jalali.toFaDigits(String(v)); };
  var TONE = { danger: "md-danger", warn: "md-warn", accent: "md-accent", ok: "md-ok" };
  // وضعیت احراز با همان نام‌ها در همه‌ی صفحه‌ها: احراز نشده → منتظر مدارک → منتظر تأیید کارشناس → احراز شده
  var KYC = { awaiting: ["منتظر مدارک", "wait"], pending: ["منتظر تأیید کارشناس", "review"], approved: ["احراز شده", "ok"], rejected: ["مدارک رد شده", "bad"], none: ["احراز نشده", "off"] };
  var NEXT = [
    { code: "followup", label: "پیگیری ۳ روز بعد", days: 3 },
    { code: "bought", label: "خرید کرد" },
    { code: "close", label: "بستن با دلیل" },
  ];

  var data = null, open = null, pick = { result: "", next: "", days: 3 }, timer = null, view = "";
  // فیلتر نوع کار (فقط در مرورگر؛ آخرین انتخاب هر کارشناس یادش می‌ماند)
  var KINDS = [
    { code: "", label: "همه" },
    { code: "call", label: "📞 تماس‌ها" },
    { code: "form", label: "📝 فرم همکاری" },
    { code: "vardast", label: "💬 وردست" },
    { code: "followup", label: "🔁 پیگیری‌ها" },
  ];
  var kind = "";
  try { kind = localStorage.getItem("mdKind") || ""; } catch (e) { kind = ""; }
  function kindOf(r) {
    if (r.kind === "intake") return r.src === "vardast" ? "vardast" : "form";
    return r.kind === "call" ? "call" : "followup";
  }
  var busy = [], liveTimer = null; // شماره‌هایی که همین حالا روی خط‌اند

  var age = function (ms) {
    var m = Math.max(0, Math.round((Date.now() - ms) / 60000));
    return m < 60 ? fa(m) + " دقیقه" : m < 1440 ? fa(Math.floor(m / 60)) + " ساعت" : fa(Math.floor(m / 1440)) + " روز";
  };
  var jalali = function (ms) { return Jalali.formatDate(new Date(ms), { faDigits: true }); };

  function formHtml(r) {
    if (open !== r.id) return "";
    var btn = function (on, attr, label, cls) {
      return '<button type="button" class="md-opt' + (on ? " on" : "") + (cls ? " " + cls : "") + '" ' + attr + ">" + esc(label) + "</button>";
    };
    var results = (data.results || []).map(function (x) {
      return btn(pick.result === x.code, 'data-md-result="' + x.code + '" data-md-days="' + x.days + '"', x.label);
    }).join("");
    var nexts = NEXT.map(function (x) {
      var label = x.code === "followup" ? "پیگیری " + fa(pick.days) + " روز بعد" : x.label;
      return btn(pick.next === x.code, 'data-md-next="' + x.code + '"', label, x.code === "followup" ? "md-go" : "");
    }).join("");
    return '<div class="md-form">' +
      '<div class="md-step"><span>۱</span> چه شد؟</div><div class="md-opts">' + results + "</div>" +
      '<div class="md-step"><span>۲</span> توضیح (اختیاری)' + (pick.next === "close" ? ' — دلیل بستن را بنویسید' : "") + "</div>" +
      '<input type="text" id="mdNote" placeholder="هر چیزی که در دکمه‌های بالا نیست">' +
      '<div class="md-step"><span>۳</span> بعدش؟</div><div class="md-opts">' + nexts + "</div>" +
      (pick.next === "followup" ? '<div class="md-days">پیگیری بعدی: ' +
        [1, 3, 7, 14, 30].map(function (d) {
          return '<button type="button" class="md-day' + (pick.days === d ? " on" : "") + '" data-md-day="' + d + '">' + fa(d) + " روز</button>";
        }).join("") + "</div>" : "") +
      '<div class="md-err" id="mdErr" hidden></div>' +
      '<div class="md-actions"><button type="button" class="btn btn-primary btn-sm" data-md-save="' + esc(r.id) + '">ثبت ✓</button>' +
      '<button type="button" class="btn btn-ghost btn-sm" data-md-cancel>انصراف</button>' +
      '<span class="hint" style="margin:0">به نام خودتان در پرونده ثبت می‌شود' + (r.leadId ? "" : " و پرونده‌ی مشتری ساخته می‌شود") + "</span></div></div>";
  }

  // هر ردیف با کارت و فرم تب اصلی‌اش: تماس ← تب «تماس‌ها»، فرم ← تب «فرم‌های همکاری»، وردست ← تب «وردست»
  function rowHtml(r) {
    if (r.kind === "call" && r.call && A.callRowHtml) return A.callRowHtml(r.call);
    if (r.kind === "intake" && r.src === "form" && r.kycLead && window.CrmKycDesk) return window.CrmKycDesk.rowHtml(r.kycLead);
    if (r.kind === "intake" && r.src === "vardast" && window.CrmDeskRow) {
      return window.CrmDeskRow.rowHtml({
        type: "vardast", at: r.at, leadId: r.leadId, name: r.name, phone: r.phone, source: "وردست", note: r.text,
        waiting: true, existing: r.existing, kyc: r.kyc, city: r.city, job: r.job, shop: r.shop, owner: r.owner, presence: r.presence,
      });
    }
    return mdRowHtml(r);
  }
  // کارت ساده‌ی «کارهای من» — فقط برای پیگیری‌ها و «انجام‌شده‌ها»
  function mdRowHtml(r) {
    var name = r.name || "بدون نام";
    var who = r.leadId
      ? '<button type="button" class="md-name" data-md-lead="' + esc(r.leadId) + '">' + esc(name) + "</button>"
      : '<b class="md-name">' + esc(name) + "</b>";
    var when = r.kind === "followup" ? jalali(r.at) : age(r.at) + " پیش";
    // فقط مدیر: حذف سریع پیگیری اشتباه بدون باز کردن پرونده
    var del = r.kind === "followup" && r.leadId && A.state.user && A.state.user.role === "manager"
      ? '<button type="button" class="md-fu-del" title="حذف این پیگیری" data-md-fudel="' + esc(r.leadId) + '">✕</button>' : "";
    return '<article class="md-row ' + (TONE[r.tone] || "") + (open === r.id ? " open" : "") + (del ? " has-del" : "") + '">' + del +
      '<div class="md-line">' +
      '<span class="md-tag">' + esc(r.label) + "</span>" +
      '<span class="md-when">' + esc(when) + "</span>" +
      '<div class="md-who">' + who +
      '<a class="md-phone" href="tel:' + esc(r.phone) + '" dir="ltr">' + esc(fa(r.phone || "")) + "</a>" +
      (r.text ? '<span class="md-text">' + esc(r.text) + "</span>" : "") +
      (r.leadId && KYC[r.kyc] ? ' <span class="md-kyc ' + KYC[r.kyc][1] + '">' + esc(KYC[r.kyc][0]) + "</span>" : "") +
      (busy.indexOf(r.phone) >= 0 ? ' <span class="md-busy">📞 همین حالا یکی با این شماره در حال مکالمه است</span>' : "") +
      (r.presence ? ' <span class="md-presence">🔒 ' + esc(r.presence.name) + " روی این پرونده کار می‌کند (" + esc(r.presence.label) + ")</span>" : "") + "</div>" +
      (r.kind === "done"
        ? '<span class="md-done-next">' + esc(r.next === "پیگیری" && r.nextAt ? "پیگیری " + jalali(r.nextAt) : r.next || "") + "</span>"
        // پیگیری در پرونده‌ی مشتری انجام می‌شود (همان‌جا که یادآوری گذاشته شده)
        : r.kind === "followup" && r.leadId
          ? '<button type="button" class="btn btn-primary btn-sm md-go-btn" data-md-lead="' + esc(r.leadId) + '">رسیدگی در پرونده</button>'
          : '<button type="button" class="btn btn-primary btn-sm md-go-btn" data-md-open="' + esc(r.id) + '">رسیدگی</button>') +
      "</div>" + formHtml(r) + "</article>";
  }

  function render() {
    if (!data || !$("mdList")) return;
    var c = data.counts;
    $("mdCount").innerHTML = view === "nonext"
      ? 'پرونده‌های بدون قدم بعدی <b>' + fa(data.rows.length) + "</b>"
      : "کارهای من <b>" + fa(c.todo) + "</b>" + (c.overdue ? ' <span class="md-late">' + fa(c.overdue) + " عقب‌افتاده</span>" : "");
    $("mdSafety").innerHTML = view === "nonext"
      ? '<button type="button" class="md-safety-btn back" data-md-nonext>↩ برگشت به کارهای من (' + fa(c.todo) + ")</button>"
      : c.noNext
        ? '<button type="button" class="md-safety-btn bad" data-md-nonext>بدون قدم بعدی: ' + fa(c.noNext) + "</button>"
        : '<span class="md-safety-btn ok">بدون قدم بعدی: ۰</span>';
    var counts = {};
    data.rows.forEach(function (r) { var k = kindOf(r); counts[k] = (counts[k] || 0) + 1; });
    $("mdKinds").hidden = view === "nonext";
    $("mdKinds").innerHTML = KINDS.map(function (k) {
      var n = k.code ? counts[k.code] || 0 : data.rows.length;
      return '<button type="button" class="chip' + (kind === k.code ? " active" : "") + '" data-md-kind="' + k.code + '">' + esc(k.label) + ' <span class="n">' + fa(n) + "</span></button>";
    }).join("");
    var rows = view === "nonext" || !kind ? data.rows : data.rows.filter(function (r) { return kindOf(r) === kind; });
    // مدارک کارت‌های فرم همکاری همراه همین فهرست آمده؛ پیش از کشیدن کارت‌ها در حافظه گذاشته می‌شود
    if (window.CrmKycDesk && window.CrmKycDesk.setDocs) data.rows.forEach(function (r) { if (r.kycLead && r.kycLead.documents) window.CrmKycDesk.setDocs(r.kycLead.id, r.kycLead.docs); });
    $("mdList").innerHTML = rows.length
      ? (view === "nonext" ? '<div class="md-note-line">این پرونده‌ها نه تاریخ پیگیری دارند، نه خرید کرده‌اند، نه بسته شده‌اند — برایشان قدم بعدی بگذارید.</div>' : "") + rows.map(view === "nonext" ? mdRowHtml : rowHtml).join("")
      : '<div class="md-empty">' + (view === "nonext" ? "همه‌ی پرونده‌ها قدم بعدی دارند 👌" : kind ? "در این دسته کاری نمانده 👌" : "کاری نمانده 👌") + "</div>";
    $("mdDone").innerHTML = view !== "nonext" && data.done.length
      ? '<div class="md-done-head">انجام‌شده‌های امروز</div>' + data.done.map(mdRowHtml).join("")
      : "";
  }

  // فرمی (از هر تبی) باز است؟ تا فهرست زیر دست کارشناس بازکشیده نشود
  function formOpen() {
    return !!open || !!(A.state.calls && A.state.calls.openId) ||
      !!(window.CrmKycDesk && window.CrmKycDesk.isOpen()) || !!(window.CrmDeskRow && window.CrmDeskRow.isOpen());
  }
  // کارت‌های تماس: همان فرم درجای تب «تماس‌ها»
  if (A.bindCallRows) A.bindCallRows($("mdList"), {
    find: function (id) { var row = data && data.rows.filter(function (x) { return x.callId === id; })[0]; return row && row.call; },
    rerender: function () { render(); },
    refresh: function () { load(); },
  });
  // کارت‌های فرم و وردست: همان دکمه‌های تب خودشان
  $("mdList").addEventListener("click", function (e) {
    if (window.CrmKycDesk && window.CrmKycDesk.rowClick(e, load)) return;
    if (window.CrmDeskRow) window.CrmDeskRow.click(e, { render: render, load: load, call: function () { return null; } });
  });

  // نوار زنده: کدام خط، با چه شماره‌ای، چند دقیقه است در حال مکالمه
  // فرم همزمان با مکالمه — همان سه سؤال، داخل نوار بالای صفحه
  // همان خانه‌های فرم معمولی ثبت تماس + پیگیری (چند روز بعد / بدون پیگیری)
  var liveOpen = null, livePick = { outcomes: [], days: 0 };
  var LIVE_IDS = ["liveOp", "liveName", "liveHeard", "liveProduct", "liveNote"];
  var liveVals = {};
  function liveVal(id, fallback) { return liveVals[id] !== undefined ? liveVals[id] : fallback; }
  function liveFormHtml(c) {
    if (liveOpen !== c.phone) return "";
    var OUT = A.CG_OUTCOMES || [];
    var sel = livePick.outcomes;
    var ops = (A.state.calls && A.state.calls.operators) || [{ id: A.state.user.id, fullName: A.state.user.fullName }];
    var opSel = liveVal("liveOp", A.state.user.id);
    var f = function (label, html, cls) { return '<label class="cf-f' + (cls ? " " + cls : "") + '"><span>' + label + "</span>" + html + "</label>"; };
    return '<div class="cf-box live-form">' +
      '<div class="cf-row">' +
      f("پاسخ‌دهنده", '<select id="liveOp">' + ops.map(function (u) {
        return '<option value="' + esc(u.id) + '"' + (u.id === opSel ? " selected" : "") + ">" + esc(u.fullName) + "</option>";
      }).join("") + "</select>") +
      f("نام مشتری", '<input type="text" id="liveName" placeholder="نام مشتری" value="' + esc(liveVal("liveName", c.name || "")) + '">') +
      f('نتیجه‌ی تماس <b class="req">*</b>', '<select id="liveOutcome" data-combo="call_outcome" data-combo-prefix="x:"><option value="">انتخاب…</option>' +
        OUT.map(function (o) { return sel.indexOf(o.code) >= 0 ? "" : '<option value="' + o.code + '">' + esc(o.label) + "</option>"; }).join("") + "</select>") +
      (c.leadId ? "" : f("از کجا آشنا شده", '<select id="liveHeard"><option value="">—</option>' + (A.cfChannelOptions ? A.cfChannelOptions() : "") + "</select>")) +
      (sel.indexOf("out_of_stock") >= 0 ? f("محصول درخواستی", '<input type="text" id="liveProduct" placeholder="مثلاً LCD سامسونگ A51" value="' + esc(liveVal("liveProduct", "")) + '">') : "") +
      f("محتوای مکالمه (اختیاری)", '<textarea id="liveNote" rows="1" placeholder="هر چیزی که در فهرست نتیجه‌ها نیست">' + esc(liveVal("liveNote", "")) + "</textarea>", "cf-span2") +
      "</div>" +
      (sel.length ? '<div class="cf-picked">' + sel.map(function (code) {
        var o = OUT.filter(function (x) { return x.code === code; })[0];
        return '<button type="button" class="tag tag-outcome" data-live-unpick="' + esc(code) + '">' + esc(o ? o.label : code.replace(/^x:/, "")) + " ✕</button>";
      }).join(" ") + "</div>" : "") +
      A.fuChooserHtml("data-live-day", livePick.days) +
      '<div class="cf-btns"><button type="button" class="btn btn-primary btn-sm" data-live-save="' + esc(c.phone) + '">ثبت ✓</button>' +
      '<button type="button" class="btn btn-ghost btn-sm" data-live-cancel>انصراف</button>' +
      '<span class="hint" style="margin:0">همین حالا ثبت کنید؛ اگر تماس هنوز تمام نشده، به‌محض پایان روی پرونده می‌نشیند</span></div></div>';
  }
  function liveSnap() {
    LIVE_IDS.forEach(function (id) { var el = $(id); if (el) liveVals[id] = el.value; });
  }
  function liveRestore() {
    LIVE_IDS.forEach(function (id) { var el = $(id); if (el && liveVals[id] !== undefined) el.value = liveVals[id]; });
  }

  // کارت تماس جاری بالای همان فهرستی می‌نشیند که کارشناس باز کرده (تماس‌ها یا کارهای من)
  function placeLive() {
    var box = $("mdLive");
    if (!box) return;
    var host = null, before = null;
    if (A.state.activeTab === "calls" && $("callTbody")) { host = $("callTbody").parentNode; before = $("callTbody"); }
    else if (A.state.activeTab === "consultant" && $("mdList")) { host = $("mdList").parentNode; before = $("mdList"); }
    if (host && box.parentNode !== host) host.insertBefore(box, before);
    else if (host && box.nextSibling !== before) host.insertBefore(box, before);
  }

  // کارت تماس جاری = همان کارت فهرست تماس‌ها، با وضعیت زنده داخل خودش
  var LIVE_STATE = {
    ringing: ["در حال زنگ خوردن", "ring"],
    calling: ["کارشناس دارد تماس می‌گیرد", "calling"],
    ended: ["تازه تمام شد", "ended"],
    talking: ["در حال مکالمه", "talking"],
  };
  function liveRowHtml(c) {
    var st = LIVE_STATE[c.state] || LIVE_STATE.talking;
    var out = c.direction === "OUTGOING";
    var hhmm = new Intl.DateTimeFormat("fa-IR", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Tehran" }).format(new Date(c.startedAt));
    var cell = function (label, html, cls) {
      return '<div class="ct-c ' + (cls || "") + '"><span class="ct-lbl">' + esc(label) + "</span>" + html + "</div>";
    };
    var who = c.leadId
      ? '<span class="call-lead cd-name" data-lead="' + esc(c.leadId) + '">' + esc(c.name || "بدون نام") + "</span>"
      : '<b class="cd-name">بدون نام</b> <span class="cd-nocrm">شماره در CRM نیست</span>';
    var d = c.draft || {};
    var note = d.note || d.name
      ? '<div class="ct-note">' + esc(d.note || "") + "</div>"
      : '<span class="ct-dash">—</span>';
    var btn = (c.state === "ringing" || !c.phone) ? "" :
      '<button type="button" class="btn btn-primary btn-sm" data-live-log="' + esc(c.phone) + '">' +
      (c.draft ? "✓ فرم پر شد — ویرایش" : "ثبت همین تماس") + "</button>";
    return '<article class="ct-row ct-live ' + st[1] + '" data-live-row>' +
      '<div class="ct-line">' +
      cell("زمان", '<b class="ct-time">' + esc(hhmm) + '</b><span class="ct-date">' + esc(jalali(c.startedAt)) + "</span>", "ct-when") +
      cell("نوع تماس", '<span class="ctype ' + (out ? "out" : "in") + '">' + (out ? "↗ خروجی" : "📞 ورودی") + "</span>" +
        '<span class="cst live"><span class="live-dot"></span>' + esc(st[0]) + "</span>", "ct-type") +
      cell("شماره", '<a class="cd-phone" href="tel:' + esc(c.phone) + '" dir="ltr">' + esc(fa(c.phone || "")) + "</a>", "ct-phone") +
      cell("مشتری", who, "ct-who") +
      cell("مدت", '<b class="live-dur">' + esc(liveDur(c)) + "</b>", "ct-dur") +
      cell("خط", "<b>" + esc(c.lineName || "—") + "</b>", "ct-line-name") +
      cell("پاسخ‌دهنده", "<b>" + esc(c.by || c.owner || "—") + "</b>", "ct-op") +
      cell("یادداشت", note, "ct-notes") +
      cell("وضعیت", '<div class="ct-acts">' + btn + "</div>", "ct-end") +
      "</div>" + liveFormHtml(c) + "</article>";
  }

  var lastLive = null, lastKeys = "";
  // اختلاف ساعت کامپیوتر کارشناس با سرور — بدون این، وقت‌شمار از چند دقیقه شروع می‌کند
  var clockGap = 0;
  function serverNow() { return Date.now() - clockGap; }
  function liveDur(c) {
    var sec = Math.max(0, Math.round(((c.state === "ended" ? c.endedAt : serverNow()) - c.startedAt) / 1000));
    return sec < 60 ? fa(sec) + " ثانیه" : fa(Math.floor(sec / 60)) + ":" + fa(("0" + (sec % 60)).slice(-2));
  }
  // فقط با داده‌ی تازه‌ی سرور به‌روز می‌شود. اگر داخل renderLive باشد، ثانیه‌شمارِ هر ثانیه
  // هم صدایش می‌زند و اختلاف هر بار یک ثانیه بزرگ‌تر می‌شود — وقت‌شمار روی صفر قفل می‌ماند.
  function noteClock(d) {
    if (d && typeof d.now === "number") clockGap = Date.now() - d.now;
  }
  function renderLive(d) {
    var calls = d.calls || [];
    // سرور تماس تمام‌شده را از فهرست زنده برمی‌دارد؛ اگر فرمش باز است، روی صفحه بماند
    if (liveOpen && lastLive && !calls.some(function (c) { return c.phone === liveOpen; })) {
      var prev = lastLive.calls.filter(function (c) { return c.phone === liveOpen; })[0];
      if (prev) {
        calls = calls.concat([Object.assign({}, prev, { state: "ended", endedAt: prev.endedAt || serverNow() })]);
        d = Object.assign({}, d, { calls: calls });
      }
    }
    lastLive = d;
    var keys = calls.map(function (c) { return c.phone + ":" + c.state + ":" + (c.draft ? "d" : "-"); }).join("|");
    // فرم باز است و چیزی عوض نشده → فقط ثانیه‌شمار را به‌روز کن تا تایپ کارشناس به هم نخورد
    if (liveOpen && keys === lastKeys && $("mdLive").querySelector("[data-live-save]")) {
      Array.prototype.forEach.call($("mdLive").querySelectorAll("[data-live-row]"), function (row, i) {
        var el = row.querySelector(".live-dur");
        if (el && calls[i]) el.textContent = liveDur(calls[i]);
      });
      return;
    }
    lastKeys = keys;
    // اگر فرم باز است، نوشته‌های کارشناس نباید با به‌روزرسانی زنده پاک شوند
    liveSnap();
    busy = calls.map(function (c) { return c.phone; });
    var box = $("mdLive");
    placeLive();
    var had = !box.hidden;
    box.hidden = !calls.length;
    // تماسی که تمام شد → فهرست تماس‌ها و کارها را همان لحظه تازه کن (منتظر ۳۰ ثانیه نماند)
    if (had && !calls.length) {
      if (A.state.activeTab === "calls" && A.fetchCalls) A.fetchCalls();
      if (A.state.activeTab === "consultant") load();
    }
    if (!calls.length) return;
    box.innerHTML = calls.map(liveRowHtml).join("");
    liveRestore();
  }
  function loadLive() {
    clearTimeout(liveTimer);
    api("/workdesk/live-calls")
      .then(function (d) { noteClock(d); renderLive(d); if (data && !formOpen()) render(); })
      .catch(function () {})
      .finally(function () {
        // اگر پخش زنده وصل باشد، این فقط یک پشتیبان کم‌تکرار است
        liveTimer = setTimeout(loadLive, stream && stream.readyState === 1 ? 30000 : 7000);
      });
  }

  // پخش زنده: تماس همان لحظه‌ای که برقرار (یا قطع) می‌شود روی صفحه می‌آید
  var stream = null;
  function openStream() {
    if (!window.EventSource || stream) return;
    try {
      stream = new EventSource("/api/v1/workdesk/live-stream");
      stream.onmessage = function (e) {
        try {
          var d = JSON.parse(e.data);
          noteClock(d);
          renderLive(d);
          if (data && !formOpen()) render(); // فرم باز = دست نزن
        } catch (err) {}
      };
      stream.onerror = function () {
        // قطع شد: مرورگر خودش دوباره وصل می‌شود؛ پشتیبانِ هر ۷ ثانیه هم هست
        if (stream && stream.readyState === 2) { stream = null; setTimeout(openStream, 5000); }
      };
    } catch (e) { stream = null; }
  }
  // مدت تماس هر ثانیه جلو برود (بدون صدا زدن سرور)
  // و ردیف «تازه تمام شد» بعد از ۱۲ ثانیه خودش برود — منتظر خبر سرور نماند.
  var ENDED_MS = 12000;
  setInterval(function () {
    if (!$("mdLive") || !lastLive || !lastLive.calls.length) return;
    var now = serverNow();
    // تماسی که فرمش باز است تا ثبت یا انصراف نرود — وگرنه نوشته‌های کارشناس پاک می‌شود
    var kept = lastLive.calls.filter(function (c) { return c.phone === liveOpen || !(c.state === "ended" && c.endedAt && now - c.endedAt > ENDED_MS); });
    if (kept.length !== lastLive.calls.length) { lastKeys = ""; renderLive({ calls: kept }); return; }
    if ($("mdLive").hidden) return;
    renderLive(lastLive);
  }, 1000);

  function load() {
    clearTimeout(timer);
    if (!$("mdList")) return;
    api("/workdesk/mydesk?view=" + view + "&days=" + $("mdDays").value + "&q=" + encodeURIComponent($("mdQ").value.trim()))
      .then(function (d) { data = d; render(); })
      .catch(function (e) { $("mdList").innerHTML = '<div class="hint">' + esc(e.message) + "</div>"; })
      .finally(function () {
        timer = setTimeout(function () { if (A.state.activeTab === "consultant" && $("overlay").hidden && !formOpen()) load(); }, 30000);
      });
  }

  function err(msg) {
    var box = $("mdErr");
    if (box) { box.textContent = msg; box.hidden = !msg; }
    if (msg) toast(msg, true);
  }

  // کلیک‌های نوار زنده (در همه‌ی صفحه‌ها)
  function liveRedraw() { liveSnap(); lastKeys = ""; if (lastLive) renderLive(lastLive); }
  $("mdLive").addEventListener("change", function (e) {
    if (e.target.id !== "liveOutcome" || !e.target.value) return;
    if (livePick.outcomes.indexOf(e.target.value) < 0) livePick.outcomes.push(e.target.value);
    liveRedraw();
  });
  $("mdLive").addEventListener("click", function (e) {
    var lv = e.target.closest(".call-lead");
    if (lv) { A.openLeadModal(lv.getAttribute("data-lead")); return; }
    var op = e.target.closest("[data-live-log]");
    if (op) {
      var ph = op.getAttribute("data-live-log");
      var c0 = ((lastLive && lastLive.calls) || []).filter(function (c) { return c.phone === ph; })[0] || {};
      var d0 = c0.draft || {};
      liveOpen = liveOpen === ph ? null : ph;
      livePick = { outcomes: (d0.outcomes || []).slice(), days: d0.days !== undefined ? d0.days : 0 };
      liveVals = { liveOp: d0.userId, liveName: d0.name, liveHeard: d0.heardFrom, liveProduct: d0.productNote, liveNote: d0.note };
      lastKeys = "";
      var show = function () { if (lastLive) renderLive(lastLive); liveRestore(); };
      if (A.loadCallOperators) A.loadCallOperators().then(show, show); else show();
      return;
    }
    if (e.target.closest("[data-live-cancel]")) { liveOpen = null; liveVals = {}; lastKeys = ""; if (lastLive) renderLive(lastLive); return; }
    var un = e.target.closest("[data-live-unpick]");
    if (un) {
      var code = un.getAttribute("data-live-unpick");
      livePick.outcomes = livePick.outcomes.filter(function (x) { return x !== code; });
      liveRedraw();
      return;
    }
    var dy = e.target.closest("[data-live-day]");
    if (dy) { livePick.days = Number(dy.getAttribute("data-live-day")); liveRedraw(); return; }
    var sv = e.target.closest("[data-live-save]");
    if (!sv) return;
    if (!livePick.outcomes.length) return toast("نتیجه‌ی تماس را از منوی کشویی انتخاب کنید", true);
    var v = function (id) { return $(id) ? $(id).value.trim() : ""; };
    sv.disabled = true;
    api("/workdesk/live-calls/draft", {
      method: "POST",
      body: {
        phone: sv.getAttribute("data-live-save"),
        operatorUserId: v("liveOp"),
        name: v("liveName"),
        heardFrom: v("liveHeard"),
        productNote: v("liveProduct"),
        outcomes: livePick.outcomes,
        note: v("liveNote"),
        days: livePick.days,
      },
    })
      .then(function (r) {
        toast(r && r.applied ? "تماس ثبت شد" : "ثبت شد — به‌محض پایان تماس روی پرونده می‌نشیند");
        liveOpen = null; liveVals = {}; lastKeys = "";
        loadLive();
        if (A.state.activeTab === "calls" && A.fetchCalls) A.fetchCalls();
        if (A.state.activeTab === "consultant") load();
      })
      .catch(function (err) { toast(err.message, true); sv.disabled = false; });
  });

  $("panel-consultant").addEventListener("click", function (e) {
    var fd = e.target.closest("[data-md-fudel]");
    if (fd) {
      var row = fd.closest(".md-row"), nm = row && row.querySelector(".md-name");
      if (!window.confirm("پیگیری «" + (nm ? nm.textContent : "") + "» حذف شود؟")) return;
      fd.disabled = true;
      api("/workdesk/leads/" + fd.getAttribute("data-md-fudel") + "/next-followup", { method: "POST", body: { remove: true } })
        .then(function () { toast("پیگیری حذف شد"); if (row) row.remove(); load(); })
        .catch(function (err) { toast(err.message, true); fd.disabled = false; });
      return;
    }
    var lead = e.target.closest("[data-md-lead]");
    if (lead) { A.openLeadModal(lead.getAttribute("data-md-lead")); return; }
    var tel = e.target.closest("a.md-phone");
    if (tel) return;   // کلیک روی شماره دیگر «تماس در جریان» نمی‌سازد (تصمیم کاربر ۱۴۰۵/۰۸/۱۲)
    var op = e.target.closest("[data-md-open]");
    if (op) {
      var id = op.getAttribute("data-md-open");
      var wasOpen = open === id;
      var row0 = (data.rows.concat(data.done)).filter(function (x) { return x.id === id; })[0];
      open = wasOpen ? null : id;
      pick = { result: "", next: "", days: 3 };
      render();
      return;
    }
    if (e.target.closest("[data-md-cancel]")) {
      var cur = data && (data.rows.concat(data.done)).filter(function (x) { return x.id === open; })[0];
      open = null; render(); return;
    }
    var res = e.target.closest("[data-md-result]");
    if (res) {
      pick.result = res.getAttribute("data-md-result");
      var d = Number(res.getAttribute("data-md-days"));
      if (d > 0) pick.days = d;
      if (!pick.next) pick.next = pick.result === "irrelevant" ? "close" : "followup";
      var note = $("mdNote") ? $("mdNote").value : "";
      render();
      if ($("mdNote")) $("mdNote").value = note;
      return;
    }
    var nx = e.target.closest("[data-md-next]");
    if (nx) {
      pick.next = nx.getAttribute("data-md-next");
      var n2 = $("mdNote") ? $("mdNote").value : "";
      render();
      if ($("mdNote")) $("mdNote").value = n2;
      return;
    }
    var dy = e.target.closest("[data-md-day]");
    if (dy) {
      pick.days = Number(dy.getAttribute("data-md-day"));
      var n3 = $("mdNote") ? $("mdNote").value : "";
      render();
      if ($("mdNote")) $("mdNote").value = n3;
      return;
    }
    if (e.target.closest("[data-md-nonext]")) { view = view === "nonext" ? "" : "nonext"; open = null; load(); return; }
    var sv = e.target.closest("[data-md-save]");
    if (!sv) return;
    var row = data.rows.filter(function (x) { return x.id === sv.getAttribute("data-md-save"); })[0];
    if (!row) return;
    if (!pick.result) return err("اول بگویید چه شد");
    if (!pick.next) return err("قدم بعدی را انتخاب کنید");
    var text = $("mdNote").value.trim();
    if (pick.next === "close" && !text) return err("دلیل بستن پرونده را بنویسید");
    // فروش به مشتری احراز‌نشده: ممنوع نیست، ولی دلیلش اجباری است
    if (pick.next === "bought" && row.kyc && row.kyc !== "approved" && !text) {
      return err("این مشتری احراز نشده است؛ در توضیح، دلیل ثبت فروش را بنویسید (قیمت آزاد / مشتری قدیمی / مدارکش در راه است)");
    }
    err("");
    sv.disabled = true;
    api("/workdesk/mydesk/act", {
      method: "POST",
      body: { callId: row.callId || "", leadId: row.leadId || "", name: row.name || "", result: pick.result, note: text, next: pick.next, days: pick.days },
    })
      .then(function (r) { toast(r.message || "ثبت شد"); open = null; load(); A.refreshLeadLists(); })
      .catch(function (e2) { err(e2.message); sv.disabled = false; });
  });

  $("mdKinds").addEventListener("click", function (e) {
    var b = e.target.closest("[data-md-kind]");
    if (!b) return;
    kind = b.getAttribute("data-md-kind");
    try { localStorage.setItem("mdKind", kind); } catch (e2) { /* بدون حافظه‌ی مرورگر هم کار می‌کند */ }
    open = null;
    render();
  });
  $("mdDays").addEventListener("change", load);
  var qt = null;
  $("mdQ").addEventListener("input", function () { clearTimeout(qt); qt = setTimeout(load, 350); });

  window.CrmMyDesk = {
    place: placeLive,
    load: function () { load(); loadLive(); placeLive(); },
    stop: function () { clearTimeout(timer); },
  };
  loadLive();  // نوار «روی خط» از همان ابتدا و در هر صفحه‌ای
  openStream();
})();
