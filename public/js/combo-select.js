// منوی کشویی با جست‌وجو و «➕ افزودن» — روی هر <select data-combo="نام"> خودکار سوار می‌شود.
// خود select (پنهان) سر جایش می‌ماند و رویداد change مثل قبل فرستاده می‌شود، پس کد فرم‌ها دست نمی‌خورد.
// data-combo-prefix: پیشوند مقدار گزینه‌ی تازه (مثلاً x: برای نتیجه‌ی تماس) · data-combo-noadd: فقط جست‌وجو
(function () {
  var SCRIPT_KINDS = { fu_ok: 1, fu_noanswer: 1, fu_msg: 1, fu_visit: 1, script: 1, sms: 1 };
  var custom = {};
  var loaded = null;
  var openBox = null;

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; });
  }
  function req(path, body) {
    return fetch("/api/v1" + path, {
      method: body ? "POST" : "GET",
      headers: { "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
      credentials: "same-origin",
    }).then(function (r) { return r.json().then(function (j) { if (!r.ok) throw new Error(j.error || "خطا"); return j; }); });
  }
  function loadCustom() {
    if (!loaded) loaded = req("/workdesk/choices").then(function (r) { custom = r.choices || {}; }).catch(function () { loaded = null; });
    return loaded;
  }

  function injectCustom(sel) {
    var key = sel.getAttribute("data-combo");
    var prefix = sel.getAttribute("data-combo-prefix") || "";
    (custom[key] || []).forEach(function (label) {
      var v = prefix + label;
      if ([].some.call(sel.options, function (o) { return o.value === v || o.text === label; })) return;
      sel.add(new Option(label, v));
    });
  }

  function labelOf(sel) {
    var o = sel.options[sel.selectedIndex];
    return o ? o.text : "";
  }

  function enhance(sel) {
    if (sel._combo) return;
    sel._combo = true;
    injectCustom(sel);
    var box = document.createElement("div");
    box.className = "combo";
    box.innerHTML = '<button type="button" class="combo-btn"><span class="combo-val"></span><span class="combo-arrow" aria-hidden="true">▾</span></button>' +
      '<div class="combo-panel" hidden><input type="text" class="combo-q" placeholder="جست‌وجو…" autocomplete="off"><ul class="combo-list"></ul></div>';
    sel.insertAdjacentElement("afterend", box);
    sel.classList.add("combo-native");
    box._sel = sel;
    var val = box.querySelector(".combo-val");
    var sync = function () { val.textContent = labelOf(sel) || "انتخاب…"; };
    sync();
    sel.addEventListener("change", sync);
    box.querySelector(".combo-btn").addEventListener("click", function () {
      if (openBox === box) close(); else open(box);
    });
    box.querySelector(".combo-q").addEventListener("input", function () { render(box); });
    box.querySelector(".combo-q").addEventListener("keydown", function (e) {
      if (e.key === "Escape") { close(); return; }
      if (e.key === "Enter") {
        e.preventDefault();
        var first = box.querySelector(".combo-list [data-v]") || box.querySelector(".combo-list [data-add]");
        if (first) pick(box, first);
      }
    });
    box.querySelector(".combo-list").addEventListener("mousedown", function (e) {
      var li = e.target.closest("li[data-v], li[data-add]");
      if (!li) return;
      e.preventDefault();
      pick(box, li);
    });
  }

  function render(box) {
    var sel = box._sel;
    var q = box.querySelector(".combo-q").value.trim();
    var opts = [].filter.call(sel.options, function (o) { return o.value !== "" && (!q || o.text.indexOf(q) >= 0); });
    var canAdd = !sel.hasAttribute("data-combo-noadd");
    var exact = [].some.call(sel.options, function (o) { return o.text === q; });
    var html = opts.map(function (o) { return '<li class="combo-item" data-v="' + esc(o.value) + '">' + esc(o.text) + "</li>"; }).join("");
    if (!opts.length) html = '<li class="combo-empty">چیزی پیدا نشد</li>';
    if (canAdd) {
      html += q && !exact
        ? '<li class="combo-add" data-add="1">➕ افزودن «' + esc(q) + '» به لیست</li>'
        : '<li class="combo-add" data-add="0">➕ افزودن گزینه‌ی تازه</li>';
    }
    box.querySelector(".combo-list").innerHTML = html;
  }

  function open(box) {
    close();
    openBox = box;
    var q = box.querySelector(".combo-q");
    q.value = "";
    q.placeholder = "جست‌وجو…";
    render(box);
    box.querySelector(".combo-panel").hidden = false;
    box.classList.add("open");
    q.focus();
  }
  function close() {
    if (!openBox) return;
    openBox.querySelector(".combo-panel").hidden = true;
    openBox.classList.remove("open");
    openBox = null;
  }

  function choose(sel, value) {
    sel.value = value;
    sel.dispatchEvent(new Event("change", { bubbles: true }));
    // بعضی فرم‌ها بعد از انتخاب، select را خالی می‌کنند (مثلاً «چه شد؟» که متن را به توضیح می‌چسباند)
    var box = sel.nextElementSibling;
    if (box && box.classList.contains("combo")) box.querySelector(".combo-val").textContent = labelOf(sel) || "انتخاب…";
  }

  function pick(box, li) {
    var sel = box._sel;
    var q = box.querySelector(".combo-q");
    if (li.hasAttribute("data-v")) { close(); choose(sel, li.getAttribute("data-v")); return; }
    var text = q.value.replace(/[,،]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 40);
    if (!text) { q.placeholder = "متن گزینه‌ی تازه را بنویسید و Enter بزنید"; q.focus(); return; }
    var key = sel.getAttribute("data-combo");
    var value = (sel.getAttribute("data-combo-prefix") || "") + text;
    var save = SCRIPT_KINDS[key]
      ? req("/workdesk/scripts/quick", { kind: key, title: text, body: text })
      : req("/workdesk/choices", { key: key, label: text }).then(function () { (custom[key] = custom[key] || []).push(text); });
    save.catch(function (e) { if (window.alert) alert("گزینه ذخیره نشد: " + e.message); });
    sel.add(new Option(text, value));
    close();
    choose(sel, value);
  }

  document.addEventListener("mousedown", function (e) {
    if (openBox && !openBox.contains(e.target)) close();
  });

  function scan(root) {
    if (!root.querySelectorAll) return;
    var list = root.matches && root.matches("select[data-combo]") ? [root] : root.querySelectorAll("select[data-combo]");
    if (!list.length) return;
    loadCustom();
    [].forEach.call(list, function (sel) {
      if (loaded) loaded.then(function () { if (sel._combo) injectCustom(sel); });
      enhance(sel);
    });
  }

  new MutationObserver(function (muts) {
    muts.forEach(function (m) {
      [].forEach.call(m.addedNodes, function (n) { if (n.nodeType === 1) scan(n); });
      // گزینه‌هایی که بعداً به select اضافه می‌شوند (مثلاً بعد از رسیدن جواب سرور)
      if (m.target && m.target.tagName === "SELECT" && m.target._combo) {
        var box = m.target.nextElementSibling;
        if (box && box.classList.contains("combo")) box.querySelector(".combo-val").textContent = labelOf(m.target) || "انتخاب…";
      }
    });
  }).observe(document.documentElement, { childList: true, subtree: true });
  document.addEventListener("DOMContentLoaded", function () { scan(document); });
})();
