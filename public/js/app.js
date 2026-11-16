(function () {
  "use strict";

  // ---------------------------------------------------------------
  // state
  // ---------------------------------------------------------------
  var state = {
    user: null,
    activeTab: "mine",
    settingsSection: "display",
    taskRange: "today",
    taskOwnerId: "",
    messages: null,
    customerSort: "createdAt:desc",
    leads: [],
    users: [],
    editingUserId: null,
    editingInvId: null,
    activeLeadId: null,
    activeLead: null,
    knownTags: [],
    // صفحه‌بندی فهرست‌ها — فهرست کامل از سرور می‌آید و مرورگر آن را صفحه‌صفحه نشان می‌دهد
    leadsPage: 1,
    customerPage: 1,
    customerLeads: [],
    // شناسه‌ی مشتری‌های تیک‌خورده در تب مشتریان — برای «حذف مشتریان انتخاب‌شده» (فقط مدیر)
    customerSelected: {},
    activePipelineId: null,
    board: null,
  };

  // تعداد ردیف هر صفحه. کمتر از این، صفحه‌ها زیاد می‌شوند؛ بیشتر از این، دوباره
  // اسکرول طولانی می‌شود.
  var PER_PAGE = 25;

  var statusClass = {
    جدید: "st-new",
    "تماس اولیه/ارسال پیام": "st-contacted",
    "در حال پیگیری": "st-progress",
    "مراجعه حضوری": "st-contract",
    "فروش موفق": "st-won",
    "فروش ناموفق": "st-lost",
  };

  // ---------------------------------------------------------------
  // helpers
  // ---------------------------------------------------------------
  function $(id) { return document.getElementById(id); }

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  // باز و بسته کردن پنجره‌های مودال — همراهش اسکرول صفحه‌ی پشت هم قفل/آزاد می‌شود.
  // اگر مرورگر نسخه‌ی قدیمیِ HTML را کنار نسخه‌ی تازه‌ی این فایل کش کرده باشد
  // (مثلاً درست بعد از آپلود، قبل از Ctrl+F5)، ممکن است عنصری که این فایل
  // انتظارش را دارد هنوز در صفحه نباشد. isHidden با محافظ null، به‌جای پرت
  // کردن خطا و خراب کردن کل صفحه، آن پنجره را «بسته» فرض می‌کند.
  function isHidden(id) {
    var el = $(id);
    return !el || el.hidden;
  }
  function setOverlay(id, open) {
    var el = $(id);
    if (el) el.hidden = !open;
    var anyOpen = !isHidden("overlay") || !isHidden("pwOverlay") || !isHidden("ftOverlay") ||
      !isHidden("clubMemberOverlay") || !isHidden("callLogOverlay");
    document.body.classList.toggle("no-scroll", anyOpen);
  }
  function toast(msg, isError) {
    var el = $("toast");
    el.textContent = msg;
    el.className = "toast" + (isError ? " error" : "");
    el.hidden = false;
    clearTimeout(toast._t);
    toast._t = setTimeout(function () { el.hidden = true; }, 3200);
  }

  // یادسپاری ساده در همین مرورگر (مثل تب باز و بخش تنظیمات). در حالت ناشناس
  // یا با تنظیمات سخت‌گیرانه‌ی مرورگر ممکن است خطا بدهد، پس هر دو طرف try می‌شوند.
  function lsGet(key) {
    try { return window.localStorage.getItem(key); } catch (e) { return null; }
  }
  function lsSet(key, val) {
    try { window.localStorage.setItem(key, val); } catch (e) { /* بی‌اهمیت */ }
  }

  function api(path, opts) {
    opts = opts || {};
    var headers = Object.assign({ "Content-Type": "application/json" }, opts.headers || {});
    var body = opts.body;
    if (body && typeof body !== "string") body = JSON.stringify(body);
    // همه‌ی درخواست‌ها به نسخه‌ی ۱ API می‌روند
    return fetch("/api/v1" + path, {
      method: opts.method || "GET",
      headers: headers,
      body: body,
      credentials: "same-origin",
    }).then(function (r) {
      return r
        .json()
        .catch(function () { return {}; })
        .then(function (data) {
          if (!r.ok) {
            var err = new Error(data.error || "خطای ناشناخته");
            err.status = r.status;
            throw err;
          }
          return data;
        });
    });
  }

  function fmtPrice(from, to) {
    var f = from !== null && from !== undefined && from !== "" ? "$" + Number(from).toLocaleString("en-US") : null;
    var t = to !== null && to !== undefined && to !== "" ? "$" + Number(to).toLocaleString("en-US") : null;
    if (f && t) return f + " تا " + t;
    if (f) return "از " + f;
    if (t) return "تا " + t;
    return "—";
  }

  // تاریخ‌ها در دیتابیس میلادی‌اند و فقط برای نمایش به شمسی تبدیل می‌شوند.
  function fmtDate(ts) {
    if (!ts) return "—";
    var d = new Date(ts);
    if (isNaN(d.getTime())) return "—";
    var isToday = d.toDateString() === new Date().toDateString();
    if (isToday) {
      return "امروز " + Jalali.toFaDigits(d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }));
    }
    return Jalali.formatDate(d, { faDigits: true });
  }

  // تاریخ کامل با ساعت — برای جاهایی که جزئیات بیشتری لازم است
  function fmtDateTime(ts) {
    if (!ts) return "—";
    var d = new Date(ts);
    if (isNaN(d.getTime())) return "—";
    return Jalali.formatDate(d, { withTime: true, faDigits: true });
  }

  var SOCIAL_CHANNELS = ["اینستاگرام", "تلگرام", "واتساپ"];
  // نشان مرحله‌ی مشتری در فهرست‌ها (رنگ از همان tone که سرور می‌دهد)
  function stageTagHtml(l) {
    if (!l || !l.stage) return "";
    return ' <span class="tag stage-tag cstage-' + esc(l.stage.tone) + '">' + esc(l.stage.label) + "</span>";
  }

  function channelTagHtml(channel) {
    if (!channel) return '<span class="cell-sub">—</span>';
    var cls = channel === "حضوری / مراجعه" ? "src-walkin" : SOCIAL_CHANNELS.indexOf(channel) !== -1 ? "src-instagram" : "";
    return '<span class="tag ' + cls + '">' + esc(channel) + "</span>";
  }


  // ---------------------------------------------------------------
  // auth / boot
  // ---------------------------------------------------------------
  function boot() {
    api("/auth/me")
      .then(function (r) {
        state.user = r.user;
        showApp();
      }, function () {
        // فقط شکست خود درخواست احراز هویت باید صفحه ورود را نشان دهد.
        // خطای راه‌اندازی رابط کاربری به معنی منقضی شدن نشست نیست.
        showLogin();
      });
  }

  function showLogin() {
    $("loginScreen").hidden = false;
    $("appScreen").hidden = true;
  }

  function showApp() {
    $("loginScreen").hidden = true;
    $("appScreen").hidden = false;
    $("whoName").textContent = state.user.fullName;
    $("whoRole").textContent = state.user.roleLabel || (state.user.role === "manager" ? "مدیر" : "کارشناس فروش");
    $("whoRole").className = "role-badge " + (state.user.role === "manager" ? "role-manager" : "role-rep");
    buildTabs();
    setupLeadFormForRole();
    loadChannels();
    // فهرست برچسب‌ها برای فرم ثبت، فرم ویرایش و فیلتر مشتریان
    loadKnownTags().then(function () { newLeadTags.render(); });
    // قالب پیام‌ها همان اول خوانده می‌شود تا کارشناس بدون رفتن به تنظیمات
    // بتواند دکمه‌های کپی پیام را بزند
    loadMessages();
    if (canAny("users", "all_leads", "performance", "dashboard", "calls_admin", "demand")) {
      loadUsersList().then(populateOwnerFilters);
      loadBranchesList().then(populateBranchSelectors);
    }
    // بخش تنظیمات که کاربر آخرین بار روی آن بوده، دوباره باز شود
    state.settingsSection = lsGet("crmSettingsSection") || "display";
    // تبی که کاربر آخرین بار باز کرده بود، بعد از رفرش دوباره باز شود.
    // اگر ذخیره‌شده‌ای نبود یا برای این نقش مجاز نیست، به «لیست وظایف» برمی‌گردیم.
    var allowedTabs = ["customers", "mine", "calls", "settings", "consultant", "forms", "vardast", "tasks", "reports", "analytics"];
    ["dashboard", "performance"].forEach(function (t) { if (can(t)) allowedTabs.push(t); });
    if (can("sales_reports")) allowedTabs.push("manager");
    // ورود به CRM همیشه با داشبورد شروع می‌شود (نه آخرین تبی که باز بوده)
    // همه با صفحه‌ی «مسابقه» شروع می‌کنند
    var savedTab = "consultant";
    var fromUrl = /^#\/([a-z]+)(?:\/([a-z]+))?/.exec(location.hash || "");
    if (fromUrl && allowedTabs.indexOf(fromUrl[1]) !== -1) {
      if (fromUrl[2]) state.settingsSection = fromUrl[2];
      savedTab = fromUrl[1];
    }
    switchTab(allowedTabs.indexOf(savedTab) !== -1 ? savedTab : "today");
    state.navReady = true;
    loadNavCounts();
  }

  $("loginForm").addEventListener("submit", function (e) {
    e.preventDefault();
    $("loginError").hidden = true;
    var btn = $("loginBtn");
    btn.disabled = true;
    api("/auth/login", { method: "POST", body: { username: $("li_username").value.trim(), password: $("li_password").value } })
      .then(function (r) {
        state.user = r.user;
        $("li_username").value = "";
        $("li_password").value = "";
        showApp();
      })
      .catch(function (err) {
        $("loginError").textContent = err.message;
        $("loginError").hidden = false;
      })
      .finally(function () { btn.disabled = false; });
  });

  $("logoutBtn").addEventListener("click", function () {
    api("/auth/logout", { method: "POST" })
      .then(function (r) {
        state.user = null;
        showLogin();
      })
      .catch(function () { state.user = null; showLogin(); });
  });

  // change password
  $("changePassBtn").addEventListener("click", function () {
    $("pwError").hidden = true;
    $("pw_old").value = "";
    $("pw_new").value = "";
    setOverlay("pwOverlay", true);
  });
  $("pw_close").addEventListener("click", function () { setOverlay("pwOverlay", false); });
  $("pw_submit").addEventListener("click", function () {
    $("pwError").hidden = true;
    api("/auth/change-password", { method: "POST", body: { oldPassword: $("pw_old").value, newPassword: $("pw_new").value } })
      .then(function () {
        setOverlay("pwOverlay", false);
        toast("رمز عبور با موفقیت تغییر کرد");
      })
      .catch(function (err) {
        $("pwError").textContent = err.message;
        $("pwError").hidden = false;
      });
  });

  // ---------------------------------------------------------------
  // tabs
  // ---------------------------------------------------------------
  // ---------------------------------------------------------------
  // ناوبری: بالا فقط دو بخش اصلی (CRM و باشگاه مشتریان)، و صفحه‌های هر بخش
  // دسته‌بندی‌شده در نوار کناری. هر صفحه همان tab-panel قبلی است.
  // ---------------------------------------------------------------
  var MODULES = [
    { id: "crm", label: "CRM" },
  ];
  var SETTINGS_ICONS = { display: "palette", messages: "message", branches: "branch", users: "users", phonelines: "sim", channels: "target", backup: "box", dups: "users", scripts: "message", smstpl: "message", fuopts: "message", vardast: "phone" };

  function moduleOf() { return "crm"; }

  function navGroups(mod) {
    var groups = [
      {
        title: "کار روزانه",
        // CRM نمونه (۱۴۰۵/۰۸/۰۶، خواست کاربر): منوی خلوت. میز کار امروز، صف بدون مسئول، داشبورد من،
        // پیگیری گروهی، جدول امتیازات و مشتری‌های مستعد از منو برداشته شدند (کدشان هست).
        items: [
          { tab: "consultant", label: "کارهای من", icon: "today" },
          { tab: "calls", label: "تماس‌ها", icon: "phone" },
          { tab: "forms", label: "فرم‌های همکاری", icon: "target" },
          { tab: "vardast", label: "لیدهای وردست", icon: "message" },
          { tab: "mine", label: "ثبت دستی / حضوری", icon: "plus" },
          { tab: "customers", label: "مشتریان", icon: "users" },
          { tab: "tasks", label: "وظیفه‌ها", icon: "won" },
          { tab: "manager", label: "میز کار مدیر فروش", icon: "board", perm: "sales_reports" },
        ],
      },
    ];
    groups[0].items = groups[0].items.filter(function (x) { return !x.perm || can(x.perm); });
    var only = function (items) { return items.filter(function (x) { return can(x.perm || x.tab); }); };
    var rep1 = only([
      { tab: "analytics", label: "آمار فروش", icon: "rate", perm: "all_leads" },
      { tab: "dashboard", label: "گزارشات", icon: "dash" },
      { tab: "performance", label: "آمار کار کارشناسان", icon: "rate" },
      { tab: "reports", label: "گزارش به مدیر فروش", icon: "message", perm: "all_leads" },
    ]);
    if (rep1.length) groups.push({ title: "گزارش‌ها", items: rep1 });
    // زیربخش‌های تنظیمات مستقیم در نوار کناری‌اند (به‌جای نوار دوم داخل صفحه)
    groups.push({
      title: "تنظیمات",
      items: settingsItems().map(function (it) {
        return { tab: "settings", section: it.id, label: it.label, icon: SETTINGS_ICONS[it.id] || "dash" };
      }),
    });
    return groups;
  }

  function buildTabs() {
    var wrap = $("tabs");
    wrap.innerHTML = MODULES
      .map(function (m) { return '<button class="tab-btn" data-module="' + m.id + '">' + esc(m.label) + "</button>"; })
      .join("");
    Array.prototype.forEach.call(wrap.querySelectorAll(".tab-btn"), function (btn) {
      btn.addEventListener("click", function () {
        var mod = btn.getAttribute("data-module");
        if (mod === moduleOf(state.activeTab)) return;
        // هر بخش آخرین صفحه‌ای را که در آن بوده‌اید به یاد دارد
        var last = lsGet("crmTab_" + mod);
        var first = navGroups(mod)[0].items[0].tab;
        switchTab(last && moduleOf(last) === mod ? last : first);
      });
    });
  }

  function navCollapsed() {
    return lsGet("crmNavCollapsed") === "1";
  }

  // شمارنده‌ی قرمز کنار «فرم‌های همکاری» و «لیدهای وردست»: چند مشتری از آخرین باری که همین کاربر
  // آن تب را باز کرده فرم یا پیام تازه فرستاده‌اند. با باز کردن تب صفر می‌شود.
  var NAV_COUNT_TABS = ["forms", "vardast"];
  var navCounts = {}, clockSkew = 0, navTimer = null;
  function seenKey(tab) { return "crmSeen_" + tab + "_" + (state.user ? state.user.id : ""); }
  function seenAt(tab) {
    var v = Number(lsGet(seenKey(tab)));
    if (v > 0) return v;
    var d = new Date();
    d.setHours(0, 0, 0, 0);
    return d.getTime(); // بار اول: رسیده‌های امروز
  }
  function markSeen(tab) {
    if (NAV_COUNT_TABS.indexOf(tab) === -1) return;
    lsSet(seenKey(tab), String(Date.now() + clockSkew));
    navCounts[tab] = 0;
    paintNavCounts();
  }
  function paintNavCounts() {
    NAV_COUNT_TABS.forEach(function (t) {
      var a = document.querySelector('#sideNav .side-item[data-tab="' + t + '"]');
      if (!a) return;
      var b = a.querySelector(".side-count");
      var n = navCounts[t] || 0;
      if (!n) { if (b) b.remove(); return; }
      if (!b) { b = document.createElement("span"); b.className = "side-count"; a.appendChild(b); }
      b.textContent = n > 99 ? "۹۹+" : Jalali.toFaDigits(String(n));
      b.title = Jalali.toFaDigits(String(n)) + " مورد تازه از آخرین بار که این صفحه را باز کردید";
    });
  }
  function loadNavCounts() {
    clearTimeout(navTimer);
    if (!state.user) return;
    if (document.hidden) { navTimer = setTimeout(loadNavCounts, 60000); return; }
    markSeen(state.activeTab); // همین الان جلوی چشم است
    var t0 = Date.now();
    api("/workdesk/nav-counts?formsSince=" + seenAt("forms") + "&vardastSince=" + seenAt("vardast"))
      .then(function (r) {
        // ساعت سرور مبنا است تا ساعت نادرست کامپیوتر کارشناس شمارنده را خراب نکند
        if (r.now) clockSkew = r.now - Math.round((t0 + Date.now()) / 2);
        NAV_COUNT_TABS.forEach(function (t) { navCounts[t] = state.activeTab === t ? 0 : r[t] || 0; });
        paintNavCounts();
      })
      .catch(function () { /* دفعه‌ی بعد */ })
      .finally(function () { navTimer = setTimeout(loadNavCounts, 60000); });
  }
  document.addEventListener("visibilitychange", function () { if (!document.hidden && state.navReady) loadNavCounts(); });

  function renderSideNav() {
    var nav = $("sideNav");
    if (!nav || !state.user) return;
    var mod = moduleOf(state.activeTab);
    var html =
      '<button type="button" class="side-item side-toggle" id="sideToggle" title="جمع / باز کردن منو" aria-label="جمع / باز کردن منو">' +
      icon("chevron") + "</button>";
    navGroups(mod).forEach(function (g, gi) {
      if (gi > 0) html += '<div class="side-sep"></div>';
      html += '<div class="side-group-title">' + esc(g.title) + "</div>";
      g.items.forEach(function (it) {
        var active = it.tab === state.activeTab && (!it.section || it.section === state.settingsSection);
        html +=
          '<a class="side-item' + (active ? " active" : "") + '" href="' + tabHash(it.tab, it.section) + '" data-tab="' + it.tab + '"' +
          (it.section ? ' data-section="' + it.section + '"' : "") + ' title="' + esc(it.label) + '">' +
          icon(it.icon) + '<span class="side-label">' + esc(it.label) + "</span></a>";
      });
    });
    nav.innerHTML = html;
    paintNavCounts();
    $("appBody").classList.toggle("nav-collapsed", navCollapsed());
    Array.prototype.forEach.call(document.querySelectorAll("#tabs .tab-btn"), function (b) {
      b.classList.toggle("active", b.getAttribute("data-module") === mod);
    });
  }

  $("sideNav").addEventListener("click", function (e) {
    if (e.target.closest("#sideToggle")) {
      lsSet("crmNavCollapsed", lsGet("crmNavCollapsed") === "1" ? "0" : "1");
      $("appBody").classList.toggle("nav-collapsed", navCollapsed());
      return;
    }
    var b = e.target.closest(".side-item[data-tab]");
    if (!b) return;
    // Ctrl/Shift/Cmd + کلیک → مرورگر خودش در تب یا پنجره‌ی تازه باز کند
    if (e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    var tab = b.getAttribute("data-tab");
    var section = b.getAttribute("data-section");
    if (section) state.settingsSection = section;
    if (tab === "settings" && state.activeTab === "settings" && section) {
      switchSettings(section);
      return;
    }
    switchTab(tab);
  });

  function tabHash(tab, section) {
    return "#/" + tab + (tab === "settings" && section ? "/" + section : "");
  }
  // هر جابه‌جایی بین صفحه‌ها یک قدم در تاریخچه‌ی مرورگر است تا «بازگشت/جلو»ی مرورگر
  // بین صفحه‌های CRM حرکت کند (نه این‌که از CRM بیرون برود). باز شدن اولیه فقط جایگزین می‌شود.
  function syncHash() {
    if (state.navFromHistory) return;
    var h = tabHash(state.activeTab, state.settingsSection);
    if (location.hash !== h) {
      try {
        if (state.navReady) history.pushState(null, "", h);
        else history.replaceState(null, "", h);
      } catch (e) { /* نادیده */ }
    }
  }

  // دکمه‌ی «بازگشت/جلو»ی مرورگر: همان صفحه‌ی آدرس باز شود، بدون افزودن قدم تازه
  window.addEventListener("popstate", function () {
    if (!state.user || !state.navReady) return;
    var m = /^#\/([a-z]+)(?:\/([a-z]+))?/.exec(location.hash || "");
    if (!m || !$("panel-" + m[1])) return;
    state.navFromHistory = true;
    try {
      if (m[1] === "settings" && m[2]) state.settingsSection = m[2];
      if (m[1] === "settings" && state.activeTab === "settings" && m[2]) switchSettings(m[2]);
      else switchTab(m[1]);
    } finally {
      state.navFromHistory = false;
    }
  });

  function switchTab(id) {
    // فرم درجای تماس با عوض شدن صفحه بسته می‌شود (تا دو فرم هم‌نام در DOM نماند)
    state.calls.openId = null; state.calls.openMode = ""; state.calls.outcomes = [];
    var changed = state.activeTab !== id;
    if (changed && state.navReady) markSeen(state.activeTab);
    state.activeTab = id;
    if (state.navReady) markSeen(id);
    lsSet("crmTab", id);
    lsSet("crmTab_" + moduleOf(id), id);
    renderSideNav();
    ["customers", "mine", "calls", "dashboard", "performance", "settings", "workdesk", "consultant", "forms", "vardast", "tasks", "queue", "reports", "manager", "analytics"].forEach(function (p) {
      var el = $("panel-" + p);
      if (el) el.hidden = p !== id;
    });
    if (id === "customers") loadCustomers();
    if (id === "mine") loadLeads();
    if (id === "calls") loadCalls();
    if (id === "dashboard") loadDashboard();
    if (id === "performance") loadPerformance();
    if (id === "settings") openSettings();
    // صفحه‌های «میز کار مشاور» در public/js/workdesk.js
    if (window.CrmWorkdesk) window.CrmWorkdesk.onTab(id);
    if (window.CrmDesk) window.CrmDesk.onTab(id);
    if (id === "analytics" && window.CrmAnalytics) window.CrmAnalytics.load();
    if (window.CrmKycDesk) { if (id === "forms") window.CrmKycDesk.load(); else window.CrmKycDesk.stop(); }
    if (window.CrmMyDesk) {
      if (id === "consultant") window.CrmMyDesk.load(); else window.CrmMyDesk.stop();
      if (window.CrmMyDesk.place) setTimeout(window.CrmMyDesk.place, 0); // کارت تماس جاری بالای فهرست همین صفحه
    }
    syncHash();
    // با عوض شدن تب، صفحه همیشه از بالا باز می‌شود (اسکرول تب قبلی منتقل نمی‌شود)
    if (changed) window.scrollTo(0, 0);
  }

  // ---------------------------------------------------------------
  // تنظیمات — زیربخش‌ها
  // ---------------------------------------------------------------
  var SETTINGS_SECTIONS = ["display", "messages", "branches", "users", "phonelines", "channels", "backup", "sms", "dups", "scripts", "smstpl", "fuopts", "vardast"];

  function settingsItems() {
    // CRM نمونه: شعبه‌ها، نحوه‌ی آشنایی (منبع را سیستم تشخیص می‌دهد) و سرنخ‌های تکراری (ثبت تکراری ممکن نیست) برداشته شدند
    var items = [{ id: "display", label: "تنظیمات نمایش" }];
    if (can("users")) items.push({ id: "users", label: "کاربران و دسترسی‌ها" });
    if (can("calls_admin")) items.push({ id: "phonelines", label: "خطوط تلفن (گوشی‌ها)" });
    if (can("scripts_admin")) items.push({ id: "scripts", label: "جمله‌های آماده‌ی فروش" });
    if (can("scripts_admin")) items.push({ id: "fuopts", label: "گزینه‌های ثبت پیگیری" });
    if (can("settings") || can("sms_send")) items.push({ id: "sms", label: "پیامک‌ها" });
    if (can("scripts_admin")) items.push({ id: "smstpl", label: "پیامک‌های آماده" });
    if (can("settings")) items.push({ id: "vardast", label: "اتصال وردست" });
    if (can("settings")) items.push({ id: "backup", label: "پشتیبان در بله" });
    return items;
  }

  function openSettings() {
    var items = settingsItems();
    var nav = $("settingsNav");
    var current = state.settingsSection;
    // اگر کارشناس قبلاً روی بخشی بوده که حالا اجازه‌اش را ندارد، به نمایش برگردد
    var allowed = items.some(function (i) { return i.id === current; });
    if (!allowed) current = "display";

    nav.innerHTML = items
      .map(function (i) {
        return (
          '<button type="button" class="subnav-btn' + (i.id === current ? " active" : "") +
          '" data-section="' + i.id + '">' + esc(i.label) + "</button>"
        );
      })
      .join("");

    Array.prototype.forEach.call(nav.querySelectorAll(".subnav-btn"), function (btn) {
      btn.addEventListener("click", function () { switchSettings(btn.getAttribute("data-section")); });
    });

    switchSettings(current);
  }

  function switchSettings(id) {
    state.settingsSection = id;
    lsSet("crmSettingsSection", id);
    syncHash();
    renderSideNav();
    Array.prototype.forEach.call(document.querySelectorAll(".subnav-btn"), function (b) {
      b.classList.toggle("active", b.getAttribute("data-section") === id);
    });
    SETTINGS_SECTIONS.forEach(function (sec) {
      var el = $("set-" + sec);
      if (!el) return;
      el.hidden = sec !== id;
    });
    if (id === "display") renderThemeGrid();
    if (id === "messages") loadMessages().then(fillMessagesForm);
    if (id === "branches") loadBranchesTable();
    if (id === "users") loadUsersTable();
    if (id === "phonelines") loadPhoneLines();
    if (id === "channels") loadChannelEditor();
    if (id === "backup") loadBackupBale();
    if (id === "dups") loadDuplicates();
    if (id === "sms") {
      $("smsConnCard").hidden = !can("settings");
      if (can("settings")) loadSmsPanel();
      $("smsLogCard").hidden = !(can("settings") || can("sms_send"));
      if (can("settings") || can("sms_send")) loadSmsLog();
    }
    if (id === "smstpl" && window.CrmWorkdesk) window.CrmWorkdesk.onSettings("smstpl");
    if ((id === "scripts" || id === "fuopts" || id === "vardast") && window.CrmWorkdesk) window.CrmWorkdesk.onSettings(id);
  }

  // ---------------------------------------------------------------
  // صفحه‌ی «امروز» — کار روز کارشناس
  // ---------------------------------------------------------------

  // آیکون‌ها به‌صورت SVG درون‌خطی‌اند تا هیچ درخواست شبکه‌ای اضافه نشود؛
  // برنامه باید بدون اینترنت هم کامل بالا بیاید.
  var ICONS = {
    overdue: '<path d="M12 8v5l3 2"/><circle cx="12" cy="12" r="9"/>',
    today: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M8 3v4M16 3v4M3 11h18"/>',
    idle: '<path d="M12 9v4M12 17h.01"/><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/>',
    won: '<path d="M20 6 9 17l-5-5"/>',
    users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.9"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    rate: '<path d="M3 17l6-6 4 4 7-7"/><path d="M14 8h6v6"/>',
    target: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1"/>',
    board: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M9 4v16M15 4v16"/>',
    dash: '<rect x="3" y="3" width="7" height="9" rx="1"/><rect x="14" y="3" width="7" height="5" rx="1"/><rect x="14" y="12" width="7" height="9" rx="1"/><rect x="3" y="16" width="7" height="5" rx="1"/>',
    car: '<path d="M5 17h14M6 17l1.5-5h9L18 17M4 17v2M20 17v2"/><circle cx="7.5" cy="17" r="1.5"/><circle cx="16.5" cy="17" r="1.5"/>',
    box: '<path d="M21 8 12 3 3 8v8l9 5 9-5z"/><path d="M3 8l9 5 9-5M12 13v8"/>',
    palette: '<circle cx="12" cy="12" r="9"/><circle cx="8" cy="10" r="1"/><circle cx="12" cy="7.5" r="1"/><circle cx="16" cy="10" r="1"/><path d="M12 21a3 3 0 0 1 0-6h2"/>',
    message: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>',
    branch: '<path d="M3 21h18M5 21V8l7-5 7 5v13M9 21v-6h6v6"/>',
    chevron: '<path d="M15 6l-6 6 6 6"/>',
    phone: '<path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1 1 .4 1.9.7 2.8a2 2 0 0 1-.5 2.1L8 9.9a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.5c.9.3 1.8.6 2.8.7a2 2 0 0 1 1.7 2z"/>',
    sim: '<rect x="5" y="2" width="14" height="20" rx="2"/><path d="M12 18h.01"/>',
    gift: '<rect x="3" y="8" width="18" height="4" rx="1"/><path d="M12 8v13M19 12v7a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-7"/><path d="M7.5 8a2.5 2.5 0 0 1 0-5C11 3 12 8 12 8s1-5 4.5-5a2.5 2.5 0 0 1 0 5"/>',
  };

  function icon(name) {
    return (
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" ' +
      'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + ICONS[name] + "</svg>"
    );
  }

  // اختلاف روز بین یک تاریخ و امروز — مبنا نصف‌شب است، نه ساعت دقیق، وگرنه
  // پیگیریِ «دیروز ساعت ۹» به‌اشتباه «امروز» حساب می‌شود.
  function daysFromToday(ts) {
    var d = new Date(ts);
    d.setHours(0, 0, 0, 0);
    var today = new Date();
    today.setHours(0, 0, 0, 0);
    return Math.round((d - today) / 86400000);
  }

  function urgencyPill(ts) {
    var diff = daysFromToday(ts);
    if (diff < 0) {
      var n = Math.abs(diff);
      return '<span class="pill st-lost">' + Jalali.toFaDigits(String(n)) + " روز عقب‌افتاده</span>";
    }
    if (diff === 0) return '<span class="pill st-contract">امروز</span>';
    return '<span class="pill st-new">' + fmtDate(ts) + "</span>";
  }

  // یک ردیف کار: چه کسی، چرا اینجاست، و دکمه‌ی تماس.
  // شماره تلفن روی موبایل مستقیم شماره‌گیری می‌کند و روی ویندوز بی‌اثر است —
  // پس متن شماره هم کنارش می‌ماند تا همیشه قابل خواندن باشد.
  function workRowHtml(l, badge) {
    return (
      '<div class="work-row" data-lead-id="' + esc(l.id) + '">' +
      '<div class="work-main">' +
      '<div class="work-name">' + esc(leadDisplayName(l) || "بدون نام") + "</div>" +
      '<div class="work-meta">' +
      '<span class="work-phone">' + Jalali.toFaDigits(esc(l.phone)) + "</span>" +
      "</div>" +
      (l.nextFollowUpNote ? '<div class="work-note">' + esc(l.nextFollowUpNote) + "</div>" : "") +
      "</div>" +
      '<div class="work-side">' + badge +
      '<a class="btn btn-ghost btn-sm work-call" href="tel:' + esc(l.phone) + '">تماس</a>' +
      "</div>" +
      "</div>"
    );
  }

  // ---------------------------------------------------------------
  // نمودارها — SVG خام، بدون هیچ کتابخانه‌ای
  // ---------------------------------------------------------------
  // چرا کتابخانه نه؟ برنامه باید بدون اینترنت کامل بالا بیاید و سیاست امنیتی
  // صفحه هم اسکریپت بیرونی را بلاک می‌کند. این دو نمودار آن‌قدر ساده‌اند که
  // چند خط SVG کافی است.

  // رنگ هر وضعیت همان رنگی است که در جدول و برچسب‌ها استفاده می‌شود، تا
  // «سبز» همه‌جای برنامه یک معنی داشته باشد.
  var STATUS_COLORS = {
    "جدید": "--st-new-fg",
    "تماس اولیه/ارسال پیام": "--st-contacted-fg",
    "در حال پیگیری": "--st-progress-fg",
    "مراجعه حضوری": "--st-contract-fg",
    "فروش موفق": "--st-won-fg",
    "فروش ناموفق": "--st-lost-fg",
  };

  function donutHtml(slices, total) {
    var r = 68, cx = 90, cy = 90, sw = 24;
    var circ = 2 * Math.PI * r;
    var offset = 0;

    var rings = slices
      .map(function (s) {
        var len = total ? (s.value / total) * circ : 0;
        var el =
          '<circle cx="' + cx + '" cy="' + cy + '" r="' + r + '" fill="none" ' +
          'style="stroke:var(' + s.color + ')" stroke-width="' + sw + '" ' +
          'stroke-dasharray="' + len.toFixed(2) + " " + (circ - len).toFixed(2) + '" ' +
          'stroke-dashoffset="' + (-offset).toFixed(2) + '" ' +
          'transform="rotate(-90 ' + cx + " " + cy + ')"/>';
        offset += len;
        return el;
      })
      .join("");

    // حلقه‌ی خاکستری زیرین تا وقتی داده‌ای نیست، جای نمودار خالی نماند
    var track =
      '<circle cx="' + cx + '" cy="' + cy + '" r="' + r + '" fill="none" ' +
      'style="stroke:var(--surface-2)" stroke-width="' + sw + '"/>';

    return (
      '<svg viewBox="0 0 180 180" class="donut" role="img" aria-label="نمودار وضعیت سرنخ‌ها">' +
      track + rings +
      '<text x="90" y="84" class="donut-num">' + Jalali.toFaDigits(String(total)) + "</text>" +
      '<text x="90" y="106" class="donut-cap">سرنخ</text>' +
      "</svg>"
    );
  }

  function legendHtml(slices, total) {
    return slices
      .map(function (s) {
        var pct = total ? Math.round((s.value / total) * 100) : 0;
        return (
          '<div class="legend-row">' +
          '<span class="legend-dot" style="background:var(' + s.color + ')"></span>' +
          '<span class="legend-label">' + esc(s.label) + "</span>" +
          '<span class="legend-val">' + Jalali.toFaDigits(String(s.value)) +
          ' <span class="legend-pct">' + Jalali.toFaDigits(String(pct)) + "٪</span></span>" +
          "</div>"
        );
      })
      .join("");
  }

  function barsHtml(rows) {
    var max = Math.max.apply(null, rows.map(function (r) { return r.value; }).concat([1]));
    return rows
      .map(function (r) {
        return (
          '<div class="bar-row">' +
          '<span class="bar-label">' + esc(r.label) + "</span>" +
          '<span class="bar-track"><span class="bar-bar" style="width:' +
          Math.max(2, Math.round((r.value / max) * 100)) + '%"></span></span>' +
          '<span class="bar-val">' + Jalali.toFaDigits(String(r.value)) + "</span>" +
          "</div>"
        );
      })
      .join("");
  }

  // شمارش یک فیلد روی فهرست سرنخ‌ها
  function countBy(list, key) {
    var m = {};
    list.forEach(function (l) {
      var v = l[key] || "نامشخص";
      m[v] = (m[v] || 0) + 1;
    });
    return m;
  }

  // سطح دسترسی: مدیر همه را دارد؛ کارشناس فقط دسترسی‌هایی که مدیر برایش روشن کرده
  function can(perm) {
    // CRM نمونه: «همه‌ی مشتری‌ها» برای همه باز است (هیچ مشتری مختص یک کارشناس نیست)
    return !!state.user && (perm === "all_leads" || state.user.role === "manager" || (state.user.permissions || []).indexOf(perm) !== -1);
  }
  function canAny() {
    for (var i = 0; i < arguments.length; i++) if (can(arguments[i])) return true;
    return false;
  }

  // کارت عدد بزرگ — هم در صفحه‌ی «امروز» و هم در داشبورد مدیر از همین ساخته
  // می‌شود تا هر دو صفحه یک زبان بصری داشته باشند.
  // n از قبل رشته‌ی آماده است (ارقام فارسی یا «—»).
  function kpiCardHtml(s) {
    return (
      '<div class="kpi" data-tone="' + s.tone + '"' + (s.alert ? ' data-alert="1"' : "") + ">" +
      '<span class="kpi-icon">' + icon(s.k) + "</span>" +
      '<div class="kpi-label">' + esc(s.label) + "</div>" +
      '<div class="kpi-num">' + esc(s.n) + "</div>" +
      '<div class="kpi-foot">' + esc(s.foot) + "</div>" +
      "</div>"
    );
  }

  function emptyWork(msg) {
    return '<div class="work-empty">' + esc(msg) + "</div>";
  }

  function bindWorkRows(container) {
    Array.prototype.forEach.call(container.querySelectorAll(".work-row"), function (row) {
      row.addEventListener("click", function (e) {
        // کلیک روی دکمه‌ی تماس نباید مودال را هم باز کند
        if (e.target.closest(".work-call")) return;
        openLeadModal(row.getAttribute("data-lead-id"));
      });
    });
  }

  // متن هر بازه در یک جا نگه داشته می‌شود تا عنوان کارت، توضیح و پیام خالی
  // بودن با هم هماهنگ بمانند.
  var RANGE_TEXT = {
    today: {
      title: "پیگیری‌های امروز و عقب‌افتاده",
      sub: "عقب‌افتاده‌ها اول آمده‌اند",
      empty: "پیگیری عقب‌افتاده یا امروزی ندارید.",
    },
    tomorrow: {
      title: "پیگیری‌های فردا",
      sub: "تا از امشب بدانید فردا با چه کسانی کار دارید",
      empty: "برای فردا پیگیری‌ای ثبت نشده است.",
    },
    all: {
      title: "همهٔ وظایف",
      sub: "هر سرنخی که یادآوری دارد — از عقب‌افتاده تا آینده",
      empty: "هیچ سرنخی یادآوری ندارد.",
    },
  };








  // ---------------------------------------------------------------
  // تنظیمات — انتخاب تم
  // ---------------------------------------------------------------
  function renderThemeGrid() {
    var grid = $("themeGrid");
    if (!grid || !window.CrmTheme) return;
    var active = window.CrmTheme.get();

    grid.innerHTML = window.CrmTheme.themes
      .map(function (t) {
        // بدنه‌ی نمونه، نوار برند همان تم است — شاخص‌ترین بخش هر تم و همان
        // چیزی که کاربر بالای صفحه می‌بیند. سه نقطه‌ی کنارش زمینه‌ی صفحه و
        // رنگ موفقیت/خطا را نشان می‌دهد. «خودکار» نصف روشن نصف تیره است.
        var swatch =
          t.id === "auto"
            ? '<span class="theme-swatch auto"></span>'
            : '<span class="theme-swatch" data-theme="' + t.id + '">' +
              '<i class="s-bg"></i><i class="s-ok"></i><i class="s-bad"></i>' +
              "</span>";
        return (
          '<button type="button" class="theme-option' + (t.id === active ? " active" : "") + '" data-theme-id="' + t.id + '">' +
          swatch +
          '<span class="theme-name">' + esc(t.label) + "</span>" +
          '<span class="theme-hint">' + esc(t.hint) + "</span>" +
          "</button>"
        );
      })
      .join("");

    Array.prototype.forEach.call(grid.querySelectorAll(".theme-option"), function (btn) {
      btn.addEventListener("click", function () {
        window.CrmTheme.set(btn.getAttribute("data-theme-id"));
        renderThemeGrid();
      });
    });
  }

  // ---------------------------------------------------------------
  // lead form setup (role-specific bits)
  // ---------------------------------------------------------------
  function setupLeadFormForRole() {
    var isManager = state.user.role === "manager";
    $("formTitle").textContent = "ثبت دستی / مراجعه‌ی حضوری";
    $("assignRepWrap").hidden = true;
    $("cImportWrap").hidden = !isManager;
    $("importTemplateLink").hidden = !isManager;
    $("importBtn").hidden = !isManager;
    $("filterOwner").hidden = true;
    $("filterBranch").hidden = !can("all_leads");

    var headRow = $("tableHeadRow");
    headRow.innerHTML =
      "<th>مشتری</th><th>منبع</th><th>فروشگاه / شهر</th><th>مرحله</th><th>پیگیری بعدی</th><th>تاریخ</th>";
  }

  // ---------------------------------------------------------------
  // شعبه‌ها
  // ---------------------------------------------------------------
  function loadBranchesList() {
    return api("/branches").then(function (r) {
      state.branches = r.branches;
      // تا وقتی فقط یک شعبه هست، انتخاب شعبه در فرم‌ها و فیلترها پنهان است (تنظیمات ← شعبه‌ها می‌ماند)
      document.body.classList.toggle("one-branch", r.branches.length <= 1);
      return r.branches;
    });
  }

  function branchOptionsHtml(selectedId) {
    return (state.branches || [])
      .map(function (b) {
        var label = b.name + (b.city ? " — " + b.city : "");
        return (
          '<option value="' + b.id + '"' + (b.id === selectedId ? " selected" : "") + ">" + esc(label) + "</option>"
        );
      })
      .join("");
  }

  function populateBranchSelectors() {
    if (canAny("all_leads", "performance", "demand", "users")) {
      // انتخابگر «همه شعبه‌ها / یک شعبه» در فهرست سرنخ‌ها و در گزارش‌ها
      ["filterBranch"].forEach(function (id) {
        var sel = $(id);
        if (!sel) return;
        var current = sel.value;
        sel.innerHTML = '<option value="">همه شعبه‌ها</option>' + branchOptionsHtml(null);
        sel.value = current;
      });
    }
    var userBranchSel = $("u_branch");
    if (userBranchSel) {
      userBranchSel.innerHTML =
        '<option value="">— انتخاب کنید —</option>' + branchOptionsHtml(state.user.branchId);
      // شعبه‌ها فعلاً پنهان‌اند؛ کاربر تازه خودکار در اولین شعبه قرار می‌گیرد
      if (!userBranchSel.value && userBranchSel.options.length > 1) userBranchSel.selectedIndex = 1;
    }
  }

  function loadBranchesTable() {
    Promise.all([loadBranchesList(), loadUsersList()])
      .then(function (res) {
        var branches = res[0];
        var users = res[1];
        var tbody = $("branchesTbody");
        tbody.innerHTML = branches
          .map(function (b) {
            var count = users.filter(function (u) { return u.branchId === b.id; }).length;
            return (
              "<tr><td>" + esc(b.name) +
              "</td><td>" + (b.city ? esc(b.city) : "—") +
              "</td><td>" + (b.address ? esc(b.address) : "—") +
              "</td><td>" + faNumFmt.format(count) +
              '</td><td><button class="btn btn-ghost btn-sm" data-edit-branch="' + b.id + '">ویرایش</button></td></tr>'
            );
          })
          .join("");
        Array.prototype.forEach.call(tbody.querySelectorAll("[data-edit-branch]"), function (btn) {
          btn.addEventListener("click", function () {
            startBranchEdit(btn.getAttribute("data-edit-branch"));
          });
        });
        populateBranchSelectors();
      })
      .catch(function (err) { toast(err.message, true); });
  }

  function resetBranchForm() {
    state.editingBranchId = null;
    $("branchForm").reset();
    $("branchFormTitle").textContent = "افزودن شعبه جدید";
    $("branchSubmitBtn").textContent = "ایجاد شعبه";
    $("branchCancelBtn").hidden = true;
  }

  function startBranchEdit(id) {
    var b = (state.branches || []).filter(function (x) { return x.id === id; })[0];
    if (!b) return;
    state.editingBranchId = id;
    $("b_name").value = b.name;
    $("b_city").value = b.city || "";
    $("b_address").value = b.address || "";
    $("branchFormTitle").textContent = "ویرایش شعبه";
    $("branchSubmitBtn").textContent = "ذخیره تغییرات";
    $("branchCancelBtn").hidden = false;
  }

  $("branchCancelBtn").addEventListener("click", resetBranchForm);

  $("branchForm").addEventListener("submit", function (e) {
    e.preventDefault();
    var body = {
      name: $("b_name").value.trim(),
      city: $("b_city").value.trim(),
      address: $("b_address").value.trim(),
    };
    var editing = state.editingBranchId;
    var req = editing
      ? api("/branches/" + editing, { method: "PATCH", body: body })
      : api("/branches", { method: "POST", body: body });
    req
      .then(function () {
        toast(editing ? "شعبه به‌روزرسانی شد" : "شعبه جدید ایجاد شد");
        resetBranchForm();
        loadBranchesTable();
      })
      .catch(function (err) { toast(err.message, true); });
  });

  function populateOwnerFilters(users) {
    var reps = users.filter(function (u) { return u.role === "rep" && u.active; });
    var assignSel = $("f_assignRep");
    assignSel.innerHTML =
      '<option value="">— به‌نام خودم (' + esc(state.user.fullName) + ") —</option>" +
      reps.map(function (r) { return '<option value="' + r.id + '">' + esc(r.fullName) + "</option>"; }).join("");
    var filterSel = $("filterOwner");
    filterSel.innerHTML =
      '<option value="">همه کارشناسان</option>' +
      reps.map(function (r) { return '<option value="' + r.id + '">' + esc(r.fullName) + "</option>"; }).join("");
    filterSel.addEventListener("change", loadLeads);
    $("filterBranch").addEventListener("change", loadLeads);
  }

  // ---------------------------------------------------------------
  // leads: list + create
  // ---------------------------------------------------------------
  state.segment = "";

  function currentFilters() {
    var f = {};
    var q = $("search").value.trim();
    var status = $("filterStatus").value;
    if (q) f.q = q;
    if (status) f.status = status;
    if (state.segment) f.segment = state.segment;
    if (can("all_leads") && $("filterOwner").value) f.ownerId = $("filterOwner").value;
    if (can("all_leads") && $("filterBranch").value) f.branchId = $("filterBranch").value;
    return f;
  }

  var faNumFmt = new Intl.NumberFormat("fa-IR");
  function renderSegmentCounts(counts) {
    counts = counts || { all: 0, walkin: 0, social: 0, followup: 0 };
    $("seg_n_all").textContent = faNumFmt.format(counts.all || 0);
    $("seg_n_walkin").textContent = faNumFmt.format(counts.walkin || 0);
    $("seg_n_social").textContent = faNumFmt.format(counts.social || 0);
    $("seg_n_followup").textContent = faNumFmt.format(counts.followup || 0);
  }

  function loadLeads() {
    var params = new URLSearchParams(currentFilters()).toString();
    api("/leads" + (params ? "?" + params : ""))
      .then(function (r) {
        state.leads = r.leads;
        renderLeadsTable();
        renderSegmentCounts(r.counts);
      })
      .catch(function (err) { toast(err.message, true); });
  }

  // با عوض شدن فیلتر، فهرست از صفحه‌ی اول نشان داده می‌شود
  function reloadLeadsFromFirstPage() {
    state.leadsPage = 1;
    loadLeads();
  }

  ["search", "filterStatus"].forEach(function (id) {
    $(id).addEventListener("input", reloadLeadsFromFirstPage);
    $(id).addEventListener("change", reloadLeadsFromFirstPage);
  });

  $("segmentRow").addEventListener("click", function (e) {
    var btn = e.target.closest(".chip");
    if (!btn) return;
    state.segment = btn.getAttribute("data-segment") || "";
    Array.prototype.forEach.call($("segmentRow").querySelectorAll(".chip"), function (c) {
      c.classList.toggle("active", c === btn);
    });
    state.leadsPage = 1;
    loadLeads();
  });

  // --- لیست وظایف: بازه و فیلتر کارشناس ---

  $("exportBtn").addEventListener("click", function () {
    var params = new URLSearchParams(currentFilters()).toString();
    window.location.href = "/api/v1/leads/export" + (params ? "?" + params : "");
  });

  $("importBtn").addEventListener("click", function () {
    $("importFile").click();
  });

  // ورود اکسل مشتریان: اول پیش‌نمایش (چه چیزی ساخته/عوض می‌شود)، بعد با تأیید اعمال
  $("cImportBtn").addEventListener("click", function () { $("cImportFile").click(); });
  $("cImportFile").addEventListener("change", function () {
    var file = this.files && this.files[0];
    this.value = "";
    if (!file) return;
    var send = function (apply) {
      var fd = new FormData();
      fd.append("file", file);
      return fetch("/api/v1/leads/customers-import" + (apply ? "?apply=1" : ""), { method: "POST", body: fd, credentials: "same-origin" })
        .then(function (r) {
          return r.json().catch(function () { return {}; }).then(function (d) {
            if (!r.ok) throw new Error(d.error || "خطا در خواندن فایل");
            return d;
          });
        });
    };
    var f = function (n) { return Jalali.toFaDigits(String(n || 0)); };
    toast("در حال خواندن فایل…");
    send(false)
      .then(function (p) {
        var msg = "ردیف‌های فایل: " + f(p.rows) + "\n" +
          "مشتری تازه: " + f(p.created) + "\n" +
          "به‌روزرسانی: " + f(p.updated) + "\n" +
          "بدون تغییر: " + f(p.unchanged) + (p.duplicateInFile ? "\nشماره‌ی تکراری در فایل: " + f(p.duplicateInFile) : "") +
          (p.kycKept ? "\nوضعیت احرازِ تازه‌تر در CRM نگه داشته شد: " + f(p.kycKept) : "") +
          (p.samples && p.samples.length ? "\n\nنمونه:\n" + p.samples.slice(0, 8).join("\n") : "") +
          (p.warnings && p.warnings.length ? "\n\nهشدار:\n" + p.warnings.slice(0, 5).join("\n") : "") +
          "\n\nاعمال شود؟";
        if (!p.created && !p.updated) { toast("چیزی برای تغییر نیست — همه‌ی مشتری‌های فایل همین حالا همین‌طورند"); return; }
        if (!window.confirm(msg)) return;
        return send(true).then(function (r) {
          toast(f(r.created) + " مشتری تازه ساخته شد و " + f(r.updated) + " مشتری به‌روز شد");
          refreshLeadLists();
        });
      })
      .catch(function (err) { toast(err.message, true); });
  });

  $("importFile").addEventListener("change", function () {
    var file = this.files && this.files[0];
    this.value = ""; // تا انتخاب دوباره‌ی همان فایل هم رویداد change را فعال کند
    if (!file) return;
    var fd = new FormData();
    fd.append("file", file);
    toast("در حال آپلود فایل…");
    fetch("/api/v1/leads/import", { method: "POST", body: fd, credentials: "same-origin" })
      .then(function (r) {
        return r
          .json()
          .catch(function () { return {}; })
          .then(function (data) {
            if (!r.ok) throw new Error(data.error || "خطا در آپلود فایل");
            return data;
          });
      })
      .then(function (data) {
        var msg = data.imported + " سرنخ با موفقیت اضافه شد";
        if (data.skipped) {
          msg += "، " + data.skipped + " ردیف رد شد";
          if (data.warnings && data.warnings.length) {
            msg += " (" + data.warnings.slice(0, 3).join("؛ ") + (data.warnings.length > 3 ? "؛ …" : "") + ")";
          }
        }
        toast(msg, data.skipped > 0);
        if (data.imported > 0) refreshLeadLists();
      })
      .catch(function (err) {
        toast(err.message, true);
      });
  });

  // ستون «پیگیری بعدی»: قرمز اگر گذشته، نارنجی اگر امروز، خنثی اگر آینده.
  // از همان کلاس‌های pill موجود استفاده می‌شود تا ظاهر با بقیه‌ی جدول یکی بماند.
  // «آخرین تماس»: تاریخ شمسی + چند روز گذشته، تا بی‌آنکه پروفایل باز شود معلوم باشد
  // آخرین بار کی به مشتری زنگ زده شده.
  function lastCallCellHtml(ts) {
    if (!ts) return '<span class="cell-sub">—</span>';
    var d = new Date(ts);
    var today = new Date();
    today.setHours(0, 0, 0, 0);
    var day = new Date(d);
    day.setHours(0, 0, 0, 0);
    var diff = Math.round((today - day) / 86400000);
    var ago = diff <= 0 ? "امروز" : diff === 1 ? "دیروز" : Jalali.toFaDigits(String(diff)) + " روز پیش";
    return '<span class="last-call">' + esc(fmtDate(ts)) + '<span class="ago">' + ago + "</span></span>";
  }

  function nextFollowUpCellHtml(ts) {
    if (!ts) return '<span class="cell-sub">—</span>';
    var d = new Date(ts);
    if (isNaN(d.getTime())) return '<span class="cell-sub">—</span>';
    var startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    var endOfToday = new Date();
    endOfToday.setHours(23, 59, 59, 999);

    var cls = "st-new";
    if (d < startOfToday) cls = "st-lost";
    else if (d <= endOfToday) cls = "st-contract";
    return '<span class="pill ' + cls + '" style="font-variant-numeric:tabular-nums;">' + esc(fmtDate(ts)) + "</span>";
  }

  function renderLeadsTable() {
    var isManager = can("all_leads");
    var tbody = $("tbody");
    var empty = $("emptyState");
    $("resultCount").textContent = state.leads.length + " مورد";

    if (state.leads.length === 0) {
      tbody.innerHTML = "";
      empty.hidden = false;
      renderPager("leadsPager", { pages: 1 });
      return;
    }
    empty.hidden = true;

    var pageInfo = paginate(state.leads, state.leadsPage);
    state.leadsPage = pageInfo.page;
    renderPager("leadsPager", pageInfo);

    tbody.innerHTML = pageInfo.rows
      .map(function (l) {
        return (
          '<tr class="clickable" data-id="' + esc(l.id) + '">' +
          "<td>" + nameCellHtml(l) + '<div class="cell-phone">' + phoneHtml(l.phone) + "</div>" + tagsCellHtml(l) + "</td>" +
          "<td>" + channelTagHtml(l.channel) + "</td>" +
          "<td>" + esc([l.shopName, l.city].filter(Boolean).join(" · ") || "—") + "</td>" +
                    "<td>" + (stageTagHtml(l) || '<span class="cell-sub">—</span>') + "</td>" +
          "<td>" + nextFollowUpCellHtml(l.nextFollowUpDate) + "</td>" +
          '<td class="cell-sub" style="font-variant-numeric:tabular-nums;">' + fmtDate(l.createdAt) + "</td>" +
          "</tr>"
        );
      })
      .join("");
    if (window.CrmFile) window.CrmFile.decorateRows(tbody);
  }

  $("tbody").addEventListener("click", function (e) {
    var tr = e.target.closest("tr[data-id]");
    if (tr) openLeadModal(tr.getAttribute("data-id"));
  });

  // ---------------------------------------------------------------
  // صفحه‌بندی — فهرست‌ها به‌جای یک جدول خیلی بلند، صفحه‌صفحه نشان داده می‌شوند.
  // ---------------------------------------------------------------
  function paginate(list, page) {
    var pages = Math.max(1, Math.ceil(list.length / PER_PAGE));
    var current = Math.min(Math.max(1, page || 1), pages);
    var start = (current - 1) * PER_PAGE;
    return { rows: list.slice(start, start + PER_PAGE), page: current, pages: pages, total: list.length, from: start + 1, to: Math.min(start + PER_PAGE, list.length) };
  }

  function pgBtn(page, label, opts) {
    opts = opts || {};
    return (
      '<button type="button" class="pg' + (opts.current ? " current" : "") + '" data-page="' + page + '"' +
      (opts.disabled ? " disabled" : "") + (opts.label ? ' aria-label="' + esc(opts.label) + '"' : "") + ">" +
      esc(label) + "</button>"
    );
  }

  function renderPager(elId, info) {
    var el = $(elId);
    if (info.pages <= 1) { el.hidden = true; el.innerHTML = ""; return; }
    el.hidden = false;

    // پنجره‌ی حداکثر پنج شماره حول صفحه‌ی فعلی، تا نوار صفحه‌بندی بلند نشود
    var from = Math.max(1, info.page - 2);
    var to = Math.min(info.pages, from + 4);
    from = Math.max(1, to - 4);

    var html = pgBtn(info.page - 1, "قبلی", { disabled: info.page === 1 });
    if (from > 1) {
      html += pgBtn(1, Jalali.toFaDigits("1"));
      if (from > 2) html += '<span class="pg-gap">…</span>';
    }
    for (var p = from; p <= to; p++) {
      html += pgBtn(p, Jalali.toFaDigits(String(p)), { current: p === info.page });
    }
    if (to < info.pages) {
      if (to < info.pages - 1) html += '<span class="pg-gap">…</span>';
      html += pgBtn(info.pages, Jalali.toFaDigits(String(info.pages)));
    }
    html += pgBtn(info.page + 1, "بعدی", { disabled: info.page === info.pages });
    html +=
      '<span class="pg-info">' +
      Jalali.toFaDigits(String(info.from)) + "–" + Jalali.toFaDigits(String(info.to)) +
      " از " + Jalali.toFaDigits(String(info.total)) +
      "</span>";
    el.innerHTML = html;
  }

  function setupPager(elId, onGo) {
    $(elId).addEventListener("click", function (e) {
      var btn = e.target.closest("button[data-page]");
      if (!btn || btn.disabled) return;
      onGo(Number(btn.getAttribute("data-page")));
    });
  }

  // بعد از عوض شدن صفحه، بالای جدول دیده شود تا کاربر وسط فهرست گیر نکند
  function scrollToTop(elId) {
    var el = $(elId);
    if (el && el.scrollIntoView) el.scrollIntoView({ block: "start", behavior: "smooth" });
  }

  // ---------------------------------------------------------------
  // برچسب‌های مشتری — یک فهرست مشترک (برچسب‌های آماده + هر برچسبی که تا حالا
  // ساخته شده) که هم در فرم ثبت، هم در فرم ویرایش و هم در فیلتر استفاده می‌شود.
  // ---------------------------------------------------------------
  function leadDisplayName(l) {
    return (l && l.name && String(l.name).trim()) || "";
  }

  // 🌤 لید گرم — چند نشانه‌ی خرید با هم در ۷ روز اخیر (سرور حساب می‌کند)
  function heatBadgeHtml(h) {
    if (!h || !h.level) return "";
    return '<span class="heat-badge warm" title="' + esc((h.reasons || []).join("، ")) + '">🌤 لید گرم</span>';
  }

  // تیک سبز کنار نام مشتریانی که احراز هویت (همکاری) تأیید شده است
  function kycBadgeHtml(l) {
    return l && l.kycStatus === "approved" ? ' <span class="kyc-ok" title="احراز هویت تأیید شده">✅</span>' : "";
  }

  // ---------------------------------------------------------------
  // اصلاح یک پیگیری آزاد که قبلاً ثبت شده (آیکون مداد کنار هر کارت).
  // مراحل اول پیگیری (step) آیکون ندارند — همان باکس بالا ویرایش می‌شود.
  // ---------------------------------------------------------------
  var fuEditId = null;
  var FU_OUTCOME_OPTIONS = ["", "جواب داد", "جواب نداد", "مراجعه حضوری"];

  function followupItemHtml(f) {
    var editBtn = f.step ? "" : '<button type="button" class="fu-edit-btn" data-fu-edit="' + esc(f.id) + '" title="ویرایش این کارت" aria-label="ویرایش">✏️</button>';
    if (fuEditId === f.id) return followupEditFormHtml(f);
    return (
      '<div class="followup-item" data-fu-id="' + esc(f.id) + '"><div class="meta"><span>' +
      esc(f.byName) +
      " · " +
      fmtDate(f.followupDate) +
      "</span>" + editBtn + '</div><div class="content">' +
      esc(f.content) +
      "</div>" +
      (f.outcome
        ? '<div class="outcome tag' + (f.outcome === "جواب داد" ? " call-ok" : f.outcome === "جواب نداد" ? " call-fail" : "") + '">' + esc(f.outcome) + "</div>"
        : "") +
      (f.messageSent ? '<span class="tag tag-sent">پیام ارسال شد</span>' : "") +
      (f.viaSocialMedia ? '<span class="tag tag-sent">شبکه‌های اجتماعی</span>' : "") +
      "</div>"
    );
  }

  function followupEditFormHtml(f) {
    return (
      '<div class="followup-item fu-editing" data-fu-id="' + esc(f.id) + '">' +
      '<div class="cf-box"><div class="cf-row">' +
      '<label class="cf-f cf-span2"><span>یادداشت</span><textarea id="fuEdit_content_' + esc(f.id) + '" rows="2">' + esc(f.content) + "</textarea></label>" +
      '<label class="cf-f"><span>نتیجه</span><select id="fuEdit_outcome_' + esc(f.id) + '">' +
      FU_OUTCOME_OPTIONS.map(function (o) { return '<option value="' + esc(o) + '"' + (o === (f.outcome || "") ? " selected" : "") + '>' + (o || "—") + "</option>"; }).join("") +
      "</select></label></div>" +
      '<div class="cf-btns">' +
      '<button type="button" class="btn btn-primary btn-sm" data-fu-edit-save="' + esc(f.id) + '">ذخیره</button>' +
      '<button type="button" class="btn btn-ghost btn-sm" data-fu-edit-cancel="' + esc(f.id) + '">انصراف</button>' +
      "</div></div></div>"
    );
  }

  // دکمه‌ی مداد و ذخیره/انصراف — روی کل سند، چون کارت‌های پیگیری هم در پرونده‌ی
  // مشتری و هم در «کارهای من» دیده می‌شوند
  document.addEventListener("click", function (e) {
    var editBtn = e.target.closest("[data-fu-edit]");
    if (editBtn) { fuEditId = editBtn.getAttribute("data-fu-edit"); rerenderFollowupsInPlace(); return; }
    var cancelBtn = e.target.closest("[data-fu-edit-cancel]");
    if (cancelBtn) { fuEditId = null; rerenderFollowupsInPlace(); return; }
    var saveBtn = e.target.closest("[data-fu-edit-save]");
    if (saveBtn) {
      var fid = saveBtn.getAttribute("data-fu-edit-save");
      var leadId = state.activeLeadId;
      if (!leadId) return;
      var content = ($("fuEdit_content_" + fid) || {}).value || "";
      var outcome = ($("fuEdit_outcome_" + fid) || {}).value || "";
      saveBtn.disabled = true;
      api("/leads/" + leadId + "/followups/" + fid, { method: "PATCH", body: { content: content.trim(), outcome: outcome } })
        .then(function () {
          toast("کارت ویرایش شد");
          fuEditId = null;
          openLeadModal(leadId);
        })
        .catch(function (err) { toast(err.message, true); saveBtn.disabled = false; });
      return;
    }
  });

  // بعد از باز/بسته کردن فرم ویرایش، فقط همان لیست (بدون درخواست از سرور) دوباره رسم می‌شود
  function rerenderFollowupsInPlace() {
    if (!$("m_followups") || !state.activeFollowups) return;
    if (state.activePhoneCalls && state.activePhoneCalls.length) { renderFollowupsAndCalls(); return; }
    $("m_followups").innerHTML = state.activeFollowups.length
      ? state.activeFollowups.map(followupItemHtml).join("")
      : '<div class="cell-sub">هنوز تماسی ثبت نشده است.</div>';
  }

  function nameCellHtml(l) {
    var name = leadDisplayName(l);
    var hot = l && l.heat ? " hot" : "";
    return name
      ? '<div class="cell-name' + hot + '">' + esc(name) + kycBadgeHtml(l) + heatBadgeHtml(l && l.heat) + "</div>"
      : '<div class="cell-name name-empty' + hot + '">بدون نام' + kycBadgeHtml(l) + heatBadgeHtml(l && l.heat) + "</div>";
  }

  function tagsCellHtml(l) {
    var tags = (l && l.tags) || [];
    if (!tags.length) return "";
    return '<div class="cell-tags">' + tags.map(function (t) { return '<span class="tag">' + esc(t) + "</span>"; }).join("") + "</div>";
  }

  function loadKnownTags() {
    return api("/leads/tags")
      .then(function (r) {
        state.knownTags = r.tags || [];
        fillTagFilter();
        return state.knownTags;
      })
      .catch(function () {
        // اگر خوانده نشد، فقط فهرست پیشنهادی خالی می‌ماند — جایی از برنامه نمی‌شکند
        state.knownTags = [];
        return [];
      });
  }

  function fillTagFilter() {
    var sel = $("cTag");
    if (!sel) return;
    var current = sel.value;
    sel.innerHTML =
      '<option value="">همه برچسب‌ها</option>' +
      state.knownTags.map(function (t) { return '<option value="' + esc(t) + '">' + esc(t) + "</option>"; }).join("");
    sel.value = current;
  }

  // سازنده‌ی انتخابگر برچسب. هر بار که باز می‌شود، فهرست مشترک به‌علاوه‌ی
  // برچسب‌های خودِ همین سرنخ نمایش داده می‌شود تا برچسب قدیمی گم نشود.
  function makeTagPicker(listId, inputId, addBtnId) {
    var selected = [];

    function render() {
      var all = state.knownTags.slice();
      selected.forEach(function (t) { if (all.indexOf(t) === -1) all.push(t); });
      var wrap = $(listId);
      if (!all.length) {
        wrap.innerHTML = '<span class="empty">هنوز برچسبی ساخته نشده — از کادر پایین اضافه کنید.</span>';
        return;
      }
      wrap.innerHTML = all
        .map(function (t) {
          var active = selected.indexOf(t) !== -1;
          return (
            '<button type="button" class="chip' + (active ? " active" : "") + '" data-tag="' + esc(t) + '"' +
            ' aria-pressed="' + (active ? "true" : "false") + '">' + esc(t) + "</button>"
          );
        })
        .join("");
    }

    function add(tag) {
      var clean = String(tag || "").trim().slice(0, 30);
      if (!clean) return;
      if (selected.indexOf(clean) === -1) selected.push(clean);
      if (state.knownTags.indexOf(clean) === -1) state.knownTags.push(clean);
      render();
    }

    $(listId).addEventListener("click", function (e) {
      var btn = e.target.closest("[data-tag]");
      if (!btn) return;
      var tag = btn.getAttribute("data-tag");
      var i = selected.indexOf(tag);
      if (i === -1) selected.push(tag);
      else selected.splice(i, 1);
      render();
    });

    $(addBtnId).addEventListener("click", function () {
      add($(inputId).value);
      $(inputId).value = "";
      $(inputId).focus();
    });

    // Enter داخل کادر «برچسب جدید» نباید کل فرم را ثبت کند
    $(inputId).addEventListener("keydown", function (e) {
      if (e.key !== "Enter") return;
      e.preventDefault();
      add(this.value);
      this.value = "";
    });

    return {
      render: render,
      get: function () { return selected.slice(); },
      set: function (tags) { selected = (tags || []).slice(); render(); },
      clear: function () { selected = []; render(); },
    };
  }

  var newLeadTags = makeTagPicker("f_tags", "f_tag_new", "f_tag_add");
  var editLeadTags = makeTagPicker("me_tags", "me_tag_new", "me_tag_add");


  // قدم بعدی در ثبت دستی اختیاری است؛ «بدون پیگیری» یعنی تاریخ خالی
  function markNextChip(days) {
    Array.prototype.forEach.call($("f_next_quick").querySelectorAll("[data-f-next]"), function (c) {
      c.classList.toggle("active", c.getAttribute("data-f-next") === days);
    });
  }
  $("f_next_quick").addEventListener("click", function (e) {
    var b = e.target.closest("[data-f-next]");
    if (!b) return;
    var days = Number(b.getAttribute("data-f-next"));
    markNextChip(b.getAttribute("data-f-next"));
    if (!days) { $("f_next_date").value = ""; return; }
    var d = new Date();
    d.setDate(d.getDate() + days);
    $("f_next_date").value = Jalali.formatDate(d, { faDigits: true });
  });
  $("f_next_date").addEventListener("input", function () { markNextChip(this.value.trim() ? "" : "0"); });

  // جلوگیری از ثبت تکراری: همان لحظه‌ی تایپ شماره بررسی می‌شود که مشتری قبلاً ثبت شده یا نه
  var phoneDup = null, phoneDupTimer = null, phoneDupSeq = 0;
  function showPhoneDup(d) {
    phoneDup = d;
    var box = $("f_phone_dup");
    box.hidden = !d;
    $("submitBtn").disabled = !!d;
    if (!d) { box.innerHTML = ""; return; }
    box.innerHTML = "⚠ این مشتری قبلاً ثبت شده است: <b>" + esc(d.name) + "</b> (" + esc(d.phone) + ")" +
      (d.ownerName ? " — کارشناس: " + esc(d.ownerName) : "") +
      (d.canOpen ? ' <button type="button" class="btn btn-ghost btn-sm" data-open-dup="' + esc(d.id) + '">باز کردن پرونده</button>' : "");
  }
  function checkPhoneDup() {
    var raw = $("f_phone").value;
    var digits = raw.replace(/[۰-۹]/g, function (x) { return "۰۱۲۳۴۵۶۷۸۹".indexOf(x); }).replace(/\D/g, "");
    if (digits.length < 10) { showPhoneDup(null); return; }
    var seq = ++phoneDupSeq;
    api("/leads/check-phone?phone=" + encodeURIComponent(raw))
      .then(function (r) { if (seq === phoneDupSeq) showPhoneDup(r.lead || null); })
      .catch(function () { if (seq === phoneDupSeq) showPhoneDup(null); });
  }
  $("f_phone").addEventListener("input", function () { clearTimeout(phoneDupTimer); phoneDupTimer = setTimeout(checkPhoneDup, 350); });
  $("f_phone_dup").addEventListener("click", function (e) {
    var b = e.target.closest("[data-open-dup]");
    if (b) openLeadModal(b.getAttribute("data-open-dup"));
  });

  $("leadForm").addEventListener("submit", function (e) {
    e.preventDefault();
    if (phoneDup) { toast("این مشتری قبلاً ثبت شده است — پرونده‌اش را باز کنید", true); return; }
    if (!$("f_channel").value) { toast("منبع ورود مشتری را انتخاب کنید", true); $("f_channel").focus(); return; }
    var rawNextStep = $("f_next_date").value.trim();
    var nextStep = rawNextStep ? Jalali.parseDate(rawNextStep) : null;
    if (rawNextStep && !nextStep) { toast("تاریخ پیگیری معتبر نیست — به شکل ۱۴۰۵/۰۶/۰۹ بنویسید یا «بدون پیگیری» را بزنید", true); $("f_next_date").focus(); return; }
    var data = {
      name: $("f_name").value.trim(),
      phone: $("f_phone").value.trim(),
      channel: $("f_channel").value,
      tags: newLeadTags.get(),
      contactMethods: Array.prototype.slice
        .call($("f_contactMethods").querySelectorAll("input:checked"))
        .map(function (c) { return c.value; }),
      priceFrom: $("f_pricefrom").value || null,
      priceTo: $("f_priceto").value || null,
      payment: $("f_payment").value,
      delivery: $("f_delivery").value,
      shopName: $("f_shop").value.trim(),
      city: $("f_city").value.trim(),
      jobType: $("f_jobtype").value,
      notes: $("f_notes").value.trim(),
      nextFollowUpDate: nextStep ? nextStep.toISOString() : "",
      nextFollowUpNote: $("f_next_note").value.trim(),
    };
    if (can("all_leads") && $("f_assignRep").value) {
      data.assignedRepId = $("f_assignRep").value;
    }
    var btn = $("submitBtn");
    btn.disabled = true;
    btn.textContent = "در حال ثبت…";
    api("/leads", { method: "POST", body: data })
      .then(function () {
        $("leadForm").reset();
        markNextChip("0");
        showPhoneDup(null);
        newLeadTags.clear();
        // برچسب تازه‌ساخته‌شده بلافاصله برای بقیه‌ی فرم‌ها و فیلتر هم در دسترس باشد
        loadKnownTags();
        toast("سرنخ با موفقیت ثبت شد");
        refreshLeadLists();
        if (state.activeTab === "dashboard") loadDashboard();
      })
      .catch(function (err) { toast(err.message, true); })
      .finally(function () {
        btn.disabled = false;
        btn.textContent = "ثبت سرنخ";
      });
  });

  // ---------------------------------------------------------------
  // تب مشتریان — همان سرنخ‌ها، ولی تمام‌عرض و با مرتب‌سازی
  // ---------------------------------------------------------------
  //
  // چرا تب جدا؟ تب «ثبت سرنخ» برای وارد کردن اطلاعات است و جدولش کنار فرم
  // جا می‌شود. اینجا فقط مرور و جست‌وجوست، پس تمام عرض صفحه در اختیار جدول
  // است و ستون‌های بیشتری جا می‌شوند.

  // ستون‌ها یک‌جا تعریف می‌شوند تا سرستون و سلول همیشه هم‌ترتیب بمانند.
  // sort خالی یعنی آن ستون قابل مرتب‌سازی نیست.
  function customerColumns() {
    var cols = [
      { key: "name", label: "مشتری", sort: "name" },
      { key: "channel", label: "منبع", sort: "channel" },
      { key: "price", label: "فروشگاه / شهر", sort: "city" },
      { key: "status", label: "مرحله", sort: "" },
      { key: "lastCall", label: "آخرین تماس", sort: "lastCallAt" },
      { key: "next", label: "پیگیری بعدی", sort: "nextFollowUpDate" },
      { key: "created", label: "تاریخ ثبت", sort: "createdAt" },
    ];
    return cols;
  }

  function currentSort() {
    var parts = String(state.customerSort || "createdAt:desc").split(":");
    return { field: parts[0], dir: parts[1] === "asc" ? "asc" : "desc" };
  }

  function renderCustomerHead() {
    var s = currentSort();
    $("cHeadRow").innerHTML = (isAdmin() ? '<th class="sel-cell"><input type="checkbox" id="cSelAll" aria-label="انتخاب همه‌ی مشتریان این فهرست" title="انتخاب همه‌ی مشتریان این فهرست (همه‌ی صفحه‌ها)"></th>' : "") + customerColumns()
      .map(function (c) {
        if (!c.sort) return "<th>" + esc(c.label) + "</th>";
        var active = c.sort === s.field;
        // فلش جهت فقط روی ستون فعال؛ بقیه یک نشانه‌ی کم‌رنگ دارند تا معلوم
        // باشد قابل کلیک‌اند.
        var arrow = active ? (s.dir === "asc" ? "▲" : "▼") : "⇅";
        return (
          '<th class="sortable' + (active ? " sorted" : "") + '" data-sort="' + c.sort + '">' +
          esc(c.label) + '<span class="sort-arrow">' + arrow + "</span></th>"
        );
      })
      .join("");
  }

  function customerFilters() {
    var s = currentSort();
    var f = { sort: s.field, dir: s.dir };
    var q = $("cSearch").value.trim();
    if (q) f.q = q;
    if ($("cChannel").value) f.channel = $("cChannel").value;
    if ($("cTag").value) f.tag = $("cTag").value;
    if ($("cOutcome").value) f.outcome = $("cOutcome").value;
    if ($("cNoPurchase").checked) f.noPurchase = "1";
    return f;
  }

  function loadCustomers() {
    renderCustomerHead();
    fillCustomerOwnerFilter();
    var params = new URLSearchParams(customerFilters()).toString();
    api("/leads?" + params)
      .then(function (r) {
        state.customerLeads = r.leads || [];
        renderCustomersTable();
      })
      .catch(function (e) { toast(e.message, true); });
  }

  // رسم دوباره‌ی جدول مشتریان از روی فهرستی که قبلاً گرفته شده — عوض کردن صفحه
  // نباید دوباره از سرور بخواند.
  // ---- نوار مرحله‌ی مشتری (منطق در shared/customer-stage.js؛ سرور روی هر ردیف stage می‌گذارد) ----
  var C_STAGES = [
    { code: "inquiry", label: "تماس اولیه" },
    { code: "form_sent", label: "منتظر مدارک" },
    { code: "docs_needed", label: "منتظر مدارک (بدون لینک)" },
    { code: "form_review", label: "منتظر تأیید کارشناس" },
    { code: "rejected", label: "رد — باید اطلاع دهید" },
    { code: "rejected_done", label: "رد — اطلاع داده شد" },
    { code: "approved", label: "تأیید شده" },
    { code: "bought", label: "خرید کرد" },
    { code: "inactive", label: "غیرفعال" },
  ];
  function renderStageBar(all) {
    var n = {};
    all.forEach(function (l) { if (l.stage) n[l.stage.code] = (n[l.stage.code] || 0) + 1; });
    var cur = state.customerStage || "";
    var html = '<button type="button" class="chip' + (cur ? "" : " active") + '" data-cstg="">همه <span class="n">' +
      Jalali.toFaDigits(String(all.length)) + "</span></button>";
    C_STAGES.forEach(function (s) {
      if (!n[s.code]) return; // پله‌ی خالی شلوغی می‌کند
      html += '<button type="button" class="chip' + (cur === s.code ? " active" : "") + '" data-cstg="' + s.code + '">' +
        esc(s.label) + ' <span class="n">' + Jalali.toFaDigits(String(n[s.code])) + "</span></button>";
    });
    $("cStageBar").innerHTML = html;
  }
  $("cStageBar").addEventListener("click", function (e) {
    var b = e.target.closest("[data-cstg]");
    if (!b) return;
    state.customerStage = b.getAttribute("data-cstg");
    state.customerPage = 1;
    renderCustomersTable();
  });

  function renderCustomersTable() {
    var all = state.customerLeads;
    renderStageBar(all);
    var list = state.customerStage ? all.filter(function (l) { return l.stage && l.stage.code === state.customerStage; }) : all;
    $("cCount").textContent = Jalali.toFaDigits(String(list.length)) + " مشتری";
    $("cEmpty").hidden = list.length > 0;

    if (list.length === 0) {
      $("cTbody").innerHTML = "";
      renderPager("cPager", { pages: 1 });
      return;
    }

    var pageInfo = paginate(list, state.customerPage);
    state.customerPage = pageInfo.page;
    renderPager("cPager", pageInfo);

    var isManager = can("all_leads");
    $("cTbody").innerHTML = pageInfo.rows
      .map(function (l) {
        var checked = state.customerSelected[l.id] ? " checked" : "";
        return (
          '<tr class="clickable' + (l.heat ? " row-hot" : "") + '" data-id="' + esc(l.id) + '">' +
          (isAdmin() ? '<td class="sel-cell"><input type="checkbox" class="cSel" data-id="' + esc(l.id) + '"' + checked + ' aria-label="انتخاب"></td>' : "") +
          "<td>" + nameCellHtml(l) + '<div class="cell-phone">' + phoneHtml(l.phone) + "</div>" + tagsCellHtml(l) + "</td>" +
          "<td>" + channelTagHtml(l.channel) + "</td>" +
          "<td>" + esc([l.shopName, l.city].filter(Boolean).join(" · ") || "—") + "</td>" +
          "<td>" + (stageTagHtml(l) || '<span class="cell-sub">—</span>') + "</td>" +
                              "<td>" + lastCallCellHtml(l.lastCallAt) + "</td>" +
          "<td>" + nextFollowUpCellHtml(l.nextFollowUpDate) + "</td>" +
          '<td class="cell-sub" style="font-variant-numeric:tabular-nums;">' + fmtDate(l.createdAt) + "</td>" +
          "</tr>"
        );
      })
      .join("");
    updateSelectionBar();
  }


  // --- انتخاب چند مشتری برای حذف (فقط مدیر) ---
  function selectedIds() { return Object.keys(state.customerSelected); }
  function isAdmin() { return !!state.user && state.user.role === "manager"; }

  $("cDeleteSelected").addEventListener("click", function () {
    var ids = selectedIds();
    if (!ids.length || !isAdmin()) return;
    if (!confirm(Jalali.toFaDigits(String(ids.length)) + " مشتری با همه‌ی پیگیری‌ها و سوابقشان برای همیشه حذف شوند؟")) return;
    api("/leads/bulk-delete", { method: "POST", body: { ids: ids } })
      .then(function (r) {
        state.customerSelected = {};
        updateSelectionBar();
        toast(Jalali.toFaDigits(String(r.count || 0)) + " مشتری حذف شد");
        refreshLeadLists();
      })
      .catch(function (err) { toast(err.message, true); });
  });

  function updateSelectionBar() {
    var n = selectedIds().length;
    var btn = $("cDeleteSelected");
    if (!btn) return;
    btn.hidden = n === 0 || !isAdmin();
    btn.textContent = "حذف " + Jalali.toFaDigits(String(n)) + " مشتری";
    // تیک سرستون وقتی روشن است که همه‌ی فهرست فیلترشده (نه فقط این صفحه) انتخاب باشد
    var all = $("cSelAll");
    if (all) {
      var list = state.customerLeads || [];
      var allChecked = list.length > 0;
      for (var i = 0; i < list.length; i++) if (!state.customerSelected[list[i].id]) { allChecked = false; break; }
      all.checked = allChecked;
    }
  }

  $("cTbody").addEventListener("change", function (e) {
    var cb = e.target.closest(".cSel");
    if (!cb) return;
    if (cb.checked) state.customerSelected[cb.getAttribute("data-id")] = true;
    else delete state.customerSelected[cb.getAttribute("data-id")];
    updateSelectionBar();
  });

  $("cHeadRow").addEventListener("change", function (e) {
    if (e.target.id !== "cSelAll") return;
    // «انتخاب همه» یعنی همه‌ی مشتریان فهرست فیلترشده در همه‌ی صفحه‌ها — نه فقط
    // ۲۵ تای این صفحه.
    var on = e.target.checked;
    (state.customerLeads || []).forEach(function (l) {
      if (on) state.customerSelected[l.id] = true;
      else delete state.customerSelected[l.id];
    });
    Array.prototype.forEach.call(document.querySelectorAll("#cTbody .cSel"), function (cb) { cb.checked = on; });
    updateSelectionBar();
  });

  // مودال جزئیات سرنخ از هر تبی می‌تواند باز شده باشد (سرنخ‌ها یا مشتریان)؛
  // بعد از هر ذخیره‌ای که در آن اتفاق می‌افتد، هر دو فهرست را به‌روز می‌کنیم
  // تا اگر کاربر برگردد به تب دیگر، داده‌ی کهنه نبیند.
  function refreshLeadLists() {
    loadLeads();
    if (state.activeTab === "customers") loadCustomers();
  }

  function fillCustomerOwnerFilter() {
    var sel = $("cOwner");
    if (!can("all_leads")) { sel.hidden = true; return; }
    sel.hidden = false;
    if (sel.getAttribute("data-filled") === "1") return;
    api("/users")
      .then(function (r) {
        var reps = (r.users || []).filter(function (u) { return u.role === "rep" && u.active; });
        sel.innerHTML =
          '<option value="">همه کارشناسان</option>' +
          reps.map(function (u) { return '<option value="' + esc(u.id) + '">' + esc(u.fullName) + "</option>"; }).join("");
        sel.setAttribute("data-filled", "1");
      })
      .catch(function () { /* بدون فهرست کارشناسان هم بقیه‌ی صفحه کار می‌کند */ });
  }

  // کلیک روی سرستون: بار اول نزولی، کلیک دوباره روی همان ستون جهت را برعکس
  // می‌کند — رفتاری که کاربر از هر جدولی انتظار دارد.
  $("cHeadRow").addEventListener("click", function (e) {
    var th = e.target.closest("th[data-sort]");
    if (!th) return;
    var field = th.getAttribute("data-sort");
    var s = currentSort();
    var dir = s.field === field && s.dir === "desc" ? "asc" : "desc";
    state.customerSort = field + ":" + dir;
    $("cSort").value = state.customerSort;
    state.customerPage = 1;
    loadCustomers();
  });

  $("cSort").addEventListener("change", function () {
    state.customerSort = $("cSort").value;
    state.customerPage = 1;
    loadCustomers();
  });

  // با عوض شدن هر فیلتر، دوباره از صفحه‌ی اول شروع می‌شود
  function reloadCustomersFromFirstPage() {
    state.customerPage = 1;
    // با عوض شدن فیلتر، انتخاب قبلی پاک می‌شود تا مشتری‌هایی که دیگر در فهرست
    // نیستند ناخواسته حذف نشوند.
    state.customerSelected = {};
    loadCustomers();
  }

  ["cSearch", "cChannel", "cTag", "cOwner", "cOutcome", "cNoPurchase"].forEach(function (id) {
    $(id).addEventListener("input", reloadCustomersFromFirstPage);
    $(id).addEventListener("change", reloadCustomersFromFirstPage);
  });

  setupPager("cPager", function (page) {
    state.customerPage = page;
    renderCustomersTable();
    scrollToTop("cTbody");
  });

  setupPager("leadsPager", function (page) {
    state.leadsPage = page;
    renderLeadsTable();
    scrollToTop("tbody");
  });

  $("cTbody").addEventListener("click", function (e) {
    if (e.target.closest(".sel-cell")) return;
    var tr = e.target.closest("tr[data-id]");
    if (tr) openLeadModal(tr.getAttribute("data-id"));
  });

  $("cExport").addEventListener("click", function () {
    var params = new URLSearchParams(customerFilters()).toString();
    window.location.href = "/api/v1/leads/export" + (params ? "?" + params : "");
  });

  // ---------------------------------------------------------------
  // lead detail modal
  // ---------------------------------------------------------------
  function openLeadModal(id) {
    api("/leads/" + id)
      .then(function (r) {
        state.activeLeadId = id;
        $("m_deleteBtn").hidden = !isAdmin();
        if (window.CrmKycDesk && window.CrmKycDesk.renderDocs) window.CrmKycDesk.renderDocs($("m_docs"), id, true);
        renderLeadModal(r.lead, r.followups);
        renderPhoneHistory(r);
        if (window.CrmWorkdesk) window.CrmWorkdesk.onLead(r.lead);
        if (window.CrmFile) window.CrmFile.onLead(r.lead);
        setOverlay("overlay", true);
      })
      .catch(function (err) { toast(err.message, true); });
  }

  function renderLeadModal(l, followups) {
    // نگه داشتن خود سرنخ، چون دکمه‌های پیامک آماده و فرم ویرایش به اطلاعاتش نیاز دارند
    state.activeLead = l;
    state.activeFollowups = followups || [];
    // فرم ویرایش هر بار بسته شروع می‌شود
    closeEditForm();
    $("m_title").innerHTML = esc(leadDisplayName(l) || "بدون نام") + kycBadgeHtml(l);
    var kv = [
      ["تلفن", phoneHtml(l.phone)],
      ["برچسب‌ها", (l.tags || []).map(function (t) { return '<span class="tag">' + esc(t) + "</span>"; }).join("") || "—"],
      ["کانال آشنایی", esc(l.channel || "—")],
      ["روش ارتباط ترجیحی", (l.contactMethods || []).map(esc).join("، ") || "—"],
      ["فروشگاه / تعمیرگاه", esc(l.shopName || "—")],
      ["کد آلور", l.alvarCode ? '<span dir="ltr">' + esc(l.alvarCode) + "</span>" : "—"],
      ["شهر", esc(l.city || "—")],
      ["نوع مشتری", esc(l.jobType || "—")],
      ["تاریخ ثبت", fmtDateTime(l.createdAt)],
    ];
    if (l.status === "فروش ناموفق" && l.cancelReason) kv.push(["دلیل انصراف", esc(l.cancelReason)]);
    $("m_kv").innerHTML = kv.map(function (row) { return "<dt>" + row[0] + "</dt><dd>" + row[1] + "</dd>"; }).join("");

    // توضیحات عمداً جدا و پررنگ‌تر از بقیه‌ی فیلدها — تا کارشناس دقیق‌تر بنویسدش.
    // با محافظِ null: اگر مرورگر HTML قدیمی را کش کرده و این باکس هنوز در
    // صفحه نیست، بقیه‌ی پروفایل (وضعیت، پیگیری‌ها، دکمه‌ها) باز هم باز شود.
    if ($("m_notesText")) $("m_notesText").hidden = !l.notes;
    if ($("m_notesText")) $("m_notesText").innerHTML = l.notes ? esc(l.notes).split("\n").join("<br>") : "";

    renderFirstTouchBoxes(l, followups);

    // هر بار که پرونده باز می‌شود، دکمه‌های «ثبت فروش موفق/ناموفق» از نو نشان داده می‌شوند
    // (قبلاً بعد از یک بار زدن، برای مشتری‌های بعدی هم پنهان می‌ماندند تا صفحه refresh شود)
    $("m_status").value = l.status || "جدید";
    $("m_directSaleWrap").hidden = false;
    $("m_cancelWrap").hidden = true;
    $("m_cancelWrap").classList.remove("direct");
    $("m_cancelReason").value = "";
    $("m_soldWrap").hidden = true;
    $("m_soldWrap").classList.remove("direct");
    $("m_soldPrice").value = "";
    $("m_saveStatus").textContent = "ذخیره تغییرات";
    var fileBody = document.querySelector("#overlay .modal-file .modal-body");
    if (fileBody) fileBody.scrollTop = 0; // اگر مرورگر قدیمی قاب را جابه‌جا کرده بود
    if ($("m_soldBadge")) $("m_soldBadge").hidden = l.status !== "فروش موفق";
    if ($("m_lostBadge")) $("m_lostBadge").hidden = l.status !== "فروش ناموفق";

    // یادآوری پیگیری بعدی — تاریخ به شمسی نمایش داده می‌شود
    $("m_next_date").value = l.nextFollowUpDate ? Jalali.formatDate(l.nextFollowUpDate, { faDigits: true }) : "";
    $("m_next_note").value = l.nextFollowUpNote || "";
    updateNextDateHint();

    fuEditId = null;
    state.activePhoneCalls = [];
    $("m_followups").innerHTML = followups.length
      ? followups.map(followupItemHtml).join("")
      : '<div class="cell-sub">هنوز تماسی ثبت نشده است.</div>';

    resetCallForm();
  }

  // ---------------------------------------------------------------
  // «ثبت پیگیری» در پروفایل — کارت‌های یک‌ضربه‌ای (جواب داد / جواب نداد / پیام / حضوری).
  // تاریخ پیش‌فرض امروز؛ یادداشت و پیگیری بعدی اختیاری و با یک ضربه.
  // ---------------------------------------------------------------
  var FU_KINDS = {
    ok: { label: "تماس — جواب داد", body: { kind: "call", outcome: "جواب داد" }, chips: ["فقط قیمت پرسید", "به قیمت اعتراض کرد", "سفارش داد", "منتظر موجودی است", "مقایسه می‌کند", "بعداً تماس بگیرم", "منصرف شد"] },
    noanswer: { label: "تماس — جواب نداد", body: { kind: "call", outcome: "جواب نداد" }, chips: ["خاموش بود", "مشغول بود", "رد تماس داد", "پیام گذاشتم"] },
    msg: { label: "پیام دادم", body: { messageSent: true }, chips: ["لیست قیمت فرستادم", "عکس محصول فرستادم", "پیام یادآوری", "لینک احراز فرستادم"] },
    visit: { label: "حضوری آمد", body: { outcome: "مراجعه حضوری" }, chips: ["محصول را دید", "قیمت گرفت", "خرید کرد", "پیش‌پرداخت داد"] },
  };
  var fuKind = "";
  var fuNext = 0;
  var fuDate = null; // null = همین حالا

  function resetCallForm() {
    if (!$("m_fu")) return; // HTML قدیمیِ کش‌شده
    fuKind = "";
    fuNext = 0;
    fuDate = null;
    $("m_fu_more").hidden = true;
    $("m_fu_date_wrap").hidden = true;
    $("m_fu_date").value = "";
    $("m_fu_note").value = "";
    $("m_fu_when").textContent = "امروز";
    Array.prototype.forEach.call($("m_fu_kinds").querySelectorAll(".fu-kind"), function (b) { b.classList.remove("on"); });
    setFuNext(0);
  }

  function setFuNext(n) {
    fuNext = n;
    Array.prototype.forEach.call($("m_fu_next").querySelectorAll(".fu-chip"), function (b) {
      b.classList.toggle("on", Number(b.getAttribute("data-next")) === n);
    });
  }

  if ($("m_fu")) {
    $("m_fu_kinds").addEventListener("click", function (e) {
      var b = e.target.closest(".fu-kind");
      if (!b) return;
      fuKind = b.getAttribute("data-kind");
      Array.prototype.forEach.call($("m_fu_kinds").querySelectorAll(".fu-kind"), function (x) { x.classList.toggle("on", x === b); });
      // CRM نمونه: گزینه‌های «چه شد؟» از «تنظیمات ← گزینه‌های ثبت پیگیری» به شکل منوی کشویی (با جست‌وجو و افزودن)
      var chipsBox = $("m_fu_chips");
      var kindNow = fuKind;
      var fuOpts = function (list) { return list.map(function (x) { return '<option value="' + esc(x.body) + '">' + esc(x.title) + "</option>"; }).join(""); };
      var fuFallback = FU_KINDS[kindNow].chips.map(function (c) { return { title: c, body: c }; });
      chipsBox.innerHTML = "";
      api("/workdesk/scripts?kind=fu_" + fuKind).then(function (r) { return r.scripts && r.scripts.length ? r.scripts : fuFallback; }, function () { return fuFallback; }).then(function (list) {
        if (fuKind !== kindNow) return;
        chipsBox.innerHTML = '<select id="m_fu_pick" data-combo="fu_' + kindNow + '" aria-label="انتخاب از گزینه‌های آماده"><option value="">انتخاب از گزینه‌های آماده…</option>' + fuOpts(list) + "</select>";
      });
      $("m_fu_more").hidden = false;
      // «جواب نداد» معمولاً یعنی فردا دوباره تماس
      setFuNext(fuKind === "noanswer" ? 1 : 0);
      $("m_fu_save").focus();
    });
    $("m_fu_chips").addEventListener("change", function (e) {
      if (e.target.id !== "m_fu_pick" || !e.target.value) return;
      var t = e.target.value;
      var cur = $("m_fu_note").value.trim();
      if (cur.indexOf(t) === -1) $("m_fu_note").value = cur ? cur + "، " + t : t;
      e.target.value = "";
    });
    $("m_fu_next").addEventListener("click", function (e) {
      var b = e.target.closest("[data-next]");
      if (b) setFuNext(Number(b.getAttribute("data-next")));
    });
    $("m_fu_cancel").addEventListener("click", resetCallForm);
    $("m_fu_date_btn").addEventListener("click", function () {
      $("m_fu_date_wrap").hidden = !$("m_fu_date_wrap").hidden;
      if (!$("m_fu_date_wrap").hidden) {
        $("m_fu_date").value = Jalali.formatDate(Date.now(), { faDigits: true });
        $("m_fu_date").focus();
      }
    });
    $("m_fu_date").addEventListener("input", function () {
      var raw = $("m_fu_date").value.trim();
      var d = raw ? Jalali.parseDate(raw) : null;
      var hint = $("m_fu_date_hint");
      if (!d) { hint.textContent = "تاریخ معتبر نیست"; hint.style.color = "#b4444a"; fuDate = null; return; }
      hint.style.color = "";
      hint.textContent = Jalali.formatLong(d);
      var now = new Date();
      if (d.toDateString() === now.toDateString()) { fuDate = null; $("m_fu_when").textContent = "امروز"; return; }
      d.setHours(12, 0, 0, 0);
      fuDate = d;
      $("m_fu_when").textContent = Jalali.formatLong(d);
    });
    $("m_fu_save").addEventListener("click", function () {
      if (!state.activeLeadId || !fuKind) return;
      var when = fuDate || new Date();
      var endOfToday = new Date();
      endOfToday.setHours(23, 59, 59, 999);
      if (when > endOfToday) { toast("تاریخ پیگیری نمی‌تواند بعد از امروز باشد", true); return; }
      var k = FU_KINDS[fuKind];
      var body = Object.assign({}, k.body, { content: $("m_fu_note").value.trim() || (k.body.outcome ? "" : k.label), followupDate: when.toISOString(), kindLabel: k.label });
      if (fuNext) {
        var nd = new Date();
        nd.setDate(nd.getDate() + fuNext);
        nd.setHours(10, 0, 0, 0);
        body.nextFollowUpDate = nd.toISOString();
        var fuTxt = $("m_fu_note").value.trim();
        body.nextFollowUpNote = ("پیگیری: " + k.label + (fuTxt ? " — " + fuTxt : "")).slice(0, 190);
      }
      var btn = $("m_fu_save");
      btn.disabled = true;
      var id = state.activeLeadId;
      api("/leads/" + id + "/followups", { method: "POST", body: body })
        .then(function () {
          toast("پیگیری ثبت شد ✓ — یک امتیاز به کارنامه‌تان اضافه شد");
          refreshLeadLists();
          openLeadModal(id);
        })
        .catch(function (err) { toast(err.message, true); })
        .finally(function () { btn.disabled = false; });
    });
  }

  // ---------------------------------------------------------------
  // پیگیری مرحله اول — ۴ باکس ثابت (پیام، تماس ۱، تماس ۲، تماس ۳) به‌علاوه‌ی
  // دکمه‌ی «+» برای مراحل بیشتر. ترتیب باید رعایت شود: تا باکس قبلی انجام
  // نشود، باکس بعدی قفل است — هم اینجا (ظاهر) و هم در سرور (leadService.js).
  // ---------------------------------------------------------------
  function ftStepLabel(step) {
    if (step === "message") return "ارسال پیام";
    var m = /^call(\d+)$/.exec(step || "");
    return m ? "تماس " + Jalali.toFaDigits(m[1]) : step;
  }

  // خلاصه‌ی پیشرفت پیگیری مرحله اول به‌صورت ۴ نقطه‌ی رنگی — برای لیست
  // مشتریان، تا بدون باز کردن پروفایل معلوم باشد کجای کار هستیم.
  var FT_DOT_ORDER = ["message", "call1", "call2", "call3"];
  function firstTouchDotsHtml(steps) {
    if (!steps || !steps.length) return '<span class="cell-sub">—</span>';
    var done = {};
    steps.forEach(function (s) { done[s] = true; });
    var extra = steps.filter(function (s) { return FT_DOT_ORDER.indexOf(s) === -1; }).length;
    var dots = FT_DOT_ORDER
      .map(function (s) {
        return (
          '<span class="ft-dot' + (done[s] ? " ft-dot-done" : "") + '" data-step="' + s + '" title="' +
          esc(ftStepLabel(s)) + (done[s] ? "" : " — انجام نشده") + '"></span>'
        );
      })
      .join("");
    return (
      '<span class="ft-dots">' + dots +
      (extra ? '<span class="ft-dot-extra">+' + Jalali.toFaDigits(String(extra)) + "</span>" : "") +
      "</span>"
    );
  }

  // از روی فهرست پیگیری‌ها، وضعیت هر باکس را می‌سازد: انجام‌شده / نوبتش / قفل.
  function ftComputeSteps(followups) {
    var byStep = {};
    (followups || []).forEach(function (f) { if (f.step) byStep[f.step] = f; });

    var order = ["message", "call1", "call2", "call3"];
    var n = 4;
    while (byStep["call" + n]) { order.push("call" + n); n++; }

    var steps = [];
    var locked = false;
    order.forEach(function (step) {
      var done = !!byStep[step];
      steps.push({ step: step, done: done, ready: !locked && !done, followup: byStep[step] || null });
      if (!done) locked = true; // بعد از اولین ناتمام، بقیه قفل می‌مانند
    });
    var allDone = steps.length > 0 && steps.every(function (s) { return s.done; });
    return { steps: steps, allDone: allDone, nextCallNumber: n };
  }

  function renderFirstTouchBoxes(lead, followups) {
    var grid = $("firstTouchGrid");
    if (!grid) return; // HTML کهنه‌ی کش‌شده — این بخش را نادیده بگیر، بقیه‌ی پروفایل باز شود
    var info = ftComputeSteps(followups);
    var html = info.steps
      .map(function (s) {
        var cls = s.done ? "ft-done" : s.ready ? "ft-ready" : "ft-locked";
        var extraCls = /^call[4-9]\d*$/.test(s.step) ? " ft-extra" : "";
        var icon = s.done ? "✓" : s.step === "message" ? "✉" : "☎";
        var dateTxt = s.done ? fmtDate(s.followup.followupDate) : s.ready ? "نوبت شماست" : "—";
        return (
          '<button type="button" class="ft-box ' + cls + extraCls + '" data-step="' + esc(s.step) + '"' +
          (!s.done && !s.ready ? " disabled" : "") + ">" +
          '<span class="ft-icon">' + icon + "</span>" +
          '<span class="ft-label">' + esc(ftStepLabel(s.step)) + "</span>" +
          '<span class="ft-date">' + esc(dateTxt) + "</span>" +
          "</button>"
        );
      })
      .join("");
    if (info.allDone) {
      html +=
        '<button type="button" class="ft-add" id="ftAddStep" title="افزودن مرحله پیگیری" aria-label="افزودن مرحله پیگیری">+</button>';
    }
    grid.innerHTML = html;

    Array.prototype.forEach.call(grid.querySelectorAll(".ft-box"), function (btn) {
      if (btn.classList.contains("ft-locked")) return; // قفل‌ها اصلاً کلیک‌پذیر نیستند
      btn.addEventListener("click", function () { openFtPopup(btn.getAttribute("data-step")); });
    });
    var addBtn = $("ftAddStep");
    if (addBtn) addBtn.addEventListener("click", function () { openFtPopup("call" + info.nextCallNumber); });
  }

  // ---------- پاپ‌آپ یک باکس ----------
  var ftCurrentStep = null;

  function openFtPopup(step) {
    ftCurrentStep = step;
    var info = ftComputeSteps(state.activeFollowups);
    var existing = info.steps.filter(function (s) { return s.step === step; })[0];
    var fu = existing && existing.followup;

    $("ft_title").textContent = ftStepLabel(step);
    $("ft_content").value = fu ? fu.content : "";
    $("ft_messageSent").checked = fu ? !!fu.messageSent : step === "message";
    $("ft_viaSocial").checked = fu ? !!fu.viaSocialMedia : false;
    $("ft_nextDate").value = "";
    $("ft_nextNote").value = "";
    $("ft_dateHint").textContent = fu
      ? "قبلاً در " + fmtDateTime(fu.followupDate) + " ثبت شده — یادداشت قابل ویرایش است."
      : "تاریخ همین الان خودکار ثبت می‌شود.";

    setOverlay("ftOverlay", true);
    $("ft_content").focus();
  }

  function closeFtPopup() {
    setOverlay("ftOverlay", false);
    ftCurrentStep = null;
  }

  // با محافظ: اگر مرورگر نسخه‌ی قدیمیِ HTML را کنار این فایل کش کرده باشد و
  // این عنصرها هنوز در صفحه نباشند، فقط همین ویژگی بی‌اثر می‌ماند — نه این‌که
  // با خطا کل باقی‌مانده‌ی اسکریپت (بقیه‌ی دکمه‌ها) قفل شود.
  if ($("ft_close")) $("ft_close").addEventListener("click", closeFtPopup);
  if ($("ft_cancel")) $("ft_cancel").addEventListener("click", closeFtPopup);
  if ($("ftOverlay")) {
    $("ftOverlay").addEventListener("click", function (e) { if (e.target.id === "ftOverlay") closeFtPopup(); });
  }

  if ($("ft_save")) $("ft_save").addEventListener("click", function () {
    if (!ftCurrentStep || !state.activeLeadId) return;
    var content = $("ft_content").value.trim();
    if (!content) { toast("محتوای مکالمه را وارد کنید", true); return; }

    var nextRaw = $("ft_nextDate").value.trim();
    var nextIso = null;
    if (nextRaw) {
      var parsed = Jalali.parseDate(nextRaw);
      if (!parsed) { toast("تاریخ پیگیری بعدی معتبر نیست — به شکل ۱۴۰۵/۰۶/۰۹ بنویسید", true); return; }
      nextIso = parsed.toISOString();
    }

    var btn = $("ft_save");
    btn.disabled = true;
    var step = ftCurrentStep;

    // تاریخ و یادداشت پیگیری بعدی (اختیاری) در همین درخواست می‌رود؛ اگر خالی
    // باشد، سرور خودش قدم بعدی را زمان‌بندی می‌کند (فردا: تماس بعدی) و وضعیت
    // سرنخ را جلو می‌برد — همین است که سرنخ را از لیست وظایف امروز بیرون می‌برد.
    api("/leads/" + state.activeLeadId + "/followups", {
      method: "POST",
      body: {
        step: step,
        content: content,
        messageSent: $("ft_messageSent").checked,
        viaSocialMedia: $("ft_viaSocial").checked,
        nextFollowUpDate: nextIso || "",
        nextFollowUpNote: $("ft_nextNote").value.trim(),
      },
    })
      .then(function (r) {
        var lead = r && r.lead;
        var when = lead && lead.nextFollowUpDate ? Jalali.formatDate(lead.nextFollowUpDate, { faDigits: true }) : null;
        toast(when ? "ثبت شد — پیگیری بعدی: " + when + (lead.nextFollowUpNote ? " (" + lead.nextFollowUpNote + ")" : "") : "پیگیری ثبت شد");
        closeFtPopup();
        refreshLeadLists();
        openLeadModal(state.activeLeadId);
      })
      .catch(function (err) { toast(err.message, true); })
      .finally(function () { btn.disabled = false; });
  });

  // بستن پروفایل: اگر از فهرست متقاضیان یک محصول باز شده بود، به همان فهرست برمی‌گردد
  function closeLeadModal() {
    setOverlay("overlay", false);
    if (window.CrmFile) window.CrmFile.onClose();
  }
  $("m_close").addEventListener("click", closeLeadModal);
  $("overlay").addEventListener("click", function (e) { if (e.target.id === "overlay") closeLeadModal(); });

  // پیگیری پس از فروش: وقتی وضعیت «موفق» می‌شود و یادآوری خالی است، پیشنهاد
  // خودکار ۱۸۰ روز بعد پر می‌شود. کاربر می‌تواند قبل از ذخیره عوضش کند یا با
  // خالی کردن تاریخ نادیده‌اش بگیرد. اگر یادآوری از قبل مقدار داشته باشد دست نمی‌خورد.
  var AFTER_SALE_DAYS = 180;
  var AFTER_SALE_NOTE = "پیگیری پس از فروش (گارانتی/رضایت مشتری)";

  // مبلغ فروش به ریال: رقم فارسی/عربی هم قبول است و هنگام تایپ سه‌رقم‌سه‌رقم جدا می‌شود
  function rialDigits(v) {
    return String(v || "").replace(/[۰-۹]/g, function (d) { return "۰۱۲۳۴۵۶۷۸۹".indexOf(d); })
      .replace(/[٠-٩]/g, function (d) { return "٠١٢٣٤٥٦٧٨٩".indexOf(d); }).replace(/[^0-9]/g, "").replace(/^0+(?=\d)/, "");
  }
  function parseRial(v) { var d = rialDigits(v); return d ? Number(d) : null; }
  function formatRial(v) { return rialDigits(v).replace(/\B(?=(\d{3})+(?!\d))/g, ","); }
  if ($("m_soldPrice")) {
    $("m_soldPrice").addEventListener("input", function () {
      var el = this, before = el.value.length, pos = el.selectionStart;
      el.value = formatRial(el.value);
      if (pos !== null) { var p = Math.max(0, pos + el.value.length - before); el.setSelectionRange(p, p); }
    });
  }

  // ماژول «موجودی خودرو» حذف شده — دیگر موجودی آماده‌ی فروشی در کار نیست
  function loadInventoryForSale() { return Promise.resolve([]); }

  // فرم فروش موفق: شماره فاکتور + مبلغ فاکتور؛ محصول پرسیده نمی‌شود
  function fillSoldForm(draft) {
    $("m_soldInvoice").value = (draft && draft.invoice) || "";
    $("m_soldPrice").value = draft && draft.price ? formatRial(draft.price) : "";
  }

  $("m_status").addEventListener("change", function () {
    $("m_cancelWrap").hidden = $("m_status").value !== "فروش ناموفق";
    $("m_soldWrap").hidden = $("m_status").value !== "فروش موفق";
    if ($("m_status").value === "فروش موفق") fillSoldForm(null);

    if (this.value === "فروش موفق" && !$("m_next_date").value.trim()) {
      var d = new Date();
      d.setDate(d.getDate() + AFTER_SALE_DAYS);
      $("m_next_date").value = Jalali.formatDate(d, { faDigits: true });
      if (!$("m_next_note").value.trim()) $("m_next_note").value = AFTER_SALE_NOTE;
      updateNextDateHint();
      toast("یادآوری پیگیری پس از فروش پیشنهاد شد — قبل از ذخیره می‌توانید تغییرش دهید");
    }
  });

  // ---------------------------------------------------------------
  // ویرایش اطلاعات مشتری (داخل مودال جزئیات سرنخ)
  // ---------------------------------------------------------------

  // پر کردن فرم ویرایش از روی سرنخ باز شده
  function fillEditForm(l) {
    $("me_name").value = l.name || "";
    $("me_phone").value = l.phone || "";
    $("me_channel").value = l.channel || "";
    $("me_pricefrom").value = l.priceFrom === null || l.priceFrom === undefined ? "" : l.priceFrom;
    $("me_priceto").value = l.priceTo === null || l.priceTo === undefined ? "" : l.priceTo;
    $("me_payment").value = l.payment || "";
    $("me_delivery").value = l.delivery || "";
    $("me_shop").value = l.shopName || "";
    $("me_alvar").value = l.alvarCode || "";
    $("me_city").value = l.city || "";
    $("me_jobtype").value = l.jobType || "";
    $("me_notes").value = l.notes || "";
    editLeadTags.set(l.tags || []);

    var methods = l.contactMethods || [];
    Array.prototype.forEach.call($("me_contactMethods").querySelectorAll("input"), function (c) {
      c.checked = methods.indexOf(c.value) !== -1;
    });
  }

  function closeEditForm() {
    $("m_editWrap").hidden = true;
    $("m_editToggle").textContent = "ویرایش اطلاعات مشتری";
  }

  $("m_editToggle").addEventListener("click", function () {
    var wrap = $("m_editWrap");
    if (wrap.hidden) {
      if (!state.activeLead) return;
      fillEditForm(state.activeLead);
      wrap.hidden = false;
      this.textContent = "بستن ویرایش";
      $("me_name").focus();
    } else {
      wrap.hidden = true;
      this.textContent = "ویرایش اطلاعات مشتری";
    }
  });

  $("me_cancel").addEventListener("click", closeEditForm);

  $("me_save").addEventListener("click", function () {
    if (!state.activeLeadId) return;
    var name = $("me_name").value.trim();
    var phone = $("me_phone").value.trim();
    if (!phone) { toast("شماره تماس الزامی است", true); return; }

    var body = {
      name: name,
      phone: phone,
      channel: $("me_channel").value,
      tags: editLeadTags.get(),
      contactMethods: Array.prototype.slice
        .call($("me_contactMethods").querySelectorAll("input:checked"))
        .map(function (c) { return c.value; }),
      // محصولات درخواستی دیگر از این فرم ویرایش نمی‌شود — requestedVehicles عمداً فرستاده نمی‌شود
      // تا سرور (leadService) چیزی را که الان روی مشتری هست دست‌نخورده نگه دارد
      priceFrom: $("me_pricefrom").value === "" ? null : $("me_pricefrom").value,
      priceTo: $("me_priceto").value === "" ? null : $("me_priceto").value,
      payment: $("me_payment").value,
      delivery: $("me_delivery").value,
      shopName: $("me_shop").value.trim(),
      alvarCode: $("me_alvar").value.trim(),
      city: $("me_city").value.trim(),
      jobType: $("me_jobtype").value,
      notes: $("me_notes").value.trim(),
    };

    var btn = $("me_save");
    btn.disabled = true;
    api("/leads/" + state.activeLeadId, { method: "PATCH", body: body })
      .then(function () {
        toast("اطلاعات مشتری به‌روزرسانی شد");
        closeEditForm();
        refreshLeadLists();
        loadKnownTags();
        openLeadModal(state.activeLeadId);
      })
      .catch(function (err) { toast(err.message, true); })
      .finally(function () { btn.disabled = false; });
  });

  // ---------------------------------------------------------------
  // پیامک آماده — فقط کپی متن در کلیپ‌بورد، بدون هیچ ارسال خودکار
  // ---------------------------------------------------------------

  // برنامه معمولاً روی http در شبکه داخلی اجرا می‌شود و در آن حالت
  // navigator.clipboard در دسترس نیست؛ پس یک روش جایگزین هم داریم.
  // شماره تماس قابل کلیک: کلیک = کپی در کلیپ‌بورد (بدون باز شدن ردیف/پروفایل)
  function phoneHtml(phone) {
    if (!phone) return "";
    return '<span class="copy-phone" data-phone="' + esc(phone) + '" title="برای کپی کلیک کنید">' + esc(phone) + "</span>";
  }

  document.addEventListener("click", function (e) {
    var el = e.target.closest(".copy-phone");
    if (!el) return;
    e.preventDefault();
    e.stopPropagation();
    var phone = el.getAttribute("data-phone");
    copyToClipboard(phone)
      .then(function () { toast("شماره " + phone + " کپی شد"); })
      .catch(function () { toast("کپی نشد", true); });
  }, true);

  function copyToClipboard(text) {
    if (navigator.clipboard && window.isSecureContext) {
      // اگر مرورگر اجازه نداد، به روش قدیمی برمی‌گردیم
      return navigator.clipboard.writeText(text).catch(function () { return legacyCopy(text); });
    }
    return legacyCopy(text);
  }

  function legacyCopy(text) {
    return new Promise(function (resolve, reject) {
      var ta = document.createElement("textarea");
      ta.value = text;
      ta.setAttribute("readonly", "");
      ta.style.position = "fixed";
      ta.style.top = "-1000px";
      document.body.appendChild(ta);
      ta.select();
      ta.setSelectionRange(0, ta.value.length);
      var ok = false;
      try { ok = document.execCommand("copy"); } catch (e) { ok = false; }
      document.body.removeChild(ta);
      ok ? resolve() : reject(new Error("کپی نشد"));
    });
  }

  // قالب پیام‌ها از تنظیمات می‌آید (جدول settings). تا وقتی نیامده، همان
  // مقدار خالی می‌ماند و دکمه‌ها پیغام مناسب می‌دهند.
  function renderTemplate(tpl, l) {
    var map = {
      "{نام}": l.name || "",
      "{کارشناس}": l.ownerName || "",
      "{محصول}": "",
      "{یادداشت}": l.nextFollowUpNote || "",
      "{لینک}": (state.messages && state.messages.channelLink) || "",
      "{شماره}": (state.messages && state.messages.phone) || "",
    };
    var keys = Object.keys(map);

    // خط‌به‌خط پردازش می‌شود تا بتوانیم تصمیم بگیریم کدام خط حذف شود.
    //
    // قاعده: خطی حذف می‌شود که جای‌گذار داشته و *همه‌ی* جای‌گذارهایش خالی
    // درآمده‌اند — مثل «محصول درخواستی: {محصول}» وقتی محصولی ثبت نشده.
    // خطی که اصلاً جای‌گذار ندارد هیچ‌وقت حذف نمی‌شود، حتی اگر به «:» ختم
    // شود (مثل «… بپیوندید:» که خط بعدش لینک است).
    return String(tpl || "")
      .split("\n")
      .map(function (line) {
        var used = keys.filter(function (k) { return line.indexOf(k) !== -1; });
        var filled = line;
        keys.forEach(function (k) { filled = filled.split(k).join(map[k]); });
        var allEmpty = used.length > 0 && used.every(function (k) { return map[k] === ""; });
        return allEmpty || filled.trim() === "" ? null : filled;
      })
      .filter(function (line) { return line !== null; })
      .join("\n");
  }

  // امضای پایانی جدا از متن اصلی اضافه می‌شود تا شماره فقط در یک جا تعریف
  // شود و در هر سه پیام یکسان بماند.
  function withFooter(text) {
    var m = state.messages || {};
    var phone = (m.phone || "").trim();
    if (!phone) return text;
    var footer = String(m.footer || "(شماره تماس: {شماره})").split("{شماره}").join(phone);
    return text + "\n" + footer;
  }

  function copySms(field) {
    var l = state.activeLead;
    if (!l) { toast("اول یک سرنخ را باز کنید", true); return; }
    var m = state.messages;
    if (!m) { toast("متن پیام‌ها هنوز بارگذاری نشده — چند لحظه صبر کنید", true); return; }
    if (field === "invite" && !(m.channelLink || "").trim()) {
      toast("اول لینک کانال را در تنظیمات ← پیام‌های آماده وارد کنید", true);
      return;
    }
    copyToClipboard(withFooter(renderTemplate(m[field], l)))
      .then(function () { toast("متن پیام در کلیپ‌بورد کپی شد"); })
      .catch(function () { toast("کپی نشد — متن را دستی انتخاب و کپی کنید", true); });
  }

  $("m_sms_welcome").addEventListener("click", function () { copySms("welcome"); });
  $("m_sms_reminder").addEventListener("click", function () { copySms("reminder"); });
  $("m_sms_invite").addEventListener("click", function () { copySms("invite"); });

  // ---------------------------------------------------------------
  // تنظیمات ← پیام‌های آماده
  // ---------------------------------------------------------------
  function loadMessages() {
    return api("/settings/messages")
      .then(function (r) { state.messages = r.messages; return r.messages; })
      .catch(function () { return null; });
  }

  var MSG_FIELDS = { phone: "msg_phone", channelLink: "msg_link", welcome: "msg_welcome", reminder: "msg_reminder", invite: "msg_invite" };

  function fillMessagesForm(m) {
    if (!m) return;
    Object.keys(MSG_FIELDS).forEach(function (k) {
      var el = $(MSG_FIELDS[k]);
      if (el) el.value = m[k] || "";
    });
    $("msgPlaceholders").innerHTML =
      '<span class="ph-title">جای‌گذارها:</span>' +
      (m.placeholders || [])
        .map(function (p) { return '<code class="ph">' + esc(p) + "</code>"; })
        .join("") +
      '<span class="ph-note">هر کدام هنگام کپی با اطلاعات همان مشتری پر می‌شود. خطی که جای‌گذارش خالی باشد حذف می‌شود.</span>';
    updateMsgPreview();
  }

  // پیش‌نمایش با یک مشتری نمونه، تا کاربر قبل از ذخیره ببیند نتیجه چه شکلی است
  function updateMsgPreview() {
    var sample = {
      name: "علی رضایی",
      ownerName: "کارشناس فروش",
      nextFollowUpNote: "قیمت نهایی اعلام شود",
    };
    var draft = {
      phone: $("msg_phone").value,
      channelLink: $("msg_link").value,
      footer: (state.messages && state.messages.footer) || "(شماره تماس: {شماره})",
    };
    var saved = state.messages;
    state.messages = draft;
    var text = withFooter(renderTemplate($("msg_invite").value, sample));
    state.messages = saved;
    $("msgPreview").textContent = text;
  }

  function collectMessagesForm() {
    var out = {};
    Object.keys(MSG_FIELDS).forEach(function (k) { out[k] = $(MSG_FIELDS[k]).value; });
    return out;
  }

  Object.keys(MSG_FIELDS).forEach(function (k) {
    var el = $(MSG_FIELDS[k]);
    if (el) el.addEventListener("input", updateMsgPreview);
  });

  $("msgSave").addEventListener("click", function () {
    var btn = $("msgSave");
    btn.disabled = true;
    api("/settings/messages", { method: "PUT", body: collectMessagesForm() })
      .then(function (r) {
        state.messages = r.messages;
        fillMessagesForm(r.messages);
        toast("پیام‌ها ذخیره شد");
      })
      .catch(function (e) { toast(e.message, true); })
      .finally(function () { btn.disabled = false; });
  });

  $("msgReset").addEventListener("click", function () {
    if (!confirm("متن هر سه پیام به حالت اولیه برگردد؟")) return;
    api("/settings/messages/reset", { method: "POST" })
      .then(function (r) {
        state.messages = r.messages;
        fillMessagesForm(r.messages);
        toast("به متن پیش‌فرض برگشت");
      })
      .catch(function (e) { toast(e.message, true); });
  });


  // راهنمای زیر فیلد تاریخ یادآوری
  function updateNextDateHint() {
    var hint = $("m_next_date_hint");
    if (!hint) return;
    var raw = $("m_next_date").value.trim();
    if (!raw) {
      hint.textContent = "بدون یادآوری";
      hint.style.color = "";
      return;
    }
    var d = Jalali.parseDate(raw);
    if (!d) {
      hint.textContent = "تاریخ معتبر نیست — به شکل ۱۴۰۵/۰۶/۰۹ بنویسید";
      hint.style.color = "#b4444a";
      return;
    }
    hint.textContent = Jalali.formatLong(d);
    hint.style.color = "";
  }

  $("m_next_date").addEventListener("input", updateNextDateHint);

  // یک دکمه، هم وضعیت و هم یادآوری را ذخیره می‌کند
  $("m_saveStatus").addEventListener("click", function () {
    if (!state.activeLeadId) return;
    var body = { status: $("m_status").value };
    if (body.status === "فروش ناموفق") {
      var reason = $("m_cancelReason").value.trim();
      if (!reason) { toast("دلیل انصراف را وارد کنید", true); return; }
      body.cancelReason = reason;
    }

    if (body.status === "فروش موفق") {
      var soldInvoice = $("m_soldInvoice").value.trim();
      if (!soldInvoice) { toast("شماره فاکتور را وارد کنید", true); return; }
      var soldPrice = parseRial($("m_soldPrice").value);
      if (!soldPrice) { toast("مبلغ فاکتور را وارد کنید", true); return; }
      body.soldPrice = soldPrice;
    }

    // تاریخ یادآوری قبل از ارسال بررسی می‌شود تا خطای سرور نگیریم
    var rawNext = $("m_next_date").value.trim();
    if (rawNext) {
      var parsedNext = Jalali.parseDate(rawNext);
      if (!parsedNext) {
        toast("تاریخ یادآوری معتبر نیست — به شکل ۱۴۰۵/۰۶/۰۹ بنویسید", true);
        return;
      }
      body.nextFollowUpDate = parsedNext.toISOString();
    } else {
      body.nextFollowUpDate = "";
    }
    body.nextFollowUpNote = $("m_next_note").value.trim();

    var wasDirectSale = $("m_soldWrap").classList.contains("direct");
    var wasDirectLost = $("m_cancelWrap").classList.contains("direct");
    // فروش به مشتری احراز‌نشده ممنوع نیست ولی دلیلش لازم است (مثل دکمه‌ی «خرید کرد»)
    var saleReason = "";
    if (wasDirectSale && state.activeLead && state.activeLead.kycStatus !== "approved") {
      saleReason = window.prompt("⚠ این مشتری احراز نشده است. برای ثبت فروش، دلیلش را بنویسید: (با قیمت آزاد می‌فروشیم / مشتری قدیمی و شناخته‌شده است / مدارکش در راه است)", "");
      if (saleReason === null) return;
      if (String(saleReason).trim().length < 3) { toast("دلیل فروش به مشتری احراز‌نشده را بنویسید", true); return; }
    }
    var leadId = state.activeLeadId;
    var saveBtn = $("m_saveStatus");
    saveBtn.disabled = true;
    // ثبت خرید: وضعیت، محصول و مبلغ یک‌جا ثبت می‌شود، کارت خرید در سابقه می‌آید و
    // چرخه‌ی پیگیری بعد از خرید (۲ روز بعد ارسال، …) از همین‌جا شروع می‌شود
    var req = wasDirectSale
      ? api("/workdesk/leads/" + leadId + "/purchased", { method: "POST", body: { saleReason: saleReason,
          sale: { invoice: soldInvoice, soldPrice: body.soldPrice } } })
      : api("/leads/" + leadId, { method: "PATCH", body: body });
    req
      .then(function () {
        saveBtn.disabled = false;
        writeSaleDraft(leadId, wasDirectSale ? "sold" : "lost", null);
        toast(wasDirectSale ? "فروش موفق ثبت شد 🎉" : wasDirectLost ? "فروش ناموفق ثبت شد" : "تغییرات ذخیره شد");
        refreshLeadLists();
        openLeadModal(leadId);
      })
      .catch(function (err) { saveBtn.disabled = false; toast(err.message, true); });
  });

  // فروش مستقیم (بدون پیگیری گروهی): همان فرم «کدام مدل فروخته شد + قیمت» باز می‌شود و
  // دکمه‌ی ذخیره، وضعیت مشتری را «فروش موفق» ثبت می‌کند — در گزارش‌ها هم شمرده می‌شود.
  // فقط ستون وسط پرونده اسکرول می‌شود — scrollIntoView قاب‌های بیرونی را هم جابه‌جا می‌کرد و پرونده گیر می‌کرد
  function scrollInFile(el) {
    var box = el && el.closest(".file-main");
    if (!box) return;
    var top = el.getBoundingClientRect().top - box.getBoundingClientRect().top + box.scrollTop - box.clientHeight / 3;
    box.scrollTo({ top: Math.max(0, top), behavior: "smooth" });
  }

  // پیش‌نویس فرم فروش: اگر کارشناس بدون ثبت از پرونده بیرون برود، فرم بسته می‌شود
  // ولی نوشته‌هایش برای همان مشتری می‌ماند و دفعه‌ی بعد با زدن همان دکمه برمی‌گردد.
  var SALE_DRAFT_KEY = "crm_sale_drafts";
  function readSaleDrafts() {
    try { return JSON.parse(localStorage.getItem(SALE_DRAFT_KEY) || "{}") || {}; } catch (e) { return {}; }
  }
  function writeSaleDraft(leadId, kind, data) {
    if (!leadId) return;
    var all = readSaleDrafts();
    var d = all[leadId] || {};
    if (data) d[kind] = data; else delete d[kind];
    if (Object.keys(d).length) all[leadId] = d; else delete all[leadId];
    try { localStorage.setItem(SALE_DRAFT_KEY, JSON.stringify(all)); } catch (e) { /* بدون حافظه‌ی مرورگر هم کار می‌کند */ }
  }
  function saveSaleDraftFromForm() {
    var id = state.activeLeadId;
    if ($("m_soldWrap").classList.contains("direct")) {
      var sold = { invoice: $("m_soldInvoice").value.trim(), price: $("m_soldPrice").value };
      writeSaleDraft(id, "sold", sold.invoice || sold.price ? sold : null);
    }
    if ($("m_cancelWrap").classList.contains("direct")) {
      var reason = $("m_cancelReason").value.trim();
      writeSaleDraft(id, "lost", reason ? { reason: reason } : null);
    }
  }
  ["m_soldInvoice", "m_soldPrice", "m_cancelReason"].forEach(function (fid) {
    if ($(fid)) $(fid).addEventListener("input", saveSaleDraftFromForm);
    if ($(fid)) $(fid).addEventListener("change", saveSaleDraftFromForm);
  });

  $("m_directSale").addEventListener("click", function () {
    if (!state.activeLeadId) return;
    $("m_status").value = "فروش موفق";
    $("m_cancelWrap").hidden = true;
    $("m_cancelWrap").classList.remove("direct");
    $("m_soldWrap").hidden = false;
    $("m_soldWrap").classList.add("direct");
    $("m_saveStatus").textContent = "✓ ثبت فروش";
    $("m_directSaleWrap").hidden = true;
    var draft = (readSaleDrafts()[state.activeLeadId] || {}).sold;
    fillSoldForm(draft);
    if (draft) toast("پیش‌نویس قبلی فرم فروش برگردانده شد");
    scrollInFile($("m_soldWrap"));
    $("m_soldInvoice").focus({ preventScroll: true });
  });

  // فروش ناموفق مستقیم (بدون پیگیری گروهی): فقط دلیل انصراف لازم است — همان وضعیت
  // «فروش ناموفق» که در گزارش‌ها هم شمرده می‌شود.
  $("m_directLost").addEventListener("click", function () {
    if (!state.activeLeadId) return;
    $("m_status").value = "فروش ناموفق";
    $("m_soldWrap").hidden = true;
    $("m_soldWrap").classList.remove("direct");
    $("m_cancelWrap").hidden = false;
    $("m_cancelWrap").classList.add("direct");
    $("m_saveStatus").textContent = "✗ ثبت فروش ناموفق";
    $("m_directSaleWrap").hidden = true;
    var draft = (readSaleDrafts()[state.activeLeadId] || {}).lost;
    if (draft) { $("m_cancelReason").value = draft.reason || ""; toast("پیش‌نویس قبلی برگردانده شد"); }
    scrollInFile($("m_cancelWrap"));
    $("m_cancelReason").focus({ preventScroll: true });
  });


  $("m_deleteBtn").addEventListener("click", function () {
    if (!state.activeLeadId) return;
    if (!confirm("این مشتری با همه‌ی پیگیری‌ها و سوابقش برای همیشه حذف شود؟")) return;
    api("/leads/" + state.activeLeadId, { method: "DELETE" })
      .then(function () {
        closeLeadModal();
        toast("مشتری حذف شد");
        refreshLeadLists();
      })
      .catch(function (err) { toast(err.message, true); });
  });

  // ---------------------------------------------------------------
  // manager: dashboard overview
  // ---------------------------------------------------------------
  function loadDashboard() {
    if (window.CrmReports) window.CrmReports.init();
    drFillDays();
    drLoadNote();
    drLoadDest();
    Promise.all([api("/reports/manager-dashboard"), api("/leads")])
      .then(function (results) {
        var d = results[0];
        var leads = results[1].leads;
        var f = function (n) { return Jalali.toFaDigits(String(n || 0)); };
        var t = d.today, c = t.calls;

        $("dashKpis").innerHTML = [
          { k: "phone", tone: "info", label: "تماس‌های امروز", n: f(c.total),
            foot: "ورودی " + f(c.incoming) + " · خروجی " + f(c.outgoing) + " · بی‌پاسخ " + f(c.missed) + " · مکالمه " + fmtTalk(c.talkSec) },
          { k: "board", tone: "info", label: "پیگیری‌های امروز", n: f(t.followups), foot: "پیگیری فردی و گروهی ثبت‌شده‌ی امروز" },
          { k: "plus", tone: "info", label: "سرنخ‌های امروز", n: f(t.leads), foot: "کل سرنخ‌های مجموعه: " + f(leads.length) },
          { k: "target", tone: "warn", label: "🌤 لیدهای گرم", n: f(t.hot),
            foot: "چند نشانه‌ی خرید با هم در ۷ روز اخیر: استعلام قیمت، موجودی، سفارش، مراجعه، تماس خود مشتری" },
        ].map(kpiCardHtml).join("");

        var al = d.alerts;
        var alerts = [
          { n: al.missedOpen, label: "تماس بی‌پاسخ بدون تماس برگشتی", hint: "۷ روز اخیر — مشتری زنگ زده و کسی جواب نداده", go: "calls", ctab: "missed" },
          { n: al.unlogged, label: "تماس ثبت‌نشده", hint: "۷ روز اخیر — فرم پاسخ‌دهنده و خلاصه پر نشده", go: "calls", ctab: "unlogged" },
          { n: al.overdue, label: "پیگیری عقب‌افتاده", hint: "سرنخ‌هایی که تاریخ پیگیری‌شان گذشته", go: "customers" },
        ];
        $("dashAlerts").innerHTML = alerts.map(function (x) {
          return '<button type="button" class="mp-todo-item ' + (x.n ? "bad" : "ok") + '" data-go="' + x.go + '"' + (x.ctab ? ' data-ctab="' + x.ctab + '"' : "") + ">" +
            '<span class="mp-todo-n">' + f(x.n) + "</span><span><b>" + esc(x.label) + '</b><span class="cell-sub">' + esc(x.hint) + "</span></span></button>";
        }).join("");

        // --- کارهای امروز هر کارشناس (همان آمار صفحه‌ی «آمار کار کارشناسان»، بدون نمره) ---
        api("/reports/rep-stats?from=" + rsDayStart(Date.now()))
          .then(function (s) { $("dashToday").innerHTML = rsTable(s.reps, s.total, true); })
          .catch(function () { $("dashToday").innerHTML = '<div class="cell-sub">آمار امروز دریافت نشد.</div>'; });

        // --- نمودار وضعیت سرنخ‌ها ---
        var won = leads.filter(function (l) { return l.status === "فروش موفق"; }).length;
        var lost = leads.filter(function (l) { return l.status === "فروش ناموفق"; }).length;
        var closed = won + lost;
        $("dashLeadTotals").textContent = "کل " + f(leads.length) + " سرنخ · فروش موفق " + f(won) +
          " · نرخ موفقیت " + (closed ? f(Math.round((won / closed) * 100)) + "٪" : "—");
        var byStatus = countBy(leads, "status");
        var slices = Object.keys(STATUS_COLORS)
          .map(function (name) {
            return { label: name, value: byStatus[name] || 0, color: STATUS_COLORS[name] };
          })
          .filter(function (s) { return s.value > 0; });
        $("statusDonut").innerHTML = donutHtml(slices, leads.length);
        $("statusLegend").innerHTML = slices.length
          ? legendHtml(slices, leads.length)
          : '<div class="work-empty">هنوز سرنخی ثبت نشده است.</div>';

        // --- نمودار کانال‌ها: پرتعدادترین‌ها اول، حداکثر ۷ تا ---
        var byChannel = countBy(leads, "channel");
        var chRows = Object.keys(byChannel)
          .map(function (k) { return { label: k, value: byChannel[k] }; })
          .sort(function (a, b) { return b.value - a.value; })
          .slice(0, 7);
        $("channelBars").innerHTML = chRows.length
          ? barsHtml(chRows)
          : '<div class="work-empty">داده‌ای برای نمایش نیست.</div>';

      })
      .catch(function (err) { toast(err.message, true); });
  }
  // ---------- گزارش روزانه‌ی مدیران (PDF) ----------
  function drFillDays() {
    var sel = $("drDay");
    if (sel.options.length) return;
    var OFF = 3.5 * 3600000, DAY = 86400000, now = Date.now();
    for (var i = 0; i < 14; i++) {
      var key = new Date(now - i * DAY + OFF).toISOString().slice(0, 10);
      var label = (i === 0 ? "امروز — " : i === 1 ? "دیروز — " : "") + Jalali.formatLong(new Date(key + "T12:00:00Z"));
      sel.insertAdjacentHTML("beforeend", '<option value="' + key + '">' + esc(label) + "</option>");
    }
  }
  function drLoadDest() {
    api("/reports/daily-chat").then(function (c) {
      state.drBot = c.bot || "";
      $("drDest").innerHTML = c.ready
        ? "مقصد ارسال شبانه: <b>" + esc(c.chatTitle || "—") + "</b>" + (c.personal ? " (بله‌ی شخصی)" : " (چت پشتیبان‌گیری)")
        : "ربات بله هنوز تنظیم نشده (تنظیمات ← پشتیبان در بله)";
    }).catch(function () {});
  }
  $("drLink").addEventListener("click", function () {
    var btn = $("drLink");
    btn.disabled = true;
    api("/reports/daily-chat/link", { method: "POST" })
      .then(function (c) { toast("از این به بعد گزارش شبانه به بله‌ی «" + (c.chatTitle || "شما") + "» می‌رود"); drLoadDest(); })
      .catch(function (e) {
        toast((state.drBot ? "اول در بله‌ی شخصی‌تان ربات @" + state.drBot + " را باز کنید و «سلام» بفرستید، بعد دوباره بزنید. " : "") + e.message, true);
      })
      .finally(function () { btn.disabled = false; });
  });
  function drLoadNote() {
    $("drStatus").textContent = "";
    api("/reports/daily-note?date=" + $("drDay").value)
      .then(function (r) { $("drNote").value = r.text || ""; })
      .catch(function (e) { toast(e.message, true); });
  }
  function drSaveNote() {
    return api("/reports/daily-note", { method: "PUT", body: { date: $("drDay").value, text: $("drNote").value } });
  }
  $("drDay").addEventListener("change", drLoadNote);
  $("drSave").addEventListener("click", function () {
    drSaveNote().then(function () { toast("کارهای این روز ذخیره شد و در گزارش می‌آید"); }).catch(function (e) { toast(e.message, true); });
  });
  $("drPdf").addEventListener("click", function () {
    var btn = $("drPdf");
    btn.disabled = true;
    $("drStatus").textContent = "در حال ساخت PDF…";
    drSaveNote()
      .then(function () { return fetch("/api/v1/reports/daily.pdf?date=" + $("drDay").value, { credentials: "same-origin" }); })
      .then(function (r) {
        if (!r.ok) return r.json().then(function (j) { throw new Error(j.error || "ساخت گزارش ممکن نشد"); });
        return r.blob();
      })
      .then(function (b) {
        var a = document.createElement("a");
        a.href = URL.createObjectURL(b);
        a.download = "crm-daily-" + $("drDay").value + ".pdf";
        document.body.appendChild(a);
        a.click();
        setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 2000);
        $("drStatus").textContent = "";
      })
      .catch(function (e) { $("drStatus").textContent = ""; toast(e.message, true); })
      .finally(function () { btn.disabled = false; });
  });
  $("drSend").addEventListener("click", function () {
    var btn = $("drSend");
    btn.disabled = true;
    $("drStatus").textContent = "در حال ارسال…";
    drSaveNote()
      .then(function () { return api("/reports/daily-send", { method: "POST", body: { date: $("drDay").value } }); })
      .then(function (r) {
        $("drStatus").textContent = "";
        toast(r.sent ? "گزارش در بله فرستاده شد" : r.reason || "ارسال انجام نشد", !r.sent);
      })
      .catch(function (e) { $("drStatus").textContent = ""; toast(e.message, true); })
      .finally(function () { btn.disabled = false; });
  });

  $("dashAlerts").addEventListener("click", function (e) {
    var b = e.target.closest("[data-go]");
    if (!b) return;
    var ctab = b.getAttribute("data-ctab");
    if (ctab) {
      state.calls.tab = ctab;
      Array.prototype.forEach.call($("callTabs").querySelectorAll(".chip"), function (x) { x.classList.toggle("active", x.getAttribute("data-ctab") === ctab); });
    }
    switchTab(b.getAttribute("data-go"));
  });

  // ---------------------------------------------------------------
  // «آمار کار کارشناسان» — شمارش واقعی کارها، روزبه‌روز و برای هر کارشناس (بدون نمره و رتبه)
  // ---------------------------------------------------------------
  var RS_DAY = 86400000;
  function rsDayStart(ms) { var t = ms + 3.5 * 3600000; return t - (t % RS_DAY) - 3.5 * 3600000; }
  // «۲ روز و ۳ ساعت» / «۴ ساعت و ۱۰ دقیقه» / «۲۵ دقیقه»
  function rsDuration(ms) {
    var f = function (n) { return Jalali.toFaDigits(String(n)); };
    var m = Math.round((ms || 0) / 60000), d = Math.floor(m / 1440), h = Math.floor((m % 1440) / 60), mm = m % 60;
    if (d) return f(d) + " روز" + (h ? " و " + f(h) + " ساعت" : "");
    if (h) return f(h) + " ساعت" + (mm ? " و " + f(mm) + " دقیقه" : "");
    return f(mm) + " دقیقه";
  }
  function rsDayLabel(ms) {
    var d = new Date(ms + 3.5 * 3600000 + 60000);
    var wd = new Intl.DateTimeFormat("fa-IR", { weekday: "long", timeZone: "Asia/Tehran" }).format(new Date(ms + 4 * 3600000));
    return wd + " " + Jalali.formatDate(d, { faDigits: true });
  }
  function rsWhen(ms) {
    return Jalali.formatDate(new Date(ms), { faDigits: true }) + " " + new Intl.DateTimeFormat("fa-IR", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Tehran" }).format(new Date(ms));
  }

  var RS_COLS = [
    ["calls", "تماس ثبت‌شده", function (r, f) { return "<b>" + f(r.calls) + '</b><div class="cell-sub">ورودی ' + f(r.incoming) + " · خروجی " + f(r.outgoing) + "</div>"; }],
    ["talkSec", "مدت مکالمه", function (r) { return r.talkSec ? talkLabel(r.talkSec) : "—"; }],
    ["callbacks", "جواب به بی‌پاسخ", null],
    ["priceInquiry", "استعلام قیمت", null],
    ["objection", "اعتراض به قیمت", null],
    ["outOfStock", "ناموجود درخواستی", null],
    ["order", "سفارش", null],
    ["followups", "پیگیری ثبت‌شده", null],
    ["named", "نام‌گذاری شماره‌ی خام", null],
    ["kyc", "احراز (تأیید / رد)", function (r, f) { return r.kycApproved || r.kycRejected ? f(r.kycApproved) + " / " + f(r.kycRejected) : "—"; }],
    ["kycWait", "میانگین زمان تأیید", function (r) { return r.kycWaitCount ? rsDuration(r.kycWaitMs / r.kycWaitCount) : "—"; }],
  ];

  function rsTable(rows, team, withTeamMissed) {
    var f = function (n) { return Jalali.toFaDigits(String(n || 0)); };
    var cell = function (c, r) { return c[2] ? c[2](r, f) : (r[c[0]] ? f(r[c[0]]) : '<span class="cell-sub">۰</span>'); };
    var head = "<tr><th>کارشناس</th>" + RS_COLS.map(function (c) { return "<th>" + c[1] + "</th>"; }).join("") + "</tr>";
    var body = rows.map(function (r) {
      return '<tr><td><div class="cell-name">' + esc(r.name) + "</div>" + (r.activeDays ? '<div class="cell-sub">' + f(r.activeDays) + " روز فعال</div>" : "") + "</td>" +
        RS_COLS.map(function (c) { return "<td>" + cell(c, r) + "</td>"; }).join("") + "</tr>";
    }).join("");
    var t = team ? '<tr class="rs-team"><td><b>کل تیم</b>' + (withTeamMissed ? '<div class="cell-sub">بی‌پاسخ ' + f(team.missed) + " · بی‌جواب مانده " + f(team.missedOpen) + "</div>" : "") + "</td>" +
      RS_COLS.map(function (c) { return "<td>" + cell(c, team) + "</td>"; }).join("") + "</tr>" : "";
    return '<div class="table-scroll"><table class="rs-table"><thead>' + head + "</thead><tbody>" + (body || '<tr><td colspan="' + (RS_COLS.length + 1) + '" class="cell-sub">کاری ثبت نشده</td></tr>') + t + "</tbody></table></div>";
  }

  function rsList(rows, cols, empty) {
    if (!rows.length) return '<div class="cell-sub">' + empty + "</div>";
    var shown = rows.slice(0, 150);
    return '<div class="table-scroll"><table class="rs-table"><thead><tr>' + cols.map(function (c) { return "<th>" + c[0] + "</th>"; }).join("") + "</tr></thead><tbody>" +
      shown.map(function (r) { return "<tr>" + cols.map(function (c) { return "<td>" + c[1](r) + "</td>"; }).join("") + "</tr>"; }).join("") +
      "</tbody></table></div>" + (rows.length > shown.length ? '<div class="cell-sub">' + Jalali.toFaDigits(String(rows.length - shown.length)) + " مورد دیگر هم هست — بازه را کوتاه‌تر کنید.</div>" : "");
  }
  var rsCustomer = function (r) {
    return (r.leadId ? '<span class="call-lead" data-rs-lead="' + esc(r.leadId) + '">' + esc(r.customer || "بدون نام") + "</span>" : esc(r.customer || "بدون نام")) +
      '<div class="cell-sub" dir="ltr">' + esc(Jalali.toFaDigits(r.phone || "")) + "</div>";
  };

  function loadPerformance() {
    var v = $("rsRange").value, now = Date.now(), today = rsDayStart(now);
    var from = v === "y" ? today - RS_DAY : today - (Number(v) - 1) * RS_DAY;
    var to = v === "y" ? today - 1 : now;
    api("/reports/rep-stats?from=" + from + "&to=" + to)
      .then(function (r) {
        var f = function (n) { return Jalali.toFaDigits(String(n || 0)); };
        var t = r.total;
        $("rsKpis").innerHTML = [
          { k: "phone", tone: "info", label: "تماس ثبت‌شده", n: f(t.calls), foot: "ورودی " + f(t.incoming) + " · خروجی " + f(t.outgoing) + " · مکالمه " + (t.talkSec ? talkLabel(t.talkSec) : "—") },
          { k: "idle", tone: t.missedOpen ? "danger" : "info", label: "تماس بی‌پاسخ", n: f(t.missed), foot: "جواب داده شد " + f(t.callbacks) + " · بی‌جواب مانده " + f(t.missedOpen) + " · ثبت‌نشده " + f(t.unlogged) },
          { k: "target", tone: "warn", label: "استعلام قیمت", n: f(t.priceInquiry), foot: "اعتراض به قیمت " + f(t.objection) + " · سفارش " + f(t.order) },
          { k: "box", tone: "info", label: "ناموجود درخواستی", n: f(t.outOfStock), foot: "فهرست کامل پایین صفحه" },
          { k: "plus", tone: "info", label: "نام‌گذاری شماره‌ی خام", n: f(t.named), foot: "شماره‌ی بی‌نامی که اسم و فامیل گرفت" },
          { k: "won", tone: "info", label: "احراز تأییدشده", n: f(t.kycApproved),
            foot: "میانگین زمان تأیید " + (t.kycWaitCount ? rsDuration(t.kycWaitMs / t.kycWaitCount) : "—") + " · الان منتظر " + f(r.kycNow.pending) + (r.kycNow.oldestSince ? " (قدیمی‌ترین " + rsDuration(now - r.kycNow.oldestSince) + ")" : "") },
        ].map(kpiCardHtml).join("");
        $("rsReps").innerHTML = rsTable(r.reps, t, true);
        $("rsDays").innerHTML = r.days.length ? r.days.map(function (d, i) {
          var x = d.team;
          return '<details class="rs-day"' + (i === 0 ? " open" : "") + "><summary><b>" + esc(rsDayLabel(d.day)) + "</b>" +
            '<span class="cell-sub">' + f(x.calls) + " تماس ثبت‌شده · " + f(x.missed) + " بی‌پاسخ (" + f(x.missedOpen) + " بی‌جواب) · " + f(x.priceInquiry) + " استعلام · " +
            f(x.objection) + " اعتراض · " + f(x.outOfStock) + " ناموجود · " + f(x.named) + " نام‌گذاری · " + f(x.kycApproved) + " احراز</span></summary>" +
            rsTable(d.reps, x, true) + "</details>";
        }).join("") : '<div class="cell-sub">در این بازه کاری ثبت نشده است.</div>';
        $("rsOos").innerHTML = rsList(r.lists.outOfStock, [
          ["زمان", function (x) { return esc(rsWhen(x.at)); }],
          ["محصول درخواستی", function (x) { return x.product ? "<b>" + esc(x.product) + "</b>" : '<span class="cell-sub">ثبت نشده</span>'; }],
          ["مشتری", rsCustomer],
          ["کارشناس", function (x) { return esc(x.by || "—"); }],
          ["یادداشت", function (x) { return esc(x.note || "—"); }],
        ], "در این بازه محصول ناموجودی درخواست نشده است.");
        $("rsObj").innerHTML = rsList(r.lists.objections, [
          ["زمان", function (x) { return esc(rsWhen(x.at)); }],
          ["مشتری", rsCustomer],
          ["کارشناس", function (x) { return esc(x.by || "—"); }],
          ["یادداشت", function (x) { return esc(x.note || "—"); }],
        ], "در این بازه اعتراضی به قیمت ثبت نشده است.");
        $("rsKyc").innerHTML = rsList(r.lists.kyc, [
          ["مشتری", rsCustomer],
          ["ارسال مدرک", function (x) { return x.submittedAt ? esc(rsWhen(x.submittedAt)) : "—"; }],
          ["بررسی", function (x) { return esc(rsWhen(x.at)) + " " + (x.approved ? '<span class="cst ok">✅ تأیید</span>' : '<span class="cst bad">❌ رد</span>'); }],
          ["مدت تا بررسی", function (x) { return x.hasWait ? "<b>" + esc(rsDuration(x.waitMs)) + "</b>" : "—"; }],
          ["بررسی‌کننده", function (x) { return esc(x.by || "—"); }],
        ], "در این بازه مدرکی تأیید یا رد نشده است.");
      })
      .catch(function (err) { toast(err.message, true); });
  }
  $("rsRange").addEventListener("change", loadPerformance);
  $("panel-performance").addEventListener("click", function (e) {
    var l = e.target.closest("[data-rs-lead]");
    if (l) openLeadModal(l.getAttribute("data-rs-lead"));
  });

  // ---------------------------------------------------------------
  // manager: user management
  // ---------------------------------------------------------------
  function loadUsersList() {
    return api("/users").then(function (r) {
      state.users = r.users;
      state.permCatalog = r.permissionCatalog || [];
      return r.users;
    });
  }

  function permSummaryHtml(u) {
    if (u.role === "manager") return '<span class="pill st-won">همه‌ی دسترسی‌ها</span>';
    var cat = state.permCatalog || [];
    var names = (u.permissions || []).map(function (k) {
      var c = cat.filter(function (x) { return x.key === k; })[0];
      return c ? c.label : k;
    });
    return names.length
      ? '<div class="perm-chips">' + names.map(function (n) { return "<span>" + esc(n) + "</span>"; }).join("") + "</div>"
      : '<span class="cell-sub">فقط کارهای خودش</span>';
  }

  function permEditorHtml(u) {
    var isMgr = u.role === "manager";
    var have = u.permissions || [];
    return '<tr class="perm-row"><td colspan="7"><div class="perm-editor">' +
      '<div class="perm-head"><b>دسترسی‌های ' + esc(u.fullName) + "</b>" +
      '<label class="perm-role">نوع حساب: <select data-perm-role><option value="rep"' + (isMgr ? "" : " selected") + '>معمولی (دسترسی‌ها را تیک بزنید)</option><option value="manager"' + (isMgr ? " selected" : "") + ">مدیر (همه‌ی دسترسی‌ها)</option></select></label>" +
      '<label class="perm-role">عنوان نقش: <input type="text" data-perm-title maxlength="40" placeholder="' + (isMgr ? "مدیر" : "کارشناس فروش") + '" value="' + esc(u.roleTitle || "") + '"></label></div>' +
      '<p class="cell-sub" style="margin:4px 0 10px;">هر کارشناس همیشه مشتری‌ها، تماس‌ها، پیگیری‌ها و «داشبورد من» خودش را دارد. تیک هر بخش، آن را <b>علاوه بر</b> کارهای خودش به او می‌دهد.<br>برای نقش دلخواه (مثلاً «مدیر کل» با دسترسی محدود): نوع حساب را «معمولی» بگذارید، عنوان دلخواه را بنویسید و فقط دسترسی‌های لازم را تیک بزنید.</p>' +
      '<div class="perm-grid">' + (state.permCatalog || []).map(function (c) {
        var on = isMgr || have.indexOf(c.key) !== -1;
        return '<label class="perm-item"><input type="checkbox" data-perm-key="' + esc(c.key) + '"' + (on ? " checked" : "") + (isMgr ? " disabled" : "") + ">" +
          "<span><b>" + esc(c.label) + '</b><span class="cell-sub">' + esc(c.desc) + "</span></span></label>";
      }).join("") + "</div>" +
      '<div class="perm-actions"><button type="button" class="btn btn-primary btn-sm" data-perm-save="' + esc(u.id) + '">ذخیره‌ی دسترسی‌ها</button> ' +
      '<button type="button" class="btn btn-ghost btn-sm" data-perm-cancel>انصراف</button></div>' +
      "</div></td></tr>";
  }

  function loadUsersTable() {
    $("u_roleWrap").hidden = state.user.role !== "manager";
    $("u_roleTitleWrap").hidden = state.user.role !== "manager";
    Promise.all([loadUsersList(), loadBranchesList()]).then(function (res) {
      var users = res[0];
      populateBranchSelectors();
      $("usersTbody").innerHTML = users
        .map(function (u) {
          if (state.editingUserId === u.id) {
            return (
              '<tr><td colspan="7"><div class="user-edit-row">' +
              '<div class="field"><label>نام کامل</label>' +
              '<input type="text" data-edit-name value="' + esc(u.fullName) + '"></div>' +
              '<div class="field"><label>رمز عبور جدید</label>' +
              '<input type="text" data-edit-pass placeholder="خالی بگذارید تا تغییر نکند"></div>' +
              (state.user.role === "manager"
                ? '<div class="field"><label>عنوان نقش</label><input type="text" data-edit-title maxlength="40" placeholder="' +
                  (u.role === "manager" ? "مدیر" : "کارشناس فروش") + '" value="' + esc(u.roleTitle || "") + '"></div>'
                : "") +
              '<div class="user-edit-actions">' +
              '<button class="btn btn-primary btn-sm" data-save="' + u.id + '">ذخیره</button> ' +
              '<button class="btn btn-ghost btn-sm" data-cancel-edit>انصراف</button>' +
              "</div></div></td></tr>"
            );
          }
          return (
            "<tr><td>" +
            esc(u.fullName) +
            (u.id === state.user.id ? '<span class="cell-sub"> (شما)</span>' : "") +
            "</td><td>" +
            esc(u.username) +
            "</td><td>" +
            esc(u.roleLabel || (u.role === "manager" ? "مدیر" : "کارشناس فروش")) +
            (u.roleTitle && u.role === "manager" ? '<div class="cell-sub">مدیر — همه‌ی دسترسی‌ها</div>' : "") +
            "</td><td>" + permSummaryHtml(u) +
            '</td><td class="branch-ui"><select data-branch-of="' + u.id + '">' +
            branchOptionsHtml(u.branchId) +
            "</select>" +
            '</td><td><span class="pill ' +
            (u.active ? "st-won" : "st-lost") +
            '">' +
            (u.active ? "فعال" : "غیرفعال") +
            '</span></td><td class="row-actions">' +
            '<button class="btn btn-ghost btn-sm" data-edit-user="' + u.id + '">ویرایش</button> ' +
            (state.user.role === "manager" && u.id !== state.user.id ? '<button class="btn btn-ghost btn-sm" data-perm-user="' + u.id + '">دسترسی‌ها</button> ' : "") +
            '<button class="btn btn-ghost btn-sm" data-toggle="' +
            u.id +
            '" data-active="' +
            u.active +
            '"' +
            (u.id === state.user.id ? " disabled" : "") +
            ">" +
            (u.active ? "غیرفعال کردن" : "فعال کردن") +
            "</button></td></tr>" +
            (state.permUserId === u.id ? permEditorHtml(u) : "")
          );
        })
        .join("");
      // دسترسی‌ها: باز/بسته کردن پنل، و ذخیره
      Array.prototype.forEach.call($("usersTbody").querySelectorAll("[data-perm-user]"), function (btn) {
        btn.addEventListener("click", function () {
          var id = btn.getAttribute("data-perm-user");
          state.permUserId = state.permUserId === id ? null : id;
          loadUsersTable();
        });
      });
      var permSave = $("usersTbody").querySelector("[data-perm-save]");
      if (permSave) {
        permSave.addEventListener("click", function () {
          var id = permSave.getAttribute("data-perm-save");
          var role = $("usersTbody").querySelector("[data-perm-role]").value;
          var perms = Array.prototype.map.call($("usersTbody").querySelectorAll("[data-perm-key]:checked"), function (c) { return c.getAttribute("data-perm-key"); });
          var title = ($("usersTbody").querySelector("[data-perm-title]") || {}).value || "";
          api("/users/" + id, { method: "PATCH", body: { role: role, permissions: perms, roleTitle: title.trim() } })
            .then(function () {
              state.permUserId = null;
              toast("نقش و دسترسی‌ها ذخیره شد — کاربر بعد از رفرش صفحه (Ctrl+F5) تغییرها را می‌بیند");
              loadUsersTable();
            })
            .catch(function (err) { toast(err.message, true); });
        });
      }
      var permCancel = $("usersTbody").querySelector("[data-perm-cancel]");
      if (permCancel) permCancel.addEventListener("click", function () { state.permUserId = null; loadUsersTable(); });
      var permRole = $("usersTbody").querySelector("[data-perm-role]");
      if (permRole) {
        permRole.addEventListener("change", function () {
          var mgr = permRole.value === "manager";
          Array.prototype.forEach.call($("usersTbody").querySelectorAll("[data-perm-key]"), function (c) { c.disabled = mgr; if (mgr) c.checked = true; });
        });
      }
      // باز کردن حالت ویرایش نام و رمز عبور برای یک کاربر
      Array.prototype.forEach.call($("usersTbody").querySelectorAll("[data-edit-user]"), function (btn) {
        btn.addEventListener("click", function () {
          state.editingUserId = btn.getAttribute("data-edit-user");
          loadUsersTable();
        });
      });
      var cancelBtn = $("usersTbody").querySelector("[data-cancel-edit]");
      if (cancelBtn) {
        cancelBtn.addEventListener("click", function () {
          state.editingUserId = null;
          loadUsersTable();
        });
      }
      var saveBtn = $("usersTbody").querySelector("[data-save]");
      if (saveBtn) {
        saveBtn.addEventListener("click", function () {
          var id = saveBtn.getAttribute("data-save");
          var name = $("usersTbody").querySelector("[data-edit-name]").value.trim();
          var pass = $("usersTbody").querySelector("[data-edit-pass]").value;
          if (!name) return toast("نام کامل را وارد کنید", true);
          if (pass && pass.length < 8) return toast("رمز عبور باید حداقل ۸ کاراکتر باشد", true);
          var body = { fullName: name };
          if (pass) body.password = pass;
          var titleBox = $("usersTbody").querySelector("[data-edit-title]");
          if (titleBox) body.roleTitle = titleBox.value.trim();
          api("/users/" + id, { method: "PATCH", body: body })
            .then(function () {
              state.editingUserId = null;
              toast(pass ? "نام و رمز عبور کاربر به‌روزرسانی شد" : "نام کاربر به‌روزرسانی شد");
              loadUsersTable();
              loadUsersList().then(populateOwnerFilters);
            })
            .catch(function (err) { toast(err.message, true); });
        });
      }
      // تغییر شعبه‌ی هر کاربر مستقیماً از همین جدول
      Array.prototype.forEach.call($("usersTbody").querySelectorAll("[data-branch-of]"), function (sel) {
        sel.addEventListener("change", function () {
          var id = sel.getAttribute("data-branch-of");
          api("/users/" + id, { method: "PATCH", body: { branchId: sel.value } })
            .then(function () {
              toast("شعبه‌ی کاربر به‌روزرسانی شد");
              loadUsersList().then(populateOwnerFilters);
            })
            .catch(function (err) {
              toast(err.message, true);
              loadUsersTable();
            });
        });
      });
      Array.prototype.forEach.call($("usersTbody").querySelectorAll("[data-toggle]"), function (btn) {
        btn.addEventListener("click", function () {
          var id = btn.getAttribute("data-toggle");
          var active = btn.getAttribute("data-active") === "true";
          api("/users/" + id, { method: "PATCH", body: { active: !active } })
            .then(function () {
              toast("وضعیت کاربر به‌روزرسانی شد");
              loadUsersTable();
              loadUsersList().then(populateOwnerFilters);
            })
            .catch(function (err) { toast(err.message, true); });
        });
      });
    });
  }

  $("userForm").addEventListener("submit", function (e) {
    e.preventDefault();
    var body = {
      fullName: $("u_fullname").value.trim(),
      username: $("u_username").value.trim(),
      password: $("u_password").value,
      role: $("u_role").value,
      roleTitle: $("u_roleTitle").value.trim(),
      branchId: $("u_branch").value,
    };
    if (!body.branchId) return toast("شعبه‌ی کاربر را انتخاب کنید", true);
    api("/users", { method: "POST", body: body })
      .then(function () {
        $("userForm").reset();
        toast("کاربر جدید ایجاد شد");
        loadUsersTable();
        loadUsersList().then(populateOwnerFilters);
      })
      .catch(function (err) { toast(err.message, true); });
  });

  // ---------------------------------------------------------------
  // «کانال ارتباطی / نحوه‌ی آشنایی» — فهرست قابل مدیریت (تنظیمات ← نحوه‌ی آشنایی)
  // ---------------------------------------------------------------
  state.channels = null;

  function loadChannels() {
    return api("/settings/channels")
      .then(function (r) {
        state.channels = r.channels || [];
        fillChannelSelects();
        return state.channels;
      })
      .catch(function () { return state.channels || []; });
  }

  // اگر مقدار فعلی در فهرست نیست (گزینه‌ی غیرفعال یا قدیمی)، همان هم نگه داشته می‌شود
  function ensureOption(sel, value) {
    if (!sel || !value) return;
    var has = Array.prototype.some.call(sel.options, function (o) { return o.value === value; });
    if (!has) {
      var o = document.createElement("option");
      o.textContent = value;
      o.value = value;
      sel.appendChild(o);
    }
  }

  // CRM نمونه: «نحوه‌ی آشنایی» تنظیم‌شدنی نیست؛ منبع ورود فهرست ثابت است و در اغلب موارد خود سیستم
  // تعیینش می‌کند (تماس، فرم همکاری سایت، وردست). در ثبت دستی، کارشناس یکی از این‌ها را انتخاب می‌کند.
  var LEAD_SOURCES = ["مراجعه حضوری", "ثبت دستی", "شبکه‌های مجازی", "تماس تلفنی", "فرم همکاری سایت", "وردست"];
  function fillChannelSelect(sel, firstLabel, includeInactive) {
    if (!sel) return;
    var cur = sel.value;
    var names = LEAD_SOURCES;
    sel.innerHTML = '<option value="">' + esc(firstLabel) + "</option>" +
      names.map(function (n) { return "<option>" + esc(n) + "</option>"; }).join("");
    ensureOption(sel, cur);
    sel.value = cur;
  }

  function fillChannelSelects() {
    fillChannelSelect($("f_channel"), "انتخاب کنید…", false);
    fillChannelSelect($("me_channel"), "انتخاب کنید…", false);
    fillChannelSelect($("cChannel"), "همه کانال‌ها", true);
  }

  // ---------------------------------------------------------------
  // صفحه‌ی «تماس‌ها» — تماس‌های گوشی‌های کاری (اپ «اپ تماس»)
  // ---------------------------------------------------------------
  state.calls = { tab: "", list: [], operators: null };
  var DIR_CLASS = { INCOMING: "st-progress", OUTGOING: "st-won", MISSED: "st-lost", REJECTED: "st-lost" };
  var DIR_ICON = { INCOMING: "↙", OUTGOING: "↗", MISSED: "✕", REJECTED: "⛔" };

  function loadCallOperators() {
    if (state.calls.operators) return Promise.resolve(state.calls.operators);
    if (!can("all_leads")) {
      state.calls.operators = [{ id: state.user.id, fullName: state.user.fullName }];
      return Promise.resolve(state.calls.operators);
    }
    return api("/users").then(function (r) {
      state.calls.operators = (r.users || []).filter(function (u) { return u.active; });
      return state.calls.operators;
    });
  }

  function loadCalls() {
    var isMgr = can("calls_admin");
    $("callOperator").hidden = !can("all_leads");
    $("callLine").hidden = !isMgr;
    $("callReportCard").hidden = !isMgr;
    $("callKpiWrap").hidden = false;
    if (isMgr) {
      api("/calls/lines").then(function (r) {
        var sel = $("callLine");
        var cur = sel.value;
        sel.innerHTML = '<option value="">همه‌ی خطوط</option>' +
          (r.lines || []).map(function (l) { return '<option value="' + esc(l.id) + '">' + esc(l.name) + "</option>"; }).join("");
        sel.value = cur;
      }).catch(function () {});
      loadCallOperators().then(function (ops) {
        var sel = $("callOperator");
        var cur = sel.value;
        sel.innerHTML = '<option value="">همه‌ی پاسخ‌دهنده‌ها</option>' +
          ops.map(function (u) { return '<option value="' + esc(u.id) + '">' + esc(u.fullName) + "</option>"; }).join("");
        sel.value = cur;
      }).catch(function () {});
      loadCallReport();
    }
    fetchCalls();
  }

  function callQuery() {
    var q = {};
    if (state.calls.tab) q.tab = state.calls.tab;
    var days = Number($("callRange").value);
    if (days) {
      var from = new Date();
      from.setHours(0, 0, 0, 0);
      from.setDate(from.getDate() - (days - 1));
      q.from = from.getTime();
    }
    if ($("callSearch").value.trim()) q.q = $("callSearch").value.trim();
    if ($("callLine").value) q.lineId = $("callLine").value;
    if ($("callOperator").value) q.operatorId = $("callOperator").value;
    if ($("callDirection").value) q.direction = $("callDirection").value;
    q.sort = $("callSort").value;
    return new URLSearchParams(q).toString();
  }

  var callsAutoTimer = null;
  function callsAutoRefresh() {
    clearTimeout(callsAutoTimer);
    callsAutoTimer = setTimeout(function () {
      if (state.activeTab === "calls" && $("overlay").hidden && !state.calls.openId) fetchCalls();
      else callsAutoRefresh();
    }, 20000);
  }

  function fetchCalls() {
    api("/calls?" + callQuery())
      .then(function (r) {
        state.calls.list = r.calls || [];
        $("ct_unlogged").textContent = Jalali.toFaDigits(String((r.counts && r.counts.unlogged) || 0));
        $("ct_missed").textContent = Jalali.toFaDigits(String((r.counts && r.counts.missedOpen) || 0));
        renderCalls();
        renderCallKpis(r.summary);
      })
      .catch(function (e) { toast(e.message, true); })
      .finally(callsAutoRefresh);
  }

  // کارت‌های بالای صفحه = خلاصه‌ی دقیقاً همان تماس‌هایی که با فیلترهای فعلی در جدول دیده می‌شوند
  function selText(id) {
    var el = $(id);
    return el && el.value && el.selectedIndex >= 0 ? el.options[el.selectedIndex].text : "";
  }
  function renderCallKpis(sm) {
    if (!sm) return;
    var fa = function (n) { return Jalali.toFaDigits(String(n || 0)); };
    var parts = [selText("callRange")];
    if ($("callLine").value) parts.push(selText("callLine"));
    if ($("callOperator").value) parts.push(selText("callOperator"));
    if ($("callDirection").value) parts.push(selText("callDirection"));
    if (state.calls.tab === "unlogged") parts.push("فقط ثبت‌نشده‌ها");
    if (state.calls.tab === "missed") parts.push("بی‌پاسخ بدون تماس برگشتی");
    if ($("callSearch").value.trim()) parts.push("«" + $("callSearch").value.trim() + "»");
    $("crPeriodTop").textContent = "(" + parts.filter(Boolean).join(" · ") + ")";
    $("crKpis").innerHTML = [
      { k: "phone", tone: "info", label: "تماس‌ها", n: fa(sm.total),
        foot: "خروجی " + fa(sm.outgoing) + " · ورودی " + fa(sm.incoming) + " · بی‌پاسخ " + fa(sm.missed) },
      { k: "today", tone: "info", label: "مدت مکالمات", n: sm.talkSec ? talkLabel(sm.talkSec) : "—",
        foot: fa(sm.answered) + " مکالمه · میانگین " + (sm.answered ? fmtTalk(sm.talkSec / sm.answered) : "—") },
      { k: "overdue", tone: sm.missedOpen ? "danger" : "success", label: "بی‌پاسخ", n: fa(sm.missed),
        foot: sm.missed ? fa(sm.missedOpen) + " هنوز تماس برگشتی نگرفته" : "تماس بی‌پاسخی نیست" },
      { k: "idle", tone: sm.unlogged ? "warn" : "success", label: "ثبت‌نشده", n: fa(sm.unlogged),
        foot: "فرم بعد از تماسشان پر نشده" },
    ].map(kpiCardHtml).join("");
  }


  // ---- فرم درجای ثبت تماس (CRM نمونه) ----
  // کارشناس بدون باز کردن پنجره، همین‌جا پاسخ‌دهنده، نام، نتیجه، نحوه‌ی آشنایی و
  // محتوای مکالمه را می‌گذارد و «ثبت» می‌زند؛ مشتری به فهرست مشتریان اضافه می‌شود.
  var CF_DISMISS = [
    { code: "wrong_number", label: "اشتباه گرفته شده" },
    { code: "spam", label: "تبلیغاتی / مزاحم" },
    { code: "internal", label: "همکار داخلی" },
    { code: "unrelated", label: "بی‌ربط به فروش" },
    { code: "duplicate", label: "تکراری" },
    { code: "no_talk", label: "قطع شد / صحبتی انجام نشد" },
    { code: "other", label: "سایر" },
  ];
  function cfOperatorOptions(sel) {
    return (state.calls.operators || []).map(function (u) {
      return '<option value="' + esc(u.id) + '"' + (u.id === sel ? " selected" : "") + ">" + esc(u.fullName) + "</option>";
    }).join("");
  }
  // فرم درجای تماس در دو جا کار می‌کند: صفحه‌ی «تماس‌ها» و «میز کار مشاور».
  // ctx می‌گوید تماس را از کجا پیدا کند، کدام فهرست را دوباره بکشد و بعد از ثبت چه چیزی تازه شود.
  var CALLS_CTX = {
    find: function (id) { return state.calls.list.find(function (x) { return x.id === id; }); },
    rerender: function () { renderCalls(); },
    refresh: function () { fetchCalls(); },
  };
  var cfCtx = CALLS_CTX;
  // هر بار که فرم دوباره کشیده می‌شود (مثلاً با انتخاب نتیجه‌ی تماس)، نوشته‌های کارشناس نگه داشته می‌شود
  function cfSnapshot() {
    var d = state.calls.draft || (state.calls.draft = {});
    ["cf_name", "cf_note", "cf_product", "cf_heard", "cf_operator"].forEach(function (id) {
      var el = $(id);
      if (el) d[id] = el.value;
    });
    return d;
  }
  function cfDraft(id, fallback) {
    var d = state.calls.draft || {};
    return d[id] !== undefined && d[id] !== null ? d[id] : fallback;
  }
  function cfRerender() {
    cfCtx.rerender();
    // انتخاب «از کجا آشنا شده» هم بعد از بازکشیدن سر جایش برمی‌گردد
    var h = $("cf_heard");
    if (h && h.getAttribute("data-sel")) h.value = h.getAttribute("data-sel");
  }
  function cfRefresh() { cfCtx.refresh(); }

  function cfFormHtml(c) {
    if (state.calls.openId !== c.id) {
      return "";
    }
    if (state.calls.openMode === "dismiss") {
      return '<div class="cf-box">' +
        '<div class="cf-row">' +
        '<label class="cf-f"><span>چرا ثبت نمی‌شود؟</span><select id="cf_reason" data-combo="dismiss_reason">' +
        CF_DISMISS.map(function (r) { return '<option value="' + esc(r.label) + '">' + esc(r.label) + "</option>"; }).join("") +
        "</select></label>" +
        '<label class="cf-f cf-other" hidden><span>توضیح</span><input type="text" id="cf_reason_other" placeholder="دلیل را بنویسید"></label>' +
        "</div>" +
        '<div class="cf-btns"><button type="button" class="btn btn-sm btn-lost" data-cf-save-dismiss="' + esc(c.id) + '">✕ ثبت نشد</button>' +
        '<button type="button" class="btn btn-ghost btn-sm" data-cf-cancel>انصراف</button></div></div>';
    }
    var sel = state.calls.outcomes;
    return '<div class="cf-box">' +
      '<div class="cf-row">' +
      '<label class="cf-f"><span>پاسخ‌دهنده</span><select id="cf_operator">' + cfOperatorOptions(cfDraft("cf_operator", c.operatorUserId || state.user.id)) + "</select></label>" +
      '<label class="cf-f"><span>نام مشتری</span><input type="text" id="cf_name" value="' + esc(cfDraft("cf_name", c.leadName || c.callerName || "")) + '" placeholder="نام مشتری"></label>' +
      '<label class="cf-f"><span>نتیجه‌ی تماس <b class="req">*</b></span><select id="cf_outcome" data-combo="call_outcome" data-combo-prefix="x:"><option value="">انتخاب…</option>' +
      CG_OUTCOMES.map(function (o) { return sel.indexOf(o.code) >= 0 ? "" : '<option value="' + o.code + '">' + esc(o.label) + "</option>"; }).join("") +
      "</select></label>" +
      // نحوه‌ی آشنایی فقط برای شماره‌ی تازه پرسیده می‌شود
      (c.leadId ? "" : '<label class="cf-f"><span>از کجا آشنا شده</span><select id="cf_heard" data-sel="' + esc(cfDraft("cf_heard", "")) + '"><option value="">—</option>' +
        cfChannelOptions() + "</select></label>") +
      (sel.indexOf("out_of_stock") >= 0 ? '<label class="cf-f"><span>محصول درخواستی</span><input type="text" id="cf_product" value="' + esc(cfDraft("cf_product", "")) + '" placeholder="مثلاً LCD سامسونگ A51"></label>' : "") +
      '<label class="cf-f cf-span2"><span>محتوای مکالمه (اختیاری)</span><textarea id="cf_note" rows="1" placeholder="هر چیزی که در فهرست نتیجه‌ها نیست">' + esc(cfDraft("cf_note", "")) + "</textarea></label>" +
      "</div>" +
      (sel.length ? '<div class="cf-picked">' + sel.map(function (code) {
        var o = CG_OUTCOMES.find(function (x) { return x.code === code; });
        return '<button type="button" class="tag tag-outcome" data-cf-unpick="' + esc(code) + '">' + esc(o ? o.label : code.replace(/^x:/, "")) + " ✕</button>";
      }).join(" ") + "</div>" : "") +
      fuChooserHtml("data-cf-fu", state.calls.fuDays) +
      '<div class="cf-err" id="cf_err" hidden></div>' +
      '<div class="cf-btns"><button type="button" class="btn btn-primary btn-sm" data-cf-save="' + esc(c.id) + '">ثبت ✓</button>' +
      '<button type="button" class="btn btn-ghost btn-sm" data-cf-cancel>انصراف</button>' +
      '<span class="hint" style="margin:0">' + (c.leadId ? "به پرونده‌ی همین مشتری اضافه می‌شود" : "پرونده‌ی تازه ساخته می‌شود و منتظر اقدام بعدی می‌ماند") + "</span></div></div>";
  }

  // پیگیری بعدی در همه‌ی فرم‌های ثبت تماس: چند روز بعد، یا بدون پیگیری (۰)
  function fuChooserHtml(attr, days) {
    var b = function (n, label) {
      return '<button type="button" class="md-day' + (days === n ? " on" : "") + '" ' + attr + '="' + n + '">' + label + "</button>";
    };
    return '<div class="md-days cf-fu">پیگیری بعدی: ' +
      [1, 3, 7, 14, 30].map(function (n) { return b(n, Jalali.toFaDigits(String(n)) + " روز"); }).join("") +
      b(0, "بدون پیگیری") + "</div>";
  }
  function fuAtIso(days) {
    if (!days) return "";
    var d = new Date(Date.now() + days * 86400000);
    d.setHours(10, 0, 0, 0);
    return d.toISOString();
  }

  function cfOpen(id, mode, ctx, prefill) {
    cfCtx = ctx || CALLS_CTX;
    var same = state.calls.openId === id && state.calls.openMode === mode;
    state.calls.openId = same ? null : id;
    state.calls.openMode = same ? "" : mode;
    state.calls.fuDays = 0; // پیش‌فرض «بدون پیگیری» — اگر کارشناس یادش برود، پیگیری اشتباهی ساخته نشود
    // ویرایش تماس قبلاً ثبت‌شده: فرم با مقدارهای فعلی‌اش پر می‌شود، نه خالی
    var c = prefill ? cfCtx.find(id) : null;
    state.calls.outcomes = c ? (c.outcomes || []).slice() : [];
    state.calls.draft = c ? { cf_name: c.leadName || c.callerName || "", cf_note: c.note || "", cf_product: c.productNote || "", cf_heard: c.heardFrom || "", cf_operator: c.operatorUserId || "" } : {};
    var go = function () { cfRerender(); };
    if (!state.calls.operators) loadCallOperators().then(go); else go();
  }
  // پیام خطا داخل خود فرم می‌ماند — پیام بالای صفحه زود می‌رود و دیده نمی‌شود
  function cfError(msg, focusId) {
    var box = $("cf_err");
    if (box) { box.textContent = msg || ""; box.hidden = !msg; }
    Array.prototype.forEach.call(document.querySelectorAll(".cf-f.bad"), function (el) { el.classList.remove("bad"); });
    if (msg) toast(msg, true);
    if (focusId && $(focusId)) { $(focusId).closest(".cf-f").classList.add("bad"); $(focusId).focus(); }
  }

  function cfClose() { state.calls.openId = null; state.calls.openMode = ""; state.calls.outcomes = []; state.calls.draft = {}; cfRerender(); }
  function cfChannelOptions() {
    return (state.channels || []).map(function (ch) {
      var v = typeof ch === "string" ? ch : (ch.name || ch.label || "");
      return v ? '<option value="' + esc(v) + '">' + esc(v) + "</option>" : "";
    }).join("");
  }
  // نتیجه‌ی تماس: با هر انتخاب یک برچسب اضافه می‌شود (چند نتیجه ممکن است)
  function callRowChange(e) {
    if (e.target.id === "cf_outcome") {
      var v = e.target.value;
      if (v && state.calls.outcomes.indexOf(v) < 0) { state.calls.outcomes.push(v); cfSnapshot(); cfRerender(); }
      return;
    }
    if (e.target.id === "cf_reason") {
      var other = document.querySelector(".cf-other");
      if (other) other.hidden = e.target.value !== "سایر";
    }
  }


  // یک ردیف کارتی تماس — همین مارک‌آپ هم در صفحه‌ی «تماس‌ها» و هم در «میز کار مشاور» استفاده می‌شود
  var CALL_TYPE = { INCOMING: ["📞 ورودی", "in"], OUTGOING: ["↗ خروجی", "out"], MISSED: ["📵 بی‌پاسخ", "miss"], REJECTED: ["⛔ قطع شد", "miss"] };
  function callRowHtml(c) {
    var fa = function (v) { return Jalali.toFaDigits(String(v)); };
    var TYPE = CALL_TYPE;
      var missed = c.direction === "MISSED" || c.direction === "REJECTED";
      var mustCall = missed && !c.callbackDone;
      var t = TYPE[c.direction] || [c.directionLabel, "in"];
      // «باید زنگ زد» و «بلاتکلیف» کنار نوع تماس؛ نتیجهٔ نهایی در ستون آخر
      var stInline = mustCall ? '<span class="cst must">باید زنگ زد</span>'
        : (!missed && c.logStatus === "UNLOGGED") ? '<span class="cst wait">⏳ بلاتکلیف</span>' : "";
      // ثبت شد / رد شد مستقل از نوع تماس است؛ تماس بی‌پاسخی که جواب دادیم هم «ثبت شد» می‌گیرد
      var st = (c.logStatus === "LOGGED" ? '<span class="cst ok">✓ ثبت شد</span>'
        : c.logStatus === "DISMISSED" ? '<span class="cst bad">✕ رد شد' + (c.dismissReason ? '<em>' + esc(c.dismissReason) + "</em>" : "") + "</span>"
        : "")
        + (missed && c.callbackDone ? ' <span class="cst ok">↩ تماس برگشتی گرفته شد</span>' : "");
      var who = c.leadId
        ? '<span class="call-lead cd-name" data-lead="' + esc(c.leadId) + '">' + esc(c.leadName || "بدون نام") + "</span>"
        : '<b class="cd-name">' + esc(c.callerName || "بدون نام") + '</b> <span class="cd-nocrm">شماره در CRM نیست</span>';
      var tags = (c.outcomeLabels || []).map(function (l) { return '<span class="tag tag-outcome">' + esc(l) + "</span>"; }).join(" ") +
        // فقط استعلام‌های همان روزِ این تماس؛ «کل» کم‌رنگ کنارش (همه‌ی روزها در پرونده‌ی مشتری)
        (c.priceInquiriesDay > 1 ? ' <span class="tag tag-warn">🔁 ' + (Jalali.formatDate(new Date(c.startedAt)) === Jalali.formatDate(new Date()) ? "امروز " : "همان روز ") + fa(c.priceInquiriesDay) + " بار استعلام قیمت</span>" : "") +
        (c.priceInquiries > Math.max(1, c.priceInquiriesDay || 0) ? ' <span class="cell-sub">کل: ' + fa(c.priceInquiries) + " بار</span>" : "") +
        (c.afterHours && mustCall ? ' <span class="tag tag-warn">🌙 خارج از ساعت کاری</span>' : "");
      var acts = [];
      // فرم درجا باز می‌شود — دیگر پنجره‌ی جدا لازم نیست (سرعت ثبت)
      if (c.logStatus !== "LOGGED" && !mustCall) acts.push('<button type="button" class="btn btn-primary btn-sm" data-cf-open="' + esc(c.id) + '">' + (c.leadId ? "ثبت تماس" : "ثبت تماس و ساخت پرونده") + "</button>");
      // اشتباه در ثبت تماس هم قابل اصلاح باشد — فرم همان فرم ثبت است، فقط با مقدارهای قبلی پر می‌شود
      if (c.logStatus === "LOGGED") acts.push('<button type="button" class="fu-edit-btn" data-cf-open="' + esc(c.id) + '" data-cf-edit="1" title="ویرایش این تماس" aria-label="ویرایش">✏️ ویرایش</button>');
      if (c.logStatus === "UNLOGGED" && !mustCall) acts.push('<button type="button" class="btn btn-ghost btn-sm" data-cf-dismiss="' + esc(c.id) + '">ثبت نشد</button>');
      // «زنگ زدم» فقط با فرم ثبت: تماس بی‌پاسخ بدون نوشتن محتوای مکالمه از فهرست بیرون نمی‌رود
      if (mustCall) acts.push('<a class="btn btn-ghost btn-sm" href="tel:' + esc(c.phone) + '">تماس</a>' +
        '<button type="button" class="btn btn-primary btn-sm" data-cf-open="' + esc(c.id) + '">زنگ زدم — ثبت مکالمه</button>');
      // ردیف ستون‌دار: زمان · نوع · شماره · نام · مدت · خط · پاسخ‌دهنده · یادداشت · وضعیت
      var hhmm = new Intl.DateTimeFormat("fa-IR", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Tehran" }).format(new Date(c.startedAt));
      var tone = mustCall ? "must" : c.logStatus === "LOGGED" ? "ok" : c.logStatus === "DISMISSED" ? "bad" : missed ? "ok" : "wait";
      var cell = function (label, html, cls) {
        return '<div class="ct-c ' + (cls || "") + '"><span class="ct-lbl">' + esc(label) + "</span>" + html + "</div>";
      };
      return '<article class="ct-row tone-' + tone + '">' +
        '<div class="ct-line">' +
        cell("زمان", '<b class="ct-time">' + esc(hhmm) + '</b><span class="ct-date">' + esc(Jalali.formatDate(new Date(c.startedAt), { faDigits: true })) + "</span>", "ct-when") +
        cell("نوع تماس", '<span class="ctype ' + t[1] + '">' + t[0] + "</span>" + stInline, "ct-type") +
        cell("شماره", '<a class="cd-phone" href="tel:' + esc(c.phone) + '" dir="ltr">' + esc(fa(c.phone || "")) + "</a>", "ct-phone") +
        cell("مشتری", who, "ct-who") +
        cell("مدت", '<b>' + (c.durationSec ? esc(fa(c.durationLabel)) : "—") + "</b>", "ct-dur") +
        cell("خط", "<b>" + esc(c.lineName || "—") + "</b>", "ct-line-name") +
        cell("پاسخ‌دهنده", "<b>" + esc(c.operatorName || "—") + "</b>", "ct-op") +
        cell("یادداشت", (tags ? '<div class="ct-tags">' + tags + "</div>" : "") +
          ((c.note || c.productNote) ? '<div class="ct-note">' + (c.productNote ? "📦 " + esc(c.productNote) + " — " : "") + esc(c.note || "") + "</div>" : (tags ? "" : '<span class="ct-dash">—</span>')), "ct-notes") +
        cell("وضعیت", '<div class="ct-state">' + st +
          (c.logStatus === "DISMISSED" ? '<button type="button" class="btn btn-ghost btn-sm" data-call-undismiss="' + esc(c.id) + '">↩ برگرداندن</button>' : "") +
          "</div>" + (acts.length ? '<div class="ct-acts">' + acts.join("") + "</div>" : ""), "ct-end") +
        "</div>" +
        cfFormHtml(c) +
        "</article>";
  }

  function renderCalls() {
    var list = state.calls.list;
    $("callSortArrow").textContent = $("callSort").value === "asc" ? "▲" : "▼";
    $("callCount").textContent = Jalali.toFaDigits(String(list.length)) + " تماس";
    $("callEmpty").hidden = list.length > 0;
    var day = "";
    $("callTbody").innerHTML = list.map(function (c) {
      var dl = new Intl.DateTimeFormat("fa-IR", { weekday: "long", day: "numeric", month: "long", timeZone: "Asia/Tehran" }).format(new Date(c.startedAt));
      var head = dl !== day ? '<div class="cd-day">' + esc(dl) + "</div>" : "";
      day = dl;
      return head + callRowHtml(c);
    }).join("");
  }

  $("callTabs").addEventListener("click", function (e) {
    var b = e.target.closest("[data-ctab]");
    if (!b) return;
    state.calls.tab = b.getAttribute("data-ctab");
    Array.prototype.forEach.call($("callTabs").querySelectorAll(".chip"), function (x) { x.classList.toggle("active", x === b); });
    fetchCalls();
  });
  var callSearchTimer = null;
  $("callSearch").addEventListener("input", function () {
    clearTimeout(callSearchTimer);
    callSearchTimer = setTimeout(fetchCalls, 300);
  });
  ["callLine", "callOperator", "callDirection", "callSort"].forEach(function (id) {
    $(id).addEventListener("change", fetchCalls);
  });
  // بازه‌ی زمانی هم فهرست و هم کارت‌ها/گزارش را عوض می‌کند
  $("callRange").addEventListener("change", function () {
    fetchCalls();
    if (can("calls_admin")) loadCallReport();
  });
  $("callSortHead").addEventListener("click", function () {
    $("callSort").value = $("callSort").value === "asc" ? "desc" : "asc";
    fetchCalls();
  });

  function callRowClick(e, ctx) {
    cfCtx = ctx || CALLS_CTX;
    var lead = e.target.closest(".call-lead");
    if (lead) { openLeadModal(lead.getAttribute("data-lead")); return; }
    // باز/بسته کردن فرم درجا
    var op = e.target.closest("[data-cf-open]");
    if (op) { cfOpen(op.getAttribute("data-cf-open"), "log", cfCtx, op.hasAttribute("data-cf-edit")); return; }
    var dz = e.target.closest("[data-cf-dismiss]");
    if (dz) { cfOpen(dz.getAttribute("data-cf-dismiss"), "dismiss", cfCtx); return; }
    if (e.target.closest("[data-cf-cancel]")) { cfClose(); return; }
    var unpick = e.target.closest("[data-cf-unpick]");
    if (unpick) {
      var code = unpick.getAttribute("data-cf-unpick");
      state.calls.outcomes = state.calls.outcomes.filter(function (x) { return x !== code; });
      cfSnapshot();
      cfRerender();
      return;
    }
    var fuB = e.target.closest("[data-cf-fu]");
    if (fuB) {
      cfSnapshot();
      state.calls.fuDays = Number(fuB.getAttribute("data-cf-fu"));
      cfRerender();
      return;
    }
    // ثبت فرم: مشتری تازه ساخته می‌شود و منتظر اقدام بعدی می‌ماند
    var sv = e.target.closest("[data-cf-save]");
    if (sv) {
      var id = sv.getAttribute("data-cf-save");
      var call = cfCtx.find(id) || {};
      var name = $("cf_name").value.trim();
      if (!state.calls.outcomes.length) return cfError("نتیجه‌ی تماس را از منوی کشویی انتخاب کنید", "cf_outcome");
      cfError("");
      sv.disabled = true;
      var body = {
        operatorUserId: $("cf_operator").value,
        callerName: name,
        heardFrom: $("cf_heard") ? $("cf_heard").value : "",
        note: $("cf_note").value.trim(),
        outcomes: state.calls.outcomes,
        productNote: $("cf_product") ? $("cf_product").value.trim() : "",
        followUpAt: fuAtIso(state.calls.fuDays),
      };
      var wasMissed = call.direction === "MISSED" || call.direction === "REJECTED";
      api("/calls/" + id + "/log", { method: "POST", body: body })
        .then(function () { return wasMissed ? api("/calls/" + id + "/callback", { method: "POST", body: { done: true } }) : null; })
        .then(function () {
          toast(call.leadId ? "تماس ثبت شد" : "تماس ثبت شد و پرونده‌ی مشتری ساخته شد");
          cfClose();
          cfRefresh();
          refreshLeadLists();
        })
        .catch(function (err) {
          cfError(err.message);
          sv.disabled = false;
          // فهرست کهنه شده (مثلاً کس دیگری همین تماس را ثبت کرده) — تازه‌اش کن
          if (String(err.message || "").indexOf("پیدا نشد") >= 0) cfRefresh();
        });
      return;
    }
    // «ثبت نشد» با دلیل از منوی کشویی
    var sd = e.target.closest("[data-cf-save-dismiss]");
    if (sd) {
      var why = $("cf_reason").value;
      if (why === "سایر") why = ($("cf_reason_other") && $("cf_reason_other").value.trim()) || "سایر";
      sd.disabled = true;
      api("/calls/" + sd.getAttribute("data-cf-save-dismiss") + "/dismiss", { method: "POST", body: { dismissed: true, reason: why } })
        .then(function () { toast("«ثبت نشد» زده شد"); cfClose(); cfRefresh(); })
        .catch(function (err) { toast(err.message, true); sd.disabled = false; });
      return;
    }
    var un = e.target.closest("[data-call-undismiss]");
    if (un) {
      api("/calls/" + un.getAttribute("data-call-undismiss") + "/dismiss", { method: "POST", body: { dismissed: false } })
        .then(function () { toast("تماس دوباره بلاتکلیف شد"); cfRefresh(); })
        .catch(function (err) { toast(err.message, true); });
      return;
    }
  }

  // همان ردیف‌های تماس در هر فهرستی (میز کار مشاور) با همان دکمه‌ها و فرم درجا
  function bindCallRows(container, ctx) {
    container.addEventListener("click", function (e) { callRowClick(e, ctx); });
    container.addEventListener("change", callRowChange);
  }
  bindCallRows($("callTbody"), CALLS_CTX);

  // --- پاپ‌آپ ثبت تماس (همان فرم اپ گوشی) ---
  function openCallLog(call) {
    state.calls.logging = call;
    $("cg_title").textContent = "ثبت تماس " + call.directionLabel;
    $("cg_sub").textContent = [call.phone, call.durationSec ? "مدت " + call.durationLabel : "", call.lineName, fmtDateTime(call.startedAt)].filter(Boolean).join(" · ");
    loadCallOperators().then(function (ops) {
      $("cg_operator").innerHTML = ops.map(function (u) { return '<option value="' + esc(u.id) + '">' + esc(u.fullName) + "</option>"; }).join("");
      $("cg_operator").value = call.operatorUserId || state.user.id;
    });
    $("cg_name").value = call.callerName || call.leadName || "";
    fillChannelSelect($("cg_heard"), "—", false);
    $("cg_heard").value = call.heardFrom || "";
    $("cg_note").value = call.note || "";
    renderCgOutcomes(call.outcomes || []);
    $("cg_product").value = call.productNote || "";
    $("cg_followup").value = "";
    updateCgHint();
    $("cg_newlead_hint").hidden = !!call.leadId;
    // مشتری تکراری: نحوه‌ی آشنایی قبلاً ثبت شده، دوباره پرسیده نمی‌شود
    $("cg_heard_wrap").hidden = !!call.leadId;
    setOverlay("callLogOverlay", true);
  }

  // گزینه‌های نتیجه‌ی تماس از سرور (shared/call-outcomes.js) — یک‌بار خوانده می‌شود
  var CG_OUTCOMES = [
    { code: "price_inquiry", label: "فقط استعلام قیمت" }, { code: "price_objection", label: "اعتراض به قیمت" },
    { code: "order", label: "سفارش داد" }, { code: "out_of_stock", label: "محصول ناموجود خواست" },
    { code: "callback", label: "قرار تماس دوباره" }, { code: "cooperation", label: "درخواست همکاری" },
    { code: "support", label: "پیگیری سفارش / پشتیبانی" }, { code: "irrelevant", label: "نامرتبط" },
  ];
  function renderCgOutcomes(selected) {
    $("cg_outcomes").innerHTML = CG_OUTCOMES.map(function (o) {
      return '<button type="button" class="btn btn-ghost btn-sm' + (selected.indexOf(o.code) >= 0 ? " on" : "") + '" data-oc="' + o.code + '">' + esc(o.label) + "</button>";
    }).join("");
    syncCgProduct();
  }
  function cgSelectedOutcomes() {
    return Array.prototype.map.call(document.querySelectorAll("#cg_outcomes .on"), function (b) { return b.getAttribute("data-oc"); });
  }
  function syncCgProduct() {
    $("cg_product_wrap").hidden = cgSelectedOutcomes().indexOf("out_of_stock") < 0 && !$("cg_product").value;
  }
  $("cg_outcomes").addEventListener("click", function (e) {
    var b = e.target.closest("[data-oc]");
    if (!b) return;
    b.classList.toggle("on");
    // «قرار تماس دوباره» یعنی پیگیری؛ اگر تاریخ خالی است، فردا گذاشته می‌شود
    if (b.getAttribute("data-oc") === "callback" && b.classList.contains("on") && !$("cg_followup").value.trim()) {
      var d = new Date(); d.setDate(d.getDate() + 1);
      $("cg_followup").value = Jalali.formatDate(d, { faDigits: true });
      updateCgHint();
    }
    syncCgProduct();
  });

  function updateCgHint() {
    var raw = $("cg_followup").value.trim();
    var d = raw ? Jalali.parseDate(raw) : null;
    $("cg_followup_hint").textContent = raw ? (d ? Jalali.formatLong(d) : "تاریخ معتبر نیست — به شکل ۱۴۰۵/۰۷/۲۵") : "";
    $("cg_followup_hint").style.color = raw && !d ? "#b4444a" : "";
  }
  $("cg_followup").addEventListener("input", updateCgHint);
  document.querySelector(".cg-quick").addEventListener("click", function (e) {
    var b = e.target.closest("[data-fu]");
    if (!b) return;
    var d = new Date();
    d.setDate(d.getDate() + Number(b.getAttribute("data-fu")));
    $("cg_followup").value = Jalali.formatDate(d, { faDigits: true });
    updateCgHint();
  });
  function closeCallLog() { setOverlay("callLogOverlay", false); state.calls.logging = null; }
  $("cg_close").addEventListener("click", closeCallLog);
  $("cg_cancel").addEventListener("click", closeCallLog);
  $("cg_save").addEventListener("click", function () {
    var call = state.calls.logging;
    if (!call) return;
    var raw = $("cg_followup").value.trim();
    var fu = null;
    if (raw) {
      var d = Jalali.parseDate(raw);
      if (!d) { toast("تاریخ پیگیری معتبر نیست", true); return; }
      d.setHours(10, 0, 0, 0);
      fu = d.getTime();
    }
    if (!cgSelectedOutcomes().length) { toast("نتیجه‌ی تماس را انتخاب کنید", true); return; }
    var btn = $("cg_save");
    btn.disabled = true;
    api("/calls/" + call.id + "/log", {
      method: "POST",
      body: { operatorUserId: $("cg_operator").value, callerName: $("cg_name").value.trim(), heardFrom: $("cg_heard").value, note: $("cg_note").value.trim(), outcomes: cgSelectedOutcomes(), productNote: $("cg_product").value.trim(), followUpAt: fu },
    })
      .then(function (r) {
        toast(r.createdLead ? "تماس ثبت شد و سرنخ تازه ساخته شد" : "تماس ثبت شد");
        closeCallLog();
        fetchCalls();
        if (window.CrmDesk) window.CrmDesk.refresh();
        if (window.CrmKycDesk && state.activeTab === "forms") window.CrmKycDesk.load();
        if (window.CrmMyDesk && state.activeTab === "consultant") window.CrmMyDesk.load();
        if (window.CrmWorkdesk && state.activeTab === "workdesk") window.CrmWorkdesk.onTab("workdesk");
        refreshLeadLists();
        if (can("calls_admin")) loadCallReport();
      })
      .catch(function (err) { toast(err.message, true); })
      .finally(function () { btn.disabled = false; });
  });

  // --- گزارش تماس‌ها (مدیر) ---
  function fmtTalk(sec) {
    sec = Math.round(sec || 0);
    var h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s2 = sec % 60;
    return Jalali.toFaDigits(h ? h + ":" + String(m).padStart(2, "0") + ":" + String(s2).padStart(2, "0") : m + ":" + String(s2).padStart(2, "0"));
  }
  function reportRange() {
    var days = Number($("callRange").value);
    var from = new Date();
    from.setHours(0, 0, 0, 0);
    if (days) from.setDate(from.getDate() - (days - 1));
    else from = new Date(2020, 0, 1);
    var label = days === 1 ? "(امروز)" : days ? "(" + Jalali.toFaDigits(String(days)) + " روز اخیر)" : "(همه‌ی تماس‌ها)";
    return { from: from.getTime(), label: label };
  }

  // «۳ ساعت و ۱۲ دقیقه» / «۲۵ دقیقه» / «۴۰ ثانیه»
  function talkLabel(sec) {
    sec = Math.round(sec || 0);
    var h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60);
    if (h) return Jalali.toFaDigits(String(h)) + " ساعت" + (m ? " و " + Jalali.toFaDigits(String(m)) + " دقیقه" : "");
    if (m) return Jalali.toFaDigits(String(m)) + " دقیقه";
    return Jalali.toFaDigits(String(sec)) + " ثانیه";
  }

  function loadCallReport() {
    var rr = reportRange();
    $("crPeriod").textContent = rr.label;
    api("/calls/report?from=" + rr.from).then(function (r) {
      var fa = function (n) { return Jalali.toFaDigits(String(n)); };
      var m = r.missed || {};
      $("crOps").innerHTML = (r.perOperator || []).map(function (o) {
        return "<tr><td>" + esc(o.name) + "</td><td>" + fa(o.calls) + "</td><td>" + fa(o.answered) + "</td><td>" + fmtTalk(o.talkSec) +
          "</td><td>" + fmtTalk(o.avgSec) + "</td><td>" + fa(o.logged) + "</td><td>" + fa(o.unlogged) + "</td></tr>";
      }).join("") || '<tr><td colspan="7" class="cell-sub">هنوز تماسی نیست</td></tr>';
      $("crHeard").innerHTML = (r.heardFrom || []).length
        ? barsHtml(r.heardFrom.map(function (h) { return { label: h.name, value: h.count }; }))
        : '<div class="cell-sub">هنوز تماس ثبت‌شده‌ای نیست</div>';
      $("crLines").innerHTML = (r.perLine || []).map(function (l) {
        var maxH = Math.max.apply(null, l.byHour.concat([1]));
        var maxD = Math.max.apply(null, l.byWeekday.concat([1]));
        var cell = function (v, max) {
          var a = v ? 0.12 + 0.6 * (v / max) : 0;
          return '<td class="heat" style="background:rgba(217,98,42,' + a.toFixed(2) + ')">' + (v ? fa(v) : "") + "</td>";
        };
        var hours = [];
        for (var h = 7; h <= 23; h++) hours.push(h);
        return '<div class="cr-line"><div class="cr-line-name">' + esc(l.name) + " — " + fa(l.total) + " تماس</div>" +
          '<div class="table-scroll"><table class="heat-table"><thead><tr><th>ساعت</th>' + hours.map(function (h) { return "<th>" + fa(h) + "</th>"; }).join("") + "</tr></thead>" +
          "<tbody><tr><td>تماس</td>" + hours.map(function (h) { return cell(l.byHour[h], maxH); }).join("") + "</tr></tbody></table></div>" +
          '<div class="table-scroll"><table class="heat-table"><thead><tr><th>روز</th>' + r.weekdays.map(function (d) { return "<th>" + esc(d) + "</th>"; }).join("") + "</tr></thead>" +
          "<tbody><tr><td>تماس</td>" + l.byWeekday.map(function (v) { return cell(v, maxD); }).join("") + "</tr></tbody></table></div></div>";
      }).join("") || '<div class="cell-sub">هنوز خطی تماس نفرستاده است</div>';
    }).catch(function () {});
  }

  // ---------------------------------------------------------------
  // تنظیمات ← خطوط تلفن (گوشی‌های کاری) و جفت‌سازی با QR
  // ---------------------------------------------------------------
  // خط بایگانی‌شده = غیرفعال و دارای تماس ثبت‌شده (حذف نمی‌شود تا تماس‌ها نمانند)
  var showArchivedLines = false;
  function loadPhoneLines() {
    var fa = function (v) { return Jalali.toFaDigits(String(v)); };
    api("/calls/lines").then(function (r) {
      var all = r.lines || [];
      var isArchived = function (l) { return !l.isActive && l.calls > 0; };
      var archived = all.filter(isArchived);
      var lines = showArchivedLines ? all : all.filter(function (l) { return !isArchived(l); });
      $("phoneLinesEmpty").hidden = all.length > 0;
      var note = $("phoneLinesArchived");
      if (note) {
        note.hidden = !archived.length;
        note.innerHTML = archived.length
          ? '<button type="button" class="btn btn-ghost btn-sm" data-pl-archived>' +
            (showArchivedLines ? "پنهان کردن" : "نمایش") + " خط‌های بایگانی‌شده (" + fa(archived.length) + ")</button>" +
            '<span class="hint" style="margin:0 8px 0 0">خطی که تماس ثبت‌شده دارد پاک نمی‌شود تا تماس‌هایش از بین نرود.</span>'
          : "";
      }
      $("phoneLinesTbody").innerHTML = lines.map(function (l) {
        var st = isArchived(l)
          ? '<span class="pill st-lost">بایگانی شده</span>'
          : !l.isActive ? '<span class="pill st-lost">غیرفعال</span>'
          : l.paired ? '<span class="pill st-won">متصل</span>' : '<span class="pill st-contract">منتظر جفت‌سازی</span>';
        // دکمه از همان اول همان کاری را بگوید که واقعاً انجام می‌دهد
        var canDelete = !l.calls;
        return (
          "<tr" + (isArchived(l) ? ' class="row-muted"' : "") + "><td><strong>" + esc(l.name) + "</strong>" +
          (l.branch ? '<div class="cell-sub">' + esc(l.branch) + "</div>" : "") +
          '<div class="cell-sub">' + (l.calls ? fa(l.calls) + " تماس ثبت‌شده" : "بدون تماس ثبت‌شده") + "</div></td>" +
          "<td>" + (l.simNumber ? phoneHtml(l.simNumber) : "—") + "</td>" +
          "<td>" + st + "</td>" +
          '<td class="club-date">' + (l.lastSeenAt ? esc(fmtDateTime(l.lastSeenAt)) : "—") + "</td>" +
          "<td>" + esc(l.appVersion || "—") + "</td>" +
          '<td style="white-space:nowrap;">' +
          '<button type="button" class="btn btn-ghost btn-sm" data-pl-pair="' + esc(l.id) + '">' + (l.paired ? "کد جدید (نصب دوباره)" : "QR / کد جفت‌سازی") + "</button> " +
          (l.paired ? '<button type="button" class="btn btn-danger btn-sm" data-pl-revoke="' + esc(l.id) + '">ابطال اتصال</button> ' : "") +
          '<button type="button" class="btn btn-ghost btn-sm" data-pl-toggle="' + esc(l.id) + '" data-active="' + (l.isActive ? "1" : "0") + '">' + (l.isActive ? "غیرفعال" : "فعال") + "</button> " +
          (isArchived(l) ? "" :
            '<button type="button" class="btn btn-danger btn-sm" data-pl-del="' + esc(l.id) + '" data-name="' + esc(l.name) + '" data-calls="' + fa(l.calls || 0) + '">' +
            (canDelete ? "حذف خط" : "بایگانی کردن") + "</button>") +
          "</td></tr>"
        );
      }).join("");
    }).catch(function (e) { toast(e.message, true); });
  }

  function showPairing(lineId, lineName) {
    api("/calls/lines/" + lineId + "/qr").then(function (r) {
      $("pairingBox").hidden = false;
      $("pairingQr").innerHTML = r.svg; // SVG ساخته‌شده توسط خود سرور
      $("pairingTitle").textContent = "جفت‌سازی «" + (lineName || "") + "»";
      $("pairingCode").textContent = Jalali.toFaDigits(String(r.code).replace(/(\d{3})(\d{3})/, "$1 $2"));
      var exp = new Date(r.expiresAt);
      $("pairingInfo").innerHTML =
        "در اپ «اپ تماس» روی همان گوشی، QR را اسکن کنید.<br>یا آدرس سرور <b dir=\"ltr\">" + esc(r.server) + "</b> و این کد را دستی وارد کنید.<br>" +
        "این کد یک‌بارمصرف است و تا ساعت " + Jalali.toFaDigits(String(exp.getHours()).padStart(2, "0") + ":" + String(exp.getMinutes()).padStart(2, "0")) + " (۱۵ دقیقه) اعتبار دارد.";
      $("pairingBox").scrollIntoView({ behavior: "smooth", block: "center" });
    }).catch(function (e) { toast(e.message, true); });
  }

  $("pl_add").addEventListener("click", function () {
    var name = $("pl_name").value.trim();
    if (!name) { toast("نام خط را وارد کنید", true); return; }
    api("/calls/lines", { method: "POST", body: { name: name, simNumber: $("pl_sim").value.trim(), branch: $("pl_branch").value.trim() } })
      .then(function (r) {
        $("pl_name").value = ""; $("pl_sim").value = ""; $("pl_branch").value = "";
        toast("خط ساخته شد — حالا QR را با گوشی اسکن کنید");
        loadPhoneLines();
        showPairing(r.line.id, r.line.name);
      })
      .catch(function (e) { toast(e.message, true); });
  });

  if ($("phoneLinesArchived")) {
    $("phoneLinesArchived").addEventListener("click", function (e) {
      if (!e.target.closest("[data-pl-archived]")) return;
      showArchivedLines = !showArchivedLines;
      loadPhoneLines();
    });
  }

  $("phoneLinesTbody").addEventListener("click", function (e) {
    var del = e.target.closest("[data-pl-del]");
    if (del) {
      var dn = del.getAttribute("data-name") || "این خط";
      var dc = del.getAttribute("data-calls") || "۰";
      var ask = dc === "۰"
        ? "خط «" + dn + "» کامل حذف شود؟ این خط هیچ تماس ثبت‌شده‌ای ندارد."
        : "خط «" + dn + "» بایگانی شود؟ این خط " + dc + " تماس ثبت‌شده دارد، پس پاک نمی‌شود — " +
          "از فهرست کنار می‌رود، اتصال گوشی باطل می‌شود و تماس‌هایش در گزارش‌ها می‌مانند.";
      if (!confirm(ask)) return;
      del.disabled = true;
      api("/calls/lines/" + del.getAttribute("data-pl-del"), { method: "DELETE" })
        .then(function (r) { toast(r.message || "انجام شد"); loadPhoneLines(); })
        .catch(function (err) { toast(err.message, true); del.disabled = false; });
      return;
    }
    var b = e.target.closest("[data-pl-pair]");
    if (b) {
      var id = b.getAttribute("data-pl-pair");
      api("/calls/lines/" + id + "/pairing", { method: "POST" })
        .then(function (r) { loadPhoneLines(); showPairing(id, r.line.name); })
        .catch(function (err) { toast(err.message, true); });
      return;
    }
    b = e.target.closest("[data-pl-revoke]");
    if (b) {
      if (!confirm("اتصال این گوشی باطل شود؟ تا جفت‌سازی دوباره، گوشی نمی‌تواند تماسی بفرستد.")) return;
      api("/calls/lines/" + b.getAttribute("data-pl-revoke") + "/revoke", { method: "POST" })
        .then(function () { toast("اتصال باطل شد"); $("pairingBox").hidden = true; loadPhoneLines(); })
        .catch(function (err) { toast(err.message, true); });
      return;
    }
    b = e.target.closest("[data-pl-toggle]");
    if (b) {
      var active = b.getAttribute("data-active") === "1";
      api("/calls/lines/" + b.getAttribute("data-pl-toggle"), { method: "PATCH", body: { isActive: !active } })
        .then(function () { loadPhoneLines(); })
        .catch(function (err) { toast(err.message, true); });
    }
  });

  // ---------------------------------------------------------------
  // تنظیمات ← نحوه‌ی آشنایی (افزودن، تغییر نام، غیرفعال، ترتیب)
  // ---------------------------------------------------------------
  state.channelDraft = [];
  function loadChannelEditor() {
    loadChannels().then(function (list) {
      state.channelDraft = list.map(function (c) { return { name: c.name, active: c.active }; });
      renderChannelEditor();
    });
  }
  function renderChannelEditor() {
    $("channelList").innerHTML = state.channelDraft.map(function (c, i) {
      return (
        '<div class="channel-row' + (c.active ? "" : " inactive") + '" data-i="' + i + '">' +
        '<button type="button" class="btn btn-ghost btn-sm" data-ch-up="' + i + '" aria-label="بالا"' + (i === 0 ? " disabled" : "") + ">▲</button>" +
        '<button type="button" class="btn btn-ghost btn-sm" data-ch-down="' + i + '" aria-label="پایین"' + (i === state.channelDraft.length - 1 ? " disabled" : "") + ">▼</button>" +
        '<input type="text" data-ch-name="' + i + '" value="' + esc(c.name) + '" maxlength="60">' +
        '<label class="ch-active"><input type="checkbox" data-ch-active="' + i + '"' + (c.active ? " checked" : "") + "> فعال</label>" +
        "</div>"
      );
    }).join("");
  }
  $("channelList").addEventListener("click", function (e) {
    var up = e.target.closest("[data-ch-up]");
    var down = e.target.closest("[data-ch-down]");
    var d = state.channelDraft;
    if (up) { var i = +up.getAttribute("data-ch-up"); var t = d[i - 1]; d[i - 1] = d[i]; d[i] = t; renderChannelEditor(); }
    if (down) { var j = +down.getAttribute("data-ch-down"); var t2 = d[j + 1]; d[j + 1] = d[j]; d[j] = t2; renderChannelEditor(); }
  });
  $("channelList").addEventListener("input", function (e) {
    var n = e.target.getAttribute("data-ch-name");
    if (n !== null) state.channelDraft[+n].name = e.target.value;
  });
  $("channelList").addEventListener("change", function (e) {
    var a = e.target.getAttribute("data-ch-active");
    if (a !== null) { state.channelDraft[+a].active = e.target.checked; renderChannelEditor(); }
  });
  $("ch_add").addEventListener("click", function () {
    var v = $("ch_new").value.trim();
    if (!v) return;
    state.channelDraft.push({ name: v, active: true });
    $("ch_new").value = "";
    renderChannelEditor();
  });
  $("ch_save").addEventListener("click", function () {
    api("/settings/channels", { method: "PUT", body: { channels: state.channelDraft } })
      .then(function (r) {
        state.channels = r.channels;
        fillChannelSelects();
        state.channelDraft = r.channels.map(function (c) { return { name: c.name, active: c.active }; });
        renderChannelEditor();
        toast("فهرست نحوه‌ی آشنایی ذخیره شد");
      })
      .catch(function (e) { toast(e.message, true); });
  });

  // ---------------------------------------------------------------
  // پرونده‌ی مشتری: تماس‌های گوشی در تاریخچه + پیشنهاد تغییر مرحله
  // ---------------------------------------------------------------
  function renderPhoneHistory(r) {
    if ($("m_heat")) $("m_heat").innerHTML = heatBadgeHtml(r && r.heat) + (r && r.heat ? '<span class="cell-sub m-heat-why">' + esc((r.heat.reasons || []).join("، ")) + "</span>" : "");
    state.activePhoneCalls = (r && r.calls) || [];
    if (!state.activePhoneCalls.length) return;
    renderFollowupsAndCalls();
  }

  // لیست یکی‌شده‌ی پیگیری‌ها و تماس‌های گوشی (پرونده‌ی مشتری) — بعد از ویرایش یک
  // کارت هم همین‌جا دوباره رسم می‌شود، بدون نیاز به درخواست تازه از سرور
  function renderFollowupsAndCalls() {
    var fus = (state.activeFollowups || []).map(function (f) {
      return { t: f.followupDate, html: followupItemHtml(f) };
    });
    var calls = state.activePhoneCalls || [];
    var cs = calls.map(function (c) {
      var label = { INCOMING: "📲 مشتری خودش تماس گرفت (ورودی)", OUTGOING: "تماس خروجی — بی‌جواب", MISSED: "📲 مشتری تماس گرفت — بی‌پاسخ ماند", REJECTED: "📲 مشتری تماس گرفت — رد شد" }[c.direction] || c.direction;
      var dur = c.durationSec ? " — " + Jalali.toFaDigits(Math.floor(c.durationSec / 60) + ":" + String(c.durationSec % 60).padStart(2, "0")) : "";
      return {
        t: c.startedAt,
        html:
          '<div class="followup-item phone-call"><div class="meta"><span>📞 ' + esc(c.operatorName || "—") + " · " + esc(fmtDateTime(c.startedAt)) + "</span>" +
          '<span class="pill ' + (DIR_CLASS[c.direction] || "") + '">' + DIR_ICON[c.direction] + " " + esc(label) + esc(dur) + "</span></div>" +
          (c.note ? '<div class="content">' + esc(c.note) + "</div>" : c.logStatus === "UNLOGGED" ? '<div class="content cell-sub">ثبت نشده</div>' : "") +
          '<div class="cell-sub">' + esc(c.lineName || "") + "</div></div>",
      };
    });
    var all = fus.concat(cs).sort(function (a, b) { return b.t - a.t; });
    $("m_followups").innerHTML = all.map(function (x) { return x.html; }).join("");
  }


  // ---------------------------------------------------------------
  // تنظیمات ← سرنخ‌های تکراری (پیدا کردن و ادغام)
  // ---------------------------------------------------------------
  state.dups = [];
  function loadDuplicates() {
    $("dupSummary").textContent = "در حال جست‌وجو…";
    api("/leads/duplicates")
      .then(function (r) {
        state.dups = r.groups || [];
        var f = function (n) { return Jalali.toFaDigits(String(n)); };
        $("dupEmpty").hidden = state.dups.length > 0;
        $("dupSummary").textContent = state.dups.length
          ? f(state.dups.length) + " شماره‌ی تکراری — با ادغام همه، " + f(r.totalExtra) + " سرنخ اضافه حذف می‌شود."
          : "";
        $("dupList").innerHTML = state.dups.map(function (g, gi) {
          var rows = g.leads.map(function (l) {
            var c = l.counts || {};
            return "<tr>" +
              '<td><label class="dup-pick"><input type="radio" name="dupPrimary' + gi + '" value="' + esc(l.id) + '"' + (l.id === g.suggestedPrimaryId ? " checked" : "") + "> اصلی</label></td>" +
              '<td><span class="call-lead" data-dup-lead="' + esc(l.id) + '">' + esc(l.name || "بدون نام") + "</span>" + (l.notes ? '<div class="cell-sub dup-note">' + esc(l.notes) + "</div>" : "") + "</td>" +
              "<td>" + (stageTagHtml(l) || '<span class="cell-sub">—</span>') + "</td>" +
              "<td>" + esc(l.channel || "—") + "</td>" +
              '<td class="club-date">' + esc(fmtDate(l.createdAt)) + "</td>" +
              '<td class="cell-sub">پیگیری ' + f(c.followups || 0) + " · تماس " + f(c.callLogs || 0) + "</td>" +
              "</tr>";
          }).join("");
          return '<div class="dup-group" data-gi="' + gi + '">' +
            '<div class="dup-head"><b dir="ltr">' + esc(g.phone) + "</b> <span class=\"cell-sub\">" + f(g.leads.length) + " سرنخ</span>" +
            '<button type="button" class="btn btn-primary btn-sm" data-dup-merge="' + gi + '">ادغام در سرنخ اصلی</button></div>' +
            '<div class="table-scroll"><table><thead><tr><th></th><th>نام / توضیحات</th><th>کارشناس</th><th>وضعیت</th><th>کانال</th><th>ثبت</th><th>فعالیت</th></tr></thead><tbody>' + rows + "</tbody></table></div></div>";
        }).join("");
      })
      .catch(function (e) { $("dupSummary").textContent = ""; toast(e.message, true); });
  }
  $("dupList").addEventListener("click", function (e) {
    var lead = e.target.closest("[data-dup-lead]");
    if (lead) { openLeadModal(lead.getAttribute("data-dup-lead")); return; }
    var b = e.target.closest("[data-dup-merge]");
    if (!b) return;
    var gi = Number(b.getAttribute("data-dup-merge"));
    var g = state.dups[gi];
    var picked = document.querySelector('input[name="dupPrimary' + gi + '"]:checked');
    if (!g || !picked) return;
    var primaryId = picked.value;
    var primary = g.leads.filter(function (l) { return l.id === primaryId; })[0];
    var others = g.leads.filter(function (l) { return l.id !== primaryId; });
    var msg = "همه‌ی اطلاعات " + Jalali.toFaDigits(String(others.length)) + " سرنخ دیگرِ شماره‌ی " + g.phone +
      " به سرنخ «" + (primary.name || "بدون نام") + "» منتقل و آن‌ها حذف می‌شوند. ادامه می‌دهید؟";
    if (!confirm(msg)) return;
    b.disabled = true;
    api("/leads/merge", { method: "POST", body: { primaryId: primaryId, mergeIds: others.map(function (l) { return l.id; }) } })
      .then(function () {
        toast("ادغام شد");
        refreshLeadLists();
        loadDuplicates();
      })
      .catch(function (err) { toast(err.message, true); b.disabled = false; });
  });

  // ---------------------------------------------------------------
  // تنظیمات ← پشتیبان روزانه در بله
  // ---------------------------------------------------------------
  state.bk = { chatTitle: "" };
  function renderBackupStatus(c) {
    $("bk_token").value = "";
    $("bk_token").placeholder = c.tokenHint ? "ذخیره شده (" + c.tokenHint + ") — برای تغییر، توکن تازه بگذارید" : "مثلاً 123456789:AbC…";
    $("bk_chat").value = c.chatId ? (c.chatTitle || "چت") + " — " + c.chatId : "";
    $("bk_pass").value = "";
    $("bk_pass2").value = "";
    $("bk_pass").placeholder = c.hasPassphrase ? "ذخیره شده — برای تغییر، رمز تازه بگذارید" : "دست‌کم ۸ نویسه";
    var lines = [];
    if (!c.configured) lines.push('<span class="pill st-contract">هنوز فعال نشده</span>');
    else lines.push('<span class="pill st-won">فعال است</span>');
    if (c.lastSentAt) lines.push("آخرین ارسال موفق: " + esc(fmtDateTime(c.lastSentAt)) + (c.lastFile ? " (" + esc(c.lastFile) + ")" : ""));
    if (c.lastError && (!c.lastSentAt || c.lastErrorAt > c.lastSentAt)) lines.push('<span class="bk-err">آخرین خطا: ' + esc(c.lastError) + "</span>");
    $("bk_status").innerHTML = lines.join("<br>");
  }
  function loadBackupBale() {
    api("/settings/backup-bale").then(renderBackupStatus).catch(function (e) { toast(e.message, true); });
  }
  $("bk_find").addEventListener("click", function () {
    var b = $("bk_find");
    b.disabled = true;
    api("/settings/backup-bale/find-chat", { method: "POST", body: { token: $("bk_token").value.trim() } })
      .then(function (r) {
        state.bk = r;
        $("bk_chat").value = (r.chatTitle || "چت") + " — " + r.chatId;
        toast("چت پیدا شد — حالا «ذخیره» را بزنید");
      })
      .catch(function (e) { toast(e.message, true); })
      .finally(function () { b.disabled = false; });
  });
  $("bk_save").addEventListener("click", function () {
    var pass = $("bk_pass").value;
    if (pass && pass !== $("bk_pass2").value) { toast("رمز و تکرار آن یکی نیست", true); return; }
    var body = {};
    if ($("bk_token").value.trim()) body.token = $("bk_token").value.trim();
    if (state.bk && state.bk.chatId) { body.chatId = state.bk.chatId; body.chatTitle = state.bk.chatTitle || ""; }
    if (pass) body.passphrase = pass;
    api("/settings/backup-bale", { method: "PUT", body: body })
      .then(function (c) {
        state.bk = {};
        renderBackupStatus(c);
        toast(c.configured ? "ذخیره شد — «ارسال آزمایشی» را بزنید" : "ذخیره شد — موارد باقی‌مانده را کامل کنید");
      })
      .catch(function (e) { toast(e.message, true); });
  });
  $("bk_test").addEventListener("click", function () {
    var b = $("bk_test");
    b.disabled = true;
    b.textContent = "در حال ارسال…";
    api("/settings/backup-bale/test", { method: "POST" })
      .then(function (r) {
        renderBackupStatus(r.status);
        toast("فرستاده شد — در بله فایل را ببینید");
      })
      .catch(function (e) { toast(e.message, true); loadBackupBale(); })
      .finally(function () { b.disabled = false; b.textContent = "ارسال آزمایشی"; });
  });

  // ---------------------------------------------------------------
  // تنظیمات ← سامانه‌ی پیامکی (کلید هیچ‌وقت کامل برنمی‌گردد)
  // ---------------------------------------------------------------
  function renderSmsPanel(c) {
    $("sms_key").value = "";
    $("sms_key").placeholder = c.keyHint ? "ذخیره شده (" + c.keyHint + ") — برای تغییر، کلید تازه بگذارید" : "کلید را این‌جا بگذارید";
    $("sms_sender").value = c.sender || "";
    var lines = [c.configured
      ? '<span class="pill st-won">وصل است</span>' + (c.source === "env" ? " (از تنظیمات سرور)" : "")
      : '<span class="pill st-contract">وصل نیست — پیامک‌ها دستی فرستاده می‌شوند</span>'];
    var t = c.lastTest;
    if (t) {
      lines.push("آخرین پیامک آزمایشی (" + esc(fmtDateTime(t.at)) + " به " + esc(Jalali.toFaDigits(t.phone || "")) + "): " +
        (t.status === "sent" ? '<b style="color:#15803d">فرستاده شد</b>' : '<span class="bk-err">ناموفق — ' + esc(t.error || t.status) + "</span>"));
    }
    $("sms_status").innerHTML = lines.join("<br>");
  }
  // ریکورد پیامک‌ها: چه پیامکی، توسط چه کسی، برای چه مشتری
  var smsLogTimer = null;
  function renderSmsLog(d) {
    var rows = d.rows || [];
    if (!rows.length) { $("smsLogList").innerHTML = '<div class="cell-sub">پیامکی پیدا نشد.</div>'; return; }
    var cls = { sent: "st-won", failed: "st-lost", manual: "st-contract" };
    $("smsLogList").innerHTML = '<div class="table-scroll"><table><thead><tr><th>تاریخ</th><th>مشتری</th><th>شماره</th><th>موضوع</th><th>فرستنده</th><th>وضعیت</th><th>متن پیامک</th></tr></thead><tbody>' +
      rows.map(function (r) {
        return "<tr>" +
          "<td>" + esc(fmtDateTime(r.at)) + "</td>" +
          "<td>" + (r.leadId ? '<button type="button" class="link-btn" data-sms-lead="' + esc(r.leadId) + '">' + esc(r.leadName || "بدون نام") + "</button>" : '<span class="cell-sub">—</span>') + "</td>" +
          '<td dir="ltr">' + esc(Jalali.toFaDigits(r.phone)) + "</td>" +
          "<td>" + esc(r.topic || "—") + "</td>" +
          "<td>" + esc(r.by) + "</td>" +
          '<td><span class="pill ' + (cls[r.status] || "") + '">' + esc(r.statusLabel) + "</span>" + (r.error ? '<div class="cell-sub">' + esc(r.error) + "</div>" : "") + "</td>" +
          '<td class="sms-body">' + esc(r.body) + "</td></tr>";
      }).join("") + "</tbody></table></div>";
  }
  function loadSmsLog() {
    var q = "?limit=300";
    if ($("smsLogQ").value.trim()) q += "&q=" + encodeURIComponent($("smsLogQ").value.trim());
    if ($("smsLogStatus").value) q += "&status=" + $("smsLogStatus").value;
    api("/settings/sms/log" + q).then(renderSmsLog).catch(function (e) { $("smsLogList").innerHTML = '<div class="cell-sub">' + esc(e.message) + "</div>"; });
  }
  $("smsLogQ").addEventListener("input", function () { clearTimeout(smsLogTimer); smsLogTimer = setTimeout(loadSmsLog, 350); });
  $("smsLogStatus").addEventListener("change", loadSmsLog);
  $("smsLogList").addEventListener("click", function (e) {
    var b = e.target.closest("[data-sms-lead]");
    if (b) openLeadModal(b.getAttribute("data-sms-lead"));
  });

  function loadSmsPanel() {
    api("/settings/sms").then(renderSmsPanel).catch(function (e) { toast(e.message, true); });
  }
  $("sms_save").addEventListener("click", function () {
    var body = { sender: $("sms_sender").value.trim() };
    if ($("sms_key").value.trim()) body.apiKey = $("sms_key").value.trim();
    api("/settings/sms", { method: "PUT", body: body })
      .then(function (c) { renderSmsPanel(c); toast("ذخیره شد — حالا پیامک آزمایشی بفرستید"); })
      .catch(function (e) { toast(e.message, true); });
  });
  $("sms_off").addEventListener("click", function () {
    if (!window.confirm("اتصال سامانه‌ی پیامکی قطع شود؟ از این به بعد پیامک‌ها دستی فرستاده می‌شوند.")) return;
    api("/settings/sms", { method: "PUT", body: { disable: true } })
      .then(function (c) { renderSmsPanel(c); toast("اتصال قطع شد"); })
      .catch(function (e) { toast(e.message, true); });
  });
  $("sms_test").addEventListener("click", function () {
    var phone = $("sms_test_phone").value.trim();
    if (!phone) { toast("شماره‌ی موبایل را بنویسید", true); return; }
    var b = $("sms_test");
    b.disabled = true;
    b.textContent = "در حال ارسال…";
    api("/settings/sms/test", { method: "POST", body: { phone: phone } })
      .then(function (r) {
        renderSmsPanel(r.config);
        if (r.status === "sent") toast("پیامک فرستاده شد — گوشی را ببینید");
        else toast("ارسال نشد: " + (r.error || r.status), true);
      })
      .catch(function (e) { toast(e.message, true); })
      .finally(function () { b.disabled = false; b.textContent = "ارسال پیامک آزمایشی"; });
  });

  // پل برای public/js/workdesk.js (میز کار مشاور CRM نمونه)
  // گوشی: جدول‌ها با CSS کارت می‌شوند؛ این‌جا اسم سرستونِ هر خانه در data-label گذاشته می‌شود
  // (جدول‌ها مدام با innerHTML دوباره ساخته می‌شوند، پس با MutationObserver)
  function stackTables() {
    Array.prototype.forEach.call(document.querySelectorAll("table:not(.no-stack)"), function (t) {
      var ths = t.tHead && t.tHead.rows.length ? t.tHead.rows[t.tHead.rows.length - 1].cells : null;
      if (!ths) return;
      var labels = Array.prototype.map.call(ths, function (th) { return { text: th.textContent.replace(/[⇅▲▼↑↓]/g, "").replace(/\s+/g, " ").trim(), span: th.colSpan || 1 }; });
      Array.prototype.forEach.call(t.tBodies, function (tb) {
        Array.prototype.forEach.call(tb.rows, function (tr) {
          var col = 0;
          Array.prototype.forEach.call(tr.cells, function (td) {
            var lab = null, c = 0;
            for (var i = 0; i < labels.length; i++) { if (c === col) { lab = labels[i].text; break; } c += labels[i].span; }
            if (td.colSpan > 1 || !lab) td.removeAttribute("data-label");
            else if (td.getAttribute("data-label") !== lab) td.setAttribute("data-label", lab);
            // خانه‌ی خالی («—») در کارتِ گوشی جا نگیرد
            td.classList.toggle("td-blank", /^[—\-–]?$/.test(td.textContent.trim()) && !td.querySelector("input,select,button,img"));
            col += td.colSpan || 1;
          });
        });
      });
    });
  }
  var stackQueued = false;
  new MutationObserver(function () {
    if (stackQueued) return;
    stackQueued = true;
    requestAnimationFrame(function () { stackQueued = false; stackTables(); });
  }).observe(document.body, { childList: true, subtree: true });
  stackTables();

  window.CrmApp = {
    api: api, esc: esc, toast: toast, can: can, state: state, $: $,
    setOverlay: setOverlay, fmtDate: fmtDate, fmtDateTime: fmtDateTime, phoneHtml: phoneHtml,
    openLeadModal: openLeadModal, switchTab: switchTab, refreshLeadLists: refreshLeadLists,
    kpiCardHtml: kpiCardHtml, openCallLog: openCallLog,
    callRowHtml: callRowHtml, bindCallRows: bindCallRows, loadCallOperators: loadCallOperators,
    fetchCalls: fetchCalls,
    CG_OUTCOMES: CG_OUTCOMES, fuChooserHtml: fuChooserHtml, cfChannelOptions: cfChannelOptions,
  };

  boot();
})();
