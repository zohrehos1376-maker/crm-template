// تست واحد یکسان‌سازی شماره — اجرا: node --test shared/
const test = require('node:test');
const assert = require('node:assert');
const { normalizePhone, isPlausiblePhone } = require('./phone');

test('mobile in every common shape becomes 09141234567', () => {
  for (const v of [
    '+989141234567', '00989141234567', '989141234567', '9141234567', '09141234567',
    '0914 123 4567', '0914-123-4567', '(0914) 123 4567', '+98 914 123 4567',
    '۰۹۱۴۱۲۳۴۵۶۷', '٠٩١٤١٢٣٤٥٦٧', '+۹۸۹۱۴۱۲۳۴۵۶۷',
  ]) {
    assert.strictEqual(normalizePhone(v), '09141234567', v);
  }
});

test('Tabriz landlines are kept intact', () => {
  assert.strictEqual(normalizePhone('041-3333 4444'), '04133334444');
  assert.strictEqual(normalizePhone('+984133334444'), '04133334444');
  assert.strictEqual(normalizePhone('984133334444'), '04133334444');
  assert.strictEqual(normalizePhone('33334444'), '33334444');
});

test('short numbers are not broken', () => {
  assert.strictEqual(normalizePhone('110'), '110');
  assert.strictEqual(normalizePhone('0416105'), '0416105');
  assert.strictEqual(normalizePhone('*141#'), '141');
});

test('empty and junk', () => {
  assert.strictEqual(normalizePhone(''), '');
  assert.strictEqual(normalizePhone(null), '');
  assert.strictEqual(normalizePhone(undefined), '');
  assert.strictEqual(isPlausiblePhone('11'), false);
  assert.strictEqual(isPlausiblePhone('1159'), false);
  assert.strictEqual(isPlausiblePhone('09141234567'), true);
});
