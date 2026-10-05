package com.ninejaride.core.data

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.async
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
data class Place(val address: String, val point: MapPoint)

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

    /** Shortens "Iwo Road, Ward 3, Ibadan North, Oyo, 200001, Nigeria" to the first three parts a person would say. */
    private fun short(display: String): String = display.split(",").map { it.trim() }.filter { it.isNotEmpty() && it != "Nigeria" && !it.all { c -> c.isDigit() } }.take(3).joinToString(", ")

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
     * Places matching [query] in Nigeria, nearest to [near] first when given. With Mapbox, both are asked at once and merged:
     * OpenStreetMap knows the landmarks (malls, airports, shops) and Mapbox the streets and addresses.
     */
    suspend fun search(query: String, near: MapPoint?): List<Place> = withContext(Dispatchers.IO) {
        if (!fast) return@withContext osmSearch(query, near)
        val streets = async { mapboxSearch(query, near).orEmpty() }
        val landmarks = async { osmSearch(query, near) }
        (landmarks.await() + streets.await()).distinctBy { it.address.lowercase() }.take(8)
    }

    private fun osmSearch(query: String, near: MapPoint?): List<Place> {
        val url = "https://nominatim.openstreetmap.org/search".toHttpUrl().newBuilder()
            .addQueryParameter("q", query).addQueryParameter("format", "jsonv2").addQueryParameter("countrycodes", "ng")
            .addQueryParameter("limit", "6").addQueryParameter("addressdetails", "0")
            .apply {
                if (near != null) { // a soft preference for results around the rider, not a hard limit
                    addQueryParameter("viewbox", "${near.lng - 0.4},${near.lat + 0.4},${near.lng + 0.4},${near.lat - 0.4}")
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
