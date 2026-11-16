const test = require('node:test');
const assert = require('node:assert');
const zlib = require('zlib');
const { gzipJson, MIN_BYTES } = require('./gzip-json');

function fakeRes() {
  const h = {};
  return {
    headers: h, body: null, headersSent: false,
    setHeader(k, v) { h[k.toLowerCase()] = v; }, getHeader(k) { return h[k.toLowerCase()]; }, removeHeader(k) { delete h[k.toLowerCase()]; },
    end(b) { this.body = b; }, json(b) { this.body = JSON.stringify(b); this.plain = true; return this; },
  };
}

test('پاسخ بزرگ gzip می‌شود و درست باز می‌شود', async () => {
  const res = fakeRes();
  const data = { rows: Array.from({ length: 200 }, (_, i) => ({ i, name: 'مشتری ' + i, price: 10n })) };
  await new Promise((done) => {
    gzipJson()({ headers: { 'accept-encoding': 'gzip, br' } }, res, () => {});
    const end = res.end.bind(res);
    res.end = (b) => { end(b); done(); };
    res.json(data);
  });
  assert.strictEqual(res.headers['content-encoding'], 'gzip');
  const back = JSON.parse(zlib.gunzipSync(res.body).toString());
  assert.strictEqual(back.rows.length, 200);
  assert.strictEqual(back.rows[0].price, '10');
});

test('پاسخ کوچک یا مرورگر بدون gzip دست نمی‌خورد', () => {
  const small = fakeRes();
  gzipJson()({ headers: { 'accept-encoding': 'gzip' } }, small, () => {});
  small.json({ ok: true });
  assert.ok(small.plain);
  const noGz = fakeRes();
  gzipJson()({ headers: {} }, noGz, () => {});
  noGz.json({ big: 'x'.repeat(MIN_BYTES * 2) });
  assert.ok(noGz.plain);
});
