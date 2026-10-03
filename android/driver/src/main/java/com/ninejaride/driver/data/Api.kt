package com.ninejaride.driver.data

import android.content.Context
import com.ninejaride.core.data.ApiClient
import com.ninejaride.core.data.ApiException
import com.ninejaride.core.data.Session
import com.ninejaride.driver.BuildConfig
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.doubleOrNull
import kotlinx.serialization.json.longOrNull
import kotlinx.serialization.json.put
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive

/** An offer from the server: a rider wants a trip and this driver is first in line. */
class ServerOffer(
    val rideId: String, val code: String, val secondsLeft: Int, val category: String, val paymentMethod: String,
    val pickup: com.ninejaride.core.data.MapPoint, val pickupAddress: String?, val dropoff: com.ninejaride.core.data.MapPoint, val dropoffAddress: String?,
    val pickupKm: Double?, val expectedKobo: Long?, val riderName: String, val riderRating: Double?,
)

/** The ride the driver is on, so the app can pick up where it left off. */
class ServerRide(val rideId: String, val code: String, val status: String, val category: String, val paymentMethod: String,
                 val pickup: com.ninejaride.core.data.MapPoint, val pickupAddress: String?, val dropoff: com.ninejaride.core.data.MapPoint, val dropoffAddress: String?,
                 val expectedKobo: Long?, val riderName: String)

class ServerFare(val lines: List<Pair<String, Long>>, val totalKobo: Long, val commissionKobo: Long, val driverEarnKobo: Long, val taxKobo: Long)

class AppConfig(val forceUpdate: Boolean, val updateUrl: String?, val batteryTips: List<BatteryTip>)

/** The calls the driver app makes, on top of the shared client. */
class Api(context: Context) {
    val client = ApiClient(context, BuildConfig.API_BASE_URL, BuildConfig.VERSION_NAME)

    val session: Session? get() = client.session

    suspend fun requestOtp(phone: String, voice: Boolean) = client.requestOtp(phone, voice)

    /** A number with no account throws ApiException(422, "registration_required"); a rider account is turned away. */
    suspend fun verifyOtp(phone: String, code: String): Session {
        val s = client.verifyOtp(phone, code)
        if (s.role != "driver") {
            client.session = null // a rider must not stay signed in inside the driver app
            throw ApiException(403, "not_a_driver", "This number is not registered as a driver.")
        }
        return s
    }

    suspend fun appConfig(): AppConfig {
        val o = client.call("GET", "/app/config")
        val tips = (o["batteryGuidance"] as? JsonArray)?.map { t ->
            val ob = t.jsonObject
            BatteryTip(
                brands = ob["brands"]?.jsonArray?.map { it.jsonPrimitive.content } ?: listOf("all"),
                title = ob["title"]?.jsonPrimitive?.contentOrNull ?: "",
                steps = ob["steps"]?.jsonArray?.map { it.jsonPrimitive.content } ?: emptyList(),
            )
        } ?: emptyList()
        return AppConfig(o["forceUpdate"]?.jsonPrimitive?.booleanOrNull ?: false, o["updateUrl"]?.jsonPrimitive?.contentOrNull, tips)
    }

    suspend fun reportProblem(key: String, topic: String, message: String) {
        client.call("POST", "/support/tickets", kotlinx.serialization.json.buildJsonObject { put("topic", kotlinx.serialization.json.JsonPrimitive(topic)); put("message", kotlinx.serialization.json.JsonPrimitive(message)) }.toString(), auth = true, headers = mapOf("Idempotency-Key" to key))
    }

    suspend fun myReports(): List<com.ninejaride.core.ui.components.MyReport> = client.call("GET", "/support/tickets", auth = true)["items"]?.jsonArray?.map {
        val o = it.jsonObject
        com.ninejaride.core.ui.components.MyReport(o["code"]?.jsonPrimitive?.contentOrNull ?: "", o["topic"]?.jsonPrimitive?.contentOrNull ?: "", o["message"]?.jsonPrimitive?.contentOrNull ?: "", o["status"]?.jsonPrimitive?.contentOrNull ?: "OPEN", o["resolution"]?.jsonPrimitive?.contentOrNull)
    } ?: emptyList()

