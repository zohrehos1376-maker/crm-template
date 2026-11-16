// آزمون «مرحله‌ی مشتری» — اجرا: npm test
const test = require('node:test');
const assert = require('node:assert');
const S = require('./customer-stage');

const now = new Date('2026-10-29T10:00:00Z');
const ago = (d) => new Date(now.getTime() - d * 86400000);
// همکار = jobType دارد؛ اگر خالی باشد و احراز هم شروع نشده باشد، مرحله ندارد
const co = (extra) => Object.assign({ jobType: 'تعمیرکار', kycStatus: 'none' }, extra || {});

test('خرده‌فروش مرحله ندارد؛ همکار دارد', () => {
  assert.strictEqual(S.describe({ kycStatus: 'none' }, now), null);
  assert.strictEqual(S.describe({}, now), null);
  assert.strictEqual(S.describe(co(), now).code, 'inquiry');
  // کسی که احراز برایش شروع شده، حتی بدون شغل، مرحله می‌گیرد
  assert.strictEqual(S.describe({ kycStatus: 'awaiting', kycToken: 't1' }, now).code, 'form_sent');
  // لید فرم همکاری سایت: لینکی فرستاده نشده، فقط عکس مدرک کم است
  assert.strictEqual(S.describe({ kycStatus: 'awaiting' }, now).code, 'docs_needed');
});

test('مسیر احراز: استعلام ← لینک ← بررسی ← تأیید', () => {
  assert.strictEqual(S.describe(co(), now).code, 'inquiry');
  assert.strictEqual(S.describe(co({ kycStatus: 'awaiting', kycToken: 't1' }), now).code, 'form_sent');
  assert.strictEqual(S.describe(co({ kycStatus: 'pending' }), now).code, 'form_review');
  assert.strictEqual(S.describe(co({ kycStatus: 'approved', lastActivityAt: ago(2) }), now).code, 'approved');
});

test('رد: تا اطلاع‌دادن باز است، بعد از آن بسته', () => {
  const open = S.describe(co({ kycStatus: 'rejected' }), now);
  assert.strictEqual(open.code, 'rejected');
  assert.ok(open.action, 'پله‌ی رد باید اقدام بعدی داشته باشد');
  const done = S.describe(co({ kycStatus: 'rejected', kycRejectNotifiedAt: ago(1) }), now);
  assert.strictEqual(done.code, 'rejected_done');
  assert.strictEqual(done.action, '');
});

test('ارسال مجدد فرم بعد از رد، مشتری را به بررسی برمی‌گرداند', () => {
  // kycService هنگام ارسال مجدد kycStatus را pending می‌کند
  const again = co({ kycStatus: 'pending', kycRejectNotifiedAt: ago(5), kycReason: 'جواز ناخوانا' });
  assert.strictEqual(S.describe(again, now).code, 'form_review');
});

test('خرید بر همه‌ی پله‌ها مقدم است', () => {
  assert.strictEqual(S.describe(co({ kycStatus: 'approved', firstPurchaseAt: ago(3) }), now).code, 'bought');
  assert.strictEqual(S.describe(co({ kycStatus: 'pending', firstPurchaseAt: ago(3) }), now).code, 'bought');
});

test('تأییدشده‌ی بی‌حرکت بعد از ۶۰ روز غیرفعال می‌شود', () => {
  assert.strictEqual(S.describe(co({ kycStatus: 'approved', lastActivityAt: ago(59) }), now).code, 'approved');
  assert.strictEqual(S.describe(co({ kycStatus: 'approved', lastActivityAt: ago(61) }), now).code, 'inactive');
  // بدون سابقه‌ی فعالیت، غیرفعال حساب نمی‌شود
  assert.strictEqual(S.describe(co({ kycStatus: 'approved' }), now).code, 'approved');
});

test('هر مشتری فقط یک مرحله دارد و شمارش با تعداد همکارها جور است', () => {
  const leads = [
    co(), co({ kycStatus: 'awaiting', kycToken: 't1' }), co({ kycStatus: 'pending' }), co({ kycStatus: 'pending' }),
    co({ kycStatus: 'rejected' }), co({ kycStatus: 'approved', lastActivityAt: ago(1) }),
    co({ kycStatus: 'approved', firstPurchaseAt: ago(1) }),
    { kycStatus: 'none' } // خرده‌فروش، شمرده نمی‌شود
  ];
  const c = S.counts(leads, now);
  assert.strictEqual(c.inquiry, 1);
  assert.strictEqual(c.form_review, 2);
  assert.strictEqual(c.bought, 1);
  const total = Object.keys(c).reduce((n, k) => n + c[k], 0);
  assert.strictEqual(total, 7, 'خرده‌فروش نباید در مرحله‌ها شمرده شود');
});

test('قیف فروش تجمعی و نزولی است', () => {
  const leads = [
    co(), co(), co({ kycStatus: 'awaiting' }), co({ kycStatus: 'pending' }),
    co({ kycStatus: 'approved', lastActivityAt: ago(1) }), co({ kycStatus: 'approved', firstPurchaseAt: ago(1) })
  ];
  const f = S.funnel(leads, now);
  assert.deepStrictEqual(f.map((x) => x.n), [6, 4, 3, 2, 1]);
  for (let i = 1; i < f.length; i += 1) assert.ok(f[i].n <= f[i - 1].n, 'قیف نباید بالا برود');
});
