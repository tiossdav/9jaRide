package com.ninejaride.rider.data

import com.ninejaride.core.data.ApiClient
import com.ninejaride.core.data.MapPoint
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.doubleOrNull
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.longOrNull
import kotlinx.serialization.json.put
import java.util.UUID

// ---------------------------------------------------------------- what the screens work with

data class Profile(val id: String, val name: String, val phone: String)

data class Quote(val id: String, val expectedKobo: Long, val lowKobo: Long, val highKobo: Long)

data class Wallet(val balanceKobo: Long, val availableKobo: Long)

data class WalletTx(val kind: String, val memo: String?, val at: String, val amountKobo: Long)

data class DriverView(val name: String, val rating: Double?, val phone: String?, val make: String, val colour: String, val plate: String)

data class RideView(
    val id: String,
    val shortCode: String,
    val status: String,
    val paymentStatus: String,
    val category: String,
    val paymentMethod: String,
    val pickup: MapPoint,
    val dropoff: MapPoint,
    val pickupAddress: String?,
    val dropoffAddress: String?,
    val estimate: Pair<Long, Long>?,
    val fareKobo: Long?,
    /** Taken off by a promo code. Zero when there is none. */
    val discountKobo: Long,
    val payableKobo: Long?,
    val promoCode: String?,
    val distanceM: Int?,
    val durationS: Int?,
    val myRating: Int?,
    val scheduledFor: String?,
    val statusChangedAt: String?,
    val createdAt: String?,
    val cancelReason: String?,
    val driver: DriverView?,
    /** Distance the driver really drove (from their GPS), apart for the way to the pickup and the trip. Final once the trip is done. */
    val pickupTravelledM: Int = 0,
    val tripTravelledM: Int = 0,
    /** Changes of drop-off made during this trip, newest first. [dropoff] is always the current one; the pickup never changes. */
    val destinationChanges: List<com.ninejaride.core.data.DestinationChange> = emptyList(),
    /** Changes whenever the drop-off changes, so the held request knows to answer. */
    val destinationVersion: String = "",
    /** True once the driver has arrived and until the trip ends: the rider may edit the drop-off. */
    val canEditDestination: Boolean = false,
)

/** One card of the "For you" strip. */
class HomeCard(val id: String, val kind: String, val title: String, val body: String)

/** Where the driver is, when that was reported, and how far they have driven. */
class CarFix(val point: MapPoint, val atMs: Long, val pickupTravelledM: Int, val tripTravelledM: Int)

data class RideListItem(
    val id: String,
    val shortCode: String,
    val status: String,
    val paymentMethod: String,
    val category: String,
    val createdAt: String,
    val scheduledFor: String?,
    val pickupAddress: String?,
    val dropoffAddress: String?,
    val fareKobo: Long?,
    val estimate: Pair<Long, Long>?,
    /** Where the trip went, so it can be offered again as a recent place. */
    val dropoff: MapPoint? = null,
)

data class ReceiptLine(val kind: String, val label: String, val amountKobo: Long)
data class Receipt(val lines: List<ReceiptLine>, val totalKobo: Long, val discountKobo: Long, val promoCode: String?, val payableKobo: Long)

data class Category(val code: String, val label: String)
data class PromoResult(val code: String, val description: String, val discountKobo: Long, val expectedKobo: Long, val payKobo: Long)

data class ScheduledRide(val rideId: String, val status: String, val scheduledFor: String)
data class ScheduleView(
    val id: String,
    val category: String,
    val paymentMethod: String,
    val repeat: String,
    val status: String,
    val pickupAddress: String?,
    val dropoffAddress: String?,
    val distanceM: Int,
    val durationS: Int,
    val rides: List<ScheduledRide>,
)

class SosResult(val stored: Boolean)

// ---------------------------------------------------------------- reading JSON without ceremony

private fun JsonObject.str(k: String): String? = (this[k] as? JsonPrimitive)?.takeIf { it !is JsonNull }?.contentOrNull
private fun JsonObject.long(k: String): Long? = (this[k] as? JsonPrimitive)?.longOrNull
private fun JsonObject.int(k: String): Int? = long(k)?.toInt()
private fun JsonObject.dbl(k: String): Double? = (this[k] as? JsonPrimitive)?.doubleOrNull
private fun JsonObject.obj(k: String): JsonObject? = this[k] as? JsonObject
private fun JsonObject.arr(k: String): JsonArray? = this[k] as? JsonArray
private fun JsonObject.items(): List<JsonObject> = (arr("items") ?: JsonArray(emptyList())).map { it.jsonObject }

