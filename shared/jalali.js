// تبدیل تاریخ میلادی و شمسی (هجری خورشیدی).
//
// چرا این فایل لازم است: تاریخ‌ها در دیتابیس همیشه میلادی ذخیره می‌شوند — این کار
// استاندارد است و باعث می‌شود مرتب‌سازی، فیلتر و گزارش‌ها درست کار کنند. فقط در
// لحظه‌ی نمایش (جدول، مودال، خروجی اکسل) به شمسی تبدیل می‌شوند.
//
// این فایل هم در سرور (require) و هم در مرورگر (script) استفاده می‌شود.
//
// الگوریتم تبدیل، پیاده‌سازی استاندارد و شناخته‌شده‌ی تقویم هجری خورشیدی است
// (همان روشی که کتابخانه‌ی jalaali-js استفاده می‌کند) و درستی‌اش با مقایسه با
// تقویم داخلی خود جاوااسکریپت (Intl با تقویم persian) تست شده است.

(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Jalali = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function div(a, b) {
    return ~~(a / b);
  }
  function mod(a, b) {
    return a - ~~(a / b) * b;
  }

  // سال‌هایی که الگوی کبیسه در آن‌ها عوض می‌شود
  var BREAKS = [
    -61, 9, 38, 199, 426, 686, 756, 818, 1111, 1181, 1210,
    1635, 2060, 2097, 2192, 2262, 2324, 2394, 2456, 3178,
  ];

  function jalCal(jy) {
    var bl = BREAKS.length;
    var gy = jy + 621;
    var leapJ = -14;
    var jp = BREAKS[0];
    var jm, jump, leap, n, i;

    if (jy < jp || jy >= BREAKS[bl - 1]) throw new Error('سال شمسی نامعتبر: ' + jy);

    jump = 0;
    for (i = 1; i < bl; i += 1) {
      jm = BREAKS[i];
      jump = jm - jp;
      if (jy < jm) break;
      leapJ = leapJ + div(jump, 33) * 8 + div(mod(jump, 33), 4);
      jp = jm;
    }
    n = jy - jp;

    leapJ = leapJ + div(n, 33) * 8 + div(mod(n, 33) + 3, 4);
    if (mod(jump, 33) === 4 && jump - n === 4) leapJ += 1;

    var leapG = div(gy, 4) - div((div(gy, 100) + 1) * 3, 4) - 150;
    var march = 20 + leapJ - leapG;

    if (jump - n < 6) n = n - jump + div(jump + 4, 33) * 33;
    leap = mod(mod(n + 1, 33) - 1, 4);
    if (leap === -1) leap = 4;

    return { leap: leap, gy: gy, march: march };
  }

  // تبدیل تاریخ میلادی به شماره روز مطلق (Julian Day Number)
  function g2d(gy, gm, gd) {
    var d =
      div((gy + div(gm - 8, 6) + 100100) * 1461, 4) +
      div(153 * mod(gm + 9, 12) + 2, 5) +
      gd -
      34840408;
    d = d - div(div(gy + 100100 + div(gm - 8, 6), 100) * 3, 4) + 752;
    return d;
  }

  function d2g(jdn) {
    var j = 4 * jdn + 139361631;
    j = j + div(div(4 * jdn + 183187720, 146097) * 3, 4) * 4 - 3908;
    var i = div(mod(j, 1461), 4) * 5 + 308;
    var gd = div(mod(i, 153), 5) + 1;
    var gm = mod(div(i, 153), 12) + 1;
    var gy = div(j, 1461) - 100100 + div(8 - gm, 6);
    return { gy: gy, gm: gm, gd: gd };
  }

  function j2d(jy, jm, jd) {
    var r = jalCal(jy);
    return g2d(r.gy, 3, r.march) + (jm - 1) * 31 - div(jm, 7) * (jm - 7) + jd - 1;
  }

  function d2j(jdn) {
    var gy = d2g(jdn).gy;
    var jy = gy - 621;
    var r = jalCal(jy);
    var jdn1f = g2d(gy, 3, r.march);
    var jd, jm, k;

    k = jdn - jdn1f;
    if (k >= 0) {
      if (k <= 185) {
        jm = 1 + div(k, 31);
        jd = mod(k, 31) + 1;
        return { jy: jy, jm: jm, jd: jd };
      }
      k -= 186;
    } else {
      jy -= 1;
      k += 179;
      if (r.leap === 1) k += 1;
    }
    jm = 7 + div(k, 30);
    jd = mod(k, 30) + 1;
    return { jy: jy, jm: jm, jd: jd };
  }

  // ---------------------------------------------------------------
  // توابعی که بقیه‌ی برنامه استفاده می‌کند
  // ---------------------------------------------------------------

  // میلادی → شمسی. ورودی: سال/ماه/روز میلادی. خروجی: {jy, jm, jd}
  function toJalali(gy, gm, gd) {
    return d2j(g2d(gy, gm, gd));
  }

  // شمسی → میلادی. خروجی: {gy, gm, gd}
  function toGregorian(jy, jm, jd) {
    return d2g(j2d(jy, jm, jd));
  }

  function isValidJalali(jy, jm, jd) {
    if (!(jy >= 1 && jy <= 3177)) return false;
    if (!(jm >= 1 && jm <= 12)) return false;
    if (!(jd >= 1 && jd <= jalaliMonthLength(jy, jm))) return false;
    return true;
  }

  function jalaliMonthLength(jy, jm) {
    if (jm <= 6) return 31;
    if (jm <= 11) return 30;
    return jalCal(jy).leap === 0 ? 30 : 29;
  }

  function pad2(n) {
    return n < 10 ? '0' + n : String(n);
  }

  // ارقام فارسی، برای نمایش در رابط کاربری
  var FA_DIGITS = ['۰', '۱', '۲', '۳', '۴', '۵', '۶', '۷', '۸', '۹'];
  function toFaDigits(s) {
    return String(s).replace(/[0-9]/g, function (d) {
      return FA_DIGITS[Number(d)];
    });
  }
  function toEnDigits(s) {
    return String(s)
      .replace(/[۰-۹]/g, function (d) {
        return String(FA_DIGITS.indexOf(d));
      })
      // ارقام عربی هم ممکن است در متن کپی‌شده باشند
      .replace(/[٠-٩]/g, function (d) {
        return String(d.charCodeAt(0) - 0x0660);
      });
  }

  // یک تاریخ جاوااسکریپت را به رشته‌ی شمسی «۱۴۰۵/۰۶/۰۹» تبدیل می‌کند.
  // گزینه‌ها: withTime (افزودن ساعت)، faDigits (ارقام فارسی به‌جای انگلیسی)
  function formatDate(date, opts) {
    opts = opts || {};
    var d = date instanceof Date ? date : new Date(date);
    if (isNaN(d.getTime())) return '';
    var j = toJalali(d.getFullYear(), d.getMonth() + 1, d.getDate());
    var out = j.jy + '/' + pad2(j.jm) + '/' + pad2(j.jd);
    if (opts.withTime) out += ' ' + pad2(d.getHours()) + ':' + pad2(d.getMinutes());
    return opts.faDigits ? toFaDigits(out) : out;
  }

  var MONTH_NAMES = [
    'فروردین', 'اردیبهشت', 'خرداد', 'تیر', 'مرداد', 'شهریور',
    'مهر', 'آبان', 'آذر', 'دی', 'بهمن', 'اسفند',
  ];

  // نمایش خوانا: «۹ شهریور ۱۴۰۵»
  function formatLong(date, opts) {
    opts = opts || {};
    var d = date instanceof Date ? date : new Date(date);
    if (isNaN(d.getTime())) return '';
    var j = toJalali(d.getFullYear(), d.getMonth() + 1, d.getDate());
    var out = j.jd + ' ' + MONTH_NAMES[j.jm - 1] + ' ' + j.jy;
    return opts.faDigits === false ? out : toFaDigits(out);
  }

  // خواندن یک تاریخ شمسی نوشته‌شده به‌دست کاربر (مثلاً در فایل اکسل).
  // جداکننده می‌تواند / یا - یا . باشد و ارقام فارسی هم پذیرفته می‌شود.
  // اگر متن تاریخ میلادی باشد (مثل 2026-08-31)، همان‌طور خوانده می‌شود تا
  // فایل‌های اکسل قدیمی هم قابل آپلود بمانند.
  function parseDate(text) {
    if (!text) return null;
    var s = toEnDigits(String(text).trim());
    if (!s) return null;

    // ساعت اختیاری در انتهای متن
    var time = { h: 0, m: 0 };
    var timeMatch = /(\d{1,2}):(\d{2})/.exec(s);
    if (timeMatch) {
      time.h = Number(timeMatch[1]);
      time.m = Number(timeMatch[2]);
      s = s.replace(timeMatch[0], '').trim();
    }

    var parts = s.split(/[\/\-.\s]+/).filter(Boolean);
    if (parts.length < 3) {
      var fallback = new Date(String(text).replace(' ', 'T'));
      return isNaN(fallback.getTime()) ? null : fallback;
    }

    var y = Number(parts[0]);
    var m = Number(parts[1]);
    var d = Number(parts[2]);
    if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) return null;

    // سال چهاررقمی بزرگ‌تر از ۱۷۰۰ یعنی تاریخ میلادی نوشته شده
    if (y >= 1700) {
      var g = new Date(y, m - 1, d, time.h, time.m, 0, 0);
      return isNaN(g.getTime()) ? null : g;
    }

    if (!isValidJalali(y, m, d)) return null;
    var conv = toGregorian(y, m, d);
    return new Date(conv.gy, conv.gm - 1, conv.gd, time.h, time.m, 0, 0);
  }

  return {
    toJalali: toJalali,
    toGregorian: toGregorian,
    isValidJalali: isValidJalali,
    jalaliMonthLength: jalaliMonthLength,
    formatDate: formatDate,
    formatLong: formatLong,
    parseDate: parseDate,
    toFaDigits: toFaDigits,
    toEnDigits: toEnDigits,
    MONTH_NAMES: MONTH_NAMES,
  };
});
