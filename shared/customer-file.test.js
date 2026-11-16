// آزمون پرونده‌ی مشتری — اجرا: npm test
const test = require('node:test');
const assert = require('node:assert');
const F = require('./customer-file');

test('«ترجیح تماس» فقط با گروه پشتیبان و دست‌کم ۵ تماس در ۳۰ روز', () => {
  assert.strictEqual(F.prefersCalls(true, 5), true);
  assert.strictEqual(F.prefersCalls(true, 4), false);
  assert.strictEqual(F.prefersCalls(false, 20), false);
});

test('گروه پشتیبان: پاک‌سازی، خطاها و برداشتن گروه', () => {
  const ok = F.cleanSupportGroup({ platform: 'whatsapp', name: '  گروه رضایی ', link: 'https://chat.whatsapp.com/x', members: ['a', 'b', 'a', ''] });
  assert.deepStrictEqual(ok.value, { supportGroupPlatform: 'whatsapp', supportGroupName: 'گروه رضایی', supportGroupLink: 'https://chat.whatsapp.com/x', supportGroupMembers: 'a,b' });
  assert.ok(F.cleanSupportGroup({ platform: 'fax', name: 'x' }).error);
  assert.ok(F.cleanSupportGroup({ platform: 'telegram', name: '' }).error);
  assert.ok(F.cleanSupportGroup({ platform: 'telegram', name: 'x', link: 'javascript:alert(1)' }).error);
  assert.deepStrictEqual(F.cleanSupportGroup({ platform: '' }).value, { supportGroupPlatform: null, supportGroupName: null, supportGroupLink: null, supportGroupMembers: null });
  assert.deepStrictEqual(F.memberIds(' a, b ,,c'), ['a', 'b', 'c']);
});

test('«در حال کار توسط…»: دیگران می‌بینند، خود کاربر نه؛ جای دیگری گرفته نمی‌شود؛ بعد از ۲ دقیقه پاک می‌شود', () => {
  let now = 1000;
  const p = F.createPresence(() => now);
  const sara = { id: 's', fullName: 'سارا' };
  const ali = { id: 'a', fullName: 'علی' };
  assert.strictEqual(p.set('L1', sara, 'followup'), null);
  assert.strictEqual(p.get('L1', 's'), null);
  assert.strictEqual(p.get('L1', 'a').name, 'سارا');
  assert.strictEqual(p.get('L1', 'a').label, 'ثبت پیگیری');
  assert.strictEqual(p.set('L1', ali, 'kyc').name, 'سارا');
  p.clear('L1', 'a');
  assert.strictEqual(p.get('L1', 'a').name, 'سارا');
  assert.deepStrictEqual(p.forLeads(['L1', 'L2'], 'a'), { L1: { name: 'سارا', label: 'ثبت پیگیری' } });
  now += F.PRESENCE_TTL_MS + 1;
  assert.strictEqual(p.get('L1', 'a'), null);
  p.set('L1', sara, 'view');
  p.clear('L1', 's');
  assert.strictEqual(p.get('L1', 'a'), null);
});

test('سابقه: همه‌ی عملیات + تماس‌های ثبت‌نشده، جدیدترین بالا، بدون تکرار تماس ثبت‌شده', () => {
  const audits = [{ id: 1, action: 'followup', actionLabel: 'ثبت پیگیری', userName: 'سارا', createdAt: 300, summary: 'سفارش داد', changes: [] }];
  const calls = [
    { id: 'x', direction: 'MISSED', durationSec: 0, logStatus: 'UNLOGGED', callbackDone: false, operatorName: '', startedAt: 500 },
    { id: 'y', direction: 'INCOMING', durationSec: 95, logStatus: 'LOGGED', operatorName: 'علی', startedAt: 400 },
    { id: 'z', direction: 'INCOMING', durationSec: 95, logStatus: 'UNLOGGED', operatorName: 'علی', startedAt: 100 },
  ];
  const t = F.mergeTimeline(audits, calls);
  assert.deepStrictEqual(t.map((x) => x.id), ['c-x', 'a-1', 'c-z']);
  assert.strictEqual(t[0].kind, 'call_missed');
  assert.strictEqual(t[0].who, 'بدون پاسخ');
  assert.strictEqual(t[2].label, 'تماس ورودی · 1:35 دقیقه');
  assert.strictEqual(t[1].who, 'سارا');
});

