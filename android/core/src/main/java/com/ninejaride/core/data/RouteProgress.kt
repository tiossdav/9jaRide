package com.ninejaride.core.data

import kotlin.math.cos

/**
 * Where a car is along the road it is following, like a navigation app: the point on the road nearest the GPS reading,
 * how far it is from the road, and the road still ahead. Distances are in metres. A small local projection is used,
 * which is accurate to well under a metre over city distances.
 */
data class RouteFix(
    /** The car's place, moved onto the road. */
    val onRoad: MapPoint,
    /** How far the GPS reading is from the road. Large means the car has left the route. */
    val offRouteM: Double,
    /** Road still to drive, from [onRoad] to the end. */
    val remainingM: Double,
    /** The road still ahead, starting at [onRoad]: what to draw. */
    val ahead: List<MapPoint>,
)

object RouteProgress {
    /** Further than this from the road (after a couple of readings) means the driver took another way: route again. */
    const val OFF_ROUTE_M = 50.0

    private const val M_PER_DEG = 111_195.0

    /** Total length of a road, in metres. */
    fun lengthM(route: List<MapPoint>): Double = route.zipWithNext { a, b -> Routing.haversineKm(a, b) * 1000 }.sum()

    /** Projects [p] onto [route]. Null when there is no road to follow. */
    fun locate(route: List<MapPoint>, p: MapPoint): RouteFix? {
        if (route.size < 2) return null
        val kx = M_PER_DEG * cos(Math.toRadians(p.lat)) // metres per degree of longitude here
        var best = -1
        var bestT = 0.0
        var bestD = Double.MAX_VALUE
        for (i in 0 until route.size - 1) {
            val a = route[i]; val b = route[i + 1]
            val ax = (a.lng - p.lng) * kx; val ay = (a.lat - p.lat) * M_PER_DEG
            val bx = (b.lng - p.lng) * kx; val by = (b.lat - p.lat) * M_PER_DEG
            val dx = bx - ax; val dy = by - ay
            val len2 = dx * dx + dy * dy
            val t = if (len2 == 0.0) 0.0 else (-(ax * dx + ay * dy) / len2).coerceIn(0.0, 1.0)
            val cx = ax + t * dx; val cy = ay + t * dy
            val d = Math.sqrt(cx * cx + cy * cy)
            if (d < bestD) { bestD = d; best = i; bestT = t }
        }
        val a = route[best]; val b = route[best + 1]
        val onRoad = MapPoint(a.lat + (b.lat - a.lat) * bestT, a.lng + (b.lng - a.lng) * bestT)
        val ahead = listOf(onRoad) + route.subList(best + 1, route.size)
        return RouteFix(onRoad, bestD, lengthM(ahead), ahead)
    }

    /** Time left, scaled from the route's own estimate by the share of road still ahead. Whole minutes, at least one. */
    fun minutesLeft(routeDurationS: Int, routeLengthM: Double, remainingM: Double): Int {
        if (routeLengthM <= 0) return 1
        return Math.ceil(routeDurationS * (remainingM / routeLengthM) / 60.0).toInt().coerceAtLeast(1)
    }
}