private fun point(o: JsonObject?) = MapPoint(o?.dbl("lat") ?: 0.0, o?.dbl("lng") ?: 0.0)

private fun estimate(o: JsonObject?): Pair<Long, Long>? = o?.let { (it.long("lowKobo") ?: return null) to (it.long("highKobo") ?: return null) }

private fun ride(o: JsonObject): RideView {
    val d = o.obj("driver")
    val v = d?.obj("vehicle")
    return RideView(
        id = o.str("id")!!, shortCode = o.str("shortCode") ?: "", status = o.str("status")!!, paymentStatus = o.str("paymentStatus") ?: "",
        category = o.str("category") ?: "regular", paymentMethod = o.str("paymentMethod") ?: "cash",
        pickup = point(o.obj("pickup")), dropoff = point(o.obj("dropoff")),
        pickupAddress = o.str("pickupAddress"), dropoffAddress = o.str("dropoffAddress"),
        estimate = estimate(o.obj("estimate")), fareKobo = o.long("fareKobo"), discountKobo = o.long("discountKobo") ?: 0, payableKobo = o.long("payableKobo"), promoCode = o.str("promoCode"), distanceM = o.int("distanceM"), durationS = o.int("durationS"),
        myRating = o.int("myRating"), scheduledFor = o.str("scheduledFor"), statusChangedAt = o.str("statusChangedAt"),
        createdAt = o.str("createdAt"), cancelReason = o.str("cancelReason"),
        pickupTravelledM = o.obj("tracking")?.int("pickupTravelledM") ?: 0, tripTravelledM = o.obj("tracking")?.int("tripTravelledM") ?: 0,
        destinationChanges = com.ninejaride.core.data.parseDestinationChanges(o["destinationChanges"] as? kotlinx.serialization.json.JsonArray), destinationVersion = o.str("destinationVersion") ?: "",
        canEditDestination = (o["canEditDestination"] as? kotlinx.serialization.json.JsonPrimitive)?.content == "true",
        driver = d?.let { DriverView(it.str("name") ?: "Driver", it.dbl("rating"), it.str("phone"), v?.str("make") ?: "", v?.str("colour") ?: "", com.ninejaride.core.format.formatPlate(v?.str("plate") ?: "")) },
    )
}

/** Every call the rider app makes to the 9jaRide backend. Throws ApiException; the view model turns that into words. */
class RiderApi(private val client: ApiClient) {
    val session get() = client.session

    suspend fun profile(): Profile {
        val o = client.call("GET", "/me", auth = true)
        return Profile(o.str("id")!!, com.ninejaride.core.format.properName(o.str("name") ?: ""), o.str("phone") ?: "")
    }

    suspend fun quote(category: String, distanceM: Int, durationS: Int): Quote {
        val o = client.call("POST", "/rides/quote", buildJsonObject { put("category", category); put("distanceM", distanceM.coerceAtLeast(1)); put("durationS", durationS) }.toString(), auth = true)
        return Quote(o.str("quoteId")!!, o.long("expectedKobo")!!, o.long("lowKobo")!!, o.long("highKobo")!!)
    }

    /** One key per attempt, reused on a retry, so a bad connection can never book two rides. */
    /** The kinds of ride on offer right now: switched on by an admin, with fees in force. */
    suspend fun categories(): List<Category> = client.call("GET", "/rides/categories", auth = true).items().map { Category(it.str("code")!!, it.str("label") ?: it.str("code")!!) }

    /** Would this code work, and what would it take off? Using it up happens only when the ride is requested. */
    suspend fun checkPromo(code: String, category: String, distanceM: Int, durationS: Int): PromoResult {
        val o = client.call("POST", "/rides/promo/check", buildJsonObject { put("code", code); put("category", category); put("distanceM", distanceM.coerceAtLeast(1)); put("durationS", durationS) }.toString(), auth = true)
        return PromoResult(o.str("code")!!, o.str("description") ?: "", o.long("discountKobo") ?: 0, o.long("expectedKobo") ?: 0, o.long("payKobo") ?: 0)
    }

