// آمار کار کارشناسان: شمارش روزبه‌روز، بدون نمره
const test = require('node:test');
const assert = require('node:assert');
const S = require('./rep-stats');

const at = (iso) => new Date(iso).getTime();
const D1 = '2026-11-03T08:00:00Z'; // ۳ نوامبر تهران
const D2 = '2026-11-04T08:00:00Z';

test('تماس‌ها و نتیجه‌ها برای هر کارشناس در روز خودش شمرده می‌شوند', () => {
  const r = S.build({ calls: [
    { userId: 'a', at: at(D1), direction: 'INCOMING', durationSec: 60, logStatus: 'LOGGED', outcomes: ['price_inquiry'] },
    { userId: 'a', at: at(D1), direction: 'OUTGOING', durationSec: 30, logStatus: 'LOGGED', outcomes: ['price_objection', 'out_of_stock'] },
    { userId: 'b', at: at(D2), direction: 'INCOMING', durationSec: 10, logStatus: 'LOGGED', outcomes: ['order'] },
  ] });
  assert.strictEqual(r.days.length, 2);
  const a = r.days[1].reps.find((x) => x.userId === 'a');
  assert.deepStrictEqual([a.calls, a.incoming, a.outgoing, a.talkSec, a.priceInquiry, a.objection, a.outOfStock], [2, 1, 1, 90, 1, 1, 1]);
  assert.strictEqual(r.days[0].reps[0].order, 1);
  assert.strictEqual(r.total.calls, 3);
});

test('بی‌پاسخ‌ها: تیمی شمرده می‌شوند، نتیجه‌ی کپی‌شده‌شان دوباره حساب نمی‌شود، تماس برگشتی به اسم کارشناس', () => {
  const r = S.build({ calls: [
    { userId: 'a', at: at(D1), direction: 'MISSED', logStatus: 'LOGGED', outcomes: ['price_inquiry'], callbackDone: true },
    { userId: null, at: at(D1), direction: 'MISSED', logStatus: 'UNLOGGED', callbackDone: false },
    { userId: null, at: at(D1), direction: 'INCOMING', durationSec: 40, logStatus: 'UNLOGGED' },
  ] });
  const d = r.days[0];
  assert.deepStrictEqual([d.team.missed, d.team.missedOpen, d.team.unlogged, d.team.priceInquiry], [2, 1, 1, 0]);
  assert.strictEqual(d.reps[0].callbacks, 1);
});

test('پیگیری، نام‌گذاری شماره‌ی خام و احراز (با مدت انتظار)', () => {
  const r = S.build({
    followups: [{ userId: 'a', at: at(D1) }, { userId: 'a', at: at(D2) }],
    named: [{ userId: 'a', at: at(D1) }],
    kyc: [{ userId: 'k', at: at(D1), approved: true, waitMs: 7200000 }, { userId: 'k', at: at(D1), approved: false }],
  });
  const a = r.reps.find((x) => x.userId === 'a');
  assert.deepStrictEqual([a.followups, a.named, a.activeDays], [2, 1, 2]);
  const k = r.reps.find((x) => x.userId === 'k');
  assert.deepStrictEqual([k.kycApproved, k.kycRejected, k.kycWaitMs], [1, 1, 7200000]);
});
