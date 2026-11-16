#!/usr/bin/env bash
#
# انتشار نسخه‌ی جدید روی سرور تولید.
#
# این اسکریپت به‌ترتیب: از دیتابیس پشتیبان می‌گیرد، آخرین کد را می‌گیرد،
# پکیج‌ها را نصب می‌کند، migration های جدید دیتابیس را اجرا می‌کند و
# برنامه را بدون قطعی ری‌استارت می‌کند.
#
# اجرا (روی سرور، با کاربر غیر-root که مالک پوشه‌ی برنامه است):
#   cd /home/crm/crm-template && ./scripts/deploy.sh
#
set -euo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$APP_DIR"

BACKUP_DIR="${BACKUP_DIR:-$HOME/db-backups-part}"
PM2_APP_NAME="${PM2_APP_NAME:-crm-template}"

step() { printf '\n\033[1m==> %s\033[0m\n' "$1"; }

# ---------------------------------------------------------------------------
step "بررسی پیش‌نیازها"

if [ ! -f .env ]; then
  echo "خطا: فایل .env پیدا نشد. بدون آن برنامه به دیتابیس وصل نمی‌شود." >&2
  exit 1
fi

# وجود DATABASE_URL را بدون نمایش مقدار حساس بررسی می‌کنیم.
if ! grep -qE '^DATABASE_URL=.+' .env; then
  echo "خطا: DATABASE_URL در فایل .env تعریف نشده است." >&2
  exit 1
fi

# ---------------------------------------------------------------------------
step "پشتیبان‌گیری از دیتابیس پیش از هر تغییر"

BACKUP_DIR="$BACKUP_DIR" npm run backup

# ---------------------------------------------------------------------------
step "گرفتن آخرین کد"

# اگر پوشه یک مخزن Git با مقصد تعریف‌شده باشد، آخرین کد گرفته می‌شود.
# اگر فایل‌ها را دستی کپی کرده باشید (بدون Git)، این مرحله رد می‌شود.
NEW_REV="نامشخص"
if git rev-parse --git-dir > /dev/null 2>&1 && [ -n "$(git remote)" ]; then
  CURRENT_REV="$(git rev-parse --short HEAD)"
  git pull --ff-only
  NEW_REV="$(git rev-parse --short HEAD)"
  if [ "$CURRENT_REV" = "$NEW_REV" ]; then
    echo "کد تغییری نکرده بود (نسخه‌ی $NEW_REV)"
  else
    echo "از $CURRENT_REV به $NEW_REV"
  fi
else
  echo "این پوشه مخزن Git نیست — فرض می‌شود فایل‌ها را دستی کپی کرده‌اید."
fi

# ---------------------------------------------------------------------------
step "نصب پکیج‌ها"

# نکته: از --omit=dev استفاده نمی‌کنیم، چون ابزار خط فرمان prisma
# (که برای اجرای migration لازم است) در devDependencies قرار دارد.
# در قطعی اینترنت بین‌المللی npm در دسترس نیست: اگر فهرست پکیج‌ها عوض نشده، نصب دوباره لازم نیست؛
# اگر عوض شده و نصب شکست خورد، پکیج‌های قبلی برمی‌گردند و برنامه‌ی فعلی دست‌نخورده می‌ماند.
LOCK_HASH="$(sha256sum package-lock.json | cut -d' ' -f1)"
if [ -d node_modules ] && [ -f node_modules/.lock-hash ] && [ "$(cat node_modules/.lock-hash)" = "$LOCK_HASH" ]; then
  echo "پکیج‌ها تغییری نکرده‌اند — نصب دوباره لازم نیست."
else
  rm -rf node_modules.prev
  [ -d node_modules ] && cp -al node_modules node_modules.prev
  if npm ci; then
    echo "$LOCK_HASH" > node_modules/.lock-hash
    rm -rf node_modules.prev
  else
    echo "نصب پکیج‌ها ناموفق بود (احتمالاً اینترنت بین‌المللی قطع است) — پکیج‌های قبلی برگردانده شد و انتشار متوقف شد."
    rm -rf node_modules
    [ -d node_modules.prev ] && mv node_modules.prev node_modules
    [ -n "${CURRENT_REV:-}" ] && git reset -q --hard "$CURRENT_REV"
    exit 1
  fi
fi

# ---------------------------------------------------------------------------
step "اعمال migration های دیتابیس"

# migrate deploy فقط migration های اجرانشده را اعمال می‌کند و
# برخلاف migrate dev هیچ‌وقت دیتابیس را ریست نمی‌کند.
npx prisma migrate deploy
npm run db:generate

# ---------------------------------------------------------------------------
step "ری‌استارت برنامه"

if pm2 describe "$PM2_APP_NAME" > /dev/null 2>&1; then
  pm2 reload "$PM2_APP_NAME" --update-env
else
  pm2 start ecosystem.config.js
fi
pm2 save

# ---------------------------------------------------------------------------
step "بررسی سلامت"

sleep 3
PORT="$(grep -E '^PORT=' .env | head -1 | cut -d= -f2- | tr -d '"'"'"'' || true)"
PORT="${PORT:-3000}"
CODE="$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:${PORT}/" || echo 000)"

if [ "$CODE" = "200" ]; then
  printf '\n\033[1;32mانتشار با موفقیت انجام شد. نسخه‌ی %s در حال اجراست.\033[0m\n' "$NEW_REV"
else
  printf '\n\033[1;31mهشدار: برنامه پاسخ %s داد. لاگ را ببینید:\033[0m\n' "$CODE" >&2
  echo "  pm2 logs $PM2_APP_NAME --lines 50" >&2
  exit 1
fi