    suspend fun reportProblem(key: String, topic: String, message: String, rideId: String? = null) {
        client.call("POST", "/support/tickets", buildJsonObject { put("topic", topic); put("message", message); rideId?.let { put("rideId", it) } }.toString(), auth = true, headers = mapOf("Idempotency-Key" to key))
    }

    suspend fun myReports(): List<com.ninejaride.core.ui.components.MyReport> = client.call("GET", "/support/tickets", auth = true).items().map {
        com.ninejaride.core.ui.components.MyReport(it.str("code") ?: "", it.str("topic") ?: "", it.str("message") ?: "", it.str("status") ?: "OPEN", it.str("resolution"))
    }

    suspend fun requestRide(key: String, quoteId: String, category: String, method: String, from: MapPoint, fromAddress: String?, to: MapPoint, toAddress: String?, promoCode: String? = null): String {
        val body = buildJsonObject {
            put("quoteId", quoteId); put("category", category); put("paymentMethod", method)
            put("pickup", buildJsonObject { put("lat", from.lat); put("lng", from.lng) })
            put("dropoff", buildJsonObject { put("lat", to.lat); put("lng", to.lng) })
            fromAddress?.let { put("pickupAddress", it) }
            toAddress?.let { put("dropoffAddress", it) }
            promoCode?.let { put("promoCode", it) }
        }.toString()
        return client.call("POST", "/rides", body, auth = true, headers = mapOf("Idempotency-Key" to key))["rideId"]!!.jsonPrimitive.content
    }

    /** With [waitFor] (the status the screen already shows) the server holds the answer until the status changes, up to [waitSeconds]. */
    suspend fun ride(id: String, waitFor: String? = null, waitSeconds: Int = 20, dest: String? = null): RideView =
        ride(if (waitFor == null) client.call("GET", "/rides/$id", auth = true) else client.call("GET", "/rides/$id?waitFor=$waitFor&wait=$waitSeconds${if (dest != null) "&dest=${java.net.URLEncoder.encode(dest, "UTF-8")}" else ""}", auth = true, patient = true))

    /** The connection the destination-change calls go through. */
    val http get() = client

    suspend fun activeRideId(): String? = client.call("GET", "/rides/active", auth = true).str("rideId")

    suspend fun rides(scope: String): List<RideListItem> = client.call("GET", "/rides?scope=$scope", auth = true).items().map { o ->
        RideListItem(
            o.str("id")!!, o.str("shortCode") ?: "", o.str("status")!!, o.str("paymentMethod") ?: "", o.str("category") ?: "", o.str("createdAt") ?: "",
            o.str("scheduledFor"), o.str("pickupAddress"), o.str("dropoffAddress"), o.long("fareKobo"), estimate(o.obj("estimate")),
            o.obj("dropoff")?.let { d -> d.dbl("lat")?.let { lat -> d.dbl("lng")?.let { MapPoint(lat, it) } } },
        )
    }

    suspend fun driverLocation(rideId: String): CarFix? {
        val o = client.call("GET", "/rides/$rideId/driver-location", auth = true)
        val lat = o.dbl("lat") ?: return null
        return CarFix(MapPoint(lat, o.dbl("lng") ?: return null), o.long("at") ?: System.currentTimeMillis(), o.int("pickupTravelledM") ?: 0, o.int("tripTravelledM") ?: 0)
    }

    suspend fun cancel(rideId: String, reason: String?) {
        client.call("POST", "/rides/$rideId/cancel", buildJsonObject { reason?.let { put("reason", it) } }.toString(), auth = true)
    }

    suspend fun rate(rideId: String, stars: Int, tags: List<String>, comment: String) {
        client.call("POST", "/rides/$rideId/rating", buildJsonObject { put("stars", stars); put("tags", buildJsonArray { tags.forEach { add(JsonPrimitive(it)) } }); if (comment.isNotBlank()) put("comment", comment.trim()) }.toString(), auth = true)
    }

    suspend fun receipt(rideId: String): Receipt {
        val o = client.call("GET", "/rides/$rideId/receipt", auth = true)
        return Receipt(o.arr("lines")!!.map { l -> val x = l.jsonObject; ReceiptLine(x.str("kind") ?: "", x.str("label") ?: "", x.long("amountKobo") ?: 0) }, o.long("totalKobo") ?: 0,
            o.long("discountKobo") ?: 0, o.str("promoCode"), o.long("payableKobo") ?: (o.long("totalKobo") ?: 0))
    }

