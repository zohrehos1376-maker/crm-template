plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

// شماره‌ی نسخه از شماره‌ی اجرای GitHub Actions می‌آید (روی لپ‌تاپ: ۱)
val ciVersionCode = (System.getenv("APP_VERSION_CODE") ?: "1").toInt()

android {
    namespace = "com.example.crmcalls"
    compileSdk = 34

    defaultConfig {
        applicationId = "com.example.crmcalls"
        minSdk = 26
        targetSdk = 34
        versionCode = ciVersionCode
        versionName = "1.0.$ciVersionCode"
    }

    signingConfigs {
        create("release") {
            // کلید اصلی از GitHub Secrets؛ اگر نبود، کلید آزمایشی داخل پروژه (فقط برای تست)
            val ks = System.getenv("ANDROID_KEYSTORE_FILE")
            if (ks != null && file(ks).exists()) {
                storeFile = file(ks)
                storePassword = System.getenv("ANDROID_KEYSTORE_PASSWORD")
                keyAlias = System.getenv("ANDROID_KEY_ALIAS")
                keyPassword = System.getenv("ANDROID_KEY_PASSWORD")
                // کلید دائمی CRM نمونه به شکل PKCS12 (.p12) ساخته شده است
                if (ks.endsWith(".p12", ignoreCase = true) || ks.endsWith(".pfx", ignoreCase = true)) storeType = "PKCS12"
            } else {
                storeFile = rootProject.file("test-signing.keystore")
                storePassword = "android"
                keyAlias = "androiddebugkey"
                keyPassword = "android"
            }
        }
    }

    buildTypes {
        release {
            // کوچک‌کردن کد (R8) روی سرور ۲ گیگابایتیِ CRM حافظه کم می‌آورد و سرویس را کند می‌کند.
            // با ANDROID_MINIFY=1 روشن می‌شود (مثلاً روی گیت‌هاب)؛ روی سرور خودمان خاموش است:
            // APK حدود ۶ مگابایت می‌شود که برای به‌روزرسانی داخل اپ هم مشکلی ندارد.
            val minify = System.getenv("ANDROID_MINIFY") == "1"
            isMinifyEnabled = minify
            isShrinkResources = minify
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
            signingConfig = signingConfigs.getByName("release")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions {
        jvmTarget = "17"
    }
    buildFeatures {
        buildConfig = true
    }
    lint {
        checkReleaseBuilds = false
        abortOnError = false
    }
}

dependencies {
    implementation("androidx.core:core-ktx:1.13.1")
    implementation("androidx.appcompat:appcompat:1.7.0")
    implementation("androidx.activity:activity-ktx:1.9.1")
    implementation("com.google.android.material:material:1.12.0")
    implementation("androidx.work:work-runtime-ktx:2.9.1")
    implementation("androidx.security:security-crypto:1.0.0")
    implementation("com.journeyapps:zxing-android-embedded:4.3.0")
}
