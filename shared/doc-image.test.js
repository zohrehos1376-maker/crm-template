const test = require('node:test');
const assert = require('node:assert');
const { prepare } = require('./doc-image');

const html = Buffer.from('<html><script>alert(document.cookie)</script></html>'.padEnd(200, ' '));

test('فایلی که فقط اسمش عکس یا PDF است ذخیره نمی‌شود', async () => {
  await assert.rejects(() => prepare(html, 'image/jpeg', 'x.jpg'));
  await assert.rejects(() => prepare(html, 'application/pdf', 'x.pdf'));
  await assert.rejects(() => prepare(html, 'video/mp4', 'x.mp4'));
});

test('عکس واقعی پذیرفته می‌شود', async () => {
  const sharp = require('sharp');
  const png = await sharp({ create: { width: 8, height: 8, channels: 3, background: '#ffffff' } }).png().toBuffer();
  const r = await prepare(png, 'application/octet-stream', 'scan');
  assert.ok(['image/png', 'image/jpeg'].includes(r.mime));
  const pdf = Buffer.from('%PDF-1.4\n%fake but signed\n'.padEnd(64, ' '));
  assert.strictEqual((await prepare(pdf, '', 'a.pdf')).mime, 'application/pdf');
});
