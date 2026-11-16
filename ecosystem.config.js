// تنظیمات PM2 برای اجرای برنامه روی سرور تولید.
// اجرا:  pm2 start ecosystem.config.js
module.exports = {
  apps: [
    {
      name: 'crm-template',
      script: 'server.js',
      cwd: __dirname,
      // یک نمونه کافی است. اگر بعداً بار زیاد شد می‌توان به 'max' تغییر داد؛
      // نشست‌ها در دیتابیس هستند پس چند نمونه هم مشکلی ایجاد نمی‌کند.
      instances: 1,
      exec_mode: 'fork',
      env: {
        NODE_ENV: 'production',
        TZ: 'Asia/Tehran',
      },
      // ری‌استارت خودکار در صورت کرش، با محدودیت تا حلقه‌ی بی‌پایان نسازد
      autorestart: true,
      max_restarts: 10,
      min_uptime: '20s',
      // اگر مصرف حافظه غیرعادی شد، نمونه ری‌استارت شود
      max_memory_restart: '400M',
      error_file: './logs/pm2-error.log',
      out_file: './logs/pm2-out.log',
      time: true,
    },
  ],
};
