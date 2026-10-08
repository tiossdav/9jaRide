plugins {
    id("com.android.application") version "8.11.1" apply false
    id("org.jetbrains.kotlin.android") version "2.2.0" apply false
    id("org.jetbrains.kotlin.plugin.compose") version "2.2.0" apply false
    id("org.jetbrains.kotlin.plugin.serialization") version "2.2.0" apply false
    id("com.google.gms.google-services") version "4.4.2" apply false
}

// The Google Maps key for drawing the map comes from -PgoogleMapsKey=... or android/local.properties, never from a file in git.
// (Place search, addresses and routes use a separate key that lives on the server.) Empty means the map shows a "not set up" message.
extra["googleMapsKey"] = (project.findProperty("googleMapsKey") as String?)
    ?: java.util.Properties().also { p -> file("local.properties").takeIf { it.exists() }?.inputStream()?.use { p.load(it) } }.getProperty("googleMapsKey", "")
