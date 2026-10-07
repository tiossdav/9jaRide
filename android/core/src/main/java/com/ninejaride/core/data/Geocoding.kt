package com.ninejaride.core.data

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.OkHttpClient
import okhttp3.Request
import java.util.concurrent.TimeUnit

/** A place the rider can pick: the words shown, and where it is. */
data class Place(val address: String, val point: MapPoint, /** How far from the person who searched, when known. */ val distanceKm: Double? = null)

/**
 * Turns words into places and places into words, using OpenStreetMap's Nominatim.
 *
 * Nominatim's public server allows light use only (one request a second, no search-as-you-type hammering), so callers
 * wait for the person to pause typing. It is for development. Before launch swap these two functions for a paid
 * service (Google Places, Mapbox or LocationIQ); nothing else in the apps needs to change.
 */
object Geocoding {
    private val mapboxToken = com.ninejaride.core.BuildConfig.MAPBOX_TOKEN
    /** True when Mapbox answers searches: fast enough to search while the person types. */
    val fast: Boolean get() = mapboxToken.isNotBlank()
    private val http = OkHttpClient.Builder().connectTimeout(6, TimeUnit.SECONDS).readTimeout(8, TimeUnit.SECONDS).build()
    private val json = Json { ignoreUnknownKeys = true }

    private fun get(url: String): String? = try {
        http.newCall(Request.Builder().url(url).header("User-Agent", "9jaRide-Pro (contact: support@9jaridepro.com)").header("Accept-Language", "en").build())
            .execute().use { if (it.isSuccessful) it.body?.string() else null }
    } catch (e: Exception) {
        null
    }

    /**
     * Shortens "Ikeja City Mall, 1, Obafemi Awolowo Way, Ikeja, Lagos, 100271, Nigeria" to what a person would say:
     * the name, the street, then the area and the state, so the city is never lost.
     */
    private fun short(display: String): String {
        val parts = display.split(",").map { it.trim() }.filter { it.isNotEmpty() && it != "Nigeria" && !it.all { c -> c.isDigit() } }
        if (parts.size <= 3) return parts.joinToString(", ")
        return (parts.take(2) + parts.takeLast(2)).distinct().joinToString(", ")
    }

    /** Names Nigerians use that map data does not: the search is made with the full name instead. */
    private val ALIASES = mapOf(
        "vi" to "Victoria Island, Lagos", "v.i" to "Victoria Island, Lagos", "mm2" to "Murtala Muhammed Airport Terminal 2, Lagos", "mma" to "Murtala Muhammed International Airport, Lagos",
        "unilag" to "University of Lagos, Akoka", "lasu" to "Lagos State University, Ojo", "yaba tech" to "Yaba College of Technology", "oau" to "Obafemi Awolowo University, Ile-Ife",
        "ui" to "University of Ibadan", "uniben" to "University of Benin", "unn" to "University of Nigeria, Nsukka", "abu" to "Ahmadu Bello University, Zaria",
        "unical" to "University of Calabar", "uniport" to "University of Port Harcourt", "futa" to "Federal University of Technology, Akure", "lekki phase1" to "Lekki Phase 1, Lagos",
        "cbd" to "Central Business District, Abuja", "nnamdi azikiwe airport" to "Nnamdi Azikiwe International Airport, Abuja", "third mainland" to "Third Mainland Bridge, Lagos",
    )
    private fun expand(q: String): String = ALIASES[q.trim().lowercase()] ?: q

    /** The search perimeter: places within this many kilometres of the person come first, nearest first. */
    const val NEARBY_KM = 5.0
    /** After the perimeter, places in the same city and its neighbours come before anything in another part of the country. */
    private const val CITY_KM = 60.0

    /** Mapbox search: places and addresses in Nigeria, nearest to [near] first. Null when it did not work (the free service is tried next). */
    private fun mapboxSearch(query: String, near: MapPoint?): List<Place>? {
        if (!fast) return null
        val url = "https://api.mapbox.com/search/geocode/v6/forward".toHttpUrl().newBuilder()
            .addQueryParameter("q", query).addQueryParameter("country", "ng").addQueryParameter("limit", "6").addQueryParameter("language", "en")
            .addQueryParameter("autocomplete", "true").addQueryParameter("access_token", mapboxToken)
            .apply { if (near != null) addQueryParameter("proximity", "${near.lng},${near.lat}") }.build().toString()
        val body = get(url) ?: return null
        return runCatching { features(body) }.getOrNull()
    }

    private fun features(body: String): List<Place> =
        json.parseToJsonElement(body).jsonObject["features"]!!.jsonArray.mapNotNull { f ->
            val p = f.jsonObject["properties"]?.jsonObject ?: return@mapNotNull null
            val c = p["coordinates"]?.jsonObject ?: return@mapNotNull null
            val words = listOfNotNull(p["name"]?.jsonPrimitive?.content, p["place_formatted"]?.jsonPrimitive?.content).joinToString(", ")
            Place(short(words), MapPoint(c["latitude"]!!.jsonPrimitive.content.toDouble(), c["longitude"]!!.jsonPrimitive.content.toDouble()))
        }

