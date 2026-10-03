package com.ninejaride.core.data

import kotlinx.coroutines.Dispatchers
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

    /** Places matching [query] in Nigeria, nearest to [near] first when given. */
    suspend fun search(query: String, near: MapPoint?): List<Place> = withContext(Dispatchers.IO) {
        val url = "https://nominatim.openstreetmap.org/search".toHttpUrl().newBuilder()
            .addQueryParameter("q", query).addQueryParameter("format", "jsonv2").addQueryParameter("countrycodes", "ng")
            .addQueryParameter("limit", "6").addQueryParameter("addressdetails", "0")
            .apply {
                if (near != null) { // a soft preference for results around the rider, not a hard limit
                    addQueryParameter("viewbox", "${near.lng - 0.4},${near.lat + 0.4},${near.lng + 0.4},${near.lat - 0.4}")
                }
            }.build().toString()
        val body = get(url) ?: return@withContext emptyList()
        runCatching {
            (json.parseToJsonElement(body) as JsonArray).map { e ->
                val o = e.jsonObject
                Place(short(o["display_name"]!!.jsonPrimitive.content), MapPoint(o["lat"]!!.jsonPrimitive.content.toDouble(), o["lon"]!!.jsonPrimitive.content.toDouble()))
            }
        }.getOrDefault(emptyList())
    }

    /** The address for a point, or null if none could be found. */
    suspend fun reverse(point: MapPoint): String? = withContext(Dispatchers.IO) {
        val url = "https://nominatim.openstreetmap.org/reverse".toHttpUrl().newBuilder()
            .addQueryParameter("lat", point.lat.toString()).addQueryParameter("lon", point.lng.toString())
            .addQueryParameter("format", "jsonv2").addQueryParameter("zoom", "17").build().toString()
        val body = get(url) ?: return@withContext null
        runCatching { short(json.parseToJsonElement(body).jsonObject["display_name"]!!.jsonPrimitive.content).ifEmpty { null } }.getOrNull()
    }
}
