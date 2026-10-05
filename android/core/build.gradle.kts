import java.util.Properties

plugins {
    id("com.android.library")
    id("org.jetbrains.kotlin.android")
    id("org.jetbrains.kotlin.plugin.compose")
    id("org.jetbrains.kotlin.plugin.serialization")
}

// The Mapbox token comes from -PmapboxToken=... or android/local.properties, never from a file in git.
val mapboxToken: String = (project.findProperty("mapboxToken") as String?)
    ?: Properties().also { p -> rootProject.file("local.properties").takeIf { it.exists() }?.inputStream()?.use { p.load(it) } }.getProperty("mapboxToken", "")

android {
    namespace = "com.ninejaride.core"
    compileSdk = 36
    defaultConfig {
        minSdk = 26
        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
        // empty means "no Mapbox": the apps fall back to the free OpenStreetMap services
        buildConfigField("String", "MAPBOX_TOKEN", "\"$mapboxToken\"")
    }
    testOptions { unitTests.isReturnDefaultValues = true }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions { jvmTarget = "17" }
    buildFeatures { compose = true; buildConfig = true }
}

// api(): the apps use these types directly, so they come through with the module.
dependencies {
    val composeBom = platform("androidx.compose:compose-bom:2025.07.00")
    api(composeBom)
    api("androidx.compose.ui:ui")
    api("androidx.compose.ui:ui-graphics")
    api("androidx.compose.foundation:foundation")
    api("androidx.activity:activity-compose:1.10.1")
    api("androidx.core:core-ktx:1.16.0")
    api("androidx.lifecycle:lifecycle-viewmodel-compose:2.9.2")
    api("androidx.lifecycle:lifecycle-runtime-compose:2.9.2")
    api("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.10.2")
    api("org.jetbrains.kotlinx:kotlinx-serialization-json:1.9.0")
    api("com.squareup.okhttp3:okhttp:4.12.0")
    api("org.osmdroid:osmdroid-android:6.1.20")
    // push notifications; inert in an app built without google-services.json
    api(platform("com.google.firebase:firebase-bom:33.7.0"))
    api("com.google.firebase:firebase-messaging")

    testImplementation("junit:junit:4.13.2")
    testImplementation("org.jetbrains.kotlinx:kotlinx-coroutines-test:1.10.2")
    testImplementation("com.squareup.okhttp3:mockwebserver:4.12.0")
    androidTestImplementation(composeBom)
    androidTestImplementation("androidx.compose.ui:ui-test-junit4")
    androidTestImplementation("androidx.test.ext:junit:1.2.1")
    androidTestImplementation("androidx.test:runner:1.6.2")
    debugImplementation("androidx.compose.ui:ui-test-manifest")
}
