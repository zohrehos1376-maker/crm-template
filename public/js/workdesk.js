// «میز کار مشاور» CRM نمونه — صفحه‌های میز کار امروز، وظیفه‌ها، صف بدون مسئول، احراز همکاری،
// گزارش به مدیر فروش، اقدامات مشاوران، تنظیم جمله‌ها/پیامک‌ها، و بخش «کار روی این مشتری» در پرونده.
// از امکانات app.js از طریق window.CrmApp استفاده می‌کند.
(function () {
  "use strict";
  var A = window.CrmApp;
  if (!A) return;
  var api = A.api, esc = A.esc, toast = A.toast, can = A.can, $ = A.$;
  var fa = function (v) { return Jalali.toFaDigits(String(v)); };
  var money = function (n) { return n ? fa(Number(n).toLocaleString("en-US")) + " تومان" : "—"; };
  var dt = function (ms) { return ms ? A.fmtDateTime(ms) : "—"; };

  var opts = null, staff = null;
  function options() {
    if (opts) return Promise.resolve(opts);
    return api("/workdesk/options").then(function (r) { opts = r; return r; });
  }
  function loadStaff() {
    if (staff) return Promise.resolve(staff);
    return api("/workdesk/staff").then(function (r) { staff = r.staff || []; return staff; });
  }
  function labelOf(list, code) { var x = (list || []).find(function (i) { return i.code === code; }); return x ? x.label : code || ""; }
  function empty(t) { return '<div class="empty-state" style="padding:18px;text-align:center;color:var(--ink-faint);">' + esc(t) + "</div>"; }
  function table(head, rows) {
    return '<div class="table-scroll"><table><thead><tr>' + head.map(function (h) { return "<th>" + esc(h) + "</th>"; }).join("") +
      "</tr></thead><tbody>" + rows.join("") + "</tbody></table></div>";
  }
  function leadLink(id, name) { return id ? '<span class="call-lead" data-wd-lead="' + esc(id) + '">' + esc(name || "بدون نام") + "</span>" : esc(name || "—"); }
  var KYC_TONE = { none: "", awaiting: "tag-warn", pending: "tag-outcome", approved: "tag-ok", rejected: "tag-warn" };
  function kycTag(code, label) { return '<span class="tag ' + (KYC_TONE[code] || "") + '">' + esc(label || code) + "</span>"; }
  function copyText(t) {
    if (navigator.clipboard && window.isSecureContext) return navigator.clipboard.writeText(t).then(function () { toast("متن کپی شد"); });
    var ta = document.createElement("textarea");
    ta.value = t; document.body.appendChild(ta); ta.select();
    try { document.execCommand("copy"); toast("متن کپی شد"); } catch (e) { toast("کپی ممکن نشد؛ متن را انتخاب و کپی کنید", true); }
    document.body.removeChild(ta);
    return Promise.resolve();
  }
  // متن پیامک/لینک: اگر پنل پیامک فرستاد، تأیید نشان داده می‌شود؛ در هر حال متن آماده با دکمه‌ی
  // کپی (برای بله و هر پیام‌رسان دیگر)، واتساپ، تلگرام و پیامک از گوشی هم هست.
  function smsResultHtml(r, phone) {
    if (!r) return "";
    var body = r.body || "";
    var p = String(phone || r.phone || "").replace(/^0/, "98");
    var head = r.status === "sent" ? '<div class="hint" style="color:var(--st-won-fg)">✓ پیامک فرستاده شد. اگر لازم است، از راه دیگری هم بفرستید:</div>'
      : '<div class="hint">' + (r.status === "failed" ? "پیامک فرستاده نشد (" + esc(r.error || "") + ")؛ " : "") + "این متن را از بله، واتساپ، تلگرام یا پیامک برای مشتری بفرستید:</div>";
    return '<div class="wd-manual">' + head + '<pre class="wd-pre">' + esc(body) + "</pre>" +
      '<button type="button" class="btn btn-primary btn-sm" data-wd-copy="' + esc(body) + '">کپی متن (برای بله و …)</button> ' +
      '<a class="btn btn-ghost btn-sm" target="_blank" rel="noopener" href="https://wa.me/' + esc(p) + "?text=" + encodeURIComponent(body) + '">واتساپ</a> ' +
      '<a class="btn btn-ghost btn-sm" target="_blank" rel="noopener" href="https://t.me/share/url?url=' + encodeURIComponent(r.link || "") + "&text=" + encodeURIComponent(body) + '">تلگرام</a> ' +
      '<a class="btn btn-ghost btn-sm" href="sms:' + esc(phone || r.phone || "") + "?body=" + encodeURIComponent(body) + '">پیامک از گوشی</a></div>';
  }
  document.addEventListener("click", function (e) {
    var c = e.target.closest("[data-wd-copy]");
    if (c) { copyText(c.getAttribute("data-wd-copy")); return; }
    var l = e.target.closest("[data-wd-lead]");
    if (l) A.openLeadModal(l.getAttribute("data-wd-lead"));
  });

  // تاریخ: میان‌برها + تایپ شمسی؛ ساعت پیش‌فرض ۱۰ صبح
  function dateField(id) {
    return '<div class="cg-quick" data-wd-dq="' + id + '">' +
      '<button type="button" class="btn btn-ghost btn-sm" data-d="0">امروز</button>' +
      '<button type="button" class="btn btn-ghost btn-sm" data-d="1">فردا</button>' +
      '<button type="button" class="btn btn-ghost btn-sm" data-d="3">۳ روز دیگر</button>' +
      '<button type="button" class="btn btn-ghost btn-sm" data-d="7">هفته بعد</button></div>' +
      '<input type="text" id="' + id + '" inputmode="numeric" placeholder="۱۴۰۵/۰۸/۰۵">';
  }
  document.addEventListener("click", function (e) {
    var b = e.target.closest("[data-wd-dq] [data-d]");
    if (!b) return;
    var d = new Date();
    d.setDate(d.getDate() + Number(b.getAttribute("data-d")));
    $(b.closest("[data-wd-dq]").getAttribute("data-wd-dq")).value = Jalali.formatDate(d, { faDigits: true });
  });
  function readDate(id, hour) {
    var raw = $(id).value.trim();
    if (!raw) return null;
    var d = Jalali.parseDate(raw);
    if (!d) return NaN;
    d.setHours(hour || 10, 0, 0, 0);
    return d.getTime();
  }

  // ================= میز کار امروز =================
  function loadWorkdesk() {
    api("/workdesk/today").then(function (t) {
      var cards = [
        { k: "phone", tone: t.unlogged ? "warn" : "info", label: "تماس ثبت‌نشده", n: t.unlogged, tab: "calls", foot: "نتیجه‌ی تماس را با کلیک ثبت کنید" },
        { k: "overdue", tone: t.missed ? "danger" : "info", label: "بی‌پاسخ بدون تماس برگشتی", n: t.missed, tab: "calls", alert: t.missed > 0, foot: "در ساعت کاری با این‌ها تماس بگیرید" },
        { k: "won", tone: t.tasksOverdue ? "danger" : "info", label: "وظیفه‌ی باز", n: t.tasksOpen, tab: "tasks", alert: t.tasksOverdue > 0, foot: t.tasksOverdue ? fa(t.tasksOverdue) + " مورد سررسید گذشته" : "سررسید گذشته ندارید" },
        { k: "users", tone: t.queue ? "warn" : "info", label: "صف بدون مسئول", n: t.queue, tab: "queue", foot: "ورودی‌های فرم سایت" },
        { k: "target", tone: t.kycPending ? "warn" : "info", label: "احراز در انتظار بررسی", n: t.kycPending, tab: "forms", foot: "مدارک همکاران" },
        { k: "message", tone: "info", label: t.reportsMode === "open" ? "گزارش در انتظار رسیدگی" : "پاسخ تازه‌ی مدیر فروش", n: t.reports, tab: "reports", foot: "گزارش به مدیر فروش" },
      ];
      $("wdCards").innerHTML = cards.map(function (c) {
        return '<button type="button" class="wd-card-btn" data-wd-tab="' + c.tab + '">' + A.kpiCardHtml({ k: c.k, tone: c.tone, label: c.label, n: fa(c.n), foot: c.foot, alert: c.alert }) + "</button>";
      }).join("");
    }).catch(function (e) { toast(e.message, true); });
    api("/workdesk/tasks?status=open").then(function (r) {
      var mine = (r.tasks || []).filter(function (t) { return t.assigneeId === A.state.user.id; }).slice(0, 15);
      $("wdTasks").innerHTML = mine.length ? taskTable(mine) : empty("وظیفه‌ی بازی ندارید");
    });    loadWaiting();
    scripts("script").then(function (list) { wdScriptList = list; renderScripts(); }).catch(function () {});
  }

  // «منتظر پاسخ»: سن هر ورودی؛ بعد از ۳۰ دقیقه قرمز. «تماس گرفتم» = تماس برگشتی ثبت شد، «برمی‌دارم» = مسئول شدن.
  var waitTimer = null;
  function loadWaiting() {
    api("/workdesk/waiting").then(function (r) {
      var now = Date.now();
      $("wdWaitCount").textContent = r.items.length ? "(" + fa(r.items.length) + ")" : "";
      $("wdWait").innerHTML = r.items.length ? r.items.map(function (x) {
        var min = Math.max(0, Math.round((now - x.at) / 60000));
        var age = min < 60 ? fa(min) + " دقیقه" : min < 1440 ? fa(Math.floor(min / 60)) + " ساعت" : fa(Math.floor(min / 1440)) + " روز";
        var src = x.type === "missed" ? '<span class="wait-src missed">📞 تماس بی‌پاسخ' + (x.count > 1 ? " ×" + fa(x.count) : "") + "</span>"
          : /وردست|اینستاگرام/.test(x.channel) ? '<span class="wait-src vardast">💬 وردست</span>' : '<span class="wait-src form">🌐 فرم سایت</span>';
        var act = x.type === "missed"
          ? '<a class="btn btn-ghost btn-sm" href="tel:' + esc(x.phone) + '">تماس</a><button type="button" class="btn btn-primary btn-sm" data-wait-log="' + esc(x.id) + '">زنگ زدم — ثبت مکالمه</button>'
          : '<button type="button" class="btn btn-primary btn-sm" data-qu-claim="' + esc(x.id) + '">برمی‌دارم</button>';
        return '<div class="wait-row' + (min >= r.lateMinutes ? " late" : "") + '">' + src + '<span class="wait-age">' + age + "</span>" +
          (x.leadId ? leadLink(x.leadId, x.name || x.phone) : "<b>" + esc(x.name || "بدون نام") + "</b>") +
          ' <span class="cell-sub" dir="ltr">' + esc(fa(x.phone || "")) + '</span><span class="wait-act">' + act + "</span></div>";
      }).join("") : empty("همه‌ی ورودی‌ها پاسخ گرفته‌اند 👌");
      clearTimeout(waitTimer);
      waitTimer = setTimeout(function () { if (A.state.activeTab === "workdesk") loadWaiting(); }, 60000);
    }).catch(function (e) { $("wdWait").innerHTML = empty(e.message); });
  }
  // «زنگ زدم» فرم ثبت تماس را باز می‌کند: متن مکالمه نوشته و پرونده ساخته می‌شود
  document.addEventListener("click", function (e) {
    var b = e.target.closest("[data-wait-log]");
    if (!b) return;
    b.disabled = true;
    api("/calls/" + b.getAttribute("data-wait-log"))
      .then(function (r) { A.openCallLog(r.call); })
      .catch(function (err) { toast(err.message, true); })
      .finally(function () { b.disabled = false; });
  });

  // جمله‌های آماده جلوی چشم کارشناس (فقط در میز کار؛ تعریف در تنظیمات)
  var wdScriptList = [];
  function renderScripts() {
    var q = ($("wdScriptQ").value || "").trim();
    var list = wdScriptList.filter(function (x) { return !q || (x.title + " " + x.body).indexOf(q) !== -1; });
    var isNew = q && !wdScriptList.some(function (x) { return x.body === q || x.title === q; });
    $("wdScripts").innerHTML = list.length ? list.map(function (x) {
      return '<div class="wd-script"><b>' + esc(x.title) + '</b><div class="call-note">' + esc(x.body) + '</div><button type="button" class="btn btn-ghost btn-sm" data-wd-copy="' + esc(x.body) + '">کپی</button></div>';
    }).join("") + (isNew ? '<div class="wd-script-new"><button type="button" class="btn btn-ghost btn-sm" data-wd-script-add="' + esc(q) + '">➕ ذخیره «' + esc(q) + '» به جمله‌های آماده</button></div>' : '')
    : (isNew ? '<div class="wd-script-new"><button type="button" class="btn btn-ghost btn-sm" data-wd-script-add="' + esc(q) + '">➕ ذخیره «' + esc(q) + '» به جمله‌های آماده</button></div>'
    : '<div class="hint">' + (wdScriptList.length ? "جمله‌ای پیدا نشد." : "هنوز جمله‌ای تعریف نشده؛ از «تنظیمات ← جمله‌های آماده‌ی فروش» اضافه کنید.") + "</div>");
  }
  $("wdScriptQ").addEventListener("input", renderScripts);
  document.addEventListener("click", function (e) {
    var b = e.target.closest("[data-wd-script-add]");
    if (!b) return;
    var text = b.getAttribute("data-wd-script-add");
    wdScriptList.push({ title: text, body: text });
    renderScripts();
    api("/workdesk/scripts/quick", { method: "POST", body: { kind: "script", title: text, body: text } })
      .then(function (r) { if (r && r.script) wdScriptList[wdScriptList.length - 1].id = r.script.id; })
      .catch(function () { toast("ذخیره نشد", true); });
    if ($("wdScriptQ")) { $("wdScriptQ").value = ""; renderScripts(); }
    toast("جمله به لیست اضافه شد");
  });
  document.addEventListener("click", function (e) {
    if (e.target.id !== "wdScriptAdd") return;
    var q = ($("wdScriptQ").value || "").trim();
    if (!q) { $("wdScriptQ").focus(); toast("ابتدا جمله را در کادر جستجو تایپ کنید", true); return; }
    var text = q;
    wdScriptList.push({ title: text, body: text });
    renderScripts();
    api("/workdesk/scripts/quick", { method: "POST", body: { kind: "script", title: text, body: text } })
      .then(function (r) { if (r && r.script) wdScriptList[wdScriptList.length - 1].id = r.script.id; })
      .catch(function () { toast("ذخیره نشد", true); });
    $("wdScriptQ").value = "";
    renderScripts();
    toast("جمله به لیست اضافه شد");
  });
  document.addEventListener("click", function (e) {
    var b = e.target.closest("[data-wd-tab]");
    if (b) A.switchTab(b.getAttribute("data-wd-tab"));
  });

  // ================= وظیفه‌ها =================
  var tkStatus = "open";
  function taskTable(list) {
    return table(["موعد", "موضوع", "مشتری", "شرح", "مسئول", ""], list.map(function (t) {
      return "<tr>" +
        '<td class="club-date">' + esc(dt(t.dueAt)) + (t.overdue ? '<div><span class="tag tag-warn">سررسید گذشته</span></div>' : "") + "</td>" +
        "<td>" + esc(t.topicLabel) + "</td>" +
        "<td>" + leadLink(t.leadId, t.leadName) + '<div class="cell-sub">' + esc(t.leadPhone || "") + "</div></td>" +
        '<td class="call-note">' + esc(t.note || "—") + "</td>" +
        "<td>" + esc(t.assigneeName) + "</td>" +
        "<td>" + (t.status === "open"
          ? '<button type="button" class="btn btn-primary btn-sm" data-tk-done="' + esc(t.id) + '">انجام شد</button>'
          : '<span class="cell-sub">✓ ' + esc(dt(t.doneAt)) + '</span> <button type="button" class="btn btn-ghost btn-sm" data-tk-open="' + esc(t.id) + '">بازگشایی</button>') +
        "</td></tr>";
    }));
  }
  function loadTasks() {
    if (can("all_leads")) {
      $("tkAssignee").hidden = false;
      loadStaff().then(function (s) {
        if ($("tkAssignee").options.length <= 1) $("tkAssignee").insertAdjacentHTML("beforeend", s.map(function (u) { return '<option value="' + esc(u.id) + '">' + esc(u.fullName) + "</option>"; }).join(""));
      });
    }
    var q = "?status=" + tkStatus + ($("tkAssignee").value ? "&assigneeId=" + encodeURIComponent($("tkAssignee").value) : "");
    api("/workdesk/tasks" + q).then(function (r) {
      $("tkList").innerHTML = r.tasks.length ? taskTable(r.tasks) : empty("وظیفه‌ای نیست");
    }).catch(function (e) { toast(e.message, true); });
  }
  $("tkFilter").addEventListener("click", function (e) {
    var b = e.target.closest("[data-st]");
    if (!b) return;
    tkStatus = b.getAttribute("data-st");
    Array.prototype.forEach.call($("tkFilter").children, function (x) { x.classList.toggle("active", x === b); });
    loadTasks();
  });
  $("tkAssignee").addEventListener("change", loadTasks);
  document.addEventListener("click", function (e) {
    var b = e.target.closest("[data-tk-done],[data-tk-open]");
    if (!b) return;
    var id = b.getAttribute("data-tk-done") || b.getAttribute("data-tk-open");
    api("/workdesk/tasks/" + id, { method: "PATCH", body: { done: b.hasAttribute("data-tk-done") } })
      .then(function () {
        toast(b.hasAttribute("data-tk-done") ? "وظیفه انجام شد" : "وظیفه باز شد");
        if (A.state.activeTab === "tasks") loadTasks();
        if (A.state.activeTab === "workdesk") loadWorkdesk();
        if (A.state.activeTab === "manager") loadManager();
        if (curLead) openPane(curPane, true);
      })
      .catch(function (err) { toast(err.message, true); });
  });

  // ================= صف بدون مسئول =================
  function loadQueue() {
    api("/workdesk/queue").then(function (r) {
      $("quList").innerHTML = r.leads.length ? table(["ورود", "مشتری", "فروشگاه / شهر", "منبع", "احراز", ""], r.leads.map(function (l) {
        return "<tr>" +
          '<td class="club-date">' + esc(dt(l.createdAt)) + "</td>" +
          "<td>" + leadLink(l.id, l.name) + '<div class="cell-sub">' + esc(l.phone) + "</div></td>" +
          "<td>" + esc([l.shopName, l.city, l.jobType].filter(Boolean).join(" · ") || "—") + "</td>" +
          "<td>" + esc(l.channel || "—") + "</td>" +
          "<td>" + kycTag(l.kycStatus, labelOf(opts && opts.kycStatuses, l.kycStatus)) + "</td>" +
          '<td><button type="button" class="btn btn-primary btn-sm" data-qu-claim="' + esc(l.id) + '">برداشتن</button></td></tr>';
      })) : empty("صف خالی است");
    }).catch(function (e) { toast(e.message, true); });
  }
  document.addEventListener("click", function (e) {
    var b = e.target.closest("[data-qu-claim]");
    if (!b) return;
    b.disabled = true;
    api("/workdesk/leads/" + b.getAttribute("data-qu-claim") + "/claim", { method: "POST" })
      .then(function () { toast("مسئول این مشتری شدید"); if (A.state.activeTab === "workdesk") loadWorkdesk(); else loadQueue(); A.refreshLeadLists(); })
      .catch(function (err) { toast(err.message, true); b.disabled = false; });
  });

  // ================= گزارش به مدیر فروش =================
  function reportDetails(r) {
    var d = r.details || {};
    if (r.kind === "no_purchase") return "علت: " + esc(r.reasonLabel || "—") + (d.product ? " · " + esc(d.product) : "");
    if (r.kind === "competitor_price") return esc(d.product || "") + "<div class=\"cell-sub\">قیمت ما " + money(d.ourPrice) + " · " + esc(d.competitor || "رقیب") + " " + money(d.competitorPrice) + "</div>";
    if (r.kind === "out_of_stock") return esc(d.product || "") + (d.quantity ? " · " + fa(d.quantity) + " عدد" : "");
    if (r.kind === "complaint") return esc(d.subject || "");
    return "";
  }
  function reportRows(list, withLead) {
    return list.map(function (r) {
      var resolve = r.status === "open" && can("sales_reports")
        ? '<div class="wd-resolve"><textarea rows="2" id="rs_' + esc(r.id) + '" placeholder="نتیجه، اقدام یا پاسخ به مشاور…"></textarea><button type="button" class="btn btn-primary btn-sm" data-rp-resolve="' + esc(r.id) + '">ثبت نتیجه</button></div>'
        : "";
      return "<tr>" +
        '<td class="club-date">' + esc(dt(r.createdAt)) + "</td>" +
        '<td><span class="tag tag-outcome">' + esc(r.kindLabel) + "</span></td>" +
        (withLead ? "<td>" + leadLink(r.leadId, r.leadName) + '<div class="cell-sub">' + esc(r.phone) + "</div></td>" : "") +
        "<td>" + reportDetails(r) + (r.note ? '<div class="call-note">' + esc(r.note) + "</div>" : "") + "</td>" +
        "<td>" + esc(r.createdByName) + "</td>" +
        "<td>" + (r.status === "resolved"
          ? '<span class="tag tag-ok">رسیدگی‌شده</span><div class="call-note">' + esc(r.resolution) + '</div><div class="cell-sub">' + esc(r.reviewedByName) + " · " + esc(dt(r.reviewedAt)) + "</div>"
          : '<span class="tag tag-warn">در انتظار رسیدگی</span>' + resolve) +
        "</td></tr>";
    });
  }
  function loadReports() {
    if ($("rpKind").options.length <= 1) $("rpKind").insertAdjacentHTML("beforeend", opts.reportKinds.map(function (k) { return '<option value="' + k.code + '">' + esc(k.label) + "</option>"; }).join(""));
    var q = "?kind=" + encodeURIComponent($("rpKind").value) + "&status=" + encodeURIComponent($("rpStatus").value);
    api("/workdesk/sales-reports" + q).then(function (r) {
      $("rpList").innerHTML = r.reports.length ? table(["زمان", "نوع", "مشتری", "جزئیات", "مشاور", "رسیدگی"], reportRows(r.reports, true)) : empty("گزارشی با این فیلترها ثبت نشده است");
    }).catch(function (e) { toast(e.message, true); });
  }
  $("rpKind").addEventListener("change", loadReports);
  $("rpStatus").addEventListener("change", loadReports);
  document.addEventListener("click", function (e) {
    var b = e.target.closest("[data-rp-resolve]");
    if (!b) return;
    var id = b.getAttribute("data-rp-resolve");
    api("/workdesk/sales-reports/" + id + "/resolve", { method: "POST", body: { resolution: $("rs_" + id).value } })
      .then(function () { toast("نتیجه‌ی رسیدگی ثبت شد"); if (A.state.activeTab === "reports") loadReports(); if (A.state.activeTab === "manager") loadManager(); if (curLead) openPane(curPane, true); })
      .catch(function (err) { toast(err.message, true); });
  });

  // ================= اقدامات مشاوران =================
  var acDays = 7;
  function acQuery() {
    var to = Date.now();
    var from = new Date();
    from.setHours(0, 0, 0, 0);
    from.setDate(from.getDate() - (acDays - 1));
    return "?from=" + from.getTime() + "&to=" + to + ($("acUser").value ? "&userId=" + encodeURIComponent($("acUser").value) : "");
  }
  function loadActivity() {
    if (!can("activity_report")) { $("acWrap").hidden = true; return; }
    $("acWrap").hidden = false;
    loadStaff().then(function (s) {
      if ($("acUser").options.length <= 1) $("acUser").insertAdjacentHTML("beforeend", s.map(function (u) { return '<option value="' + esc(u.id) + '">' + esc(u.fullName) + "</option>"; }).join(""));
    });
    var q = acQuery();
    api("/workdesk/activity/summary" + q).then(function (r) {
      $("acSummary").innerHTML = r.rows.length ? table(["مشاور", "تماس جواب‌داده", "تماس ثبت‌شده", "کل اقدامات", "وظیفه‌ی انجام‌شده", "گزارش به مدیر", "تأیید احراز", "رد احراز", "پیامک"], r.rows.map(function (x) {
        return "<tr><td><b>" + esc(x.name) + "</b></td><td>" + fa(x.callsAnswered) + "</td><td>" + fa(x.callsLogged) + "</td><td>" + fa(x.actions) + "</td><td>" + fa(x.tasksDone) + "</td><td>" + fa(x.reports) + "</td><td>" + fa(x.kycApproved) + "</td><td>" + fa(x.kycRejected) + "</td><td>" + fa(x.sms) + "</td></tr>";
      })) : empty("در این بازه فعالیتی ثبت نشده است");
    }).catch(function (e) { toast(e.message, true); });
    api("/workdesk/activity/log" + q + "&limit=300").then(function (r) {
      $("acLog").innerHTML = r.rows.length ? table(["زمان", "مشاور", "اقدام", "مشتری", "توضیح", ""], r.rows.map(function (x) {
        return '<tr><td class="club-date">' + esc(dt(x.createdAt)) + "</td><td>" + esc(x.userName) + "</td><td>" + esc(x.actionLabel) + "</td><td>" + leadLink(x.leadId, x.leadName) + '<div class="cell-sub">' + esc(x.phone) + "</div></td><td>" + changesHtml(x) + "</td>" +
          (x.leadId ? '<td><button type="button" class="btn btn-ghost btn-sm" data-ac-ask="' + esc(x.leadId) + '" data-ac-name="' + esc(x.leadName || "") + '">درخواست پیگیری</button></td>' : "<td></td>") + "</tr>";
      })) : empty("اقدامی ثبت نشده است");
    });
  }
  $("acRange").addEventListener("click", function (e) {
    var b = e.target.closest("[data-d]");
    if (!b) return;
    acDays = Number(b.getAttribute("data-d"));
    Array.prototype.forEach.call($("acRange").children, function (x) { x.classList.toggle("active", x === b); });
    loadActivity();
  });
  $("acUser").addEventListener("change", loadActivity);
  $("acExcel").addEventListener("click", function () { window.location.href = "/api/v1/workdesk/activity/excel" + acQuery(); });

  // ---- «درخواست پیگیری» مدیر فروش روی یک اقدام ----
  // مدیر روی اقدام‌ها نظر نمی‌دهد و تأیید/رد نمی‌کند؛ بیشتر اقدام‌ها هیچ کاری لازم ندارند.
  // فقط گاهی می‌خواهد همان کار دوباره پیگیری شود — همان «وظیفه»ی موجود ساخته می‌شود
  // (به نام مدیر، برای همان کارشناس یا کس دیگر) تا کار دو جا ثبت نشود.
  var askLead = null;
  document.addEventListener("click", function (e) {
    var b = e.target.closest("[data-ac-ask]");
    if (b) { openAsk(b.getAttribute("data-ac-ask"), b.getAttribute("data-ac-name"), b); return; }
    if (e.target.id === "ac_ask_cancel") { closeAsk(); return; }
    if (e.target.id !== "ac_ask_save") return;
    var due = readDate("ac_ask_due", 10);
    if (!due || isNaN(due)) { toast("موعد را به شکل ۱۴۰۵/۰۸/۰۵ بنویسید", true); return; }
    e.target.disabled = true;
    api("/workdesk/leads/" + askLead + "/tasks", {
      method: "POST",
      body: { topic: "manager_followup", dueAt: due, note: $("ac_ask_note").value, assigneeId: $("ac_ask_who").value },
    }).then(function () { toast("درخواست پیگیری برای کارشناس فرستاده شد"); closeAsk(); })
      .catch(function (err) { toast(err.message, true); e.target.disabled = false; });
  });
  function closeAsk() { askLead = null; var box = $("acAsk"); if (box) { box.hidden = true; box.innerHTML = ""; } }
  function openAsk(leadId, leadName, btn) {
    askLead = leadId;
    var box = $("acAsk");
    box.hidden = false;
    box.innerHTML = '<div class="hint">در حال دریافت…</div>';
    loadStaff().then(function (st) {
      if (askLead !== leadId) return;
      box.innerHTML =
        '<div class="ask-head">درخواست پیگیری — <b>' + esc(leadName || "") + "</b></div>" +
        '<div class="ask-row">' +
        '<div class="field"><label>به عهدهٔ</label><select id="ac_ask_who">' +
        st.map(function (u) { return '<option value="' + esc(u.id) + '">' + esc(u.fullName) + "</option>"; }).join("") + "</select></div>" +
        '<div class="field"><label>موعد</label>' + dateField("ac_ask_due") + "</div>" +
        "</div>" +
        '<div class="field"><label>چه کاری انجام شود؟</label><input type="text" id="ac_ask_note" placeholder="مثلاً: دوباره تماس بگیر و نتیجه را بنویس"></div>' +
        '<button type="button" class="btn btn-primary btn-sm" id="ac_ask_save">ارسال درخواست</button> ' +
        '<button type="button" class="btn btn-ghost btn-sm" id="ac_ask_cancel">انصراف</button>';
      box.scrollIntoView({ block: "nearest" });
      if (btn) btn.blur();
    }).catch(function (err) { toast(err.message, true); closeAsk(); });
  }

  function changesHtml(a) {
    var parts = [];
    if (a.summary) parts.push(esc(a.summary));
    (a.changes || []).forEach(function (c) { parts.push(esc(c.label) + ': <span class="cell-sub">' + esc(c.from) + "</span> ← <b>" + esc(c.to) + "</b>"); });
    return parts.join("<br>") || "—";
  }

  // ================= میز کار مدیر فروش =================
  var mgDays = 7, mgTimer = null, mgAuto = true, mgBranches = null;
  function mgRange() {
    var from = new Date();
    from.setHours(0, 0, 0, 0);
    from.setDate(from.getDate() - (mgDays - 1));
    return { from: from.getTime(), to: Date.now() };
  }
  function loadManager() {
    loadStaff().then(function (s) {
      if ($("mgUser").options.length <= 1) $("mgUser").insertAdjacentHTML("beforeend", s.map(function (u) { return '<option value="' + esc(u.id) + '">' + esc(u.fullName) + "</option>"; }).join(""));
    });
    if (!mgBranches) {
      mgBranches = api("/branches").then(function (b) {
        var list = b.branches || [];
        $("mgBranch").insertAdjacentHTML("beforeend", list.map(function (x) { return '<option value="' + esc(x.id) + '">' + esc(x.name) + "</option>"; }).join(""));
        $("mgBranch").hidden = list.length < 2; // با یک شعبه، فیلتر لازم نیست
      }).catch(function () { $("mgBranch").hidden = true; });
    }
    if ($("mgKind").options.length <= 1) $("mgKind").insertAdjacentHTML("beforeend", opts.reportKinds.map(function (k) { return '<option value="' + k.code + '">' + esc(k.label) + "</option>"; }).join(""));
    var r = mgRange(), u = $("mgUser").value, br = $("mgBranch").value;
    var q = "?from=" + r.from + "&to=" + r.to + (u ? "&userId=" + encodeURIComponent(u) : "") + (br ? "&branchId=" + encodeURIComponent(br) : "");
    api("/workdesk/manager" + q).then(function (d) {
      var k = d.kpis;
      $("mgCards").innerHTML = [
        { k: "phone", tone: "info", label: "تماس ثبت‌شده", n: k.calls, foot: "در بازه‌ی انتخابی" },
        { k: "message", tone: "info", label: "پیگیری ثبت‌شده", n: k.followups, foot: "تماس، پیام و حضوری" },
        { k: "board", tone: k.reportsOpen ? "warn" : "info", label: "گزارش‌های مشاوران", n: k.reports, foot: fa(k.reportsOpen) + " مورد در انتظار رسیدگی", alert: k.reportsOpen > 0 },
        { k: "overdue", tone: k.overdue ? "danger" : "info", label: "وظیفه‌ی عقب‌افتاده‌ی فعلی", n: k.overdue, foot: "وضعیت همین حالا", alert: k.overdue > 0 },
      ].map(function (c) { return A.kpiCardHtml({ k: c.k, tone: c.tone, label: c.label, n: fa(c.n), foot: c.foot, alert: c.alert }); }).join("");
      renderFunnel(d.funnel || []);
      $("mgKyc").innerHTML = [
        { k: "target", tone: d.kyc.pending ? "warn" : "info", label: "فرم در انتظار بررسی", n: d.kyc.pending, tab: "forms" },
        { k: "users", tone: "info", label: "پرونده‌ی دارای فرم و مدرک", n: d.kyc.forms, tab: "forms" },
        { k: "message", tone: "info", label: "لینک احراز فرستاده‌شده", n: d.kyc.links, tab: "forms" },
      ].map(function (c) { return '<button type="button" class="wd-card-btn" data-wd-tab="' + c.tab + '">' + A.kpiCardHtml({ k: c.k, tone: c.tone, label: c.label, n: fa(c.n), foot: "مشاهده‌ی ورودی‌های احراز" }) + "</button>"; }).join("");
      $("mgTeam").innerHTML = d.team.length ? table(["مشاور", "تماس", "پیگیری", "گزارش", "تأیید احراز", "عقب‌افتاده"], d.team.map(function (x) {
        return "<tr><td><b>" + esc(x.name) + "</b></td><td>" + fa(x.calls) + "</td><td>" + fa(x.followups) + "</td><td>" + fa(x.reports) + "</td><td>" + fa(x.kycApproved) + "</td><td>" +
          (x.overdue ? '<span class="tag tag-warn">' + fa(x.overdue) + "</span>" : "۰") + "</td></tr>";
      })) : empty("در این بازه فعالیتی ثبت نشده است");
      $("mgTasks").innerHTML = d.nextTasks.length ? taskTable(d.nextTasks) : empty("وظیفه‌ی بازی وجود ندارد");
      $("mgChecked").textContent = "آخرین به‌روزرسانی: " + dt(d.checkedAt) + (mgAuto ? " · خودکار هر ۶۰ ثانیه" : "");
    }).catch(function (e) { toast(e.message, true); });
    var rq = "?from=" + r.from + "&to=" + r.to + "&kind=" + encodeURIComponent($("mgKind").value) + "&status=" + encodeURIComponent($("mgStatus").value) + (u ? "&createdBy=" + encodeURIComponent(u) : br ? "&branchId=" + encodeURIComponent(br) : "");
    api("/workdesk/sales-reports" + rq).then(function (x) {
      $("mgReports").innerHTML = x.reports.length ? table(["زمان", "نوع", "مشتری", "جزئیات", "مشاور", "رسیدگی"], reportRows(x.reports, true)) : empty("گزارشی با این فیلترها ثبت نشده است");
    });
    clearTimeout(mgTimer);
    if (mgAuto) mgTimer = setTimeout(function () { if (A.state.activeTab === "manager" && !document.querySelector("#mgReports textarea:focus")) loadManager(); else if (A.state.activeTab === "manager") loadManagerLater(); }, 60000);
  }
  function loadManagerLater() { clearTimeout(mgTimer); mgTimer = setTimeout(loadManager, 60000); }
  $("mgRange").addEventListener("click", function (e) {
    var b = e.target.closest("[data-d]");
    if (!b) return;
    mgDays = Number(b.getAttribute("data-d"));
    Array.prototype.forEach.call($("mgRange").children, function (x) { x.classList.toggle("active", x === b); });
    loadManager();
  });
  ["mgBranch", "mgUser", "mgKind", "mgStatus"].forEach(function (id) { $(id).addEventListener("change", loadManager); });
  $("mgAuto").addEventListener("click", function () {
    mgAuto = !mgAuto;
    $("mgAuto").textContent = mgAuto ? "توقف به‌روزرسانی خودکار" : "ادامه‌ی به‌روزرسانی";
    loadManager();
  });
  $("mgScripts").addEventListener("click", function () {
    if (!can("scripts_admin")) { toast("ویرایش متن‌ها به دسترسی «مدیریت جمله‌های آماده» نیاز دارد", true); return; }
    A.state.settingsSection = "scripts";
    A.switchTab("settings");
  });

  // ================= تنظیمات: جمله‌های آماده و الگوهای پیامک =================
  function loadEditor(kind) {
    var fu = kind.indexOf("fu_") === 0;
    var box = $(kind === "sms" ? "smEditor" : kind === "script" ? "scEditor" : "fuEditor_" + kind);
    api("/workdesk/scripts?kind=" + kind + "&all=1").then(function (r) {
      var row = function (s) {
        var id = s ? s.id : "new";
        return '<div class="wd-script-edit" data-sc-id="' + id + '">' +
          '<div class="row2"><div class="field"><label>' + (fu ? "متن گزینه" : "عنوان") + '</label><input type="text" class="sc-title" value="' + esc(s ? s.title : "") + '"></div>' +
          (kind === "sms" ? '<div class="field"><label>موضوع (اختیاری)</label><input type="text" class="sc-topic" value="' + esc(s ? s.topic : "") + '" placeholder="مثلاً kyc_link"></div>' : "") + "</div>" +
          (fu ? "" : '<div class="field"><label>متن</label><textarea rows="3" class="sc-body">' + esc(s ? s.body : "") + "</textarea></div>") +
          '<label class="hint"><input type="checkbox" class="sc-active"' + (!s || s.isActive ? " checked" : "") + "> در دسترس مشاوران باشد</label> " +
          '<button type="button" class="btn btn-primary btn-sm" data-sc-save="' + kind + '">' + (s ? "ذخیره‌ی ویرایش" : "+ افزودن") + "</button></div>";
      };
      box.innerHTML = r.scripts.map(row).join("") + '<div class="hint">' + (fu ? "گزینه‌ی جدید" : "متن جدید") + "</div>" + row(null);
    }).catch(function (e) { toast(e.message, true); });
  }
  document.addEventListener("click", function (e) {
    var b = e.target.closest("[data-sc-save]");
    if (!b) return;
    var wrap = b.closest("[data-sc-id]");
    var id = wrap.getAttribute("data-sc-id");
    var kind = b.getAttribute("data-sc-save");
    var body = {
      kind: kind,
      title: wrap.querySelector(".sc-title").value,
      body: wrap.querySelector(".sc-body") ? wrap.querySelector(".sc-body").value : wrap.querySelector(".sc-title").value,
      topic: wrap.querySelector(".sc-topic") ? wrap.querySelector(".sc-topic").value : null,
      isActive: wrap.querySelector(".sc-active").checked,
    };
    api(id === "new" ? "/workdesk/scripts" : "/workdesk/scripts/" + id, { method: id === "new" ? "POST" : "PUT", body: body })
      .then(function () { toast("ذخیره شد"); scriptCache[kind] = null; loadEditor(kind); })
      .catch(function (err) { toast(err.message, true); });
  });
  var scriptCache = {};
  function scripts(kind) {
    if (scriptCache[kind]) return Promise.resolve(scriptCache[kind]);
    return api("/workdesk/scripts?kind=" + kind).then(function (r) { scriptCache[kind] = r.scripts; return r.scripts; });
  }

  // ================= پرونده‌ی مشتری: «کار روی این مشتری» =================
  var curLead = null, curPane = "";
  var PANES = [
    { id: "kyc", label: "احراز همکاری" },
    { id: "tasks", label: "وظیفه‌ها" },
    { id: "report", label: "گزارش به مدیر فروش" },
    { id: "sms", label: "پیامک" },
    { id: "owner", label: "مسئول پرونده", perm: "all_leads" },
  ];
  function onLead(lead) {
    curLead = lead;
    options().then(function () {
      var box = $("wdLead");
      box.innerHTML =
        // وضعیت احراز بالای پرونده در نوار خودش دیده می‌شود؛ اینجا تکرار نشود
        '<div class="wd-lead-head"><span class="cell-sub">مسئول: ' + esc(lead.ownerName || "—") + "</span></div>" +
        '<div class="wd-panes">' + PANES.filter(function (p) { return !p.perm || can(p.perm); }).map(function (p) {
          return '<button type="button" class="btn btn-ghost btn-sm" data-wd-pane="' + p.id + '">' + esc(p.label) + "</button>";
        }).join("") + '</div><div id="wdPane" class="wd-pane"></div>';
      curPane = "";
      // پرونده‌ی منتظر بررسی، مستقیم بخش احراز را باز می‌کند
      if (lead.kycStatus === "pending" && can("kyc_review")) openPane("kyc");
    });
  }
  $("wdLead").addEventListener("click", function (e) {
    var b = e.target.closest("[data-wd-pane]");
    if (b) openPane(b.getAttribute("data-wd-pane"));
  });
  function openPane(id, force) {
    if (!curLead) return;
    if (curPane === id && !force) { curPane = ""; $("wdPane").innerHTML = ""; mark(); return; }
    curPane = id;
    mark();
    var el = $("wdPane");
    el.innerHTML = '<div class="hint">در حال دریافت…</div>';
    ({ kyc: paneKyc, tasks: paneTasks, report: paneReport, sms: paneSms, scripts: paneScripts, history: paneHistory, owner: paneOwner }[id])(el, curLead);
  }
  function mark() {
    Array.prototype.forEach.call(document.querySelectorAll("[data-wd-pane]"), function (b) { b.classList.toggle("on", b.getAttribute("data-wd-pane") === curPane); });
  }
  function reloadLead() {
    api("/leads/" + curLead.id).then(function (r) { curLead = r.lead; onLead(r.lead); A.refreshLeadLists(); setTimeout(function () { openPane("kyc"); }, 50); });
  }

  // --- احراز ---
  function paneKyc(el, lead) {
    api("/workdesk/leads/" + lead.id + "/kyc/documents").then(function (r) {
      var s = lead.kycStatus;
      var docs = r.documents.map(function (d) {
        // مدرک فرم سایت روی خود سایت مانده و ما فقط آدرسش را داریم
        if (d.url) {
          var pic = /\.(jpe?g|png|webp|gif|bmp)$/i.test(d.url);
          return '<div class="wd-doc-link">' +
            (pic ? '<a target="_blank" rel="noopener noreferrer" href="' + esc(d.url) + '"><img class="wd-doc" src="' + esc(d.url) + '" alt="مدرک روی سایت" loading="lazy"></a>' : "") +
            '<a class="btn btn-ghost btn-sm" target="_blank" rel="noopener noreferrer" href="' + esc(d.url) + '">🔗 ' + esc(d.name || "باز کردن مدرک") + "</a>" +
            '<span class="hint" style="margin:0">روی سایت · ' + esc(dt(d.createdAt)) + "</span></div>";
        }
        var url = "/api/v1/workdesk/kyc/documents/" + d.id;
        if ((d.mime || "").indexOf("video/") === 0) return '<video class="wd-doc" controls preload="metadata" src="' + url + '"></video>';
        return d.mime === "application/pdf"
          ? '<a class="btn btn-ghost btn-sm" target="_blank" rel="noopener" href="' + url + '">📄 PDF · ' + esc(dt(d.createdAt)) + "</a>"
          : '<a target="_blank" rel="noopener" href="' + url + '" title="نمایش در اندازه‌ی اصلی"><img class="wd-doc" src="' + url + '?thumb=1" alt="مدرک ارسالی" loading="lazy"></a>';
      }).join("");
      var act = [];
      var send = can("kyc_send") || can("kyc_review");
      if (send && (s === "none" || s === "awaiting" || s === "rejected")) act.push('<button type="button" class="btn btn-primary btn-sm" data-ky-act="link">ارسال لینک احراز (پیامک، بله، واتساپ…)</button>');
      // یادآوری فقط وقتی معنی دارد که قبلاً لینکی فرستاده باشیم؛ لید فرم همکاری سایت خودش فرم را پر کرده
      if (send && r.linkSent && (s === "awaiting" || s === "rejected")) act.push('<button type="button" class="btn btn-ghost btn-sm" data-ky-act="remind">یادآوری تکمیل مشخصات</button>');
      if (can("kyc_review") && s === "pending") {
        act.push('<button type="button" class="btn btn-sm btn-sale" data-ky-act="approve">✓ تأیید نهایی مدارک</button>');
        act.push('<div class="field" style="margin-top:8px"><label>دلیل رد (برای مشتری پیامک می‌شود)</label><textarea rows="2" id="ky_reason"></textarea><button type="button" class="btn btn-sm btn-lost" data-ky-act="reject">✗ رد مدارک و ارسال پیامک اصلاح</button></div>');
      }
      if (can("kyc_review") && s === "approved") act.push('<div class="field"><label>دلیل لغو تأیید و بازگشایی</label><textarea rows="2" id="ky_reason"></textarea><button type="button" class="btn btn-ghost btn-sm" data-ky-act="reopen">لغو تأیید و بازگشت به بررسی</button></div>');
      el.innerHTML =
        '<dl class="kv"><dt>وضعیت</dt><dd>' + kycTag(s, labelOf(opts.kycStatuses, s)) + "</dd>" +
        "<dt>کد ملی</dt><dd>" + esc(lead.nationalId || "—") + "</dd>" +
        (lead.kycReason ? "<dt>آخرین دلیل</dt><dd>" + esc(lead.kycReason) + "</dd>" : "") + "</dl>" +
        '<div class="section-title">مدارک ارسالی</div><div id="ky_docs"></div>' +
        '<div class="wd-actions">' + (act.join(" ") || '<span class="cell-sub">اقدامی برای شما در این وضعیت نیست</span>') + '</div><div id="ky_result"></div>';
          if (window.CrmKycDesk && window.CrmKycDesk.renderDocs) window.CrmKycDesk.renderDocs($("ky_docs"), lead.id, true);
    }).catch(function (e) { el.innerHTML = empty(e.message); });
  }
  $("wdLead").addEventListener("click", function (e) {
    var b = e.target.closest("[data-ky-act]");
    if (!b) return;
    var act = b.getAttribute("data-ky-act");
    var reason = $("ky_reason") ? $("ky_reason").value.trim() : "";
    if (act === "reject" && !reason) { toast("دلیل رد مدارک را بنویسید", true); return; }
    b.disabled = true;
    // لینک/یادآوری/تأیید/رد: اول متن پیامک نشان داده می‌شود تا کارشناس ویرایش یا لغوش کند
    var ask = ["link", "remind", "approve", "reject"].indexOf(act) >= 0 && window.CrmKycDesk && window.CrmKycDesk.askSms
      ? window.CrmKycDesk.askSms(curLead.id, act, reason) : Promise.resolve({});
    ask.then(function (c) {
      if (!c) { b.disabled = false; return; }
      return api("/workdesk/leads/" + curLead.id + "/kyc/" + act, { method: "POST", body: Object.assign({ reason: reason }, c) }).then(function (r) {
        var sent = c.sendSms !== false;
        toast({
          link: "لینک احراز آماده شد — " + (sent ? "پیامک رفت" : "پیامکی نرفت"),
          remind: "یادآوری آماده شد — " + (sent ? "پیامک رفت" : "پیامکی نرفت"),
          approve: "مدارک تأیید شد — " + (sent ? "پیامک رفت" : "پیامکی نرفت") + "؛ یادآوری تماس با مشتری برای امروز گذاشته شد",
          reject: "مدارک رد شد — " + (sent ? "پیامک اصلاح رفت" : "پیامکی نرفت") + "؛ یادآوری تماس با مشتری برای امروز گذاشته شد",
          reopen: "پرونده بازگشایی شد",
        }[act]);
        var res = r.sms ? smsResultHtml(Object.assign({ link: r.link }, r.sms), curLead.phone) : "";
        if (window.CrmFile) window.CrmFile.refresh();
        api("/leads/" + curLead.id).then(function (x) {
          curLead = x.lead;
          onLead(x.lead);
          setTimeout(function () { openPane("kyc"); setTimeout(function () { if ($("ky_result")) $("ky_result").innerHTML = res; }, 300); }, 50);
          A.refreshLeadLists();
        });
      });
    })
      .catch(function (err) { toast(err.message, true); b.disabled = false; });
  });

  // --- وظیفه‌ها ---
  function paneTasks(el, lead) {
    Promise.all([api("/workdesk/leads/" + lead.id + "/tasks"), can("all_leads") ? loadStaff() : Promise.resolve(null)]).then(function (res) {
      var list = res[0].tasks, st = res[1];
      el.innerHTML = (list.length ? taskTable(list) : '<div class="hint">وظیفه‌ای برای این مشتری ثبت نشده است.</div>') +
        '<div class="section-title">وظیفه‌ی جدید</div>' +
        '<div class="field"><label>موضوع</label><div class="cg-outcomes" id="tk_topics">' + opts.taskTopics.map(function (t) { return '<button type="button" class="btn btn-ghost btn-sm" data-tk-topic="' + t.code + '">' + esc(t.label) + "</button>"; }).join("") + "</div></div>" +
        '<div class="field"><label>موعد</label>' + dateField("tk_due") + "</div>" +
        (st ? '<div class="field"><label>مسئول وظیفه</label><select id="tk_assignee">' + st.map(function (u) { return '<option value="' + esc(u.id) + '"' + (u.id === A.state.user.id ? " selected" : "") + ">" + esc(u.fullName) + "</option>"; }).join("") + "</select></div>" : "") +
        '<div class="field"><label>شرح کار (اختیاری)</label><input type="text" id="tk_note"></div>' +
        '<button type="button" class="btn btn-primary btn-sm" id="tk_save">ثبت وظیفه</button>';
    }).catch(function (e) { el.innerHTML = empty(e.message); });
  }
  $("wdLead").addEventListener("click", function (e) {
    var t = e.target.closest("[data-tk-topic]");
    if (t) { Array.prototype.forEach.call($("tk_topics").children, function (x) { x.classList.toggle("on", x === t); }); return; }
    if (e.target.id !== "tk_save") return;
    var topic = document.querySelector("#tk_topics .on");
    if (!topic) { toast("موضوع وظیفه را انتخاب کنید", true); return; }
    var due = readDate("tk_due", 10);
    if (!due) { toast("موعد را انتخاب کنید", true); return; }
    if (isNaN(due)) { toast("تاریخ معتبر نیست — به شکل ۱۴۰۵/۰۸/۰۵", true); return; }
    api("/workdesk/leads/" + curLead.id + "/tasks", { method: "POST", body: { topic: topic.getAttribute("data-tk-topic"), dueAt: due, note: $("tk_note").value, assigneeId: $("tk_assignee") ? $("tk_assignee").value : null } })
      .then(function () { toast("وظیفه ثبت شد"); openPane("tasks", true);  if (window.CrmFile) window.CrmFile.refresh(); })
      .catch(function (err) { toast(err.message, true); });
  });

  // --- گزارش به مدیر فروش ---
  var rpKindSel = "";
  function reportFields(kind) {
    var f = function (id, label, ph, num) { return '<div class="field"><label>' + label + '</label><input type="text" id="' + id + '"' + (num ? ' inputmode="numeric"' : "") + ' placeholder="' + (ph || "") + '"></div>'; };
    if (kind === "no_purchase") return '<div class="field"><label>علت نخریدن</label><div class="cg-outcomes" id="rp_reason">' + opts.noPurchaseReasons.map(function (r) { return '<button type="button" class="btn btn-ghost btn-sm" data-rp-reason="' + r.code + '">' + esc(r.label) + "</button>"; }).join("") + "</div></div>" + f("rp_product", "کالا / مدل (اختیاری)", "مثلاً LCD A51");
    if (kind === "competitor_price") return f("rp_product", "کالا / مدل", "مثلاً LCD سامسونگ A51") + '<div class="row2">' + f("rp_our", "قیمت ما (تومان)", "", true) + f("rp_theirs", "قیمت رقیب (تومان)", "", true) + "</div>" + f("rp_comp", "نام رقیب", "");
    if (kind === "out_of_stock") return '<div class="row2">' + f("rp_product", "کالای درخواستی", "مثلاً تاچ ال سی دی Note 12") + f("rp_qty", "تعداد", "", true) + "</div>";
    if (kind === "complaint") return f("rp_subject", "موضوع شکایت / بخش مربوط", "مثلاً تأخیر ارسال");
    return "";
  }
  function paneReport(el, lead) {
    api("/workdesk/sales-reports?leadId=" + lead.id).then(function (r) {
      rpKindSel = "";
      el.innerHTML =
        '<div class="field"><label>نوع گزارش</label><div class="cg-outcomes" id="rp_kinds">' + opts.reportKinds.map(function (k) { return '<button type="button" class="btn btn-ghost btn-sm" data-rp-kind="' + k.code + '">' + esc(k.label) + "</button>"; }).join("") + "</div></div>" +
        '<div id="rp_fields"></div><div class="field"><label>شرح و توضیحات</label><textarea rows="2" id="rp_note"></textarea></div>' +
        '<button type="button" class="btn btn-primary btn-sm" id="rp_save">ثبت گزارش برای مدیر فروش</button>' +
        '<div class="section-title">گزارش‌های این مشتری و پاسخ مدیر</div>' +
        (r.reports.length ? table(["زمان", "نوع", "جزئیات", "مشاور", "رسیدگی"], reportRows(r.reports, false)) : '<div class="hint">گزارشی ثبت نشده است.</div>');
    }).catch(function (e) { el.innerHTML = empty(e.message); });
  }
  $("wdLead").addEventListener("click", function (e) {
    var k = e.target.closest("[data-rp-kind]");
    if (k) {
      rpKindSel = k.getAttribute("data-rp-kind");
      Array.prototype.forEach.call($("rp_kinds").children, function (x) { x.classList.toggle("on", x === k); });
      $("rp_fields").innerHTML = reportFields(rpKindSel);
      return;
    }
    var rs = e.target.closest("[data-rp-reason]");
    if (rs) { Array.prototype.forEach.call($("rp_reason").children, function (x) { x.classList.toggle("on", x === rs); }); return; }
    if (e.target.id !== "rp_save") return;
    if (!rpKindSel) { toast("نوع گزارش را انتخاب کنید", true); return; }
    var v = function (id) { return $(id) ? $(id).value.trim() : ""; };
    var reason = document.querySelector("#rp_reason .on");
    var details = { product: v("rp_product"), ourPrice: v("rp_our"), competitorPrice: v("rp_theirs"), competitor: v("rp_comp"), quantity: v("rp_qty"), subject: v("rp_subject"), reason: reason ? reason.getAttribute("data-rp-reason") : "" };
    api("/workdesk/sales-reports", { method: "POST", body: { leadId: curLead.id, kind: rpKindSel, details: details, note: v("rp_note") } })
      .then(function () { toast("گزارش برای مدیر فروش ثبت شد"); openPane("report", true);  if (window.CrmFile) window.CrmFile.refresh(); })
      .catch(function (err) { toast(err.message, true); });
  });

  // --- پیامک ---
  function paneSms(el, lead) {
    Promise.all([scripts("sms"), api("/workdesk/leads/" + lead.id + "/sms")]).then(function (res) {
      var tpls = res[0], hist = res[1].sms;
      var canSend = can("sms_send");
      el.innerHTML =
        (canSend
          ? '<div class="field"><label>الگو</label><select id="sm_tpl" data-combo="sms"><option value="">متن دلخواه…</option>' + tpls.map(function (t, i) { return '<option value="' + i + '">' + esc(t.title) + "</option>"; }).join("") + "</select></div>" +
            '<div class="field"><label>متن پیامک</label><textarea rows="3" id="sm_body"></textarea></div>' +
            '<button type="button" class="btn btn-primary btn-sm" id="sm_send">' + (res[1].configured ? "ارسال پیامک" : "آماده کردن پیامک") + '</button><div id="sm_result"></div>'
          : '<div class="hint">ارسال پیامک به دسترسی «ارسال پیامک» نیاز دارد.</div>') +
        '<div class="section-title">پیامک‌های این مشتری</div>' +
        (hist.length ? hist.map(function (h) {
          return '<div class="wd-sms"><span class="cell-sub">' + esc(dt(h.createdAt)) + " · " + esc({ sent: "فرستاده شد", manual: "دستی", failed: "ناموفق" }[h.status] || h.status) + "</span><div>" + esc(h.body) + "</div></div>";
        }).join("") : '<div class="hint">پیامکی ثبت نشده است.</div>');
      if (canSend) {
        $("sm_tpl").addEventListener("change", function () {
          var v = $("sm_tpl").value;
          // الگوی تازه‌ای که همین الان از منو افزوده شده، مقدارش خود متن است
          var t = /^\d+$/.test(v) ? tpls[Number(v)] : v ? { title: v, body: v, topic: "" } : null;
          $("sm_body").value = t ? t.body.replace(/\{نام\}/g, lead.name || "مشتری").replace(/\{کارشناس\}/g, A.state.user.fullName) : "";
          $("sm_body").setAttribute("data-topic", t ? t.topic || "" : "");
          $("sm_body").setAttribute("data-title", t ? t.title : "");
        });
      }
    }).catch(function (e) { el.innerHTML = empty(e.message); });
  }
  $("wdLead").addEventListener("click", function (e) {
    if (e.target.id !== "sm_send") return;
    var b = e.target;
    b.disabled = true;
    api("/workdesk/leads/" + curLead.id + "/sms", { method: "POST", body: { body: $("sm_body").value, topic: $("sm_body").getAttribute("data-topic") || null, title: $("sm_body").getAttribute("data-title") || null } })
      .then(function (r) {
        var html = smsResultHtml(r, curLead.phone);
        if (window.CrmFile) window.CrmFile.refresh();
        openPane("sms", true);
        setTimeout(function () { if ($("sm_result")) $("sm_result").innerHTML = html; }, 400);
      })
      .catch(function (err) { toast(err.message, true); b.disabled = false; });
  });

  // --- جمله‌های آماده ---
  function paneScripts(el, lead) {
    scripts("script").then(function (list) {
      el.innerHTML = list.length ? list.map(function (s) {
        var text = s.body.replace(/\{نام\}/g, lead.name || "");
        return '<div class="wd-script"><b>' + esc(s.title) + '</b><div class="call-note">' + esc(text) + '</div><button type="button" class="btn btn-ghost btn-sm" data-wd-copy="' + esc(text) + '">کپی متن</button></div>';
      }).join("") : '<div class="hint">جمله‌ی آماده‌ای ثبت نشده است.</div>';
    }).catch(function (e) { el.innerHTML = empty(e.message); });
  }

  // --- سابقه‌ی تغییرات ---
  function paneHistory(el, lead) {
    api("/workdesk/leads/" + lead.id + "/audits").then(function (r) {
      el.innerHTML = r.audits.length ? '<div class="wd-history">' + r.audits.map(function (a) {
        return '<div class="wd-hist-row"><div><b>' + esc(a.actionLabel) + '</b> <span class="cell-sub">' + esc(a.userName) + " · " + esc(dt(a.createdAt)) + "</span></div><div>" + changesHtml(a) + "</div></div>";
      }).join("") + "</div>" : '<div class="hint">سابقه‌ای ثبت نشده است.</div>';
    }).catch(function (e) { el.innerHTML = empty(e.message); });
  }

  // --- مسئول پرونده ---
  function paneOwner(el, lead) {
    loadStaff().then(function (st) {
      el.innerHTML =
        '<div class="field"><label>مشاور مسئول</label><select id="ow_user">' + st.map(function (u) { return '<option value="' + esc(u.id) + '"' + (u.id === lead.ownerId ? " selected" : "") + ">" + esc(u.fullName) + "</option>"; }).join("") + "</select></div>" +
        '<div class="field"><label>علت تعیین یا تغییر مسئول (اختیاری)</label><input type="text" id="ow_reason"></div>' +
        '<button type="button" class="btn btn-primary btn-sm" id="ow_save">ثبت مسئول</button>';
    });
  }
  $("wdLead").addEventListener("click", function (e) {
    if (e.target.id !== "ow_save") return;
    api("/workdesk/leads/" + curLead.id + "/assign", { method: "POST", body: { ownerId: $("ow_user").value, reason: $("ow_reason").value } })
      .then(function (r) { toast("مسئول پرونده ثبت شد"); curLead = r.lead; onLead(r.lead); A.refreshLeadLists();  if (window.CrmFile) window.CrmFile.refresh(); })
      .catch(function (err) { toast(err.message, true); });
  });

  // ================= تنظیمات: اتصال وردست =================
  function loadVardast() {
    api("/workdesk/vardast").then(function (r) {
      var steps = '<ol class="wd-steps">' +
        "<li>در پنل وردست به بخش <b>وب‌هوک</b> بروید و وب‌هوک جدید بسازید.</li>" +
        '<li>این آدرس را بگذارید: <code class="wd-code">' + esc(r.url) + '</code> <button type="button" class="btn btn-ghost btn-sm" data-wd-copy="' + esc(r.url) + '">کپی</button></li>' +
        "<li>رویدادهای <b>سرنخ جدید</b> و <b>سفارش جدید</b> را انتخاب کنید.</li>" +
        "<li>«کلید امضا» (Secret) که وردست نشان می‌دهد را به مسئول فنی بدهید تا در تنظیمات سرور (VARDAST_WEBHOOK_SECRET) بگذارد. این کلید را در چت یا جای عمومی نفرستید.</li>" +
        "<li>وردست یک پیام آزمایشی می‌فرستد و CRM خودکار جوابش را می‌دهد. اگر وردست وب‌هوک را «فعال» نشان داد، اتصال برقرار است و از آن به بعد سرنخ‌ها و سفارش‌ها در «آخرین ورودی‌ها» دیده می‌شوند.</li></ol>";
      var status = r.configured
        ? '<span class="tag tag-ok">کلید امضا روی سرور تنظیم شده</span>'
        : '<span class="tag tag-warn">کلید امضا هنوز روی سرور تنظیم نشده — تا تنظیم نشود، ورودی‌های وردست پذیرفته نمی‌شوند</span>';
      var ev = r.events.length ? table(["زمان", "نوع", "خلاصه"], r.events.map(function (e) {
        return '<tr><td class="club-date">' + esc(dt(e.createdAt)) + "</td><td>" + esc({ "lead.created": "سرنخ جدید", "order.created": "سفارش جدید" }[e.type] || e.type) + "</td><td>" + (e.leadId ? leadLink(e.leadId, e.summary) : esc(e.summary)) + "</td></tr>";
      })) : '<div class="hint">هنوز چیزی از وردست دریافت نشده است.</div>';
      $("vdInfo").innerHTML = "<p>" + status + "</p>" + steps + '<div class="section-title">آخرین ورودی‌های وردست</div>' + ev;
    }).catch(function (e) { $("vdInfo").innerHTML = empty(e.message); });
  }

  // قیف فروش مدیر: هر پله یک نوار، درصد نسبت به پله‌ی اول
  function renderFunnel(rows) {
    var el = $("mgFunnel");
    if (!el) return;
    var top = rows.length ? rows[0].n : 0;
    if (!top) { el.innerHTML = empty("هنوز همکاری در قیف نیست"); return; }
    el.innerHTML = rows.map(function (r, i) {
      var pct = Math.round((r.n / top) * 100);
      var drop = i > 0 && rows[i - 1].n ? Math.round(((rows[i - 1].n - r.n) / rows[i - 1].n) * 100) : 0;
      return '<div class="funnel-row">' +
        '<div class="funnel-label">' + esc(r.label) + "</div>" +
        '<div class="funnel-bar"><div class="funnel-fill" style="width:' + pct + '%"></div>' +
        '<span class="funnel-n">' + fa(r.n) + " نفر · " + fa(pct) + "٪</span></div>" +
        '<div class="funnel-drop">' + (i > 0 && drop > 0 ? "ریزش " + fa(drop) + "٪" : "") + "</div></div>";
    }).join("");
  }

  // ================= اتصال به app.js =================
  var LOADERS = { workdesk: loadWorkdesk, tasks: loadTasks, queue: loadQueue, reports: loadReports, performance: loadActivity, manager: loadManager };
  window.CrmWorkdesk = {
    onTab: function (id) { if (LOADERS[id]) options().then(function () { LOADERS[id](); }); },
    onSettings: function (id) {
      if (id === "vardast") loadVardast();
      else if (id === "fuopts") ["fu_ok", "fu_noanswer", "fu_msg", "fu_visit"].forEach(loadEditor);
      else loadEditor(id === "smstpl" ? "sms" : "script");
    },
    onLead: onLead,
    // برای کارت «اقدام بعدی» در پرونده: باز کردن مستقیم یک بخش
    openPane: function (id) { openPane(id, true); },
  };
  if (A.state.activeTab && LOADERS[A.state.activeTab]) window.CrmWorkdesk.onTab(A.state.activeTab);
})();
