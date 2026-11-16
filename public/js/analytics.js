// صفحه‌ی «آمار فروش»: چند گزارش با زیرتب، بازه‌ی شمسی، پیش‌نمایش و اکسل.
// داده‌ها از /reports/analytics/:kind (modules/crm/services/analyticsService.js).
(function () {
  "use strict";
  var A = window.CrmApp;
  if (!A) return;
  var api = A.api, esc = A.esc, toast = A.toast, $ = A.$;
  var fa = function (v) { return Jalali.toFaDigits(String(v)); };
  var sep = function (n) { return fa(String(Math.round(Number(n) || 0)).replace(/\B(?=(\d{3})+(?!\d))/g, ",")); };
  var reports = [], cur = null, ready = false, segFilter = "", granularity = "week";

  function fmt(d) { return Jalali.formatDate(d, { faDigits: true }); }
  function startOfDay(d) { var x = new Date(d); x.setHours(0, 0, 0, 0); return x; }
  function fromJalali(jy, jm, jd) { var g = Jalali.toGregorian(jy, jm, jd); return new Date(g.gy, g.gm - 1, g.gd); }

  function setRange(key) {
    var today = startOfDay(new Date()), from = today, to = today;
    if (key === "7" || key === "30" || key === "90") from = new Date(today.getTime() - (Number(key) - 1) * 864e5);
    else if (key === "year") from = new Date(today.getTime() - 364 * 864e5);
    else if (key === "month" || key === "lastmonth") {
      var j = Jalali.toJalali(today.getFullYear(), today.getMonth() + 1, today.getDate());
      var jy = j.jy, jm = j.jm;
      if (key === "lastmonth") { jm--; if (jm < 1) { jm = 12; jy--; } }
      from = fromJalali(jy, jm, 1);
      to = key === "month" ? today : new Date(fromJalali(jm === 12 ? jy + 1 : jy, jm === 12 ? 1 : jm + 1, 1).getTime() - 864e5);
    }
    $("anFrom").value = fmt(from);
    $("anTo").value = fmt(to);
    Array.prototype.forEach.call($("anQuick").querySelectorAll("[data-an-range]"), function (c) {
      c.classList.toggle("active", c.getAttribute("data-an-range") === key);
    });
  }

  function query() {
    var q = [];
    if (cur && cur.ranged) {
      var f = Jalali.parseDate($("anFrom").value), t = Jalali.parseDate($("anTo").value);
      if (!f || !t) { toast("تاریخ را به شکل ۱۴۰۵/۰۸/۰۱ بنویسید", true); return null; }
      var from = startOfDay(f).getTime(), to = startOfDay(t).getTime() + 864e5;
      if (to <= from) { toast("تاریخ «تا» باید بعد از «از» باشد", true); return null; }
      q.push("from=" + from, "to=" + to);
    }
    if (cur && cur.kind === "segments" && segFilter) q.push("segment=" + segFilter);
    if (cur && cur.kind === "dashboard") q.push("granularity=" + granularity);
    return q.join("&");
  }

  function cellText(r, i, v) {
    if ((r.money || []).indexOf(i) !== -1 && v !== "" && v !== null) return sep(v);
    return fa(v === null || v === undefined ? "" : v);
  }
  function tableHtml(r) {
    if (!r.rows.length) return '<div class="empty">موردی نیست.</div>';
    return '<div class="table-scroll rx-table"><table><thead><tr>' + r.columns.map(function (c) { return "<th>" + esc(c) + "</th>"; }).join("") + "</tr></thead><tbody>" +
      r.rows.map(function (row, ri) {
        var id = r.leadIds ? r.leadIds[ri] : "";
        return "<tr" + (id ? ' class="an-row" data-lead="' + esc(id) + '"' : "") + ">" + row.map(function (v, i) {
          var t = cellText(r, i, v); return "<td" + (t.length > 40 ? ' class="rx-wrap"' : "") + ">" + esc(t) + "</td>";
        }).join("") + "</tr>";
      }).join("") + "</tbody>" +
      (r.footer ? "<tfoot><tr>" + r.footer.map(function (v, i) { return "<td>" + esc(cellText(r, i, v)) + "</td>"; }).join("") + "</tr></tfoot>" : "") + "</table></div>" +
      (r.total > r.rows.length ? '<div class="cell-sub">' + fa(r.rows.length) + " ردیف از " + fa(r.total) + " نمایش داده شد؛ فایل اکسل همه را دارد.</div>" : "");
  }
  function sumHtml(r) {
    return '<div class="rx-sum">' + (r.summary || []).map(function (s) { return "<div>" + esc(s[0]) + "<b>" + esc(fa(s[1])) + "</b></div>"; }).join("") + "</div>";
  }

  // داشبورد: کارت شاخص با مقایسه + نمودار میله‌ای هفتگی
  function dashHtml(r) {
    var cards = '<div class="an-kpis">' + r.kpis.map(function (k) {
      var v = k.money ? sep(k.value) + ' <small>ریال</small>' : sep(k.value);
      var ch = k.change === null ? '<span class="an-ch">بازه‌ی قبل: ' + (k.money ? sep(k.prev) : sep(k.prev)) + "</span>"
        : '<span class="an-ch ' + (k.change >= 0 ? "up" : "down") + '">' + (k.change >= 0 ? "▲ " : "▼ ") + fa(Math.abs(k.change)) + "٪ نسبت به بازه‌ی قبل</span>";
      return '<div class="an-kpi"><div class="an-l">' + esc(k.label) + '</div><div class="an-v">' + v + "</div>" + ch + "</div>";
    }).join("") + "</div>";
    var max = Math.max.apply(null, r.weeks.map(function (w) { return w.amount; }).concat([1]));
    var bars = '<div class="an-chart" aria-label="روند جمع خرید">' + r.weeks.map(function (w) {
      var h = Math.round((w.amount / max) * 100);
      return '<div class="an-bar" title="' + esc(fa(w.label) + " — " + sep(w.amount) + " ریال، " + fa(w.count) + " فاکتور") + '"><i style="height:' + h + '%"></i><span>' + esc(fa(w.short)) + "</span></div>";
    }).join("") + "</div>";
    var granLabel = { day: "روزانه", week: "هفتگی", month: "ماهانه" };
    var tabs = '<div class="segment-row an-gran" style="margin:0 0 8px;">' + ["day", "week", "month"].map(function (g) {
      return '<button type="button" class="chip' + (r.granularity === g ? " active" : "") + '" data-an-gran="' + g + '">' + granLabel[g] + "</button>";
    }).join("") + "</div>";
    return cards + '<h3 class="an-h">روند ' + granLabel[r.granularity] + " جمع خرید</h3>" + tabs + bars;
  }

  function segHtml(r) {
    var st = r.settings;
    var cards = '<div class="an-segs">' + r.segments.map(function (g) {
      return '<button type="button" class="an-seg seg-' + g.key + (segFilter === g.key ? " active" : "") + '" data-seg="' + g.key + '"><b>' + esc(g.label) + "</b><span>" + fa(g.count) + " مشتری · " + fa(g.share) + "٪</span><small>" + esc(g.hint) + "</small></button>";
    }).join("") + "</div>";
    var rules = '<details class="an-rules"><summary>معیار گروه‌ها' + (A.can("settings") ? " (قابل ویرایش)" : "") + "</summary>" +
      '<div class="rx-bar">' +
      field("goldCount", "طلایی: حداقل نوبت خرید", st.goldCount) +
      field("goldAmount", "طلایی: حداقل جمع خرید (ریال)", st.goldAmount) +
      field("activeDays", "فعال: حداکثر روز از آخرین خرید", st.activeDays) +
      field("sleepDays", "خواب‌رفته: بیش از این روز بی‌خرید", st.sleepDays) +
      field("churnFactor", "هشدار ریزش: چند برابر فاصله‌ی معمول", st.churnFactor) +
      (A.can("settings") ? '<div class="rx-btns"><button type="button" class="btn btn-primary btn-sm" id="anSaveRules">ذخیره</button></div>' : "") +
      "</div></details>";
    return cards + rules;
  }
  function field(k, label, v) {
    return '<label class="rx-f"><span>' + esc(label) + '</span><input type="text" inputmode="decimal" data-rule="' + k + '" value="' + esc(fa(v)) + '"' + (A.can("settings") ? "" : " disabled") + "></label>";
  }

  function render(r) {
    var head = '<div class="rx-head"><b>' + esc(r.title) + "</b> · " + esc(fa(r.period)) + "</div>";
    var extra = r.kind === "dashboard" ? dashHtml(r) : r.kind === "segments" ? segHtml(r) : sumHtml(r);
    $("anOut").innerHTML = head + extra + tableHtml(r);
    Array.prototype.forEach.call($("anOut").querySelectorAll("[data-seg]"), function (b) {
      b.addEventListener("click", function () { var k = b.getAttribute("data-seg"); segFilter = segFilter === k ? "" : k; show(); });
    });
    Array.prototype.forEach.call($("anOut").querySelectorAll("[data-an-gran]"), function (b) {
      b.addEventListener("click", function () { granularity = b.getAttribute("data-an-gran"); show(); });
    });
    Array.prototype.forEach.call($("anOut").querySelectorAll(".an-row"), function (tr) {
      tr.addEventListener("click", function () { A.openLeadModal(tr.getAttribute("data-lead")); });
    });
    var save = $("anSaveRules");
    if (save) save.addEventListener("click", saveRules);
  }

  function saveRules() {
    var body = {};
    Array.prototype.forEach.call($("anOut").querySelectorAll("[data-rule]"), function (i) {
      body[i.getAttribute("data-rule")] = Jalali.toEnDigits ? Jalali.toEnDigits(i.value) : i.value.replace(/٫/g, ".").replace(/[۰-۹]/g, function (d) { return "۰۱۲۳۴۵۶۷۸۹".indexOf(d); });
    });
    api("/reports/analytics/settings", { method: "PUT", body: body })
      .then(function () { toast("معیارها ذخیره شد"); show(); })
      .catch(function (e) { toast(e.message || "ذخیره نشد", true); });
  }

  function show() {
    if (!cur) return;
    var q = query();
    if (q === null) return;
    $("anOut").innerHTML = '<div class="empty">در حال بارگذاری…</div>';
    api("/reports/analytics/" + cur.kind + (q ? "?" + q : ""))
      .then(render)
      .catch(function (e) { $("anOut").innerHTML = '<div class="empty">' + esc(e.message || "خطا") + "</div>"; });
  }
  function download() {
    if (!cur) return;
    var q = query();
    if (q === null) return;
    window.location.href = "/api/v1/reports/analytics/" + cur.kind + ".xlsx" + (q ? "?" + q : "");
  }

  function select(kind) {
    cur = reports.filter(function (r) { return r.kind === kind; })[0] || reports[0];
    segFilter = "";
    Array.prototype.forEach.call($("anTabs").querySelectorAll("[data-an]"), function (c) { c.classList.toggle("active", c.getAttribute("data-an") === cur.kind); });
    $("anRangeBar").hidden = !cur.ranged;
    $("anQuick").hidden = !cur.ranged;
    $("anXlsxOnly").hidden = cur.ranged;
    try { localStorage.setItem("crmAnalytics", cur.kind); } catch (e) { /* */ }
    show();
  }

  function load() {
    if (ready) { show(); return; }
    api("/reports/analytics").then(function (d) {
      reports = d.reports || [];
      ready = true;
      $("anTabs").innerHTML = reports.map(function (r) { return '<button type="button" class="chip" data-an="' + r.kind + '">' + esc(r.title) + "</button>"; }).join("");
      Array.prototype.forEach.call($("anTabs").querySelectorAll("[data-an]"), function (c) {
        c.addEventListener("click", function () { select(c.getAttribute("data-an")); });
      });
      setRange("30");
      Array.prototype.forEach.call($("anQuick").querySelectorAll("[data-an-range]"), function (c) {
        c.addEventListener("click", function () { setRange(c.getAttribute("data-an-range")); show(); });
      });
      $("anShow").addEventListener("click", show);
      $("anXlsx").addEventListener("click", download);
      $("anXlsx2").addEventListener("click", download);
      var last = null;
      try { last = localStorage.getItem("crmAnalytics"); } catch (e) { /* */ }
      select(last || (reports.length === 1 ? "calls" : "dashboard"));
    }).catch(function (e) { toast(e.message || "خطا", true); });
  }

  window.CrmAnalytics = { load: load };
})();
