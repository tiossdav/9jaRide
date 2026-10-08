package com.ninejaride.core

import com.ninejaride.core.data.DestinationChange
import com.ninejaride.core.data.DestinationController
import com.ninejaride.core.data.MapPoint
import com.ninejaride.core.data.parseDestinationChange
import com.ninejaride.core.ui.components.BusyTracker
import kotlinx.coroutines.GlobalScope
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.yield
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** Unit tests: what a person is told when the drop-off changes, and the "please wait" cover. */
class DestinationControllerTest {
    private fun change(id: String) = DestinationChange(id, "Old Place", MapPoint(6.4, 3.44), "New Place", 4800, 900, false, 12_000)

    private fun controller(changed: MutableList<String> = mutableListOf()) =
        DestinationController(GlobalScope, { throw IllegalStateException("no network in this test") }, { "r1" }, BusyTracker(), { changed += it.id })

    @Test fun theFirstLookAtATripOnlyLearnsWhereThingsStand() {
        val changed = mutableListOf<String>()
        val c = controller(changed)
        c.observe("d1", listOf(change("d1"))) // an old change found when the app opens is not news
        assertNull(c.notice)
        assertTrue(changed.isEmpty())
    }

    @Test fun aLaterChangeIsAnnouncedOnceAndTheRouteIsRefreshed() {
        val changed = mutableListOf<String>()
        val c = controller(changed)
        c.observe("", emptyList())
        c.observe("d1", listOf(change("d1")))
        assertEquals("d1", c.notice?.id)
        assertEquals(listOf("d1"), changed)
        c.dismiss()
        c.observe("d1", listOf(change("d1"))) // the same version arriving again says nothing
        assertNull(c.notice)
        assertEquals(1, changed.size)
        c.observe("d2", listOf(change("d2"), change("d1")))
        assertEquals("d2", c.notice?.id)
    }

    @Test fun leavingTheTripForgetsEverything() {
        val c = controller()
        c.observe("", emptyList()); c.observe("d1", listOf(change("d1")))
        c.picking = true
        c.clear()
        assertNull(c.notice); assertFalse(c.picking)
        c.observe("d1", listOf(change("d1"))) // the next trip starts from a first look again
        assertNull(c.notice)
    }

    @Test fun theServersChangeIsReadWithItsDistanceAndWhetherItIsAGuess() {
        val o = Json.parseToJsonElement("""{"id":"x","oldAddress":"A","newDropoff":{"lat":6.5,"lng":3.4,"address":"B"},"remainingDistanceM":9100,"remainingDurationS":1300,"routeSource":"estimate","deltaExpectedKobo":-5000}""").jsonObject
        val parsed = parseDestinationChange(o)!!
        assertEquals("B", parsed.newAddress); assertEquals(9100, parsed.remainingDistanceM)
        assertTrue(parsed.estimated)
        assertEquals(-5000, parsed.deltaExpectedKobo) // a closer place makes the trip cheaper
        assertNull(parseDestinationChange(null))
    }

    @Test fun thePleaseWaitCoverShowsWhileWorkRunsAndAlwaysGoesAway() = runBlocking {
        val t = BusyTracker()
        assertNull(t.message)
        val job = launch { t.run("Please wait while your document is being uploaded...") { delay(80) } }
        yield(); delay(20)
        assertEquals("Please wait while your document is being uploaded...", t.message)
        assertNull(t.run("a second tap") { 1 }) // not started twice
        job.join()
        assertNull(t.message)
        // a failure also clears it, and still reaches the caller
        try { t.run("x") { throw IllegalStateException("boom") } } catch (e: IllegalStateException) { assertNotNull(e) }
        assertNull(t.message); assertFalse(t.isBusy)
    }
}
