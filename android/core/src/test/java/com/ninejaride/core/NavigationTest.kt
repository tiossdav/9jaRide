package com.ninejaride.core

import com.ninejaride.core.data.MapPoint
import com.ninejaride.core.data.RouteProgress
import com.ninejaride.core.data.RouteStep
import com.ninejaride.core.data.Routing
import com.ninejaride.core.data.RouteInfo
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** The turn-by-turn banner: which manoeuvre is next, and how far, from where the car is on the road. */
class NavigationTest {
    // a road straight north, about 2.2 km: start, a turn about 1.1 km along, the end
    private val road = listOf(MapPoint(6.600, 3.35), MapPoint(6.610, 3.35), MapPoint(6.620, 3.35))
    private val steps = listOf(
        RouteStep("Head north on Allen Avenue", MapPoint(6.600, 3.35), "depart"),
        RouteStep("Turn left onto Obafemi Awolowo Way", MapPoint(6.610, 3.35), "turn left"),
        RouteStep("You have arrived", MapPoint(6.620, 3.35), "arrive"),
    )

    @Test fun atTheStartTheFirstInstructionIsShown() {
        assertEquals("Head north on Allen Avenue", RouteProgress.nextTurn(road, steps, MapPoint(6.6000, 3.35))!!.instruction)
    }

    @Test fun onTheWayTheNextTurnAndItsDistanceAreShown() {
        val t = RouteProgress.nextTurn(road, steps, MapPoint(6.6050, 3.35))!! // about 555 m before the turn
        assertEquals("Turn left onto Obafemi Awolowo Way", t.instruction)
        assertTrue("distance was ${t.distanceM}", t.distanceM in 520..590)
        assertEquals("turn left", t.type)
    }

    @Test fun theTurnStaysUntilTheCarIsPastItThenTheNextOneShows() {
        assertEquals("Turn left onto Obafemi Awolowo Way", RouteProgress.nextTurn(road, steps, MapPoint(6.60995, 3.35))!!.instruction) // 5 m before
        assertEquals("Turn left onto Obafemi Awolowo Way", RouteProgress.nextTurn(road, steps, MapPoint(6.61005, 3.35))!!.instruction) // 5 m past: GPS jitter must not skip it
        assertEquals("You have arrived", RouteProgress.nextTurn(road, steps, MapPoint(6.6120, 3.35))!!.instruction)                  // well past
    }

    @Test fun noStepsOrNoRoadGivesNoBanner() {
        assertNull(RouteProgress.nextTurn(road, emptyList(), MapPoint(6.605, 3.35)))
        assertNull(RouteProgress.nextTurn(emptyList(), steps, MapPoint(6.605, 3.35)))
    }

    @Test fun theServersStepsAreReadAndOnlyKeptForARealRoute() {
        val json = """{"distanceM":2200,"durationS":300,"polyline":"_p~iF~ps|U_ulLnnqC","source":"road","steps":[{"instruction":"Turn left","distanceM":500,"lat":6.61,"lng":3.35,"type":"turn left"},{"distanceM":1,"lat":1.0}]}"""
        val fallback = RouteInfo(listOf(MapPoint(6.5, 3.3), MapPoint(6.6, 3.4)), 15_000, 3000, estimated = true)
        val r = Routing.parse(Json.parseToJsonElement(json).jsonObject, fallback)
        assertEquals(1, r.steps.size) // the half-empty one is dropped
        assertEquals("Turn left", r.steps[0].instruction)
        assertNotNull(r.steps[0].at)
        val est = Routing.parse(Json.parseToJsonElement(json.replace("\"road\"", "\"estimate\"")).jsonObject, fallback)
        assertTrue(est.steps.isEmpty())
    }
}
