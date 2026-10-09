package com.ninejaride.core.data

import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.doubleOrNull
import kotlinx.serialization.json.jsonPrimitive
import kotlin.math.cos
import kotlin.math.hypot

data class MapPoint(val lat: Double, val lng: Double)

/**
 * A road route: the line to draw, and how far and how long it is (what the fare quote needs). [estimated] is true when the map service could not
 * be reached and the numbers are a straight-line guess, so a screen never pretends a guess is a road route.
 */
data class RouteInfo(val points: List<MapPoint>, val distanceM: Int, val durationS: Int, val estimated: Boolean = false)

/** Road routes, from the map provider the 9jaRide server is set to use. The app does not know or care which one. */
object Routing {
    suspend fun route(from: MapPoint, to: MapPoint): List<MapPoint> = routeInfo(from, to).points

    /** Distance, time and the line to draw. If the server cannot answer, a straight line at city speed stands in and is marked [RouteInfo.estimated]. */
    suspend fun routeInfo(from: MapPoint, to: MapPoint): RouteInfo {
        val straightKm = haversineKm(from, to)
        val straight = RouteInfo(listOf(from, to), (straightKm * 1000).toInt(), (straightKm / 25.0 * 3600).toInt(), estimated = true)
        val client = MapsGateway.client ?: return straight
        return try {
            parse(client.call("POST", "/maps/route", """{"from":{"lat":${from.lat},"lng":${from.lng}},"to":{"lat":${to.lat},"lng":${to.lng}}}""", auth = true), straight)
        } catch (e: Exception) {
            straight
        }
    }

    /** The server's answer as a route. Anything unusable gives [fallback]. */
    internal fun parse(o: JsonObject, fallback: RouteInfo): RouteInfo {
        val distance = o["distanceM"]?.jsonPrimitive?.doubleOrNull?.toInt() ?: return fallback
        val duration = o["durationS"]?.jsonPrimitive?.doubleOrNull?.toInt() ?: return fallback
        val line = o["polyline"]?.jsonPrimitive?.contentOrNull?.let { PolylineCodec.decode(it) }.orEmpty()
        val real = o["source"]?.jsonPrimitive?.contentOrNull.let { it != null && it != "estimate" } && line.size >= 2
        return RouteInfo(if (line.size >= 2) line else fallback.points, distance, duration, estimated = !real)
    }

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
