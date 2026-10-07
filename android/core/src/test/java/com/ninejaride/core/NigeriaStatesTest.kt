package com.ninejaride.core

import com.ninejaride.core.data.MapPoint
import com.ninejaride.core.data.NigeriaStates
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/** Unit tests: a search moves to another state only when the words typed end in that state or one of its big towns. */
class NigeriaStatesTest {
    private fun state(q: String) = NigeriaStates.trailing(q)?.name

    @Test fun aStateAtTheEndMovesTheSearch() {
        assertEquals("Lagos", state("Allen Avenue, Lagos"))
        assertEquals("Lagos", state("Allen Avenue Lagos"))
        assertEquals("Lagos", state("Ikeja City Mall, Lagos State"))
        assertEquals("Oyo", state("Bodija Market Ibadan"))
        assertEquals("Federal Capital Territory", state("Wuse 2, Abuja"))
        assertEquals("Rivers", state("Aba Road Port Harcourt"))
        assertEquals("Lagos", state("lagos"))
    }

    @Test fun aStateInTheMiddleOrAStreetNameDoesNot() {
        assertNull(state("Lagos Street"))
        assertNull(state("Ibadan Road"))
        assertNull(state("Abuja Close Estate"))
        assertNull(state("Ikeja City Mall"))
        assertNull(state("Newlagos"))
        assertNull(state(""))
    }

    @Test fun theBiggerNameWins() {
        assertEquals("Edo", state("Ring Road Benin City"))
        assertEquals("Akwa Ibom", state("Ikot Ekpene"))
    }

    @Test fun aPersonIsPlacedInTheNearestState() {
        assertEquals("Oyo", NigeriaStates.around(MapPoint(7.4478, 3.9552)).name)
        assertEquals("Lagos", NigeriaStates.around(MapPoint(6.60, 3.35)).name)
    }
}
