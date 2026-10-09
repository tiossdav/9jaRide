package com.ninejaride.core

import com.ninejaride.core.location.Reading
import com.ninejaride.core.location.shouldReplace
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/** Which of the phone's position readings is believed: a fresh GPS reading must not be overwritten by a rough network one. */
class DeviceLocationTest {
    private val now = 1_000_000L
    private fun gps(ageMs: Long, acc: Float? = 8f, lat: Double = 6.60, lng: Double = 3.35) = Reading(lat, lng, acc, now - ageMs, true)
    private fun net(ageMs: Long, acc: Float? = 900f) = Reading(6.50, 3.30, acc, now - ageMs, false)

    @Test fun theFirstReadingIsTaken() { assertTrue(shouldReplace(null, net(0), now)) }

    @Test fun aRoughNetworkReadingDoesNotOverwriteAFreshGpsOne() { assertFalse(shouldReplace(gps(5_000), net(0), now)) }

    @Test fun aNetworkReadingIsUsedOnceTheGpsOneHasGoneStale() { assertTrue(shouldReplace(gps(60_000), net(0), now)) }

    @Test fun gpsAlwaysBeatsNetwork() { assertTrue(shouldReplace(net(1_000), gps(0), now)) }

    @Test fun anOlderReadingNeverReplacesANewerOne() { assertFalse(shouldReplace(gps(1_000), gps(30_000), now)) }

    @Test fun betweenTwoGpsReadingsTheLessAccurateFreshOneIsIgnored() {
        assertFalse(shouldReplace(gps(2_000, 5f), gps(0, 60f), now))
        assertTrue(shouldReplace(gps(2_000, 60f), gps(0, 5f), now))
        assertTrue(shouldReplace(gps(40_000, 5f), gps(0, 60f), now)) // the good one is stale now
    }

    @Test fun nonsenseCoordinatesAreRefused() {
        assertFalse(shouldReplace(null, Reading(Double.NaN, 3.0, 5f, now, true), now))
        assertFalse(shouldReplace(null, Reading(95.0, 3.0, 5f, now, true), now))
        assertFalse(shouldReplace(null, Reading(6.5, 200.0, 5f, now, true), now))
    }
}
