package com.ninejaride.driver.alert

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.media.AudioAttributes
import android.media.AudioManager
import android.media.MediaPlayer
import android.net.Uri
import android.os.Build
import android.os.VibrationEffect
import android.os.Vibrator
import android.os.VibratorManager
import androidx.core.app.NotificationCompat
import com.ninejaride.driver.MainActivity
import com.ninejaride.driver.R

/**
 * The loud alert for a new booking. It does two things together, because each covers what the other cannot:
 *  - a high-priority notification with a full-screen intent, which Android allows to light up the screen and open the app
 *    over the lock screen or another app, and which carries the booking sound on a channel of its own;
 *  - a looping ringtone on the alarm volume, which keeps sounding until the driver answers or the offer runs out.
 *
 * Only Android's own notification channel settings decide whether a sound plays in Do Not Disturb, so the app also asks
 * the driver to allow it (see [needsDndAccess]). Call [start] again for the same booking and nothing doubles up.
 */
object BookingAlert {
    private const val CHANNEL = "booking_alerts_v1"
    private const val NOTIFICATION_ID = 9001

    private var player: MediaPlayer? = null
    private var ringingFor: String? = null
    private var savedVolume: Int? = null

    private fun ensureChannel(context: Context) {
        val manager = context.getSystemService(NotificationManager::class.java)
        if (manager.getNotificationChannel(CHANNEL) != null) return
        val sound = Uri.parse("android.resource://${context.packageName}/${R.raw.booking_ring}")
        val attrs = AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_ALARM).setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION).build()
        manager.createNotificationChannel(NotificationChannel(CHANNEL, "New bookings", NotificationManager.IMPORTANCE_HIGH).apply {
            description = "A loud alert when a rider asks for a trip"
            setSound(sound, attrs)
            enableVibration(true)
            vibrationPattern = longArrayOf(0, 600, 300, 600, 300, 600)
            enableLights(true)
            lockscreenVisibility = Notification.VISIBILITY_PUBLIC
            setBypassDnd(true) // only takes effect once the driver has allowed Do Not Disturb access
            setShowBadge(true)
        })
    }

    /** Starts (or keeps) the alert for this booking. [seconds] is how long the offer lasts, so the alert ends with it. */
    fun start(context: Context, rideId: String, riderName: String, pickup: String, seconds: Int) {
        val app = context.applicationContext
        if (ringingFor == rideId) return
        stop(app)
        ringingFor = rideId
        ensureChannel(app)
        val open = PendingIntent.getActivity(
            app, 1, Intent(app, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )
        val note = NotificationCompat.Builder(app, CHANNEL)
            .setSmallIcon(android.R.drawable.ic_menu_directions)
            .setContentTitle("New booking")
            .setContentText("$riderName is waiting at $pickup")
            .setPriority(NotificationCompat.PRIORITY_MAX)
            .setCategory(NotificationCompat.CATEGORY_CALL)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setFullScreenIntent(open, true)
            .setContentIntent(open)
            .setOngoing(true)
            .setAutoCancel(false)
            .setTimeoutAfter(seconds.coerceAtLeast(5) * 1000L)
            .build()
        runCatching { app.getSystemService(NotificationManager::class.java).notify(NOTIFICATION_ID, note) }
        ring(app)
        vibrate(app, true)
    }

    /** Ends the alert: the driver answered, the offer ran out, or the ride was taken. Safe to call at any time. */
    fun stop(context: Context) {
        val app = context.applicationContext
        ringingFor = null
        player?.let { runCatching { it.stop() }; it.release() }
        player = null
        savedVolume?.let { v -> runCatching { app.getSystemService(AudioManager::class.java).setStreamVolume(AudioManager.STREAM_ALARM, v, 0) } }
        savedVolume = null
        vibrate(app, false)
        runCatching { app.getSystemService(NotificationManager::class.java).cancel(NOTIFICATION_ID) }
    }

    private fun ring(context: Context) {
        runCatching {
            val audio = context.getSystemService(AudioManager::class.java)
            // The alarm volume is raised for the length of the alert, then put back as the driver had it.
            savedVolume = audio.getStreamVolume(AudioManager.STREAM_ALARM)
            audio.setStreamVolume(AudioManager.STREAM_ALARM, audio.getStreamMaxVolume(AudioManager.STREAM_ALARM), 0)
            player = MediaPlayer().apply {
                setAudioAttributes(AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_ALARM).setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION).build())
                context.resources.openRawResourceFd(R.raw.booking_ring).use { setDataSource(it.fileDescriptor, it.startOffset, it.length) }
                isLooping = true
                prepare()
                start()
            }
        }
    }

    private fun vibrate(context: Context, on: Boolean) {
        runCatching {
            val vibrator: Vibrator = if (Build.VERSION.SDK_INT >= 31) context.getSystemService(VibratorManager::class.java).defaultVibrator else @Suppress("DEPRECATION") context.getSystemService(Vibrator::class.java)
            if (on) vibrator.vibrate(VibrationEffect.createWaveform(longArrayOf(0, 600, 300, 600, 900), 0), AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_ALARM).build())
            else vibrator.cancel()
        }
    }

    // ---- what the driver has allowed, for the checks before going online

    fun notificationsAllowed(context: Context): Boolean = context.getSystemService(NotificationManager::class.java).areNotificationsEnabled()

    fun fullScreenAllowed(context: Context): Boolean = Build.VERSION.SDK_INT < 34 || context.getSystemService(NotificationManager::class.java).canUseFullScreenIntent()

    fun needsDndAccess(context: Context): Boolean = !context.getSystemService(NotificationManager::class.java).isNotificationPolicyAccessGranted
}
