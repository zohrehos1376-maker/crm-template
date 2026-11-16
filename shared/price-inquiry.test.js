// روال مشتریِ فقط استعلام‌کننده: ۳ بار در یک روز → همان روز یادآوری؛ ۳ بار در روزهای مختلف → فردا عارضه‌یابی
const test = require('node:test');
const assert = require('node:assert');
const PI = require('./price-inquiry');

const now = new Date('2026-11-03T15:20:00');
const dayOf = (d) => `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;

test('استعلام اول و دوم: هیچ یادآوری‌ای نمی‌گذارد (یادآوری لیست قیمت حذف شد)', () => {
  assert.strictEqual(PI.decide(1, { now, todayCount: 1 }).followUp, null);
  assert.strictEqual(PI.decide(2, { now, todayCount: 2 }).followUp, null);
});

test('۳ بار در یک روز: همان روز یادآوری برای کارشناس', () => {
  const r = PI.decide(3, { now, todayCount: 3 });
  assert.strictEqual(dayOf(r.followUp.date), dayOf(now));
  assert.strictEqual(r.followUp.date.getHours(), 0);
  assert.match(r.followUp.note, /امروز ۳ بار/);
  assert.match(PI.decide(9, { now, todayCount: 5 }).followUp.note, /امروز ۵ بار/);
});

test('۳ بار در روزهای مختلف: فردا (بی‌ساعت) تماس عارضه‌یابی', () => {
  const r = PI.decide(3, { now, todayCount: 1 });
  assert.strictEqual(dayOf(r.followUp.date), '2026-11-4');
  assert.strictEqual(r.followUp.date.getHours(), 0);
  assert.match(r.followUp.note, /عارضه‌یابی/);
  assert.match(PI.decide(7, { now, todayCount: 2 }).followUp.note, /عارضه‌یابی/);
});

test('مشتریِ خریدکرده یا پرونده‌ی بسته از این روال بیرون است', () => {
  assert.strictEqual(PI.decide(5, { now, todayCount: 4, purchased: true }).followUp, null);
  assert.strictEqual(PI.decide(5, { now, todayCount: 4, closed: true }).followUp, null);
});

test('گروه‌بندی روزبه‌روز به وقت تهران، جدیدترین روز اول', () => {
  // ۰۱:۰۰ تهران = ۲۱:۳۰ UTC روز قبل — باید در روز تهران بیفتد، نه روز UTC
  const at = (iso) => new Date(iso).getTime();
  const days = PI.groupByDay([
    { at: at('2026-11-02T21:30:00Z') }, // ۳ نوامبر ۰۱:۰۰ تهران
    { at: at('2026-11-03T10:00:00Z') }, // ۳ نوامبر
    { at: at('2026-11-02T10:00:00Z') }, // ۲ نوامبر
  ]);
  assert.strictEqual(days.length, 2);
  assert.deepStrictEqual(days.map((d) => d.count), [2, 1]);
  assert.ok(days[0].day > days[1].day);
  assert.ok(days[0].calls[0].at < days[0].calls[1].at);
});
