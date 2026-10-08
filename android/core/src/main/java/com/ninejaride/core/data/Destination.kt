package com.ninejaride.core.data

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import com.ninejaride.core.ui.components.BusyTracker
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.doubleOrNull
import kotlinx.serialization.json.longOrNull
import kotlinx.serialization.json.put

/**
 * One change of drop-off during a trip. It is the same trip with a new end point: the pickup and the trip itself stay as they were.
 * [remainingDistanceM] and [remainingDurationS] are what is left to drive from where the driver was when the change was made.
 */
data class DestinationChange(
    val id: String,
    val oldAddress: String?,
    val newPoint: MapPoint,
    val newAddress: String?,
    val remainingDistanceM: Int,
    val remainingDurationS: Int,
    /** True when the road route could not be worked out and these numbers are a straight-line guess. */
    val estimated: Boolean,
    /** What the change did to the expected fare; below zero when the new place is closer. */
    val deltaExpectedKobo: Long,
)

private fun JsonObject.text(k: String) = (this[k] as? JsonPrimitive)?.contentOrNull
private fun JsonObject.num(k: String) = (this[k] as? JsonPrimitive)?.longOrNull

fun parseDestinationChange(o: JsonObject?): DestinationChange? {
    o ?: return null
    val at = o["newDropoff"] as? JsonObject ?: return null
    return DestinationChange(
        o.text("id") ?: return null, o.text("oldAddress"),
        MapPoint((at["lat"] as? JsonPrimitive)?.doubleOrNull ?: 0.0, (at["lng"] as? JsonPrimitive)?.doubleOrNull ?: 0.0), at.text("address"),
        (o.num("remainingDistanceM") ?: 0).toInt(), (o.num("remainingDurationS") ?: 0).toInt(), o.text("routeSource") == "estimate", o.num("deltaExpectedKobo") ?: 0,
    )
}

fun parseDestinationChanges(a: JsonArray?): List<DestinationChange> = a.orEmpty().mapNotNull { parseDestinationChange(it as? JsonObject) }

/** The rider asks for a new drop-off. Null when the place chosen is where the trip is already going. */
suspend fun ApiClient.changeDestination(rideId: String, place: Place): DestinationChange? {
    val answer = call("PUT", "/rides/$rideId/destination", buildJsonObject {
        put("lat", place.point.lat); put("lng", place.point.lng); put("address", place.address.take(200))
    }.toString(), auth = true)
    return parseDestinationChange(answer["change"] as? JsonObject).takeIf { (answer["changed"] as? JsonPrimitive)?.contentOrNull == "true" }
}

/**
 * What a screen needs for changing the drop-off, the same in both apps: whether the picker is open, the work in progress, and a notice
 * when the drop-off changes (to the rider as a confirmation, to the driver so they know to follow the new route). The app feeds it
 * every ride update with [observe].
 */
class DestinationController(
    private val scope: CoroutineScope,
    private val client: () -> ApiClient,
    private val rideId: () -> String?,
    private val busy: BusyTracker,
    /** Called once the destination has changed (by this rider, or seen by the driver), so the app can redraw the route and the fare. */
    private val onChanged: (DestinationChange) -> Unit,
) {
    var picking by mutableStateOf(false)
    var error by mutableStateOf<String?>(null); private set
    /** The change to tell the person about, until they close it. */
    var notice by mutableStateOf<DestinationChange?>(null); private set
    private var seen: String? = null

    /** The ride was read again. The first read only learns where things stand; a later change of version is a change to announce. */
    fun observe(version: String, changes: List<DestinationChange>) {
        val before = seen
        seen = version
        if (before == null || before == version) return
        changes.firstOrNull { it.id == version }?.let { notice = it; onChanged(it) }
    }

    fun dismiss() { notice = null; error = null }

    fun clear() { notice = null; error = null; picking = false; seen = null }

    /** The rider chose a place. The server works out the route from the driver's position, so nothing more is sent. */
    fun change(place: Place) {
        val id = rideId() ?: return
        error = null
        scope.launch {
            try {
                busy.run("Please wait while the destination is being updated...") {
                    val change = client().changeDestination(id, place)
                    picking = false
                    if (change != null) { seen = change.id; notice = change; onChanged(change) }
                    else error = "That is where the trip is already going."
                }
            } catch (e: ApiException) {
                error = e.message.takeIf { it.isNotBlank() } ?: "We could not change the destination. Please try again."
            } catch (e: kotlinx.coroutines.CancellationException) {
                throw e
            } catch (e: Exception) {
                error = "We could not change the destination. Please try again."
            }
        }
    }
}
