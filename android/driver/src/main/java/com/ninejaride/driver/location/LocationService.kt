package com.ninejaride.driver.location

import android.Manifest
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.content.pm.ServiceInfo
import android.location.Location
import android.location.LocationListener
import android.location.LocationManager
import android.os.Build
import android.os.Bundle
import android.os.IBinder
import android.os.Looper
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.core.app.NotificationCompat
import androidx.core.content.ContextCompat
import com.ninejaride.core.data.ApiClient
import com.ninejaride.core.data.ApiException
import com.ninejaride.driver.BuildConfig
import com.ninejaride.driver.MainActivity
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

/** What the driver can be told about location sharing. Read by the Home screen. */
object LocationStatus {
    /** True while the service is running and following the phone. */
    var running by mutableStateOf(false)
    /** Readings taken but not yet accepted by the server. */
    var pending by mutableIntStateOf(0)
    var lastUploadAtMillis by mutableStateOf<Long?>(null)
    /** A plain-words reason sharing is not working right now, or null when all is well. */
    var problem by mutableStateOf<String?>(null)
    /** The newest good position, so the screens need not ask the phone for one of their own while the service is running. */
    var last by mutableStateOf<com.ninejaride.core.data.MapPoint?>(null)
}

/**
 * Keeps sharing the driver's position while they are online, with the screen off or the app in the background.
 *
 * It runs as a foreground service (the notification is required by Android and tells the driver it is on). Each reading
 * goes into a file-backed queue; every 20 seconds, or as soon as the phone is back online, up to 100 readings are sent
 * to POST /driver/location/batch and removed only once the server accepts them.
 */
