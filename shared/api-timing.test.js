const test = require('node:test');
const assert = require('node:assert');
const { routeKey, summarize } = require('./api-timing');

test('شناسه و query از مسیر حذف می‌شود', () => {
  assert.strictEqual(routeKey({ method: 'GET', originalUrl: '/api/v1/leads/3eb23224-3c77-4579-ace6-2d1bf3859614/file?x=09121234567' }), 'GET /leads/:id/file');
  assert.strictEqual(routeKey({ method: 'PATCH', originalUrl: '/api/v1/workdesk/leads/3eb23224-3c77-4579-ace6-2d1bf3859614/timeline/a-3eb23224-3c77-4579-ace6-2d1bf3859614' }), 'PATCH /workdesk/leads/:id/timeline/:item');
});

test('خلاصه: میانه و کندترین', () => {
  const r = summarize(new Map([['GET /leads', { ms: [300, 100, 200], bytes: 3 * 2048 }]]));
  assert.deepStrictEqual(r[0], { k: 'GET /leads', n: 3, med: 200, max: 300, kb: 2 });
});
