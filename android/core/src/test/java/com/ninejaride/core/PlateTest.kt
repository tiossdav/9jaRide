package com.ninejaride.core

import com.ninejaride.core.format.formatPlate
import com.ninejaride.core.format.normalizePlate
import org.junit.Assert.assertEquals
import org.junit.Test

class PlateTest {
    @Test fun `typing in any style is stored the same way`() {
        assertEquals("KJA482AB", normalizePlate("kja 482-ab"))
        assertEquals("KJA482AB", normalizePlate("KJA-482AB"))
        assertEquals("KJA482AB", normalizePlate("  kja482ab "))
    }

    @Test fun `a pasted plate with odd characters is cleaned and cut to length`() {
        assertEquals("ABC123DE45", normalizePlate("abc-123 de_45!!extra"))
    }

    @Test fun `the dash appears after the third character and only then`() {
        assertEquals("", formatPlate(""))
        assertEquals("KJ", formatPlate("kj"))
        assertEquals("KJA", formatPlate("KJA"))
        assertEquals("KJA-4", formatPlate("KJA4"))
        assertEquals("KJA-482AB", formatPlate("kja482ab"))
        assertEquals("KJA-482AB", formatPlate("KJA-482AB")) // already formatted stays the same
    }
}
