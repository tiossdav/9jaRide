package com.ninejaride.core

import com.ninejaride.core.data.Geocoding
import com.ninejaride.core.data.MapPoint
import com.ninejaride.core.data.PolylineCodec
import com.ninejaride.core.data.RouteInfo
import com.ninejaride.core.data.Routing
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/** Unit tests for what comes back from the server's map service: the road line, the route numbers and the place list. */
class MapsDataTest {
    private fun obj(s: String) = Json.parseToJsonElement(s).jsonObject

    @Test fun googlesOwnExampleLineDecodes() {
        // the worked example in Google's polyline documentation
        val pts = PolylineCodec.decode("_p~iF~ps|U_ulLnnqC_mqNvxq`@")
        assertEquals(3, pts.size)
        assertEquals(38.5, pts[0].lat, 1e-5); assertEquals(-120.2, pts[0].lng, 1e-5)
        assertEquals(40.7, pts[1].lat, 1e-5); assertEquals(-120.95, pts[1].lng, 1e-5)
        assertEquals(43.252, pts[2].lat, 1e-5); assertEquals(-126.453, pts[2].lng, 1e-5)
    }

    @Test fun aBrokenLineGivesWhatCouldBeReadAndNeverCrashes() {
        assertTrue(PolylineCodec.decode("").isEmpty())
        PolylineCodec.decode("_p~iF~ps|U_ulL") // cut off in the middle of a point
    }

    private val fallback = RouteInfo(listOf(MapPoint(6.5, 3.3), MapPoint(6.6, 3.4)), 15_000, 3000, estimated = true)

    @Test fun aRealRouteIsDrawnAndNotMarkedAsAGuess() {
        val r = Routing.parse(obj("""{"distanceM":5230,"durationS":812,"polyline":"_p~iF~ps|U_ulLnnqC","source":"google"}"""), fallback)
        assertEquals(5230, r.distanceM); assertEquals(812, r.durationS)
        assertEquals(2, r.points.size)
        assertFalse(r.estimated)
    }

    @Test fun anEstimateFromTheServerStaysMarkedAsAGuess() {
        val r = Routing.parse(obj("""{"distanceM":9000,"durationS":1200,"polyline":null,"source":"estimate"}"""), fallback)
        assertTrue(r.estimated)
        assertEquals(fallback.points, r.points) // a straight line, not an invented road
        assertEquals(9000, r.distanceM)
    }

    @Test fun anUnusableAnswerFallsBackToTheStraightLine() {
        assertEquals(fallback, Routing.parse(obj("""{"message":"nope"}"""), fallback))
    }

    @Test fun placesAreReadWithTheirNamesAndDistances() {
        val places = Geocoding.parse(obj("""{"places":[
            {"id":"a","name":"Computer Village","address":"Ikeja, Lagos, Nigeria","lat":6.5964,"lng":3.3426,"distanceM":2300},
            {"id":"b","name":"KFC","address":"KFC, Ring Road, Ibadan, 200001, Nigeria","lat":7.35,"lng":3.88},
            {"id":"c","name":"No place","address":"x"}]}"""))
        assertEquals(2, places.size) // the one without a position is dropped
        assertEquals("Computer Village, Ikeja, Lagos", places[0].address)
        assertEquals(2.3, places[0].distanceKm!!, 1e-9)
        assertEquals("KFC, Ring Road, Ibadan", places[1].address) // the name is not said twice, the country and postcode are dropped
        assertEquals(null, places[1].distanceKm)
    }

    @Test fun nigerianShortNamesAreExpandedBeforeSearching() {
        assertEquals("Victoria Island, Lagos", Geocoding.expand("VI"))
        assertEquals("KFC Bodija", Geocoding.expand("KFC Bodija"))
    }
}
