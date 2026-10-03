package com.ninejaride.core

import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import com.ninejaride.core.ui.components.ConfirmRequest
import com.ninejaride.core.ui.components.ConfirmSheet
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test

/** Component tests, run on a phone or emulator: the second tap that guards every consequential action. */
class ConfirmSheetTest {
    @get:Rule val rule = createComposeRule()

    @Test fun theActionDoesNotRunUntilTheConfirmButtonIsTapped() {
        var ran = 0
        var dismissed = 0
        rule.setContent { ConfirmSheet(ConfirmRequest("Decline this ride?", "The rider is matched with another driver.", "Yes, decline", true) { ran++ }) { dismissed++ } }
        rule.onNodeWithText("Decline this ride?").assertIsDisplayed()
        assertEquals(0, ran)
        rule.onNodeWithText("Yes, decline").performClick()
        assertEquals(1, ran)
        assertEquals(1, dismissed)
    }

    @Test fun goingBackRunsNothing() {
        var ran = 0
        var dismissed = 0
        rule.setContent { ConfirmSheet(ConfirmRequest("Start the trip?", "Only start once the rider is in.", "Yes, start", false) { ran++ }) { dismissed++ } }
        rule.onNodeWithText("Go back").performClick()
        assertEquals(0, ran)
        assertEquals(1, dismissed)
    }
}
