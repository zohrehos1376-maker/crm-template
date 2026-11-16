#!/usr/bin/env bash
# انتشار نسخه‌ی تازه‌ی اپ «CRM نمونه تماس» روی سرور آزمایشی:
# APK ساخته‌شده‌ی گیت‌هاب را می‌گیرد، روی سرور می‌گذارد و به گوشی‌ها اعلام می‌کند.
# اجرا از روی لپ‌تاپ:  bash scripts/publish-apk.sh
set -euo pipefail
cd "$(dirname "$0")/.."

SSH_KEY="$HOME/.ssh/id_ed25519"
SERVER="user@your-server"
URL="https://crm.example.com/downloads/crm-template-call.apk"

echo "==> گرفتن آخرین APK از گیت‌هاب"
GIT_SSH_COMMAND="ssh -i \"$HOME/.ssh/id_ed25519_crmtemplate\" -o IdentitiesOnly=yes" git fetch -q origin ci-build
git show origin/ci-build:status.txt
RUN=$(git show origin/ci-build:status.txt | sed -n 's/^versionCode=//p')
OUT=$(git show origin/ci-build:status.txt | sed -n 's/^outcome=//p')
[ "$OUT" = "success" ] || { echo "بیلد موفق نبوده؛ انتشار انجام نشد."; exit 1; }
# گوشی‌ها اپ امضاشده با کلید دائمی دارند؛ APK با کلید آزمایشی نصب نمی‌شود
SIGNED=$(git show origin/ci-build:status.txt | sed -n 's/^signed=//p')
[ "$SIGNED" = "release" ] || { echo "این APK با کلید آزمایشی امضا شده و روی گوشی‌ها نصب نمی‌شود. روی سرور بسازید: ssh user@your-server 'cd ~/crm-template && bash scripts/build-apk-server.sh <versionCode>'"; exit 1; }
mkdir -p tmp
git show origin/ci-build:crm-template-call.apk > tmp/crm-template-call.apk
ls -lh tmp/crm-template-call.apk

echo "==> گذاشتن روی سرور"
scp -i "$SSH_KEY" -o IdentitiesOnly=yes tmp/crm-template-call.apk "$SERVER:~/crm-downloads-part/crm-template-call.apk"

echo "==> اعلام نسخه به گوشی‌ها"
ssh -i "$SSH_KEY" -o IdentitiesOnly=yes "$SERVER" "cd ~/crm-template && node scripts/publish-android-app.js $RUN 1.0.$RUN '$URL' 'به‌روزرسانی تازه'"
echo "تمام — کارشناس‌ها در صفحه‌ی اصلی اپ پیام «نسخه‌ی تازه» را می‌بینند."
