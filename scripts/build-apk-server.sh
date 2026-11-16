#!/usr/bin/env bash
# ساخت APK اپ «CRM نمونه تماس» روی سرور خودمان (داخل ایران) — بدون گیت‌هاب و بدون گوگل‌پلی.
# روی سرور اجرا می‌شود:  cd ~/crm-template && bash scripts/build-apk-server.sh [versionCode]
set -euo pipefail
cd "$(dirname "$0")/.."

export ANDROID_HOME="$HOME/android/sdk"
export ANDROID_SDK_ROOT="$ANDROID_HOME"
export JAVA_HOME="${JAVA_HOME:-/usr/lib/jvm/java-17-openjdk-amd64}"
export PATH="$HOME/android/gradle-8.9/bin:$JAVA_HOME/bin:$PATH"
# رم سرور کم است: بیلد با حافظه‌ی محدود و اولویت پایین تا CRM کند نشود
export GRADLE_OPTS="-Dorg.gradle.jvmargs=-Xmx900m -Dkotlin.daemon.jvmargs=-Xmx700m"

VERSION_CODE="${1:-$(date +%y%m%d)}"
export APP_VERSION_CODE="$VERSION_CODE"

# کلید دائمی اگر روی سرور گذاشته شده باشد (~/crm-keys/crm-template-release.p12 و pw.txt)
if [ -f "$HOME/crm-keys/crm-template-release.p12" ] && [ -f "$HOME/crm-keys/pw.txt" ]; then
  export ANDROID_KEYSTORE_FILE="$HOME/crm-keys/crm-template-release.p12"
  export ANDROID_KEYSTORE_PASSWORD="$(cat "$HOME/crm-keys/pw.txt")"
  export ANDROID_KEY_ALIAS="crmtemplate"
  export ANDROID_KEY_PASSWORD="$ANDROID_KEYSTORE_PASSWORD"
  echo "==> امضا با کلید دائمی"
else
  echo "==> امضا با کلید آزمایشی (کلید دائمی روی سرور نیست)"
fi

cd android-app
echo "==> ساخت نسخه $VERSION_CODE"
nice -n 10 gradle --no-daemon --offline assembleRelease 2>/dev/null \
  || nice -n 10 gradle --no-daemon assembleRelease

APK=$(ls -t "$PWD"/app/build/outputs/apk/release/*.apk | head -1)
cd ..
echo "==> APK: $APK"
mkdir -p "$HOME/crm-downloads-part"
cp "$APK" "$HOME/crm-downloads-part/crm-template-call.apk"
node scripts/publish-android-app.js "$VERSION_CODE" "1.0.$VERSION_CODE" \
  "https://crm.example.com/downloads/crm-template-call.apk" "به‌روزرسانی تازه"
echo "تمام — نسخه روی سرور منتشر شد و در اپ کارشناس‌ها پیام به‌روزرسانی می‌آید."
