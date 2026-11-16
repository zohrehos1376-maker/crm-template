const test = require('node:test');
const assert = require('node:assert');
const { isAllowedDocUrl } = require('./doc-url');

test('آدرس مدرک فقط از سایت CRM نمونه', () => {
  assert.ok(isAllowedDocUrl('https://crm.example.com/wp-content/uploads/a.jpg'));
  assert.ok(isAllowedDocUrl('https://www.crm.example.com/a.heic'));
  assert.ok(!isAllowedDocUrl('http://127.0.0.1:3101/api'));
  assert.ok(!isAllowedDocUrl('https://crm.example.com.evil.ir/a.jpg'));
  assert.ok(!isAllowedDocUrl('https://evilcrm.example.com/a.jpg'));
  assert.ok(!isAllowedDocUrl('https://crm.example.com:3306/a'));
  assert.ok(!isAllowedDocUrl('https://x@crm.example.com/a'));
  assert.ok(!isAllowedDocUrl('file:///etc/passwd'));
});
