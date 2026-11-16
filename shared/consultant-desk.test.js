// آزمون «میز کار مشاور» — اجرا: npm test
const test = require('node:test');
const assert = require('node:assert');
const D = require('./consultant-desk');

const Q = 'queue-user';
const lead = (id, phone, extra) => Object.assign({ id, customerName: 'مشتری ' + id, phone, city: 'تهران', shopName: '', jobType: '', kycStatus: 'none', ownerId: 'u1', owner: { fullName: 'سارا' }, tags: [], channel: '', supportGroupPlatform: null }, extra || {});

test('ردیف‌ها: منبع، منتظر پاسخ، ثبت‌نشده و مرتب‌سازی', () => {
  const now = Date.now();
  const calls = [
    { id: 'c1', phone: '09120000001', direction: 'MISSED', startedAt: now - 1000, logStatus: 'UNLOGGED', callbackDone: false },
    { id: 'c2', phone: '09120000001', direction: 'MISSED', startedAt: now - 5000, logStatus: 'UNLOGGED', callbackDone: true },
    { id: 'c3', phone: '09120000002', direction: 'INCOMING', durationSec: 60, startedAt: now - 3000, logStatus: 'UNLOGGED' },
    { id: 'c4', phone: '09120000003', direction: 'INCOMING', durationSec: 60, startedAt: now - 4000, logStatus: 'LOGGED' },
  ];
  const intakes = [
    { id: 'a1', at: now - 2000, lead: lead('L5', '09120000005', { ownerId: Q, tags: ['وردست'] }) },
    { id: 'a2', at: now - 6000, lead: lead('L6', '09120000006', { ownerId: 'u1' }) },
    // مشتری قدیمی (بی‌برچسب وردست) که از وردست آمده: نوع از خود ورودی است و «از قبل در CRM» نشان داده می‌شود
    { id: 'a3', at: now - 7000, action: 'intake_vardast', leadCreatedAt: now - 86400000, lead: lead('L7', '09120000007', { channel: 'حضوری' }) },
  ];
  const rows = D.buildRows(calls, intakes, new Map([['09120000001', lead('L1', '09120000001')]]), Q);
  assert.deepStrictEqual(rows.map((r) => r.id), ['call-c1', 'intake-a1', 'call-c3', 'call-c4', 'call-c2', 'intake-a2', 'intake-a3']);
  const by = Object.fromEntries(rows.map((r) => [r.id, r]));
  assert.strictEqual(by['call-c1'].waiting, true);
  assert.strictEqual(by['call-c2'].waiting, false);       // تماس برگشتی گرفته شده
  assert.strictEqual(by['call-c3'].unlogged, true);
  assert.strictEqual(by['call-c3'].waiting, true);   // ثبت‌نشده هم منتظر می‌ماند
  assert.strictEqual(by['call-c4'].unlogged, false);
  assert.strictEqual(by['intake-a1'].type, 'vardast');
  assert.strictEqual(by['intake-a1'].waiting, true);      // هنوز در صف بدون مسئول
  assert.strictEqual(by['intake-a1'].owner, '');
  assert.strictEqual(by['intake-a2'].type, 'form');
  assert.strictEqual(by['intake-a2'].waiting, true);      // مسئول پرونده دیگر معنی ندارد؛ تا رسیدگی نشده منتظر است
  assert.strictEqual(by['intake-a2'].existing, false);
  assert.strictEqual(by['intake-a3'].type, 'vardast');
  assert.strictEqual(by['intake-a3'].existing, true);
  assert.strictEqual(by['call-c1'].name, 'مشتری L1');
  assert.strictEqual(by['call-c1'].phoneCalls, 2);

  const s = D.stats(rows, now);
  assert.strictEqual(s.waiting, 5);
  assert.strictEqual(s.unlogged, 1);
  assert.strictEqual(s.call.waiting, 2);
  assert.strictEqual(s.vardast.waiting, 2);

  assert.deepStrictEqual(D.filter(rows, 'waiting', '').map((r) => r.id), ['call-c1', 'intake-a1', 'call-c3', 'intake-a2', 'intake-a3']);
  assert.deepStrictEqual(D.filter(rows, 'form', '').map((r) => r.id), ['intake-a2']);
  assert.deepStrictEqual(D.filter(rows, 'all', '0000003').map((r) => r.id), ['call-c4']);
});

test('شروع امروز به وقت تهران', () => {
  // ۲۷ اکتبر ۲۰۲۶، ساعت ۰۲:۰۰ تهران = ۲۶ اکتبر ۲۲:۳۰ UTC → شروع امروز = ۲۶ اکتبر ۲۰:۳۰ UTC
  const t = Date.UTC(2026, 9, 26, 22, 30);
  assert.strictEqual(D.startOfTodayTehran(t), Date.UTC(2026, 9, 26, 20, 30));
});
