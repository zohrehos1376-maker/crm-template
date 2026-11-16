const test = require('node:test');
const assert = require('node:assert');
const { buildMultiSheetXlsx, buildWorkbookXlsx } = require('./xlsx');

test('اکسل چندبرگه‌ای: دو برگه، راست‌به‌چپ', () => {
  const buf = buildMultiSheetXlsx([
    { name: 'خلاصه', headers: ['عنوان', 'مقدار'], rows: [['فروش', '۳']] },
    { name: 'جزئیات', headers: ['مبلغ'], rows: [[1500000]], numericCols: new Set([0]) },
  ]);
  const text = buf.toString('utf8');
  assert.ok(text.includes('xl/worksheets/sheet2.xml'));
  assert.ok(text.includes('rightToLeft="1"'));
  assert.ok(text.includes('<v>1500000</v>'));
});

test('اکسل تک‌برگه‌ی قبلی همچنان چپ‌به‌راست ساخته می‌شود', () => {
  const text = buildWorkbookXlsx('s', ['a'], [['b']]).toString('utf8');
  assert.ok(!text.includes('rightToLeft'));
});
