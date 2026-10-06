package com.ninejaride.core.data

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.doubleOrNull
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.longOrNull
import kotlinx.serialization.json.put

/**
 * A proposal to go further than the booked destination, from either side. Nothing about the trip changes until the other person
 * accepts; a decline, a lapse or a withdrawal leaves the original destination and fare as they were.
 */
data class TripExtension(
    val id: String,
    val requestedBy: String,
    /** True when the person looking is the one who asked. */
    val mine: Boolean,
    val status: String,
    val oldAddress: String?,
    val newPoint: MapPoint,
    val newAddress: String?,
    val extraDistanceM: Int,
    val extraDurationS: Int,
    val extraKobo: Long,
    val newTotalKobo: Long?,
    val secondsLeft: Int,
    val declineReason: String?,
) {
    val pending get() = status == "PENDING"
}

private fun JsonObject.text(k: String) = (this[k] as? JsonPrimitive)?.contentOrNull
private fun JsonObject.num(k: String) = (this[k] as? JsonPrimitive)?.longOrNull

/** The extension as the server sends it inside a ride, or null when there is none. */
fun parseExtension(o: JsonObject?): TripExtension? {
    o ?: return null
    val at = o["newDropoff"] as? JsonObject ?: return null
    return TripExtension(
        o.text("id") ?: return null, o.text("requestedBy") ?: "driver", (o["mine"] as? JsonPrimitive)?.contentOrNull == "true", o.text("status") ?: "PENDING",
        o.text("oldAddress"), MapPoint((at["lat"] as? JsonPrimitive)?.doubleOrNull ?: 0.0, (at["lng"] as? JsonPrimitive)?.doubleOrNull ?: 0.0), at.text("address"),
        (o.num("extraDistanceM") ?: 0).toInt(), (o.num("extraDurationS") ?: 0).toInt(), o.num("extraKobo") ?: 0, o.num("newTotalKobo"), (o.num("secondsLeft") ?: 0).toInt(), o.text("declineReason"),
    )
}

suspend fun ApiClient.askExtension(rideId: String, place: Place, route: RouteInfo): TripExtension =
    parseExtension(call("POST", "/rides/$rideId/extension", buildJsonObject {
        put("lat", place.point.lat); put("lng", place.point.lng); put("address", place.address.take(200)); put("distanceM", route.distanceM.coerceAtLeast(1)); put("durationS", route.durationS.coerceAtLeast(0))
    }.toString(), auth = true))!!

suspend fun ApiClient.answerExtension(rideId: String, extId: String, accept: Boolean, reason: String? = null): TripExtension =
    parseExtension(call("POST", "/rides/$rideId/extension/$extId/${if (accept) "accept" else "decline"}", buildJsonObject { reason?.let { put("reason", it) } }.toString(), auth = true))!!

suspend fun ApiClient.withdrawExtension(rideId: String, extId: String): TripExtension =
    parseExtension(call("POST", "/rides/$rideId/extension/$extId/withdraw", "{}", auth = true))!!

/**
 * What the screen needs to run an extension, the same for the rider and the driver app: what the server last said, what to show
 * now, and the actions. The app feeds it every ride update with [update].
 */
class ExtensionController(
    private val scope: CoroutineScope,
    private val client: () -> ApiClient,
    private val rideId: () -> String?,
    /** Called when an acceptance (by either side) has changed the destination, so the app can redraw the route and the fare. */
    private val onAccepted: (TripExtension) -> Unit,
) {
    /** What the server last said about the newest request of this trip. */
    var current by mutableStateOf<TripExtension?>(null); private set
    /** What to show now, if anything: a question, the answer to ours, or a short confirmation. */
    var shown by mutableStateOf<TripExtension?>(null); private set
    var busy by mutableStateOf(false); private set
    var error by mutableStateOf<String?>(null); private set
    /** The place picker is open. */
    var picking by mutableStateOf(false)
    private val dismissed = mutableSetOf<String>()
    private var lastSeen: TripExtension? = null

    /** The ride was read again. A question shows to both; the answer shows to the one who asked; a yes shows to both, once. */
    fun update(ext: TripExtension?) {
        val before = lastSeen
        lastSeen = ext
        current = ext
        if (ext == null) { shown = null; return }
        if (ext.id in dismissed) { if (shown?.id == ext.id) shown = null; return }
        val sawItOpen = before?.id == ext.id && before.pending
        when (ext.status) {
            "PENDING" -> shown = ext
            "ACCEPTED" -> if (sawItOpen) { shown = ext; onAccepted(ext) } else if (shown?.id == ext.id) shown = ext
            "DECLINED", "EXPIRED" -> shown = if (ext.mine && (sawItOpen || shown?.id == ext.id)) ext else null
            else -> shown = null // withdrawn: nothing left to answer
        }
    }

    fun dismiss() { shown?.let { dismissed += it.id }; shown = null; error = null }

    fun clear() { current = null; shown = null; lastSeen = null; dismissed.clear(); error = null; busy = false; picking = false }

    private fun run(block: suspend (String) -> TripExtension, failure: String) {
        val id = rideId() ?: return
        if (busy) return
        busy = true; error = null
        scope.launch {
            try { val e = block(id); update(e); if (e.status == "ACCEPTED" && shown?.id != e.id) { shown = e; onAccepted(e) } }
            catch (e: ApiException) { error = e.message?.takeIf { it.isNotBlank() } ?: failure }
            catch (e: kotlinx.coroutines.CancellationException) { throw e }
            catch (e: Exception) { error = failure }
            finally { busy = false }
        }
    }

    /** Sends a new destination to the other person. [route] is the road from the current destination to the new place. */
    fun ask(place: Place, route: RouteInfo) {
        picking = false
        run({ id -> client().askExtension(id, place, route).also { lastSeen = null } }, "We could not send that. Please try again.")
    }

    fun accept() { val e = shown ?: return; run({ id -> client().answerExtension(id, e.id, true) }, "We could not accept that. Please try again.") }
    fun decline(reason: String? = null) { val e = shown ?: return; run({ id -> client().answerExtension(id, e.id, false, reason) }, "We could not send your answer. Please try again."); dismissed += e.id; shown = null }
    fun withdraw() { val e = shown ?: return; run({ id -> client().withdrawExtension(id, e.id) }, "We could not take that back. Please try again.") }
}
