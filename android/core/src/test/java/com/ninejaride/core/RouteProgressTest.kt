package com.ninejaride.core

import com.ninejaride.core.data.MapPoint
import com.ninejaride.core.data.RouteProgress
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** Unit tests: following a car along its road, as the live route on both apps does. */
class RouteProgressTest {
    // an L-shaped road in Lagos: 1 km north, then 1 km east
    private val start = MapPoint(6.5000, 3.3500)
    private val corner = MapPoint(6.5000 + 1000 / 111_195.0, 3.3500)
    private val end = MapPoint(corner.lat, 3.3500 + 1000 / (111_195.0 * Math.cos(Math.toRadians(corner.lat))))
    private val road = listOf(start, corner, end)

    @Test fun theRoadIsTwoKilometres() = assertEquals(2000.0, RouteProgress.lengthM(road), 5.0)

    @Test fun aCarOnTheRoadIsOnIt() {
        val halfway = MapPoint(start.lat + 500 / 111_195.0, start.lng)
        val fix = RouteProgress.locate(road, halfway)!!
        assertTrue(fix.offRouteM < 1.0)
        assertEquals(1500.0, fix.remainingM, 5.0)
        assertEquals(3, fix.ahead.size) // where the car is, the corner, the end
    }

    @Test fun aReadingBesideTheRoadIsMovedOntoIt() {
        // 20 m to the west of the first leg, 300 m up
        val beside = MapPoint(start.lat + 300 / 111_195.0, start.lng - 20 / (111_195.0 * Math.cos(Math.toRadians(start.lat))))
        val fix = RouteProgress.locate(road, beside)!!
        assertEquals(20.0, fix.offRouteM, 1.0)
        assertEquals(start.lng, fix.onRoad.lng, 1e-6)
        assertEquals(1700.0, fix.remainingM, 5.0)
    }

    @Test fun aCarThatTookAnotherWayIsOffRoute() {
        val elsewhere = MapPoint(start.lat - 0.005, start.lng - 0.005) // half a kilometre away
        assertTrue(RouteProgress.locate(road, elsewhere)!!.offRouteM > RouteProgress.OFF_ROUTE_M)
    }

    @Test fun pastTheCornerOnlyTheLastLegIsAhead() {
        val onSecondLeg = MapPoint(corner.lat, (corner.lng + end.lng) / 2)
        val fix = RouteProgress.locate(road, onSecondLeg)!!
        assertEquals(500.0, fix.remainingM, 5.0)
        assertEquals(2, fix.ahead.size)
    }

    @Test fun noRoadNoFix() = assertNull(RouteProgress.locate(listOf(start), start))

    @Test fun timeLeftShrinksWithTheRoad() {
        assertEquals(10, RouteProgress.minutesLeft(600, 2000.0, 2000.0))
        assertEquals(5, RouteProgress.minutesLeft(600, 2000.0, 1000.0))
        assertEquals(1, RouteProgress.minutesLeft(600, 2000.0, 0.0))
    }
}
