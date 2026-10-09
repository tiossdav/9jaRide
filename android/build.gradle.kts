plugins {
    id("com.android.application") version "8.11.1" apply false
    id("org.jetbrains.kotlin.android") version "2.2.0" apply false
    id("org.jetbrains.kotlin.plugin.compose") version "2.2.0" apply false
    id("org.jetbrains.kotlin.plugin.serialization") version "2.2.0" apply false
    id("com.google.gms.google-services") version "4.4.2" apply false
}

// The Mapbox token the apps draw the map with: -PmapboxToken=... or android/local.properties, never a file in git. It is a PUBLIC token
// (starts with pk.), restricted on mapbox.com to this app's id. Place search, addresses and routes use a separate token that lives on the server.
// Empty means the map falls back to OpenStreetMap's own pictures.
extra["mapboxToken"] = (project.findProperty("mapboxToken") as String?)
    ?: java.util.Properties().also { p -> file("local.properties").takeIf { it.exists() }?.inputStream()?.use { p.load(it) } }.getProperty("mapboxToken", "")
