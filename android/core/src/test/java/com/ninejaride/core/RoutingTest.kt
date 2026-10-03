package com.ninejaride.core

import com.ninejaride.core.data.MapPoint
import com.ninejaride.core.data.Routing
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/** Unit tests: the map maths the ride screens depend on (distance, and where the car is along a road). */
class RoutingTest {
    private val ibadan = MapPoint(7.3775, 3.9470)
    private val lagos = MapPoint(6.5244, 3.3792)

    @Test fun distanceBetweenIbadanAndLagosIsAboutOneHundredAndFourteenKm() {
        val km = Routing.haversineKm(ibadan, lagos)
        assertTrue("got $km", km in 110.0..118.0)
    }
    @Test fun distanceToTheSamePlaceIsZero() = assertEquals(0.0, Routing.haversineKm(ibadan, ibadan), 1e-9)
    @Test fun distanceIsTheSameBothWays() = assertEquals(Routing.haversineKm(ibadan, lagos), Routing.haversineKm(lagos, ibadan), 1e-9)

    private val road = listOf(MapPoint(0.0, 0.0), MapPoint(0.0, 1.0), MapPoint(0.0, 2.0))
    @Test fun carStartsAtTheStart() = assertEquals(road.first(), Routing.pointAt(road, 0.0))
    @Test fun carEndsAtTheEnd() = assertEquals(road.last(), Routing.pointAt(road, 1.0))
    @Test fun carIsHalfwayAtHalf() = assertEquals(1.0, Routing.pointAt(road, 0.5).lng, 1e-6)
    @Test fun carNeverLeavesTheRoad() {
        assertEquals(road.first(), Routing.pointAt(road, -3.0))
        assertEquals(road.last(), Routing.pointAt(road, 9.0))
    }
    @Test fun noRoadGivesAHarmlessPoint() = assertEquals(MapPoint(0.0, 0.0), Routing.pointAt(emptyList(), 0.5))
    @Test fun aSinglePointRoadStaysPut() = assertEquals(ibadan, Routing.pointAt(listOf(ibadan), 0.7))
}
