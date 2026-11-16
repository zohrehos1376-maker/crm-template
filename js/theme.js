/* ==========================================================================
   انتخاب تم
   --------------------------------------------------------------------------
   این فایل عمداً کوچک است و در <head> و قبل از بقیه‌ی اسکریپت‌ها اجرا می‌شود.
   دلیلش این است که تم باید *قبل از* رسم صفحه اعمال شود؛ وگرنه کاربر یک لحظه
   تم روشن را می‌بیند و بعد صفحه تیره می‌شود («پرش رنگ»).

   انتخاب کاربر در localStorage همین مرورگر ذخیره می‌شود، نه روی سرور. برای
   یک برنامه‌ی داخلی که هر کارشناس با کامپیوتر خودش کار می‌کند این کافی است و
   نیازی به تغییر دیتابیس ندارد.
   ========================================================================== */
(function () {
  "use strict";

  // ---------------------------------------------------------------------
  // محافظ «نسخه‌ی کهنه‌ی HTML»
  // ---------------------------------------------------------------------
  // روی هاست، کنار پوشه‌ی اصلی برنامه یک کپی قدیمی از index.html هم باقی مانده
  // بود (/crm/index.html) و آدرس اصلی سایت با یک ریدایرکت به همان کپی می‌رفت.
  // چون آن HTML قدیمی اسکریپت‌ها را با مسیر مطلق (/js/app.js) صدا می‌زند، کدِ
  // تازه اجرا می‌شد ولی قالبِ صفحه مالِ چند روز قبل بود — یعنی تغییرهای جدیدِ
  // رابط کاربری اصلاً دیده نمی‌شدند. همین باعث شد مشکل شبیه «کش مرورگر» به نظر
  // برسد، در حالی که ریشه‌اش یک فایل کهنه روی خودِ سرور بود.
  //
  // هر نسخه‌ی درستِ index.html تگ <meta name="crm-build"> را دارد. اگر این تگ
  // نبود یعنی صفحه‌ی فعلی یک کپی کهنه است و کاربر را به /index.html می‌فرستیم
  // که همیشه تازه‌ترین نسخه است. sessionStorage جلوی حلقه‌ی بی‌پایان را می‌گیرد.
  (function redirectStaleHtml() {
    if (document.querySelector('meta[name="crm-build"]')) return;

    var target = "/index.html";
    if (window.location.pathname === target) return; // خودش نسخه‌ی درست است؛ کاری نکن

    try {
      if (window.sessionStorage.getItem("crm-stale-redirect") === "1") return;
      window.sessionStorage.setItem("crm-stale-redirect", "1");
    } catch (e) {
      // اگر sessionStorage در دسترس نبود، یک‌بار هدایت بهتر از هیچ است
    }

    window.location.replace(target + window.location.search + window.location.hash);
  })();

  var STORAGE_KEY = "crm-theme";

  // «خودکار» یعنی هیچ data-theme روی صفحه نمی‌نشیند و tokens.css خودش طبق
  // تنظیم روشن/تیره‌ی ویندوز تصمیم می‌گیرد.
  var THEMES = [
    { id: "auto", label: "خودکار", hint: "طبق تنظیم ویندوز" },
    { id: "light", label: "روشن", hint: "آبی CRM نمونه، ظاهر استاندارد" },
    { id: "dark", label: "تیره", hint: "برای کار در نور کم" },
    { id: "crm", label: "آبی و طلایی", hint: "آبی CRM نمونه با طلایی" },
    { id: "ocean", label: "آبی روشن", hint: "پالت روشن و سرزنده" },
    { id: "violet", label: "بنفش", hint: "پالت روشن و مدرن" },
    { id: "contrast", label: "کنتراست بالا", hint: "برای نور زیاد یا چشم خسته" },
  ];

  var VALID = {};
  THEMES.forEach(function (t) { VALID[t.id] = true; });

  // localStorage در حالت ناشناس یا با تنظیمات سخت‌گیرانه‌ی مرورگر خطا می‌دهد.
  // نبودِ تم نباید باعث شود برنامه بالا نیاید، پس هر دو طرف try می‌شوند.
  function read() {
    try {
      var v = window.localStorage.getItem(STORAGE_KEY);
      return VALID[v] ? v : "auto";
    } catch (e) {
      return "auto";
    }
  }

  function write(id) {
    try {
      window.localStorage.setItem(STORAGE_KEY, id);
    } catch (e) {
      /* ذخیره نشد؛ تم تا بسته شدن صفحه کار می‌کند */
    }
  }

  function apply(id) {
    if (id === "auto") {
      document.documentElement.removeAttribute("data-theme");
    } else {
      document.documentElement.setAttribute("data-theme", id);
    }
  }

  var current = read();
  apply(current);

  window.CrmTheme = {
    themes: THEMES,
    get: function () { return current; },
    set: function (id) {
      if (!VALID[id]) return false;
      current = id;
      apply(id);
      write(id);
      return true;
    },
  };
})();