class LocationService : Service() {
    private lateinit var queue: LocationQueue
    private lateinit var api: ApiClient
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
    private var uploadJob: Job? = null
    private var offerJob: Job? = null
    private var listener: LocationListener? = null
    private var lastFix: Long = 0
    /** Waiting for a booking (false) or on a trip (true). A trip needs a fast, exact position; waiting does not. */
    @Volatile private var tripMode = false
    private var lastGood: Fix? = null

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        queue = LocationQueue(this)
        api = ApiClient(this, BuildConfig.API_BASE_URL, BuildConfig.VERSION_NAME)
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        // Android restarts a killed service with a null intent; only carry on if the driver is still meant to be online.
        if (intent?.action == ACTION_STOP) {
            stopForeground(STOP_FOREGROUND_REMOVE)
            stopSelf()
            return START_NOT_STICKY
        }
        if (intent?.action == ACTION_MODE) {
            val wasTrip = tripMode
            tripMode = isTrip(this)
            if (tripMode != wasTrip && listener != null) restartListening()
            return START_STICKY
        }
        // Started with startForegroundService, so Android requires the notification within seconds, even if we then stop.
        startInForeground()
        if (!isOnline(this)) {
            stopForeground(STOP_FOREGROUND_REMOVE)
            stopSelf()
            return START_NOT_STICKY
        }
        if (!hasLocationPermission(this)) {
            LocationStatus.problem = "Location permission is off. Allow it in the phone settings."
            return START_STICKY
        }
        tripMode = isTrip(this)
        startListening()
        if (uploadJob == null) uploadJob = scope.launch { uploadLoop() }
        if (offerJob == null) offerJob = scope.launch { watchOffers() }
        LocationStatus.running = true
        return START_STICKY
    }

    private fun startInForeground() {
        val manager = getSystemService(NotificationManager::class.java)
        manager.createNotificationChannel(NotificationChannel(CHANNEL, "Online status", NotificationManager.IMPORTANCE_LOW).apply {
            description = "Shown while you are online and sharing your location"
            setShowBadge(false)
        })
        val open = PendingIntent.getActivity(this, 0, Intent(this, MainActivity::class.java), PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
        val notification: Notification = NotificationCompat.Builder(this, CHANNEL)
            .setSmallIcon(android.R.drawable.ic_menu_mylocation)
            .setContentTitle("You're online")
            .setContentText("9jaRide Pro is sharing your location to find you trips")
            .setOngoing(true)
            .setContentIntent(open)
            .setCategory(NotificationCompat.CATEGORY_SERVICE)
            .build()
        if (Build.VERSION.SDK_INT >= 29) startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION)
        else startForeground(NOTIFICATION_ID, notification)
    }

    private fun startListening() {
        if (listener != null) return
        val lm = getSystemService(LocationManager::class.java) ?: return
        val l = object : LocationListener {
            override fun onLocationChanged(location: Location) = onFix(location)
            override fun onProviderEnabled(provider: String) { if (provider == LocationManager.GPS_PROVIDER) LocationStatus.problem = null }
            override fun onProviderDisabled(provider: String) {
                if (provider == LocationManager.GPS_PROVIDER) LocationStatus.problem = "GPS is off. Turn on location to receive trips."
            }
            @Deprecated("Deprecated in Java")
            override fun onStatusChanged(provider: String?, status: Int, extras: Bundle?) {}
        }
        try {
            if (!lm.isProviderEnabled(LocationManager.GPS_PROVIDER)) LocationStatus.problem = "GPS is off. Turn on location to receive trips."
            // How often the phone is asked depends on what the driver is doing. Waiting for a booking, the GPS is asked every
            // 10 s and only reports when the car has moved 15 m (a parked car costs almost nothing; the upload loop keeps it
            // "online" with a heartbeat). On a trip the rider is watching, so it is every 3 s. The network position is the
            // fallback when there is no view of the sky, and is asked far less often.
            val gps = if (tripMode) Triple(3_000L, 0f, true) else Triple(10_000L, 15f, true)
            val net = if (tripMode) Triple(15_000L, 0f, true) else Triple(30_000L, 50f, true)
            if (lm.allProviders.contains(LocationManager.GPS_PROVIDER)) lm.requestLocationUpdates(LocationManager.GPS_PROVIDER, gps.first, gps.second, l, Looper.getMainLooper())
            if (lm.allProviders.contains(LocationManager.NETWORK_PROVIDER)) lm.requestLocationUpdates(LocationManager.NETWORK_PROVIDER, net.first, net.second, l, Looper.getMainLooper())
            listener = l
        } catch (e: SecurityException) {
            LocationStatus.problem = "Location permission is off. Allow it in the phone settings."
        }
    }

    private fun restartListening() {
        listener?.let { getSystemService(LocationManager::class.java)?.removeUpdates(it) }
        listener = null
        startListening()
    }

    private fun onFix(loc: Location) {
        // The network provider is much less exact: ignore it when the GPS spoke within the last 15 seconds.
        val now = System.currentTimeMillis()
        if (loc.provider == LocationManager.NETWORK_PROVIDER && now - lastFix < 15_000) return
        if (loc.hasAccuracy() && loc.accuracy > MAX_ACCURACY_M) return
        if (loc.provider == LocationManager.GPS_PROVIDER) lastFix = now
        val mock = if (Build.VERSION.SDK_INT >= 31) loc.isMock else @Suppress("DEPRECATION") loc.isFromMockProvider
        val fix = Fix(
            lat = loc.latitude, lng = loc.longitude,
            accuracyM = if (loc.hasAccuracy()) loc.accuracy else null,
            speedKmh = if (loc.hasSpeed()) loc.speed * 3.6f else null,
            mock = mock,
            recordedAtMillis = if (loc.time > 0) loc.time else now,
        )
        if (!mock) { lastGood = fix; LocationStatus.last = com.ninejaride.core.data.MapPoint(fix.lat, fix.lng) }
        queue.add(fix)
        LocationStatus.pending = queue.size()
    }

    /**
     * Waits for a booking while the driver is online. The server holds each request open until an offer arrives (or 20 seconds
     * pass), so the phone makes about three requests a minute instead of twenty, and still hears of a booking at once. This runs
     * in the foreground service, so it carries on with the app behind another app or the screen off; the booking alert rings.
     */
    private suspend fun watchOffers() {
        while (true) {
            if (tripMode) { delay(10_000); continue } // on a trip there are no new offers to wait for
            try {
                val started = System.currentTimeMillis()
                val offer = com.ninejaride.driver.data.parseOffer(api.call("GET", "/driver/offer?wait=20", auth = true, patient = true))
                com.ninejaride.driver.alert.OfferFeed.offer.value = offer
                if (offer != null) {
                    com.ninejaride.driver.alert.BookingAlert.start(this, offer.rideId, offer.riderName, offer.pickupAddress ?: "the pickup point", offer.secondsLeft)
                    delay(2_000) // an offer is there already, so the server answers at once: look again in a moment, not in a tight loop
                } else {
                    com.ninejaride.driver.alert.BookingAlert.stop(this)
                    if (System.currentTimeMillis() - started < 1_000) delay(2_000) // the server answered instantly with nothing: do not spin
                }
            } catch (e: Exception) {
                delay(8_000) // offline for a moment: try again shortly
            }
        }
    }

    /** Sends what is queued. Never gives up: a network error just waits and tries again. */
    private suspend fun uploadLoop() {
        var failures = 0
        while (true) {
            val every = if (tripMode) TRIP_UPLOAD_EVERY_MS else IDLE_UPLOAD_EVERY_MS
            delay(if (failures == 0) every else minOf(every * (1L shl minOf(failures, 3)), 120_000L))
            heartbeat()
            try {
                flush()
                failures = 0
            } catch (e: ApiException) {
                failures++
                LocationStatus.problem = when {
                    e.isNetwork -> "No connection. Your location will be sent when you are back online."
                    e.status == 401 -> "Please sign in again."
                    e.status == 403 -> "This account cannot go online."
                    e.code == "no_active_vehicle" -> "You need an approved vehicle to receive trips."
                    else -> e.message
                }
            }
        }
    }

    /**
     * A car parked at the kerb reports nothing new, but the server must still see the driver as online. When nothing is
     * queued and the last good position is fresh enough to trust, it is sent again with the time now. After three minutes
     * without a real fix it stops, so a driver whose GPS has died does not look online.
     */
    private fun heartbeat() {
        val g = lastGood ?: return
        if (queue.size() > 0) return
        val now = System.currentTimeMillis()
        if (now - g.recordedAtMillis > 180_000L) return
        queue.add(g.copy(recordedAtMillis = now))
        LocationStatus.pending = queue.size()
    }

    private suspend fun flush() {
        val cutoff = System.currentTimeMillis() - LocationQueue.MAX_AGE_MILLIS + 60_000
        while (true) {
            val lines = queue.peek(BATCH)
            if (lines.isEmpty()) break
            // Readings the server would refuse for being over 24 hours old are not worth sending.
            val fresh = lines.filter { (LocationQueue.recordedAt(it) ?: 0) >= cutoff }
            if (fresh.isEmpty()) { queue.drop(lines.size); continue }
            val body = "{\"points\":[" + fresh.joinToString(",") + "]}"
            try {
                api.call("POST", "/driver/location/batch", body, auth = true)
            } catch (e: ApiException) {
                // A rejected batch (400) would block everything behind it forever, so it is dropped. Anything else is retried.
                if (e.status == 400) { queue.drop(lines.size); continue }
                throw e
            }
            queue.drop(lines.size)
            LocationStatus.lastUploadAtMillis = System.currentTimeMillis()
            LocationStatus.problem = null
            LocationStatus.pending = queue.size()
            if (lines.size < BATCH) break
        }
        LocationStatus.pending = queue.size()
    }

    override fun onDestroy() {
        listener?.let { getSystemService(LocationManager::class.java)?.removeUpdates(it) }
        listener = null
        scope.cancel()
        com.ninejaride.driver.alert.BookingAlert.stop(this)
        LocationStatus.running = false
        super.onDestroy()
    }

    companion object {
        private const val CHANNEL = "online"
        private const val NOTIFICATION_ID = 41
        private const val ACTION_STOP = "com.ninejaride.driver.STOP_LOCATION"
        private const val IDLE_UPLOAD_EVERY_MS = 15_000L // waiting for a booking: the server counts a driver online for 45 s after a report
        private const val TRIP_UPLOAD_EVERY_MS = 5_000L  // on a trip: the rider is watching the car move
        private const val ACTION_MODE = "com.ninejaride.driver.LOCATION_MODE"
        private const val BATCH = 100
        private const val MAX_ACCURACY_M = 100f
        private const val PREFS = "driver_state"

        fun hasLocationPermission(context: Context) =
            listOf(Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION)
                .any { ContextCompat.checkSelfPermission(context, it) == PackageManager.PERMISSION_GRANTED }

        fun isTrip(context: Context) = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getBoolean("on_trip", false)

        /** Tells the service whether the driver is on a trip (fast, exact position) or waiting (slow, cheap). */
        fun setTrip(context: Context, on: Boolean) {
            if (isTrip(context) == on) return
            context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putBoolean("on_trip", on).apply()
            if (isOnline(context)) context.startService(Intent(context, LocationService::class.java).setAction(ACTION_MODE))
        }

        fun isOnline(context: Context) = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getBoolean("online", false)

        /** Remembers that the driver is online, then starts sharing. Returns false if location permission is missing. */
        fun start(context: Context): Boolean {
            if (!hasLocationPermission(context)) return false
            context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putBoolean("online", true).apply()
            ContextCompat.startForegroundService(context, Intent(context, LocationService::class.java))
            return true
        }

        fun stop(context: Context) {
            context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putBoolean("online", false).apply()
            context.startService(Intent(context, LocationService::class.java).setAction(ACTION_STOP))
            LocationStatus.problem = null
        }
    }
}
