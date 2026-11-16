// گزارش‌گیری داشبورد مدیریتی: انتخاب گزارش، بازه و کارشناس ← پیش‌نمایش، و دانلود اکسل / PDF (با نام مشتری‌ها).
// داده‌ها از /reports/export/:kind (modules/crm/services/exportReportService.js).
(function () {
  "use strict";
  var A = window.CrmApp;
  if (!A) return;
  var api = A.api, esc = A.esc, toast = A.toast, $ = A.$;
  var fa = function (v) { return Jalali.toFaDigits(String(v)); };
  var ready = false;
  var money = [];

  function fmt(d) { return Jalali.formatDate(d, { faDigits: true }); }
  function startOfDay(d) { var x = new Date(d); x.setHours(0, 0, 0, 0); return x; }
  function jParts(d) { var j = Jalali.toJalali(d.getFullYear(), d.getMonth() + 1, d.getDate()); return j; }
  function fromJalali(jy, jm, jd) { var g = Jalali.toGregorian(jy, jm, jd); return new Date(g.gy, g.gm - 1, g.gd); }

  function setRange(key) {
    var today = startOfDay(new Date());
    var from = today, to = today;
    if (key === "7") from = new Date(today.getTime() - 6 * 864e5);
    else if (key === "30") from = new Date(today.getTime() - 29 * 864e5);
    else if (key === "month" || key === "lastmonth") {
      var j = jParts(today);
      var jy = j.jy, jm = j.jm;
      if (key === "lastmonth") { jm--; if (jm < 1) { jm = 12; jy--; } }
      from = fromJalali(jy, jm, 1);
      to = key === "month" ? today : new Date(fromJalali(jm === 12 ? jy + 1 : jy, jm === 12 ? 1 : jm + 1, 1).getTime() - 864e5);
    }
    $("rxFrom").value = fmt(from);
    $("rxTo").value = fmt(to);
    Array.prototype.forEach.call($("rxQuick").querySelectorAll("[data-rx-range]"), function (c) {
      c.classList.toggle("active", c.getAttribute("data-rx-range") === key);
    });
  }

  // پارامترهای مشترک پیش‌نمایش و دانلود؛ null یعنی ورودی نامعتبر
  function query() {
    var f = Jalali.parseDate($("rxFrom").value), t = Jalali.parseDate($("rxTo").value);
    if (!f || !t) { toast("تاریخ را به شکل ۱۴۰۵/۰۸/۰۱ بنویسید", true); return null; }
    var from = startOfDay(f).getTime(), to = startOfDay(t).getTime() + 864e5; // «تا» همان روز را هم شامل می‌شود
    if (to <= from) { toast("تاریخ «تا» باید بعد از «از» باشد", true); return null; }
    var q = "from=" + from + "&to=" + to;
    if ($("rxUser").value) q += "&userId=" + encodeURIComponent($("rxUser").value);
    return q;
  }

  function cellText(i, v) {
    if (money.indexOf(i) !== -1 && v !== "" && v !== null) return fa(String(Math.round(Number(v) || 0)).replace(/\B(?=(\d{3})+(?!\d))/g, ","));
    return fa(v === null || v === undefined ? "" : v);
  }

  function render(r) {
    money = r.money || [];
    var head = '<div class="rx-head"><b>' + esc(r.title) + "</b> · " + esc(fa(r.period)) + (r.userName ? " · " + esc(r.userName) : "") + "</div>";
    var sum = '<div class="rx-sum">' + r.summary.map(function (s) { return "<div>" + esc(s[0]) + "<b>" + esc(s[1]) + "</b></div>"; }).join("") + "</div>";
    var table = r.rows.length
      ? '<div class="table-scroll rx-table"><table><thead><tr>' + r.columns.map(function (c) { return "<th>" + esc(c) + "</th>"; }).join("") + "</tr></thead><tbody>" +
        r.rows.map(function (row) { return "<tr>" + row.map(function (v, i) { var t = cellText(i, v); return "<td" + (t.length > 40 ? ' class="rx-wrap"' : "") + ">" + esc(t) + "</td>"; }).join("") + "</tr>"; }).join("") +
        "</tbody>" + (r.footer ? "<tfoot><tr>" + r.footer.map(function (v, i) { return "<td>" + esc(cellText(i, v)) + "</td>"; }).join("") + "</tr></tfoot>" : "") + "</table></div>" +
        (r.total > r.rows.length ? '<div class="cell-sub">' + fa(r.rows.length) + " ردیف از " + fa(r.total) + " نمایش داده شد؛ فایل اکسل و PDF همه‌ی ردیف‌ها را دارند.</div>" : "")
      : '<div class="cell-sub">در این بازه موردی نیست.</div>';
    $("rxOut").innerHTML = head + sum + table;
  }

  function show() {
    var q = query();
    if (!q) return;
    $("rxOut").innerHTML = '<div class="cell-sub">در حال ساخت گزارش…</div>';
    api("/reports/export/" + $("rxKind").value + "?" + q)
      .then(render)
      .catch(function (err) { $("rxOut").innerHTML = ""; toast(err.message, true); });
  }

  function download(ext) {
    var q = query();
    if (!q) return;
    if (ext === "pdf") toast("PDF در حال ساخت است — چند ثانیه صبر کنید");
    window.location.href = "/api/v1/reports/export/" + $("rxKind").value + "." + ext + "?" + q;
  }

  function init() {
    if (ready || !$("rxCard")) return;
    $("rxCard").hidden = !A.can("dashboard");
    if ($("rxCard").hidden) return;
    ready = true;
    setRange("30");
    show();
    api("/users").then(function (r) {
      var users = (r.users || r || []).filter(function (u) { return u.active !== false && u.isActive !== false; });
      $("rxUser").innerHTML = '<option value="">همه</option>' + users.map(function (u) { return '<option value="' + esc(u.id) + '">' + esc(u.fullName) + "</option>"; }).join("");
    }).catch(function () {});
    $("rxQuick").addEventListener("click", function (e) {
      var b = e.target.closest("[data-rx-range]");
      if (b) { setRange(b.getAttribute("data-rx-range")); show(); }
    });
    ["rxFrom", "rxTo"].forEach(function (id) {
      $(id).addEventListener("input", function () {
        Array.prototype.forEach.call($("rxQuick").querySelectorAll(".chip"), function (c) { c.classList.remove("active"); });
      });
    });
    $("rxKind").addEventListener("change", show);
    $("rxUser").addEventListener("change", show);
    $("rxShow").addEventListener("click", show);
    $("rxXlsx").addEventListener("click", function () { download("xlsx"); });
    $("rxPdf").addEventListener("click", function () { download("pdf"); });
  }

  window.CrmReports = { init: init };
})();
