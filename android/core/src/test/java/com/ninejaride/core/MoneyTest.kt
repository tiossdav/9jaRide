package com.ninejaride.core

import com.ninejaride.core.format.clock
import com.ninejaride.core.format.minutesSeconds
import com.ninejaride.core.format.naira
import com.ninejaride.core.format.nairaMinus
import com.ninejaride.core.format.nairaSigned
import org.junit.Assert.assertEquals
import org.junit.Test

/** Unit tests: how money and time are written on screen. Money is whole kobo, as on the server. */
class MoneyTest {
    @Test fun wholeNairaHasNoDecimals() = assertEquals("₦2,260", naira(226_000))
    @Test fun koboAreKeptWhenThereAreAny() = assertEquals("₦2,260.50", naira(226_050))
    @Test fun decimalsCanBeForced() = assertEquals("₦2,260.00", naira(226_000, forceDecimals = true))
    @Test fun zero() = assertEquals("₦0", naira(0))
    @Test fun bigAmountsGetThousandsSeparators() = assertEquals("₦12,345,678", naira(1_234_567_800))
    @Test fun negativeKeepsTheSignInFront() = assertEquals("-₦120", naira(-12_000))
    @Test fun signedAmounts() {
        assertEquals("+₦1,988.80", nairaSigned(198_880))
        assertEquals("−₦120.00", nairaSigned(-12_000))
        assertEquals("−₦267.60", nairaMinus(26_760))
    }
    @Test fun clockPadsMinutesAndSeconds() {
        assertEquals("02:50", clock(170))
        assertEquals("00:05", clock(5))
        assertEquals("10:00", clock(600))
    }
    @Test fun minutesAndSeconds() = assertEquals("11m 40s", minutesSeconds(700))
}