test('بی‌پاسخی که با تماس برگشتی بسته شد (logStatus=LOGGED) همچنان در سابقه دیده می‌شود', () => {
  const calls = [
    { id: 'm1', direction: 'MISSED', durationSec: 0, logStatus: 'LOGGED', callbackDone: true, operatorName: 'سارا', startedAt: 100, note: null },
    { id: 'm2', direction: 'MISSED', durationSec: 0, logStatus: 'UNLOGGED', callbackDone: false, operatorName: '', startedAt: 50 },
  ];
  const t = F.mergeTimeline([], calls);
  assert.deepStrictEqual(t.map((x) => x.id), ['c-m1', 'c-m2']);
  assert.strictEqual(t[0].kind, 'call_missed_done');
  assert.match(t[0].label, /تماس برگشتی گرفته شد/);
  assert.strictEqual(t[1].kind, 'call_missed');
  assert.match(t[1].label, /بدون تماس برگشتی/);
});

test('سابقه: تغییر مرحله جدا نام می‌گیرد؛ تاریخ پیگیری و «فروش بدون احراز» کنار خرید پنهان است', () => {
  const t0 = 1700000000000;
  const audits = [
    { id: '1', action: 'updated', actionLabel: 'اصلاح مشخصات', createdAt: t0, changes: [{ field: 'status', from: 'جدید', to: 'فروش موفق' }] },
    { id: '2', action: 'updated', actionLabel: 'اصلاح مشخصات', createdAt: t0 + 1, changes: [{ field: 'nextFollowUpDate', from: '—', to: 'x' }] },
    { id: '3', action: 'updated', actionLabel: 'اصلاح مشخصات', createdAt: t0 + 2, changes: [{ field: 'customerName', from: '—', to: 'علی' }] },
    { id: '4', action: 'sale_unverified', actionLabel: 'فروش به مشتری احراز‌نشده', createdAt: t0 + 5000, changes: [] },
    { id: '5', action: 'first_purchase', actionLabel: 'اولین خرید مشتری', createdAt: t0 + 5010, changes: [] },
  ];
  const t = F.mergeTimeline(audits, []);
  const byId = Object.fromEntries(t.map((x) => [x.id, x]));
  assert.strictEqual(byId['a-1'].label, 'تغییر مرحله');
  assert.ok(!byId['a-2']);
  assert.strictEqual(byId['a-3'].label, 'اصلاح مشخصات');
  assert.ok(!byId['a-4']);
  assert.ok(byId['a-5']);
});

test('کارت ثبت تماس یادداشت و پیگیری همان تماس را نشان می‌دهد', () => {
  const audits = [{ id: 'a1', action: 'call_logged', actionLabel: 'ثبت تماس', userName: 'مرضیه', createdAt: 2000, summary: 'ورودی · فقط استعلام قیمت', changes: [] }];
  const calls = [{ id: 'c1', direction: 'INCOMING', durationSec: 60, logStatus: 'LOGGED', operatorName: 'مرضیه', startedAt: 1000, note: 'lcd note 20', followUpAt: 1767000000000 }];
  const t = F.mergeTimeline(audits, calls);
  assert.equal(t.length, 1);
  assert.match(t[0].text, /📝 lcd note 20/);
  assert.match(t[0].text, /📅 پیگیری بعدی/);
});

test('کارت ثبت پیگیری نوع پیگیری و پیگیری بعدی را نشان می‌دهد', () => {
  const audits = [{ id: 'a1', action: 'followup', actionLabel: 'ثبت پیگیری', userName: 'امیر', createdAt: 2000, summary: 'بحث کردیم سر قیمت',
    changes: [{ field: '_fuKind', to: 'پیام دادم' }, { field: '_fuNext', to: '2026-11-10T06:30:00.000Z' }] }];
  const t = F.mergeTimeline(audits, []);
  assert.equal(t[0].label, 'ثبت پیگیری · پیام دادم');
  assert.match(t[0].extra, /📅 پیگیری بعدی/);
});
