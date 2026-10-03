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
            override fun onLocationChanged(location: Location) {
                point = MapPoint(location.latitude, location.longitude)
                accuracyM = if (location.hasAccuracy()) location.accuracy else null
            }
            override fun onProviderEnabled(provider: String) {}
            override fun onProviderDisabled(provider: String) {}
            @Deprecated("Deprecated in Java")
            override fun onStatusChanged(provider: String?, status: Int, extras: Bundle?) {}
        }
        try {
            for (provider in listOf(LocationManager.GPS_PROVIDER, LocationManager.NETWORK_PROVIDER)) {
                if (!lm.isProviderEnabled(provider)) continue
                lm.getLastKnownLocation(provider)?.let { if (point == null) point = MapPoint(it.latitude, it.longitude) }
                lm.requestLocationUpdates(provider, 5_000L, 10f, l, Looper.getMainLooper())
            }
            listener = l
        } catch (e: SecurityException) {
            // Permission was withdrawn between the check and the call: stay on the default view.
        }
    }

    fun stop() {
        listener?.let { context.getSystemService(LocationManager::class.java)?.removeUpdates(it) }
        listener = null
    }
}
