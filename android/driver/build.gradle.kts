plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("org.jetbrains.kotlin.plugin.compose")
    id("org.jetbrains.kotlin.plugin.serialization")
}

// Firebase (push notifications) switches on once google-services.json from the Firebase console is in this folder.
if (file("google-services.json").exists()) apply(plugin = "com.google.gms.google-services")

android {
    namespace = "com.ninejaride.driver"
    compileSdk = 36

    defaultConfig {
        applicationId = "com.naijaridepro.driver"
        minSdk = 26
        targetSdk = 36
        versionCode = 1
        versionName = "0.1.0"

        // Where the API lives. 10.0.2.2 is the host machine as seen from the Android emulator.
        // Demo mode (default): every screen runs on built-in sample data, no server needed.
        // Real server:  ./gradlew :driver:installDebug -PdemoMode=false -PapiBase=http://localhost:3000
        // (with a phone on USB, run `adb reverse tcp:3000 tcp:3000` first so "localhost" reaches your computer).
        val demoMode = (project.findProperty("demoMode") as String?) ?: "true"
        val apiBase = (project.findProperty("apiBase") as String?) ?: "http://10.0.2.2:3000"
        buildConfigField("String", "API_BASE_URL", "\"$apiBase\"")
        manifestPlaceholders["googleMapsKey"] = rootProject.extra["googleMapsKey"] as String
        buildConfigField("boolean", "DEMO_MODE", demoMode)
    }

    buildTypes {
        release {
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions { jvmTarget = "17" }

    buildFeatures {
        compose = true
        buildConfig = true
    }
}

dependencies {
    implementation(project(":core"))
    debugImplementation("androidx.compose.ui:ui-tooling")
}
