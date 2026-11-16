// اندازه‌گیری سرعت واقعی API روی سرور (وقتی همکاران کار می‌کنند): برای هر مسیر تعداد، میانه، کندترین
// و حجم پاسخ جمع می‌شود و هر ۱۰ دقیقه یک خلاصه در لاگ می‌آید ([api-timing]). شناسه‌ها و query از مسیر
// حذف می‌شوند — هیچ اطلاعات مشتری ثبت نمی‌شود.
const INTERVAL_MS = 10 * 60 * 1000;
let stats = new Map();

function routeKey(req) {
  const p = String(req.originalUrl || req.url || '').split('?')[0]
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, ':id')
    .replace(/\/\d+(?=\/|$)/g, '/:n')
    .replace(/\/[ac]-[^/]+/g, '/:item');
  return req.method + ' ' + p.replace(/^\/api\/v1/, '');
}

function summarize(map) {
  return [...map.entries()].map(([k, v]) => {
    const t = v.ms.sort((a, b) => a - b);
    return { k, n: t.length, med: t[Math.floor(t.length / 2)], max: t[t.length - 1], kb: Math.round(v.bytes / t.length / 1024) };
  }).sort((a, b) => b.med * b.n - a.med * a.n);
}

function apiTiming() {
  setInterval(() => {
    if (!stats.size) return;
    const rows = summarize(stats);
    stats = new Map();
    console.log('[api-timing] ۱۰ دقیقه‌ی اخیر (مسیر · تعداد · میانه · کندترین · حجم):\n' +
      rows.slice(0, 30).map((r) => '  ' + r.k + ' · ' + r.n + ' · ' + r.med + 'ms · ' + r.max + 'ms · ' + r.kb + 'KB').join('\n'));
  }, INTERVAL_MS).unref();
  return function (req, res, next) {
    if (req.path === '/v1/workdesk/live-stream') return next();
    const start = process.hrtime.bigint();
    res.on('finish', () => {
      const ms = Math.round(Number(process.hrtime.bigint() - start) / 1e6);
      const key = routeKey(req);
      const s = stats.get(key) || { ms: [], bytes: 0 };
      s.ms.push(ms);
      s.bytes += Number(res.getHeader('Content-Length')) || 0;
      stats.set(key, s);
    });
    next();
  };
}

module.exports = { apiTiming, routeKey, summarize };
