// چرخه‌ی پیگیری بعد از خرید: ۲ روز → ۵ تا ۷ روز → هر ۲ هفته (docs/lead-stages-plan.md)
const test = require('node:test');
const assert = require('node:assert');
const Cycle = require('./purchase-cycle');

const at = new Date('2026-11-03T15:20:00');
const dayOf = (d) => `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;

test('خرید: دو روز بعد پیگیری ارسال، ساعت ۱۰ صبح', () => {
  const s = Cycle.start(at);
  assert.strictEqual(s.purchaseFollowStep, 'ship');
  assert.strictEqual(dayOf(s.nextFollowUpDate), '2026-11-5');
  assert.strictEqual(s.nextFollowUpDate.getHours(), 10);
  assert.match(s.nextFollowUpNote, /ارسال/);
});

test('بعد از پیگیری ارسال: ۶ روز بعد سفارش جدید', () => {
  const s = Cycle.advance('ship', at);
  assert.strictEqual(s.purchaseFollowStep, 'reorder');
  assert.strictEqual(dayOf(s.nextFollowUpDate), '2026-11-9');
});

test('بعد از سفارش جدید: هر ۲ هفته دوره‌ای و همان‌جا می‌ماند', () => {
  const s = Cycle.advance('reorder', at);
  assert.strictEqual(s.purchaseFollowStep, 'periodic');
  assert.strictEqual(dayOf(s.nextFollowUpDate), '2026-11-17');
  const again = Cycle.advance('periodic', at);
  assert.strictEqual(again.purchaseFollowStep, 'periodic');
  assert.strictEqual(dayOf(again.nextFollowUpDate), '2026-11-17');
});

test('مشتری بی‌چرخه دست نمی‌خورد', () => {
  assert.strictEqual(Cycle.advance(null, at), null);
  assert.strictEqual(Cycle.advance('', at), null);
  assert.strictEqual(Cycle.advance('bogus', at), null);
  assert.strictEqual(Cycle.isStep('ship'), true);
  assert.strictEqual(Cycle.isStep(null), false);
});

test('هیچ قدمی بدون تاریخ و بدون متن نمی‌ماند', () => {
  Cycle.STEPS.forEach((st) => {
    const s = Cycle.advance(st.code, at);
    assert.ok(s.nextFollowUpDate instanceof Date);
    assert.ok(s.nextFollowUpNote);
  });
});
