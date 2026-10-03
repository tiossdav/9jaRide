plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("org.jetbrains.kotlin.plugin.compose")
}

android {
    namespace = "com.ninejaride.rider"
    compileSdk = 36

    defaultConfig {
        applicationId = "com.ninejaride.rider"
        minSdk = 26
        targetSdk = 36
        versionCode = 1
        versionName = "0.1.0"

        // The rider app talks to the real backend by default (the booking flow needs live prices and drivers).
        // Phone on USB:  adb reverse tcp:3000 tcp:3000  then use http://localhost:3000.  Emulator: http://10.0.2.2:3000.
        val apiBase = (project.findProperty("apiBase") as String?) ?: "http://localhost:3000"
        buildConfigField("String", "API_BASE_URL", "\"$apiBase\"")
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