    private fun JsonObject.str(k: String) = (this[k] as? JsonPrimitive)?.takeIf { it !is JsonNull }?.contentOrNull
    private fun JsonObject.lng(k: String) = (this[k] as? JsonPrimitive)?.longOrNull
    private fun JsonObject.dbl(k: String) = (this[k] as? JsonPrimitive)?.doubleOrNull
    private fun JsonObject.obj(k: String) = this[k] as? JsonObject
    private fun pt(o: JsonObject?) = com.ninejaride.core.data.MapPoint(o?.dbl("lat") ?: 0.0, o?.dbl("lng") ?: 0.0)

    suspend fun offer(): ServerOffer? {
        val o = client.call("GET", "/driver/offer", auth = true).obj("offer") ?: return null
        return ServerOffer(
            o.str("rideId")!!, o.str("code") ?: "", (o.lng("secondsLeft") ?: 0).toInt(), o.str("category") ?: "Ride", o.str("paymentMethod") ?: "cash",
            pt(o.obj("pickup")), o.obj("pickup")?.str("address"), pt(o.obj("dropoff")), o.obj("dropoff")?.str("address"),
            o.dbl("pickupKm"), o.obj("estimate")?.lng("expectedKobo"), o.obj("rider")?.str("name") ?: "Rider", o.obj("rider")?.dbl("rating"),
        )
    }

    suspend fun activeRide(): ServerRide? {
        val o = client.call("GET", "/driver/rides/active", auth = true).obj("ride") ?: return null
        return ServerRide(
            o.str("rideId")!!, o.str("code") ?: "", o.str("status") ?: "", o.str("category") ?: "Ride", o.str("paymentMethod") ?: "cash",
            pt(o.obj("pickup")), o.obj("pickup")?.str("address"), pt(o.obj("dropoff")), o.obj("dropoff")?.str("address"), o.lng("expectedKobo"), o.obj("rider")?.str("name") ?: "Rider",
        )
    }

    /** True when the ride is now this driver's; false when it was taken, timed out or cancelled. */
    suspend fun accept(rideId: String): Boolean = client.call("POST", "/driver/rides/$rideId/accept", "{}", auth = true)["ok"]?.jsonPrimitive?.booleanOrNull == true
    suspend fun decline(rideId: String) { client.call("POST", "/driver/rides/$rideId/decline", "{}", auth = true) }
    suspend fun arrive(rideId: String) { client.call("POST", "/driver/rides/$rideId/arrive", "{}", auth = true) }
    suspend fun startTrip(rideId: String) { client.call("POST", "/driver/rides/$rideId/start", "{}", auth = true) }
    suspend fun cancelRide(rideId: String, reason: String?) {
        client.call("POST", "/driver/rides/$rideId/cancel", buildJsonObject { reason?.let { put("reason", it) } }.toString(), auth = true)
    }

    suspend fun completeTrip(rideId: String, distanceM: Int, durationS: Int, waitingS: Int): ServerFare {
        val o = client.call("POST", "/driver/rides/$rideId/complete", buildJsonObject { put("distanceM", distanceM); put("durationS", durationS); put("waitingS", waitingS) }.toString(), auth = true)
        val lines = o["lines"]?.jsonArray?.map { val l = it.jsonObject; (l.str("label") ?: "") to (l.lng("amountKobo") ?: 0L) } ?: emptyList()
        return ServerFare(lines, o.lng("totalKobo") ?: 0, o.lng("commissionKobo") ?: 0, o.lng("driverEarnKobo") ?: 0, o.lng("taxKobo") ?: 0)
    }

    suspend fun sos(key: String, at: com.ninejaride.core.data.MapPoint?) {
        client.call("POST", "/sos", buildJsonObject { at?.let { put("location", buildJsonObject { put("lat", it.lat); put("lng", it.lng) }) } }.toString(), auth = true, headers = mapOf("Idempotency-Key" to key))
    }

    suspend fun logout() = client.logout()
}
