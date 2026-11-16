# Tink (داخل androidx.security-crypto) به این حاشیه‌نویسی‌ها در زمان اجرا نیاز ندارد
-dontwarn com.google.errorprone.annotations.**
-dontwarn javax.annotation.**
-dontwarn com.google.api.client.**
-dontwarn org.joda.time.**
# نام کلاس‌های Worker برای WorkManager (قواعد خود کتابخانه هم هست؛ برای اطمینان)
-keep class com.example.crmcalls.SyncWorker { *; }
# پیام خطاهای خوانا در گزارش کرش
-keepattributes SourceFile,LineNumberTable
