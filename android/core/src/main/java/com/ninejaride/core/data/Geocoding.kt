package com.ninejaride.core.data

import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.doubleOrNull
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import java.net.URLEncoder

/** A place the rider can pick: the words shown, and where it is. */
data class Place(val address: String, val point: MapPoint, /** How far from the person who searched, when known. */ val distanceKm: Double? = null)

/**
 * Turns words into places and places into words, through the 9jaRide server, which asks whichever map provider it is set to use.
 *
 * The search is Nigeria-wide and not tied to any one city. The phone sends where it is, and the server puts matches near that spot first
 * and expands outward only when nothing is near, so "Computer Village" in Lagos finds Lagos first, and "KFC in Ibadan" finds Ibadan's
 * KFCs even while the person is somewhere else. Without a position the search simply covers the whole country.
 */
object Geocoding {
    /** Names Nigerians use that map data does not know: the search is made with the full name instead. */
    private val ALIASES = mapOf(
        "vi" to "Victoria Island, Lagos", "v.i" to "Victoria Island, Lagos", "mm2" to "Murtala Muhammed Airport Terminal 2, Lagos", "mma" to "Murtala Muhammed International Airport, Lagos",
        "unilag" to "University of Lagos, Akoka", "lasu" to "Lagos State University, Ojo", "yaba tech" to "Yaba College of Technology", "oau" to "Obafemi Awolowo University, Ile-Ife",
        "ui" to "University of Ibadan", "uniben" to "University of Benin", "unn" to "University of Nigeria, Nsukka", "abu" to "Ahmadu Bello University, Zaria",
        "unical" to "University of Calabar", "uniport" to "University of Port Harcourt", "futa" to "Federal University of Technology, Akure",
        "nnamdi azikiwe airport" to "Nnamdi Azikiwe International Airport, Abuja", "third mainland" to "Third Mainland Bridge, Lagos",
    )
    internal fun expand(q: String): String = ALIASES[q.trim().lowercase()] ?: q

    /** What a person would say: the place's name, then its address without the country. */
    internal fun label(name: String, address: String): String {
        val where = address.split(",").map { it.trim() }.filter { it.isNotEmpty() && it != "Nigeria" && !it.all { c -> c.isDigit() } }.joinToString(", ")
        return when {
            where.isEmpty() -> name
            where.startsWith(name, ignoreCase = true) -> where
            else -> "$name, $where"
        }
    }

    internal fun parse(o: JsonObject): List<Place> =
        (o["places"] as? JsonArray).orEmpty().mapNotNull { e ->
            val p = e.jsonObject
            val lat = p["lat"]?.jsonPrimitive?.doubleOrNull ?: return@mapNotNull null
            val lng = p["lng"]?.jsonPrimitive?.doubleOrNull ?: return@mapNotNull null
            val name = p["name"]?.jsonPrimitive?.contentOrNull ?: return@mapNotNull null
            Place(label(name, p["address"]?.jsonPrimitive?.contentOrNull.orEmpty()), MapPoint(lat, lng), p["distanceM"]?.jsonPrimitive?.doubleOrNull?.let { it / 1000.0 })
        }

    /**
     * Places matching [query], best first, as the server ranks them. [near] is the phone's position when it has one.
     * Throws the server's own message (for example that search is not set up) so the screen can say what is wrong.
     */
    suspend fun search(query: String, near: MapPoint?): List<Place> {
        val client = MapsGateway.client ?: return emptyList()
        val q = expand(query.trim())
        if (q.length < 2) return emptyList()
        val where = if (near != null) "&lat=${near.lat}&lng=${near.lng}" else ""
        return parse(client.call("GET", "/maps/places?q=${URLEncoder.encode(q, "UTF-8")}$where", auth = true))
    }

    /** The address for a point, or null if none could be found. */
    suspend fun reverse(point: MapPoint): String? {
        val client = MapsGateway.client ?: return null
        return try {
            client.call("GET", "/maps/reverse?lat=${point.lat}&lng=${point.lng}", auth = true)["address"]?.jsonPrimitive?.contentOrNull
                ?.let { label("", it).removePrefix(", ") }?.ifEmpty { null }
        } catch (e: Exception) {
            null
        }
    }
}
