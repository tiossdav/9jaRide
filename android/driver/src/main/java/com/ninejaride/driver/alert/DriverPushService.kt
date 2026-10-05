package com.ninejaride.driver.alert

import android.content.Context
import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage
import com.ninejaride.core.data.Push
import com.ninejaride.driver.MainActivity

/**
 * Messages from the server, delivered even when the app is closed. A new booking rings the loud booking alert (only while
 * the driver is online); anything else (approval, changes needed) is an ordinary notification.
 */
class DriverPushService : FirebaseMessagingService() {
    override fun onMessageReceived(message: RemoteMessage) {
        val d = message.data
        when (d["type"]) {
            "offer" -> {
                val online = getSharedPreferences("driver_state", Context.MODE_PRIVATE).getBoolean("online", false)
                if (!online) return // went offline since the offer was made: say nothing
                BookingAlert.start(this, d["rideId"] ?: return, d["riderName"] ?: "A rider", d["pickup"] ?: "the pickup point", d["seconds"]?.toIntOrNull() ?: 15)
            }
            else -> Push.show(this, "driver_updates", "Account updates", d["title"] ?: "9jaRide Pro", d["body"] ?: "", MainActivity::class.java)
        }
    }

    // The new token is sent the next time the app starts while signed in.
    override fun onNewToken(token: String) {}
}
