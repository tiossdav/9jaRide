package com.ninejaride.core.data

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import okhttp3.OkHttpClient
import okhttp3.Request
import java.util.concurrent.TimeUnit
import kotlin.math.cos
import kotlin.math.hypot

data class MapPoint(val lat: Double, val lng: Double)

/** A road route: the line to draw, and how far and how long it is (what the fare quote needs). */
data class RouteInfo(val points: List<MapPoint>, val distanceM: Int, val durationS: Int)

/**
 * Road route between two points, for drawing on the map.
 *
 * This uses the public OSRM demo server, which is fine to develop against but is not meant for production traffic and
 * has no uptime promise. Before launch, swap this one function for a paid directions service (Google, Mapbox, or your
 * own OSRM). If the call fails the map falls back to a straight line, so a ride screen never breaks on it.
 */
object Routing {
    private val http = OkHttpClient.Builder().connectTimeout(6, TimeUnit.SECONDS).readTimeout(12, TimeUnit.SECONDS).build()
    private val json = Json { ignoreUnknownKeys = true }

    suspend fun route(from: MapPoint, to: MapPoint): List<MapPoint> = routeInfo(from, to).points

    private val mapboxToken = com.ninejaride.core.BuildConfig.MAPBOX_TOKEN

    /**
     * Same as [route] with distance and time. Mapbox (with live traffic) when a token is set, else the public OSRM server; if
     * neither answers, the numbers come from a straight line at 25 km/h.
     */
    suspend fun routeInfo(from: MapPoint, to: MapPoint): RouteInfo = withContext(Dispatchers.IO) {
        val straightKm = haversineKm(from, to)
        val straight = RouteInfo(listOf(from, to), (straightKm * 1000).toInt(), (straightKm / 25.0 * 3600).toInt())
        if (mapboxToken.isNotBlank()) {
            val url = "https://api.mapbox.com/directions/v5/mapbox/driving-traffic/${from.lng},${from.lat};${to.lng},${to.lat}?overview=full&geometries=geojson&access_token=$mapboxToken"
            fetchRoute(url, straight)?.let { return@withContext it }
        }
        for (attempt in 1..2) try {
            val url = "https://router.project-osrm.org/route/v1/driving/${from.lng},${from.lat};${to.lng},${to.lat}?overview=full&geometries=geojson"
            http.newCall(Request.Builder().url(url).header("User-Agent", "9jaRide-Pro").build()).execute().use { res ->
                if (!res.isSuccessful) return@withContext straight
                val root = json.parseToJsonElement(res.body?.string().orEmpty()).jsonObject
                val r = root["routes"]?.jsonArray?.firstOrNull()?.jsonObject ?: return@withContext straight
                val coords = r["geometry"]?.jsonObject?.get("coordinates")?.jsonArray ?: return@withContext straight
                val pts = coords.map { c -> val a = c.jsonArray; MapPoint(a[1].jsonPrimitive.content.toDouble(), a[0].jsonPrimitive.content.toDouble()) }
                if (pts.size < 2) return@withContext straight
                return@withContext RouteInfo(pts, r["distance"]?.jsonPrimitive?.content?.toDouble()?.toInt() ?: straight.distanceM, r["duration"]?.jsonPrimitive?.content?.toDouble()?.toInt() ?: straight.durationS)
            }
        } catch (e: Exception) {
            // one more try: the public server is sometimes slow on the first call
        }
        straight
    }

    /** One request in the OSRM/Mapbox shape (both answer the same way). Null when it did not work. */
    private fun fetchRoute(url: String, fallback: RouteInfo): RouteInfo? = try {
        http.newCall(Request.Builder().url(url).header("User-Agent", "9jaRide").build()).execute().use { res ->
            if (!res.isSuccessful) return null
            val r = json.parseToJsonElement(res.body?.string().orEmpty()).jsonObject["routes"]?.jsonArray?.firstOrNull()?.jsonObject ?: return null
            val coords = r["geometry"]?.jsonObject?.get("coordinates")?.jsonArray ?: return null
            val pts = coords.map { c -> val a = c.jsonArray; MapPoint(a[1].jsonPrimitive.content.toDouble(), a[0].jsonPrimitive.content.toDouble()) }
            if (pts.size < 2) null
            else RouteInfo(pts, r["distance"]?.jsonPrimitive?.content?.toDouble()?.toInt() ?: fallback.distanceM, r["duration"]?.jsonPrimitive?.content?.toDouble()?.toInt() ?: fallback.durationS)
        }
    } catch (e: Exception) { null }

    fun haversineKm(a: MapPoint, b: MapPoint): Double {
        val r = 6371.0
        val dLat = Math.toRadians(b.lat - a.lat)
        val dLng = Math.toRadians(b.lng - a.lng)
        val h = Math.sin(dLat / 2).let { it * it } + Math.cos(Math.toRadians(a.lat)) * Math.cos(Math.toRadians(b.lat)) * Math.sin(dLng / 2).let { it * it }
        return 2 * r * Math.asin(Math.sqrt(h))
    }

    /** The point `fraction` (0..1) of the way along a polyline, measured by length. */
    fun pointAt(route: List<MapPoint>, fraction: Double): MapPoint {
        if (route.isEmpty()) return MapPoint(0.0, 0.0)
        if (route.size == 1 || fraction <= 0) return route.first()
        if (fraction >= 1) return route.last()
        fun d(a: MapPoint, b: MapPoint) = hypot((b.lat - a.lat), (b.lng - a.lng) * cos(Math.toRadians(a.lat)))
        val seg = route.zipWithNext { a, b -> d(a, b) }
        val total = seg.sum()
        if (total == 0.0) return route.first()
        var left = fraction * total
        for (i in seg.indices) {
            if (left <= seg[i]) {
                val t = if (seg[i] == 0.0) 0.0 else left / seg[i]
                return MapPoint(route[i].lat + (route[i + 1].lat - route[i].lat) * t, route[i].lng + (route[i + 1].lng - route[i].lng) * t)
            }
            left -= seg[i]
        }
        return route.last()
    }
}
