// تب «فرم‌های همکاری» — فقط جای دیدن مدارک و تأیید یا رد کردن فرم (تصمیم کاربر، ۱۴۰۵/۰۸/۱۲).
// پرونده‌ی مشتری اینجا باز نمی‌شود؛ پیگیری‌ها در تب‌های دیگر انجام می‌شود.
(function () {
  "use strict";
  var A = window.CrmApp;
  if (!A) return;
  var api = A.api, esc = A.esc, toast = A.toast, $ = A.$;
  var fa = function (v) { return Jalali.toFaDigits(String(v)); };
  if (!$("fmList")) return;

  var STATUSES = [
    { code: "none", label: "🆕 احراز نشده" },
    { code: "recent", label: "📥 فرم‌های رسیده" },
    { code: "pending", label: "🕓 منتظر تأیید" },
    { code: "awaiting", label: "📄 منتظر مدارک" },
    { code: "approved", label: "✅ تأیید شده" },
    { code: "rejected", label: "❌ رد شده" }
  ];
  var sel = "recent", timer = null, docsCache = {}, rejectOpen = null;
  // کارت‌های نمایش‌داده‌شده به همان ترتیب صفحه؛ هر بار ۲۰ تا با «بیشتر» اضافه می‌شود
  var PAGE = 20, items = [], hasMore = false, total = 0, busy = false;
  var REFRESH_MS = 30000;

  function when(ms) {
    if (!ms) return "—";
    var t = new Intl.DateTimeFormat("fa-IR", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Tehran" }).format(new Date(ms));
    return fa(Jalali.formatDate(new Date(ms)) + " " + t);
  }

  // گالری مدارک یک مشتری — هم در کارت فرم‌ها، هم در «کارهای من»، هم در پرونده‌ی مشتری.
  // دکمه‌ی × (فقط با دسترسی «تأیید و رد مدارک») عکس نامربوط را از پرونده برمی‌دارد.
  function docsHtml(leadId) {
    var d = docsCache[leadId];
    if (!d) return '<div class="cell-sub">در حال گرفتن مدارک…</div>';
    if (!d.length) return '<div class="cell-sub">هنوز مدرکی نرسیده است.</div>';
    var del = A.can("kyc_review");
    return '<div class="wd-docs">' + d.map(function (x) {
      var x1 = del ? '<button type="button" class="doc-del" data-doc-del="' + esc(x.id) + '" data-doc-lead="' + esc(leadId) + '" title="حذف این عکس از پرونده" aria-label="حذف عکس">×</button>' : "";
      var inner;
      if (x.url) {
        var pic = /\.(jpe?g|png|webp|gif|bmp)$/i.test(x.url);
        inner = (pic ? '<a target="_blank" rel="noopener noreferrer" href="' + esc(x.url) + '"><img class="wd-doc" src="' + esc(x.url) + '" alt="مدرک" loading="lazy"></a>' : "") +
          '<a class="btn btn-ghost btn-sm" target="_blank" rel="noopener noreferrer" href="' + esc(x.url) + '">🔗 ' + esc(x.name || "باز کردن مدرک") + "</a>";
      } else {
        var u = "/api/v1/workdesk/kyc/documents/" + x.id;
        if ((x.mime || "").indexOf("video/") === 0) inner = '<video class="wd-doc" controls preload="metadata" src="' + u + '"></video>';
        else if (x.mime === "application/pdf") inner = '<a class="btn btn-ghost btn-sm doc-pdf" target="_blank" rel="noopener" href="' + u + '">📄 PDF</a>';
        else inner = '<a target="_blank" rel="noopener" href="' + u + '" title="نمایش در اندازه‌ی اصلی"><img class="wd-doc" src="' + u + '?thumb=1" alt="مدرک" loading="lazy"></a>';
      }
      return '<div class="doc-item">' + inner + x1 + "</div>";
    }).join("") + "</div>";
  }

  function redrawDocs(leadId) {
    Array.prototype.forEach.call(document.querySelectorAll('[data-docs-lead="' + leadId + '"], [id="fmDocs_' + leadId + '"]'), function (box) { box.innerHTML = docsHtml(leadId); });
  }

  // گالری را در هر جای صفحه می‌گذارد (مثلاً پرونده‌ی مشتری)
  function renderInto(el, leadId, fresh) {
    if (!el) return;
    el.setAttribute("data-docs-lead", leadId);
    if (fresh) delete docsCache[leadId];
    el.innerHTML = docsHtml(leadId);
    loadDocs(leadId);
  }

  document.addEventListener("crm:docs-changed", function () { if (A.state.activeTab === "forms") refresh(); });

  document.addEventListener("click", function (e) {
    var b = e.target.closest("[data-doc-del]");
    if (!b) return;
    e.preventDefault();
    e.stopPropagation();
    if (!window.confirm("این عکس از پرونده‌ی مشتری حذف شود؟ (در سابقه‌ی پرونده ثبت می‌شود)")) return;
    var leadId = b.getAttribute("data-doc-lead");
    b.disabled = true;
    api("/workdesk/kyc/documents/" + b.getAttribute("data-doc-del"), { method: "DELETE" })
      .then(function () {
        toast("عکس از پرونده حذف شد");
        delete docsCache[leadId];
        loadDocs(leadId);
        document.dispatchEvent(new CustomEvent("crm:docs-changed", { detail: { leadId: leadId } }));
      })
      .catch(function (err) { toast(err.message, true); b.disabled = false; });
  }, true);

  function loadDocs(leadId) {
    if (docsCache[leadId]) return;
    api("/workdesk/leads/" + leadId + "/kyc/documents")
      .then(function (r) {
        docsCache[leadId] = r.documents || [];
        // ممکن است همین کارت هم در تب فرم‌ها و هم در «کارهای من» باشد
        redrawDocs(leadId);
      })
      .catch(function () { docsCache[leadId] = []; });
  }

  function rowHtml(l) {
    var review = A.can("kyc_review");
    var acts;
    if (l.kycStatus === "pending") {
      // مدارک رسیده و منتظر بررسی است؛ اگر کارشناس دسترسی «تأیید و رد مدارک احراز» را نداشته باشد
      // باید همین را ببیند، نه پیام گمراه‌کننده‌ی «هنوز مدرکی نرسیده»
      acts = review
        ? '<button type="button" class="btn btn-sale btn-sm" data-fm-ok="' + esc(l.id) + '">✓ تأیید فرم</button>' +
          '<button type="button" class="btn btn-lost btn-sm" data-fm-no="' + esc(l.id) + '">✗ رد فرم</button>'
        : '<span class="cell-sub">منتظر تأیید — دسترسی «تأیید و رد مدارک احراز» لازم است</span>';
    } else if (l.kycStatus === "approved") {
      acts = '<span class="cst ok">✅ تأیید شده</span>';
    } else if (l.kycStatus === "rejected") {
      acts = '<span class="cst">❌ رد شده' + (l.kycReason ? " — " + esc(l.kycReason) : "") + "</span>";
    } else {
      acts = '<span class="cell-sub">هنوز مدرکی برای بررسی نیست</span>';
    }
    var reject = rejectOpen === l.id
      ? '<div class="cf-box"><label class="cf-f"><span>دلیل رد (برای مشتری پیامک می‌شود) <b class="req">*</b></span>' +
        '<textarea id="fmReason" rows="2" placeholder="مثلاً: عکس پروانه‌ی کسب خوانا نیست"></textarea></label>' +
        '<div class="cf-btns"><button type="button" class="btn btn-lost btn-sm" data-fm-no-save="' + esc(l.id) + '">ثبت رد و ارسال پیامک</button>' +
        '<button type="button" class="btn btn-ghost btn-sm" data-fm-cancel>انصراف</button></div></div>'
      : "";
    var badge = l.existing === null || l.existing === undefined ? ""
      : l.existing
        ? '<span class="file-badge" style="background:#dbeafe;color:#1e3a8a">👤 از قبل در CRM بود</span>'
        : '<span class="file-badge" style="background:#dcfce7;color:#14532d">✨ مشتری تازه</span>';
    // تب «احراز نشده»: آیا قبلاً لینک فرم برایش فرستاده شده یا هنوز هیچ اقدامی نشده
    var linkBadge = l.kycStatus === "none"
      ? (l.linkSent
          ? '<span class="file-badge" style="background:#fef9c3;color:#854d0e">📨 لینک فرستاده شد' + (l.linkSentAt ? " — " + when(l.linkSentAt) : "") + "</span>"
          : '<span class="file-badge" style="background:#fee2e2;color:#991b1b">🚫 هنوز لینک فرستاده نشده</span>')
      : "";
    return '<article class="cd-row fm-row">' + (badge || linkBadge ? '<div class="cd-tags">' + badge + linkBadge + "</div>" : "") + '<div class="cd-grid">' +
      '<div class="cd-who"><button type="button" class="cd-name cd-link" data-fm-lead="' + esc(l.id) + '" title="باز کردن پرونده‌ی مشتری">' + esc(l.name || "بدون نام") + "</button>" +
      '<div><a class="cd-phone" href="tel:' + esc(l.phone) + '" dir="ltr">' + esc(fa(l.phone || "")) + "</a></div></div>" +
      '<div class="cd-cell"><span>فروشگاه</span><b>' + (esc(l.shopName) || '<i class="cell-sub">—</i>') + "</b></div>" +
      '<div class="cd-cell"><span>شهر / رسته</span><b>' + (esc([l.city, l.jobType].filter(Boolean).join(" · ")) || '<i class="cell-sub">—</i>') + "</b></div>" +
      (l.receivedAt || l.submittedAt
        ? '<div class="cd-cell"><span>زمان ارسال فرم</span><b>' + when(l.receivedAt || l.submittedAt) + "</b></div>"
        // وضعیت از ورود اکسل / CRM قدیمی آمده و فرمی از سایت نرسیده
        : '<div class="cd-cell"><span>فرم سایت نفرستاده — منبع</span><b>' + (esc(l.channel) || "—") + (l.createdAt ? ' <i class="cell-sub">(' + when(l.createdAt) + ")</i>" : "") + "</b></div>") +
      '<div class="cd-cell"><span>مدارک</span><b>' + (l.documents ? fa(l.documents) + " فایل" : "ندارد") + "</b></div>" +
      '<div class="cd-acts">' + acts + "</div></div>" +
      '<div class="fm-docs" id="fmDocs_' + esc(l.id) + '">' + (l.documents ? docsHtml(l.id) : '<div class="cell-sub">هنوز مدرکی نرسیده است — برای تأیید، اول لینک فرم احراز را از پرونده برای مشتری بفرستید.</div>') + "</div>" + reject + "</article>";
  }

  function fetchPage(offset, limit) {
    var q = $("fmQ").value.trim();
    return api("/workdesk/kyc?status=" + encodeURIComponent(sel) + "&offset=" + offset + "&limit=" + limit + (q ? "&q=" + encodeURIComponent(q) : ""))
      .then(function (r) {
        $("fmKinds").innerHTML = STATUSES.map(function (s) {
          var n = (r.counts || {})[s.code] || 0;
          return '<button type="button" class="chip' + (sel === s.code ? " active" : "") + '" data-fm-kind="' + s.code + '">' + esc(s.label) + (n ? " (" + fa(n) + ")" : "") + "</button>";
        }).join("");
        // مدارک همراه همین پاسخ آمده؛ درخواست جدا برای هر کارت لازم نیست
        (r.leads || []).forEach(function (l) { if (l.documents) docsCache[l.id] = l.docs || []; });
        total = r.total || 0;
        return r;
      });
  }

  // امضای هر کارت: اگر عوض نشده باشد، همان کارت قبلی (با عکس‌های بارشده) دست نمی‌خورد
  function sig(l) {
    return [l.kycStatus, l.kycReason, l.name, l.phone, l.shopName, l.city, l.jobType, l.documents, l.linkSent, l.linkSentAt, l.receivedAt, l.submittedAt,
      (docsCache[l.id] || []).map(function (d) { return d.id; }).join(","), rejectOpen === l.id].join("|");
  }
  function cardNode(l) {
    var box = document.createElement("div");
    box.innerHTML = rowHtml(l);
    var el = box.firstElementChild;
    el.setAttribute("data-fm-id", l.id);
    el.setAttribute("data-fm-sig", sig(l));
    return el;
  }

  // فهرست را با کمترین تغییر به‌روز می‌کند: کارت تازه اضافه، کارت رفته حذف، کارت عوض‌شده جایگزین
  function paint() {
    var list = $("fmList");
    if (!items.length) {
      list.innerHTML = '<div class="empty-state" style="padding:24px;text-align:center;color:var(--ink-faint)">' + ($("fmQ").value.trim() ? "چیزی با این جست‌وجو پیدا نشد" : "موردی در این وضعیت نیست 👌") + "</div>";
    } else {
      var old = {};
      Array.prototype.forEach.call(list.querySelectorAll(":scope > [data-fm-id]"), function (n) { old[n.getAttribute("data-fm-id")] = n; });
      if (!list.querySelector(":scope > [data-fm-id]")) list.innerHTML = "";
      var prev = null;
      items.forEach(function (l) {
        var n = old[l.id];
        if (!n || n.getAttribute("data-fm-sig") !== sig(l)) {
          var fresh = cardNode(l);
          if (n) n.replaceWith(fresh);
          n = fresh;
        }
        delete old[l.id];
        var want = prev ? prev.nextSibling : list.firstChild;
        if (want !== n) list.insertBefore(n, want);
        prev = n;
      });
      Object.keys(old).forEach(function (id) { old[id].remove(); });
    }
    var more = $("fmMore");
    if (!more) {
      more = document.createElement("div");
      more.id = "fmMore";
      more.className = "fm-more";
      list.parentNode.insertBefore(more, list.nextSibling);
    }
    more.innerHTML = hasMore
      ? '<button type="button" class="btn btn-ghost btn-sm" data-fm-more>بیشتر (' + fa(items.length) + " از " + fa(total) + ")</button>"
      : items.length > PAGE ? '<span class="cell-sub">همه‌ی ' + fa(total) + " مورد نشان داده شد</span>" : "";
  }

  function schedule() {
    clearTimeout(timer);
    timer = setTimeout(function () {
      // فقط وقتی همین تب باز و جلوی چشم است؛ وسط نوشتن دلیل رد هم دست نمی‌خورد
      if (A.state.activeTab === "forms" && !document.hidden && !rejectOpen) refresh();
      else schedule();
    }, REFRESH_MS);
  }

  // باز کردن تب، عوض کردن وضعیت یا جست‌وجو: از صفحه‌ی اول
  function load() {
    clearTimeout(timer);
    busy = true;
    fetchPage(0, PAGE)
      .then(function (r) { items = r.leads || []; hasMore = !!r.hasMore; window.scrollTo(0, 0); paint(); })
      .catch(function (e) { $("fmList").innerHTML = '<div class="hint">' + esc(e.message) + "</div>"; })
      .finally(function () { busy = false; schedule(); });
  }

  // رفرش بی‌صدا: همان تعداد کارتی که الان باز است دوباره خوانده و فقط تفاوت‌ها اعمال می‌شود
  function refresh() {
    if (busy) return schedule();
    clearTimeout(timer);
    busy = true;
    fetchPage(0, Math.max(PAGE, items.length))
      .then(function (r) { items = r.leads || []; hasMore = !!r.hasMore; paint(); })
      .catch(function () { /* رفرش بی‌صدا؛ دفعه‌ی بعد دوباره */ })
      .finally(function () { busy = false; schedule(); });
  }

  function more(btn) {
    if (busy) return;
    busy = true;
    btn.disabled = true;
    btn.textContent = "در حال گرفتن…";
    fetchPage(items.length, PAGE)
      .then(function (r) {
        var have = {};
        items.forEach(function (l) { have[l.id] = true; });
        items = items.concat((r.leads || []).filter(function (l) { return !have[l.id]; }));
        hasMore = !!r.hasMore;
        paint();
      })
      .catch(function (e) { toast(e.message, true); paint(); })
      .finally(function () { busy = false; });
  }

  document.addEventListener("visibilitychange", function () {
    if (!document.hidden && A.state.activeTab === "forms" && !rejectOpen) refresh();
  });

  $("panel-forms").addEventListener("click", function (e) {
    var pull = e.target.closest("#fmPull");
    if (pull) {
      pull.disabled = true;
      var label = pull.textContent;
      pull.textContent = "در حال دریافت…";
      api("/workdesk/site-forms/pull", { method: "POST" })
        .then(function (r) {
          if (!r.ok) return toast(r.error || "دریافت نشد", true);
          toast(r.added ? fa(r.added) + " فرم تازه ثبت شد" : "فرم تازه‌ای نیامده (" + fa(r.received) + " فرم بررسی شد)");
          refresh();
          A.refreshLeadLists();
        })
        .catch(function (err) { toast(err.message, true); })
        .finally(function () { pull.disabled = false; pull.textContent = label; });
      return;
    }
    var k = e.target.closest("[data-fm-kind]");
    if (k) { sel = k.getAttribute("data-fm-kind"); load(); return; }
    var m = e.target.closest("[data-fm-more]");
    if (m) { more(m); return; }
    rowClick(e, refresh);
  });

  // پیش از تأیید/رد: متن پیامک نشان داده می‌شود، کارشناس ویرایش یا لغوش می‌کند و بعد ثبت می‌شود.
  // نتیجه: null (انصراف) یا { sendSms, smsBody }
  var KYC_SMS_UI = {
    approve: { title: "تأیید احراز", okOn: "تأیید و ارسال پیامک", okOff: "تأیید بدون پیامک", note: "مدارک و مشخصات این مشتری را دیده‌اید و تأیید می‌کنید؟" },
    reject: { title: "رد مدارک", okOn: "رد و ارسال پیامک", okOff: "رد بدون پیامک" },
    link: { title: "ارسال لینک احراز", okOn: "ارسال لینک و پیامک", okOff: "فقط آماده کردن لینک (بدون پیامک)" },
    remind: { title: "یادآوری تکمیل مشخصات", okOn: "ارسال پیامک یادآوری", okOff: "ثبت بدون ارسال پیامک" },
  };
  function askSms(leadId, action, reason) {
    return api("/workdesk/leads/" + leadId + "/kyc/sms-preview", { method: "POST", body: { action: action, reason: reason || "" } }).then(function (p) {
      return new Promise(function (resolve) {
        var ui = KYC_SMS_UI[action] || { title: "ارسال پیامک", okOn: "ارسال پیامک", okOff: "بدون پیامک" };
        var ov = document.createElement("div");
        ov.className = "overlay kyc-sms-ov";
        ov.innerHTML = '<div class="modal kyc-sms" role="dialog" aria-modal="true">' +
          '<div class="modal-head"><h2>' + esc(ui.title) + '</h2></div>' +
          '<div class="modal-body">' +
          (ui.note || action === "reject" ? '<p class="hint" style="margin-top:0">' + (ui.note || "دلیل رد: " + esc(reason)) + "</p>" : "") +
          '<label class="kyc-sms-chk"><input type="checkbox" checked> پیامک برای مشتری فرستاده شود (' + esc(p.phone || "") + ")</label>" +
          '<div class="field kyc-sms-txt"><label>متن پیامک (قابل ویرایش)</label><textarea rows="5" dir="rtl"></textarea>' +
          (p.body.indexOf("{لینک}") >= 0 ? '<div class="hint">«{لینک}» موقع ارسال خودکار با لینک فرم اصلاح مدارک پر می‌شود.</div>' : "") + "</div>" +
          '<div class="cf-btns"><button type="button" class="btn btn-primary btn-sm" data-ks-ok>' + esc(ui.okOn) + "</button>" +
          '<button type="button" class="btn btn-ghost btn-sm" data-ks-cancel>انصراف</button></div>' +
          "</div></div>";
        document.body.appendChild(ov);
        var chk = ov.querySelector("input[type=checkbox]");
        var ta = ov.querySelector("textarea");
        var okBtn = ov.querySelector("[data-ks-ok]");
        ta.value = p.body;
        chk.addEventListener("change", function () {
          ov.querySelector(".kyc-sms-txt").hidden = !chk.checked;
          okBtn.textContent = chk.checked ? ui.okOn : ui.okOff;
        });
        var onKey = function (e) { if (e.key === "Escape") done(null); };
        var done = function (v) { ov.remove(); document.removeEventListener("keydown", onKey); resolve(v); };
        document.addEventListener("keydown", onKey);
        ov.addEventListener("click", function (e) {
          if (e.target === ov || e.target.closest("[data-ks-cancel]")) return done(null);
          if (!e.target.closest("[data-ks-ok]")) return;
          if (chk.checked && !ta.value.trim()) { toast("متن پیامک خالی است", true); return; }
          done({ sendSms: chk.checked, smsBody: chk.checked ? ta.value.trim() : "" });
        });
        ta.focus();
      });
    });
  }
  function kycDoneMsg(action, sent) {
    return (action === "approve" ? "فرم تأیید شد" : "فرم رد شد") + (sent ? " — پیامک رفت" : " — پیامکی نرفت") + "؛ یادآوری تماس با مشتری برای امروز گذاشته شد";
  }

  // دکمه‌های کارت فرم (تأیید / رد / دلیل رد) — همین تابع در «کارهای من» هم استفاده می‌شود
  function rowClick(e, reload) {
    var lead = e.target.closest("[data-fm-lead]");
    if (lead) { A.openLeadModal(lead.getAttribute("data-fm-lead")); return true; }
    var ok = e.target.closest("[data-fm-ok]");
    if (ok) {
      var okId = ok.getAttribute("data-fm-ok");
      ok.disabled = true;
      askSms(okId, "approve").then(function (c) {
        if (!c) { ok.disabled = false; return; }
        return api("/workdesk/leads/" + okId + "/kyc/approve", { method: "POST", body: c })
          .then(function () { toast(kycDoneMsg("approve", c.sendSms)); reload(); A.refreshLeadLists(); });
      }).catch(function (err) { toast(err.message, true); ok.disabled = false; });
      return true;
    }
    var no = e.target.closest("[data-fm-no]");
    if (no) { rejectOpen = no.getAttribute("data-fm-no"); reload(); return true; }
    if (e.target.closest("[data-fm-cancel]")) { rejectOpen = null; reload(); return true; }
    var save = e.target.closest("[data-fm-no-save]");
    if (save) {
      var box = save.closest("article").querySelector("textarea");
      var why = box ? box.value.trim() : "";
      if (!why) { toast("دلیل رد را بنویسید", true); return true; }
      var noId = save.getAttribute("data-fm-no-save");
      save.disabled = true;
      askSms(noId, "reject", why).then(function (c) {
        if (!c) { save.disabled = false; return; }
        return api("/workdesk/leads/" + noId + "/kyc/reject", { method: "POST", body: { reason: why, sendSms: c.sendSms, smsBody: c.smsBody } })
          .then(function () { toast(kycDoneMsg("reject", c.sendSms)); rejectOpen = null; reload(); A.refreshLeadLists(); });
      }).catch(function (err) { toast(err.message, true); save.disabled = false; });
      return true;
    }
    return false;
  }

  var qTimer = null;
  $("fmQ").addEventListener("input", function () { clearTimeout(qTimer); qTimer = setTimeout(load, 350); });

  window.CrmKycDesk = {
    load: load, stop: function () { clearTimeout(timer); },
    // برای «کارهای من»: همان کارت و همان دکمه‌ها
    rowHtml: rowHtml, loadDocs: loadDocs, rowClick: rowClick, renderDocs: renderInto, askSms: askSms,
    // مدارکی که همراه فهرست آمده (مثلاً در «کارهای من») — بدون درخواست جدا
    setDocs: function (leadId, docs) { docsCache[leadId] = docs || []; },
    isOpen: function () { return !!rejectOpen; },
  };
})();
