package com.ninejaride.core.location

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.location.Location
import android.location.LocationListener
import android.location.LocationManager
import android.os.Bundle
import android.os.Looper
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.core.content.ContextCompat
import com.ninejaride.core.data.MapPoint

/**
 * Follows the phone's position while the app is on screen, for maps. (The driver app's background sharing is a
 * separate foreground service.) Does nothing until location permission has been given.
 */
class DeviceLocation(private val context: Context) {
    /** When the reading now in [point] was taken (phone clock), the provider that gave it, and how good it was. Used to decide whether a later one replaces it. */
    private var fix: Reading? = null

    /** Where the phone is, or null until the first reading. Compose redraws when it changes. */
    var point by mutableStateOf<MapPoint?>(null)
        private set
    var accuracyM by mutableStateOf<Float?>(null)
        private set

    private var listener: LocationListener? = null

    fun hasPermission() = listOf(Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION)
        .any { ContextCompat.checkSelfPermission(context, it) == PackageManager.PERMISSION_GRANTED }

    fun start() {
        if (listener != null || !hasPermission()) return
        val lm = context.getSystemService(LocationManager::class.java) ?: return
        // Written out in full: on Android 8 to 10 the interface's extra methods are not defaults, so a lambda would crash.
        val l = object : LocationListener {
            override fun onLocationChanged(location: Location) = accept(Reading(location.latitude, location.longitude, if (location.hasAccuracy()) location.accuracy else null, location.time, location.provider == LocationManager.GPS_PROVIDER), System.currentTimeMillis())
            override fun onProviderEnabled(provider: String) {}
            override fun onProviderDisabled(provider: String) {}
            @Deprecated("Deprecated in Java")
            override fun onStatusChanged(provider: String?, status: Int, extras: Bundle?) {}
        }
        try {
            for (provider in listOf(LocationManager.GPS_PROVIDER, LocationManager.NETWORK_PROVIDER)) {
                if (!lm.isProviderEnabled(provider)) continue
                // A remembered position is only a starting point, and only if it is recent: one from an hour ago is where the phone WAS.
                lm.getLastKnownLocation(provider)?.let {
                    if (point == null && System.currentTimeMillis() - it.time <= MAX_REMEMBERED_AGE_MS)
                        accept(Reading(it.latitude, it.longitude, if (it.hasAccuracy()) it.accuracy else null, it.time, provider == LocationManager.GPS_PROVIDER), System.currentTimeMillis())
                }
                // The rider's pickup depends on this, and the app only listens while it is on screen: a position every 3 s (GPS) or 15 s (network),
                // and after the phone has moved 5 m (GPS) or 50 m (network).
                lm.requestLocationUpdates(provider, if (provider == LocationManager.GPS_PROVIDER) 3_000L else 15_000L, if (provider == LocationManager.GPS_PROVIDER) 5f else 50f, l, Looper.getMainLooper())
            }
            listener = l
        } catch (e: SecurityException) {
            // Permission was withdrawn between the check and the call: stay on the default view.
        }
    }

    private fun accept(candidate: Reading, now: Long) {
        if (!shouldReplace(fix, candidate, now)) return
        fix = candidate
        point = MapPoint(candidate.lat, candidate.lng)
        accuracyM = candidate.accuracyM
    }

    fun stop() {
        listener?.let { context.getSystemService(LocationManager::class.java)?.removeUpdates(it) }
        listener = null
    }
}

/** One position reading and how trustworthy it is. */
data class Reading(val lat: Double, val lng: Double, val accuracyM: Float?, val takenAtMs: Long, val fromGps: Boolean)

/** A remembered position older than this is not shown as "where you are". */
const val MAX_REMEMBERED_AGE_MS = 5 * 60_000L
private const val GPS_PREFERRED_MS = 20_000L

/**
 * Whether a new reading should replace the current one. The phone offers GPS and network readings; a network reading can be hundreds of metres
 * or kilometres off, so it must not overwrite a good GPS reading that is still fresh. Otherwise: the first reading is taken; a reading that is
 * clearly older than the current one is ignored; GPS replaces network; a network reading replaces a GPS one only once that has gone stale; and
 * between two of the same kind the one that is newer and not less accurate wins.
 */
fun shouldReplace(current: Reading?, candidate: Reading, now: Long): Boolean {
    if (!candidate.lat.isFinite() || !candidate.lng.isFinite() || Math.abs(candidate.lat) > 90 || Math.abs(candidate.lng) > 180) return false
    if (current == null) return true
    if (candidate.takenAtMs < current.takenAtMs) return false
    val currentFresh = now - current.takenAtMs <= GPS_PREFERRED_MS
    if (current.fromGps && !candidate.fromGps) return !currentFresh
    if (!current.fromGps && candidate.fromGps) return true
    val better = (candidate.accuracyM ?: Float.MAX_VALUE) <= (current.accuracyM ?: Float.MAX_VALUE)
    return better || !currentFresh
}
