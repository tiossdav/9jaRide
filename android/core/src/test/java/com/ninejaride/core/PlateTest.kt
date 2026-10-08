package com.ninejaride.core

import com.ninejaride.core.format.formatPlate
import com.ninejaride.core.format.isValidPlate
import com.ninejaride.core.format.normalizePlate
import com.ninejaride.core.format.plateProblem
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class PlateTest {
    @Test fun `typing in any style is stored the same way`() {
        assertEquals("KJA482AB", normalizePlate("kja 482-ab"))
        assertEquals("KJA482AB", normalizePlate("KJA-482AB"))
        assertEquals("KJA482AB", normalizePlate("  kja482ab "))
    }

    @Test fun `a pasted plate with odd characters is cleaned and cut to eight`() {
        assertEquals("ABC123DE", normalizePlate("abc-123 de_45!!extra"))
    }

    @Test fun `the dash appears after the third character and only then`() {
        assertEquals("", formatPlate(""))
        assertEquals("KJ", formatPlate("kj"))
        assertEquals("KJA", formatPlate("KJA"))
        assertEquals("KJA-4", formatPlate("KJA4"))
        assertEquals("KJA-482AB", formatPlate("kja482ab"))
        assertEquals("KJA-482AB", formatPlate("KJA-482AB")) // already formatted stays the same
    }

    @Test fun `three letters, three digits and two letters is the only valid plate`() {
        assertTrue(isValidPlate("ABC-123XY"))
        assertTrue(isValidPlate("abc 123 xy"))
        listOf("AB-123XY", "ABC-12XY", "123-ABCXY", "ABC-1234X", "ABCD-123XY", "ABC-123X", "").forEach { assertFalse(it, isValidPlate(it)) }
    }

    @Test fun `the field message appears only for a plate that breaks the rule`() {
        assertNull(plateProblem("KJA-482AB"))
        assertNotNull(plateProblem("KJA-48"))
        assertTrue(plateProblem("AB-123XY")!!.contains("ABC-123XY"))
    }
}
