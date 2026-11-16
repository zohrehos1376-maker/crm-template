#!/usr/bin/env node
/**
 * حذف سرویس ویندوز برنامه.
 * اجرا (نیاز به دسترسی مدیر):  npm run service:uninstall
 */
const path = require('path');
const { Service } = require('node-windows');

const svc = new Service({
  name: 'CRM Crm',
  script: path.join(__dirname, '..', 'server.js'),
});

svc.on('uninstall', () => {
  console.log('سرویس حذف شد.');
});
svc.on('alreadyuninstalled', () => {
  console.log('سرویسی برای حذف وجود نداشت.');
});
svc.on('error', (e) => {
  console.error('خطا:', e && e.message ? e.message : e);
});

console.log('در حال حذف سرویس…');
svc.uninstall();