    suspend fun sos(key: String, at: MapPoint?): SosResult {
        val body = buildJsonObject { at?.let { put("location", buildJsonObject { put("lat", it.lat); put("lng", it.lng) }) } }.toString()
        val o = client.call("POST", "/sos", body, auth = true, headers = mapOf("Idempotency-Key" to key))
        return SosResult(o["stored"]?.jsonPrimitive?.contentOrNull == "true")
    }

    // ---- wallet
    suspend fun homeCards(): List<HomeCard> = client.call("GET", "/app/home-cards", auth = true).items().map { HomeCard(it.str("id") ?: "", it.str("kind") ?: "announcement", it.str("title") ?: "", it.str("body") ?: "") }

    suspend fun wallet(): Wallet = client.call("GET", "/wallet", auth = true).let { Wallet(it.long("balanceKobo") ?: 0, it.long("availableKobo") ?: 0) }

    suspend fun walletTransactions(): List<WalletTx> = client.call("GET", "/wallet/transactions", auth = true).items().map {
        WalletTx(it.str("kind") ?: "", it.str("memo"), it.str("at") ?: "", it.long("amountKobo") ?: 0)
    }

    /** Starts a Paystack payment; returns the page to open and the reference to ask about afterwards. */
    suspend fun topUp(amountKobo: Long): com.ninejaride.core.data.TopUpStart = com.ninejaride.core.data.TopUps.start(client, amountKobo)

    /** How a payment went, as confirmed by Paystack to the server. */
    suspend fun topUpStatus(reference: String): com.ninejaride.core.data.TopUpOutcome = com.ninejaride.core.data.TopUps.status(client, reference)

    // ---- scheduled rides
    suspend fun schedule(
        key: String, category: String, method: String, from: MapPoint, fromAddress: String?, to: MapPoint, toAddress: String?,
        distanceM: Int, durationS: Int, firstPickupIso: String, weeks: Int?,
    ): ScheduleView {
        val body = buildJsonObject {
            put("category", category); put("paymentMethod", method)
            put("pickup", buildJsonObject { put("lat", from.lat); put("lng", from.lng) })
            put("dropoff", buildJsonObject { put("lat", to.lat); put("lng", to.lng) })
            put("distanceM", distanceM.coerceAtLeast(1)); put("durationS", durationS)
            put("firstPickupAt", firstPickupIso)
            put("repeat", if (weeks == null) "none" else "weekly")
            weeks?.let { put("weeks", it) }
            fromAddress?.let { put("pickupAddress", it) }
            toAddress?.let { put("dropoffAddress", it) }
        }.toString()
        return schedule(client.call("POST", "/ride-schedules", body, auth = true, headers = mapOf("Idempotency-Key" to key)))
    }

    suspend fun schedules(): List<ScheduleView> = client.call("GET", "/ride-schedules", auth = true).items().map { schedule(it) }

    suspend fun cancelSchedule(id: String) {
        client.call("POST", "/ride-schedules/$id/cancel", "{}", auth = true)
    }

    private fun schedule(o: JsonObject) = ScheduleView(
        o.str("scheduleId")!!, o.str("category") ?: "", o.str("paymentMethod") ?: "", o.str("repeat") ?: "none", o.str("status") ?: "",
        o.str("pickupAddress"), o.str("dropoffAddress"), o.int("distanceM") ?: 0, o.int("durationS") ?: 0,
        o.arr("rides")?.map { r -> val x = r.jsonObject; ScheduledRide(x.str("rideId")!!, x.str("status") ?: "", x.str("scheduledFor") ?: "") } ?: emptyList(),
    )

    // ---- sign-in is shared with the driver app (ApiClient); the rider adds a role check
    suspend fun requestOtp(phone: String, voice: Boolean) = client.requestOtp(phone, voice)
    suspend fun verifyOtp(phone: String, code: String) = client.verifyOtp(phone, code)
    suspend fun register(ticket: String, name: String) = client.register(ticket, "rider", name)
    suspend fun logout() = client.logout()
    fun dropSession() { client.session = null }

    companion object { fun newKey() = UUID.randomUUID().toString() }
}
