// فشرده‌سازی پاسخ‌های JSON (gzip) — بدون پکیج اضافه، فقط با zlib خود Node.
// فهرست مشتریان/تماس‌ها چند صد کیلوبایت است؛ فشرده حدود یک‌دهم می‌شود و تب‌ها روی اینترنت کند سریع‌تر باز می‌شوند.
const zlib = require('zlib');

const MIN_BYTES = 2048;

function gzipJson() {
  return function (req, res, next) {
    if (!/\bgzip\b/.test(String(req.headers['accept-encoding'] || ''))) return next();
    const json = res.json.bind(res);
    res.json = function (body) {
      const text = JSON.stringify(body, (k, v) => (typeof v === 'bigint' ? v.toString() : v));
      if (text === undefined || Buffer.byteLength(text) < MIN_BYTES || res.getHeader('Content-Encoding')) return json(body);
      zlib.gzip(text, { level: 6 }, (err, buf) => {
        if (err || res.headersSent) return json(body);
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.setHeader('Content-Encoding', 'gzip');
        res.setHeader('Vary', 'Accept-Encoding');
        res.removeHeader('ETag');
        res.end(buf);
      });
      return res;
    };
    next();
  };
}

module.exports = { gzipJson, MIN_BYTES };
