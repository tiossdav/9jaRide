package com.ninejaride.core

import com.ninejaride.core.data.ExtensionController
import com.ninejaride.core.data.MapPoint
import com.ninejaride.core.data.TripExtension
import kotlinx.coroutines.GlobalScope
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** Unit tests: what a person is shown as a trip extension is asked, answered, declined or lapses. */
class ExtensionControllerTest {
    private fun ext(status: String, mine: Boolean, id: String = "e1") = TripExtension(
        id, if (mine) "driver" else "rider", mine, status, "Old Place", MapPoint(6.4, 3.44), "New Place", 4800, 900, 120_000, 470_000, 90, null,
    )

    private fun controller(accepted: MutableList<String> = mutableListOf()) =
        ExtensionController(GlobalScope, { throw IllegalStateException("no network in this test") }, { "r1" }, { accepted += it.id })

    @Test fun aQuestionFromTheOtherSideIsShownToBeAnswered() {
        val c = controller()
        c.update(ext("PENDING", mine = false))
        assertEquals("e1", c.shown?.id)
        assertTrue(c.shown!!.pending)
    }

    @Test fun ourOwnRequestIsShownAsWaiting_andADeclineIsShownToUsOnlyAfterWeSawItOpen() {
        val c = controller()
        c.update(ext("PENDING", mine = true))
        assertTrue(c.shown!!.mine)
        c.update(ext("DECLINED", mine = true))
        assertEquals("DECLINED", c.shown?.status) // the person who asked is told, with what to do next
        c.dismiss()
        assertNull(c.shown)
        c.update(ext("DECLINED", mine = true)) // the same answer arriving again does not bring it back
        assertNull(c.shown)
    }

    @Test fun anOldAnswerFoundWhenTheAppOpensIsNotShown() {
        val c = controller()
        c.update(ext("DECLINED", mine = true))
        assertNull(c.shown)
        c.update(ext("ACCEPTED", mine = true, id = "e0"))
        assertNull(c.shown)
    }

    @Test fun aDeclineIsNotShownToThePersonWhoDeclined() {
        val c = controller()
        c.update(ext("PENDING", mine = false))
        c.update(ext("DECLINED", mine = false))
        assertNull(c.shown)
    }

    @Test fun anAcceptanceIsShownOnceAndTellsTheAppToFollowTheNewDestination() {
        val accepted = mutableListOf<String>()
        val c = controller(accepted)
        c.update(ext("PENDING", mine = true))
        c.update(ext("ACCEPTED", mine = true))
        assertEquals("ACCEPTED", c.shown?.status)
        assertEquals(listOf("e1"), accepted)
        c.update(ext("ACCEPTED", mine = true)) // the next poll says the same: no second callback
        assertEquals(listOf("e1"), accepted)
    }

    @Test fun aWithdrawnRequestDisappearsFromTheOtherPersonsScreen() {
        val c = controller()
        c.update(ext("PENDING", mine = false))
        c.update(ext("CANCELLED", mine = false))
        assertNull(c.shown)
    }

    @Test fun lapsingShowsToTheAskerAndClearingForgetsEverything() {
        val c = controller()
        c.update(ext("PENDING", mine = true))
        c.update(ext("EXPIRED", mine = true))
        assertEquals("EXPIRED", c.shown?.status)
        c.clear()
        assertNull(c.shown); assertNull(c.current)
    }
}