    /**
     * Places matching [query]. The search stays around where the person is (their city and neighbours) until the words they typed end
     * in a state or well-known town ("Allen Avenue Lagos", "Bodija, Ibadan"): then it looks in that state instead. Inside the area,
     * places within 5 km come first, nearest first, then the rest, and nothing from outside the area is shown.
     */
    suspend fun search(query: String, near: MapPoint?): List<Place> = withContext(Dispatchers.IO) {
        val q = expand(query.trim())
        val state = NigeriaStates.trailing(q)
        // where to look, how far from there is still "the area", and what distances are measured from
        val region: Pair<MapPoint, Double>? = when {
            state != null -> state.centre to state.radiusKm
            near != null -> near to CITY_KM
            else -> null
        }
        val anchor = if (state != null && near != null && Routing.haversineKm(near, state.centre) > state.radiusKm) state.centre else near
        val found = coroutineScope {
            val streets = async { if (fast) mapboxSearch(q, anchor ?: region?.first).orEmpty() else emptyList() }
            val landmarks = async {
                // the 5 km perimeter first, then the whole area, stopping as soon as there is enough
                var all = if (anchor != null) osmSearch(q, anchor, bounded = true, span = 0.05) else emptyList()
                if (region != null && all.size < 4) all = (all + osmSearch(q, region.first, bounded = true, span = region.second / 111.0)).distinctBy { it.address.lowercase() }
                all
            }
            landmarks.await() + streets.await()
        }
        val inArea = if (region == null) found else found.filter { Routing.haversineKm(region.first, it.point) <= region.second }
        rank(q, inArea.distinctBy { it.address.lowercase() }, anchor).take(8)
    }

    /** Local results first, best name match then nearest; faraway ones after, in the order the service gave them. */
    internal fun rank(query: String, places: List<Place>, near: MapPoint?): List<Place> {
        if (near == null) return places
        val withDistance = places.map { it.copy(distanceKm = Routing.haversineKm(near, it.point)) }
        val (local, far) = withDistance.partition { it.distanceKm!! <= CITY_KM }
        val words = query.lowercase().split(" ").filter { it.length > 1 }
        fun nameScore(p: Place): Double {
            val title = p.address.substringBefore(",").lowercase()
            return when {
                title == query.lowercase() -> 30.0 // typed exactly what the place is called
                title.startsWith(query.lowercase()) -> 15.0
                words.isNotEmpty() && words.all { title.contains(it) } -> 8.0
                else -> 0.0
            }
        }
        // inside the 5 km perimeter first; beyond it, the rest of the city by closeness
        val nearDeduped = local.sortedBy { (if (it.distanceKm!! <= NEARBY_KM) 0.0 else 1000.0) + it.distanceKm!! - nameScore(it) }.fold(mutableListOf<Place>()) { acc, p ->
            // the same place found by both services, a few metres apart
            if (acc.none { Routing.haversineKm(it.point, p.point) < 0.08 && it.address.substringBefore(",").equals(p.address.substringBefore(","), true) }) acc += p
            acc
        }
        return nearDeduped + far
    }

    private fun osmSearch(query: String, near: MapPoint?, bounded: Boolean = false, span: Double = 0.4): List<Place> {
        val url = "https://nominatim.openstreetmap.org/search".toHttpUrl().newBuilder()
            .addQueryParameter("q", query).addQueryParameter("format", "jsonv2").addQueryParameter("countrycodes", "ng")
            .addQueryParameter("limit", "6").addQueryParameter("addressdetails", "0")
            .apply {
                if (near != null) { // around the rider: a preference, or the only place to look when bounded
                    val d = span // 0.05 degrees is about 5.5 km, 0.5 about 55 km
                    addQueryParameter("viewbox", "${near.lng - d},${near.lat + d},${near.lng + d},${near.lat - d}")
                    if (bounded) addQueryParameter("bounded", "1")
                }
            }.build().toString()
        val body = get(url) ?: return emptyList()
        return runCatching {
            (json.parseToJsonElement(body) as JsonArray).map { e ->
                val o = e.jsonObject
                Place(short(o["display_name"]!!.jsonPrimitive.content), MapPoint(o["lat"]!!.jsonPrimitive.content.toDouble(), o["lon"]!!.jsonPrimitive.content.toDouble()))
            }
        }.getOrDefault(emptyList())
    }

    /** The address for a point, or null if none could be found. */
    suspend fun reverse(point: MapPoint): String? = withContext(Dispatchers.IO) {
        if (fast) {
            val mb = "https://api.mapbox.com/search/geocode/v6/reverse".toHttpUrl().newBuilder()
                .addQueryParameter("longitude", point.lng.toString()).addQueryParameter("latitude", point.lat.toString())
                .addQueryParameter("limit", "1").addQueryParameter("language", "en").addQueryParameter("access_token", mapboxToken).build().toString()
            get(mb)?.let { body -> runCatching { features(body).firstOrNull()?.address?.ifEmpty { null } }.getOrNull() }?.let { return@withContext it }
        }
        val url = "https://nominatim.openstreetmap.org/reverse".toHttpUrl().newBuilder()
            .addQueryParameter("lat", point.lat.toString()).addQueryParameter("lon", point.lng.toString())
            .addQueryParameter("format", "jsonv2").addQueryParameter("zoom", "17").build().toString()
        val body = get(url) ?: return@withContext null
        runCatching { short(json.parseToJsonElement(body).jsonObject["display_name"]!!.jsonPrimitive.content).ifEmpty { null } }.getOrNull()
    }
}
