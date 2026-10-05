package com.ninejaride.rider

import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage
import com.ninejaride.core.data.Push

/** Trip updates from the server (driver on the way, arrived, trip over...), shown even when the app is closed. */
class RiderPushService : FirebaseMessagingService() {
    override fun onMessageReceived(message: RemoteMessage) {
        val d = message.data
        Push.show(this, "trip_updates", "Trip updates", d["title"] ?: "9jaRide", d["body"] ?: "", MainActivity::class.java, id = (d["rideId"]?.hashCode() ?: 0) and 0x7fffffff)
    }

    // The new token is sent the next time the app starts while signed in.
    override fun onNewToken(token: String) {}
}
