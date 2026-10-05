package com.ninejaride.core.data

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import androidx.core.app.NotificationCompat
import com.google.firebase.FirebaseApp
import com.google.firebase.messaging.FirebaseMessaging
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import kotlin.coroutines.resume

/**
 * Push notifications (Firebase Cloud Messaging). A build without google-services.json has no Firebase, and then every
 * function here quietly does nothing, so the apps work the same as before.
 */
object Push {
    fun available(context: Context): Boolean = runCatching { FirebaseApp.getApps(context).isNotEmpty() }.getOrDefault(false)

    /** Tells the server where to reach this phone. Call after signing in (and at start-up while signed in). */
    suspend fun register(context: Context, client: ApiClient) {
        if (!available(context)) return
        val token = suspendCancellableCoroutine<String?> { c ->
            FirebaseMessaging.getInstance().token.addOnCompleteListener { t -> if (c.isActive) c.resume(if (t.isSuccessful) t.result else null) }
        } ?: return
        runCatching { client.call("POST", "/me/push-token", buildJsonObject { put("token", token) }.toString(), auth = true) }
    }

    /** Shows an ordinary notification that opens [activity] when tapped. */
    fun show(context: Context, channelId: String, channelName: String, title: String, body: String, activity: Class<*>, id: Int = (System.currentTimeMillis() % 100_000).toInt()) {
        val manager = context.getSystemService(NotificationManager::class.java)
        if (manager.getNotificationChannel(channelId) == null) {
            manager.createNotificationChannel(NotificationChannel(channelId, channelName, NotificationManager.IMPORTANCE_HIGH))
        }
        val open = PendingIntent.getActivity(
            context, id, Intent(context, activity).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )
        val note = NotificationCompat.Builder(context, channelId)
            .setSmallIcon(android.R.drawable.ic_dialog_info)
            .setContentTitle(title).setContentText(body)
            .setStyle(NotificationCompat.BigTextStyle().bigText(body))
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setContentIntent(open).setAutoCancel(true)
            .build()
        runCatching { manager.notify(id, note) }
    }
}
