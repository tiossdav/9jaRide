package com.ninejaride.core

import com.ninejaride.core.data.Geocoding
import com.ninejaride.core.data.MapPoint
import com.ninejaride.core.data.Place
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/** Unit tests: results around the rider come before similar names in other cities. */
class GeocodingRankTest {
    private val ikeja = MapPoint(6.6018, 3.3515)
    private val lagosMall = Place("Ikeja City Mall, Obafemi Awolowo Way, Ikeja, Lagos", MapPoint(6.6130, 3.3580))
    private val abujaMall = Place("Ikeja City Mall, Wuse, Abuja", MapPoint(9.0765, 7.3986))
    private val lagosStop = Place("Ikeja Along Bus Stop, Ikeja, Lagos", MapPoint(6.6100, 3.3400))

    @Test fun aLagosRiderSeesLagosFirstEvenWhenAbujaIsListedFirst() {
        val r = Geocoding.rank("ikeja city mall", listOf(abujaMall, lagosStop, lagosMall), ikeja)
        assertEquals(listOf("Ikeja City Mall, Obafemi Awolowo Way, Ikeja, Lagos", "Ikeja Along Bus Stop, Ikeja, Lagos", "Ikeja City Mall, Wuse, Abuja"), r.map { it.address })
        assertTrue(r.first().distanceKm!! < 5)
    }

    @Test fun anExactNameBeatsAMerelyCloserPlace() {
        val r = Geocoding.rank("ikeja city mall", listOf(lagosStop, lagosMall), ikeja)
        assertEquals("Ikeja City Mall", r.first().address.substringBefore(","))
    }

    @Test fun withoutALocationTheOrderIsLeftAlone() {
        assertEquals(listOf(abujaMall, lagosMall), Geocoding.rank("x", listOf(abujaMall, lagosMall), null))
    }

    @Test fun theSamePlaceFoundTwiceIsShownOnce() {
        val twin = Place("Ikeja City Mall, Ikeja", MapPoint(6.61305, 3.35805))
        assertEquals(1, Geocoding.rank("ikeja city mall", listOf(lagosMall, twin), ikeja).size)
    }
}
