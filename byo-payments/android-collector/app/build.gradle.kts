plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "com.hulet.byocollector"
    compileSdk = 34

    defaultConfig {
        applicationId = "com.hulet.byocollector"
        minSdk = 24            // Android 7.0+ — covers virtually every cheap dedicated phone
        targetSdk = 34
        versionCode = 8
        versionName = "1.5.0"

        // ---- Configure these here (or override at build time) ----
        // The ingest endpoint and secrets. Baked into the app; only ever installed on YOUR phone.
        buildConfigField("String", "INGEST_URL",
            "\"${project.findProperty("INGEST_URL") ?: "https://lkftnbkuuitaxtlvrqfj.supabase.co/functions/v1/ingest-sms"}\"")
        buildConfigField("String", "SUPABASE_URL",
            "\"${project.findProperty("SUPABASE_URL") ?: "https://lkftnbkuuitaxtlvrqfj.supabase.co"}\"")
        buildConfigField("String", "SUPABASE_ANON",
            "\"${project.findProperty("SUPABASE_ANON") ?: "sb_publishable_D5tMkCSL1AVvJS8S9fuPgQ_nOg_ItOY"}\"")
        buildConfigField("String", "COLLECTOR_API_KEY",
            "\"${project.findProperty("COLLECTOR_API_KEY") ?: "SET_ME_IN_SETTINGS"}\"")
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            // debug-signed so CI can produce an installable APK without a keystore
        }
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions { jvmTarget = "17" }
    buildFeatures { buildConfig = true; viewBinding = true }
}

dependencies {
    implementation("androidx.core:core-ktx:1.13.1")
    implementation("androidx.appcompat:appcompat:1.7.0")
    implementation("com.google.android.material:material:1.12.0")
    implementation("androidx.constraintlayout:constraintlayout:2.1.4")
    implementation("androidx.lifecycle:lifecycle-service:2.8.4")
    implementation("androidx.work:work-runtime-ktx:2.9.1")   // retry queue
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.8.1")
}
