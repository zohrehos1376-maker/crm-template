// تقویم شمسی برای همه‌ی باکس‌های تاریخ (هر input متنی که placeholder آن شکل ۱۴۰۵/۰۸/۰۱ دارد).
// عددهای تایپ‌شده خودکار فارسی می‌شوند و با کلیک روی باکس، تقویم باز می‌شود؛ تایپ دستی هم کار می‌کند.
(function () {
  "use strict";
  if (!window.Jalali) return;
  var FA = "۰۱۲۳۴۵۶۷۸۹";
  var MONTHS = ["فروردین", "اردیبهشت", "خرداد", "تیر", "مرداد", "شهریور", "مهر", "آبان", "آذر", "دی", "بهمن", "اسفند"];
  var WEEK = ["ش", "ی", "د", "س", "چ", "پ", "ج"];
  var isDateInput = function (el) {
    return el && el.tagName === "INPUT" && el.type === "text" && /^[۰-۹0-9]{4}\/[۰-۹0-9]{2}\/[۰-۹0-9]{2}$/.test(el.getAttribute("placeholder") || "");
  };
  var toFa = function (s) { return String(s).replace(/[0-9]/g, function (d) { return FA[d]; }).replace(/[٠-٩]/g, function (d) { return FA["٠١٢٣٤٥٦٧٨٩".indexOf(d)]; }); };
  var pad = function (n) { return (n < 10 ? "0" : "") + n; };
  var gDate = function (jy, jm, jd) { var g = Jalali.toGregorian(jy, jm, jd); return new Date(g.gy, g.gm - 1, g.gd); };
  var monthLen = function (jy, jm) { return Math.round((gDate(jm === 12 ? jy + 1 : jy, jm === 12 ? 1 : jm + 1, 1) - gDate(jy, jm, 1)) / 864e5); };
  var todayJ = function () { var d = new Date(); return Jalali.toJalali(d.getFullYear(), d.getMonth() + 1, d.getDate()); };

  var pop = null, target = null, view = null;

  function parse(v) {
    var m = /^(\d{4})\/(\d{1,2})\/(\d{1,2})$/.exec(String(v || "").replace(/[۰-۹]/g, function (d) { return FA.indexOf(d); }).trim());
    return m ? { jy: +m[1], jm: +m[2], jd: +m[3] } : null;
  }

  function render() {
    var sel = parse(target.value), t = todayJ();
    var first = (gDate(view.jy, view.jm, 1).getDay() + 1) % 7; // شنبه = ۰
    var html = '<div class="jdp-head"><button type="button" data-nav="1" aria-label="ماه بعد">‹</button><b>' + MONTHS[view.jm - 1] + " " + toFa(view.jy) +
      '</b><button type="button" data-nav="-1" aria-label="ماه قبل">›</button></div><div class="jdp-grid">' +
      WEEK.map(function (w) { return "<span class=\"jdp-w\">" + w + "</span>"; }).join("");
    for (var i = 0; i < first; i++) html += "<span></span>";
    for (var d = 1, n = monthLen(view.jy, view.jm); d <= n; d++) {
      var cls = (sel && sel.jy === view.jy && sel.jm === view.jm && sel.jd === d ? " on" : "") + (t.jy === view.jy && t.jm === view.jm && t.jd === d ? " today" : "");
      html += '<button type="button" class="jdp-d' + cls + '" data-d="' + d + '">' + toFa(d) + "</button>";
    }
    html += '</div><div class="jdp-foot"><button type="button" data-today="1">امروز</button></div>';
    pop.innerHTML = html;
  }

  function place() {
    var r = target.getBoundingClientRect();
    pop.style.top = window.scrollY + r.bottom + 4 + "px";
    var left = window.scrollX + r.right - pop.offsetWidth;
    pop.style.left = Math.max(8, Math.min(left, window.scrollX + document.documentElement.clientWidth - pop.offsetWidth - 8)) + "px";
  }

  function open(el) {
    target = el;
    var s = parse(el.value) || todayJ();
    view = { jy: s.jy, jm: s.jm };
    if (!pop) {
      pop = document.createElement("div");
      pop.className = "jdp";
      pop.addEventListener("mousedown", function (e) { e.preventDefault(); }); // فوکوس از باکس نرود
      pop.addEventListener("click", onPick);
      document.body.appendChild(pop);
    }
    pop.hidden = false;
    render();
    place();
  }
  function close() { if (pop) pop.hidden = true; target = null; }

  function set(jy, jm, jd) {
    target.value = toFa(jy + "/" + pad(jm) + "/" + pad(jd));
    target.dispatchEvent(new Event("input", { bubbles: true }));
    target.dispatchEvent(new Event("change", { bubbles: true }));
    close();
  }

  function onPick(e) {
    var b = e.target.closest("button");
    if (!b || !target) return;
    if (b.hasAttribute("data-nav")) {
      view.jm += Number(b.getAttribute("data-nav"));
      if (view.jm > 12) { view.jm = 1; view.jy++; }
      if (view.jm < 1) { view.jm = 12; view.jy--; }
      render();
    } else if (b.hasAttribute("data-d")) set(view.jy, view.jm, Number(b.getAttribute("data-d")));
    else if (b.hasAttribute("data-today")) { var t = todayJ(); set(t.jy, t.jm, t.jd); }
  }

  document.addEventListener("focusin", function (e) { if (isDateInput(e.target)) open(e.target); });
  document.addEventListener("click", function (e) { if (isDateInput(e.target) && (!pop || pop.hidden)) open(e.target); });
  document.addEventListener("focusout", function (e) { if (e.target === target) setTimeout(function () { if (document.activeElement !== target) close(); }, 150); });
  document.addEventListener("keydown", function (e) { if (e.key === "Escape" && target) close(); });
  // عددهای انگلیسی/عربی تایپ‌شده همان لحظه فارسی شوند
  document.addEventListener("input", function (e) {
    var el = e.target;
    if (!isDateInput(el)) return;
    var v = toFa(el.value);
    if (v !== el.value) {
      var pos = el.selectionStart;
      el.value = v;
      try { el.setSelectionRange(pos, pos); } catch (err) { /* */ }
    }
    if (el === target && pop && !pop.hidden) { var s = parse(el.value); if (s && s.jm >= 1 && s.jm <= 12) { view = { jy: s.jy, jm: s.jm }; render(); } }
  });
  window.addEventListener("resize", function () { if (target && pop && !pop.hidden) place(); });
})();
