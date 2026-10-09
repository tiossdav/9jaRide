package com.ninejaride.core

import com.ninejaride.core.data.MapPoint
import com.ninejaride.core.data.RouteInfo
import com.ninejaride.core.data.Routing
import com.ninejaride.core.data.TopUpOutcome
import com.ninejaride.core.data.TopUpState
import com.ninejaride.core.data.TopUps
import com.ninejaride.core.format.nairaTextToKobo
import com.ninejaride.core.format.topUpAllowed
import com.ninejaride.core.format.topUpProblem
import com.ninejaride.core.ui.components.isCheckoutFinished
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/** What the apps do with the server's answer about a wallet top-up, and the provider-neutral route answer. */
class TopUpTest {
    @Test fun theServersWordsBecomeStates() {
        assertEquals(TopUpState.Success, TopUps.parseState("success"))
        assertEquals(TopUpState.Failed, TopUps.parseState("failed"))
        assertEquals(TopUpState.Cancelled, TopUps.parseState("cancelled"))
        assertEquals(TopUpState.Mismatch, TopUps.parseState("mismatch"))
        assertEquals(TopUpState.Pending, TopUps.parseState("pending"))
    }

    @Test fun anUnknownOrMissingWordIsNeverTreatedAsSuccess() {
        assertEquals(TopUpState.Pending, TopUps.parseState(null))
        assertEquals(TopUpState.Pending, TopUps.parseState("SUCCESS "))
        assertEquals(TopUpState.Pending, TopUps.parseState("paid"))
    }

    @Test fun onlyAPendingPaymentIsWorthAskingAboutAgain() {
        assertFalse(TopUps.isFinal(TopUpOutcome(TopUpState.Pending, 100_000)))
        TopUpState.values().filter { it != TopUpState.Pending }.forEach { assertTrue(TopUps.isFinal(TopUpOutcome(it, 100_000))) }
    }

    @Test fun eachOutcomeHasAPlainMessage() {
        val ok = TopUps.message(TopUpOutcome(TopUpState.Success, 250_000))
        assertEquals("Payment received", ok.first)
        assertTrue(ok.second.contains("2,500"))
        assertTrue(TopUps.message(TopUpOutcome(TopUpState.Cancelled, 0)).second.contains("Nothing was charged"))
        assertTrue(TopUps.message(TopUpOutcome(TopUpState.Failed, 0)).second.contains("not charged"))
        assertTrue(TopUps.message(TopUpOutcome(TopUpState.Pending, 0)).first.contains("Confirming"))
        assertTrue(TopUps.message(TopUpOutcome(TopUpState.Mismatch, 0)).second.contains("support"))
    }

    private fun obj(s: String) = Json.parseToJsonElement(s).jsonObject
    private val fallback = RouteInfo(listOf(MapPoint(6.5, 3.3), MapPoint(6.6, 3.4)), 15_000, 3000, estimated = true)

    @Test fun aRoadRouteFromEitherProviderIsDrawnAndNotMarkedAsAGuess() {
        for (source in listOf("road", "google", "mapbox")) {
            val r = Routing.parse(obj("""{"distanceM":5230,"durationS":812,"polyline":"_p~iF~ps|U_ulLnnqC","source":"$source"}"""), fallback)
            assertFalse(source, r.estimated)
            assertEquals(2, r.points.size)
        }
    }

    @Test fun aRouteWithoutALineOrAnEstimateIsMarkedAsAGuess() {
        assertTrue(Routing.parse(obj("""{"distanceM":9000,"durationS":1200,"polyline":null,"source":"road"}"""), fallback).estimated)
        assertTrue(Routing.parse(obj("""{"distanceM":9000,"durationS":1200,"polyline":"_p~iF~ps|U_ulLnnqC","source":"estimate"}"""), fallback).estimated)
    }

    private val back = "https://api.9jaridepro.com/payments/return"

    @Test fun theInAppPaymentPageClosesWhenItHeadsBackToUsOrPaystackCloses() {
        assertTrue(isCheckoutFinished("$back?trxref=topup_1&reference=topup_1", back))
        assertTrue(isCheckoutFinished("https://standard.paystack.co/close", back))
        assertTrue(isCheckoutFinished("https://checkout.paystack.com/close", back))
    }

    @Test fun otherPagesStayInsideTheCheckout() {
        assertFalse(isCheckoutFinished("https://checkout.paystack.com/abc123", back))
        assertFalse(isCheckoutFinished("https://api.9jaridepro.com/health", back))
        assertFalse(isCheckoutFinished("https://evil.example/payments/return", back))
    }

    @Test fun anyAmountFromOneThousandNairaIsAllowed() {
        assertEquals(100_000L, nairaTextToKobo("1000"))
        assertEquals(150_000L, nairaTextToKobo("1,500"))
        assertTrue(topUpAllowed(nairaTextToKobo("1000")))
        assertTrue(topUpAllowed(nairaTextToKobo("7350")))
        assertTrue(topUpAllowed(nairaTextToKobo("500000")))
        assertEquals(null, topUpProblem(nairaTextToKobo("1000")))
    }

    @Test fun nothingBelowOneThousandNairaOrAboveTheLimit() {
        assertFalse(topUpAllowed(nairaTextToKobo("999")))
        assertFalse(topUpAllowed(nairaTextToKobo("0")))
        assertFalse(topUpAllowed(nairaTextToKobo("500001")))
        assertTrue(topUpProblem(nairaTextToKobo("500"))!!.contains("₦1,000"))
        assertTrue(topUpProblem(nairaTextToKobo("600000"))!!.contains("most"))
    }

    @Test fun anEmptyBoxIsNotAnAmountAndGetsNoScolding() {
        assertEquals(null, nairaTextToKobo(""))
        assertEquals(null, nairaTextToKobo("abc"))
        assertFalse(topUpAllowed(null))
        assertEquals(null, topUpProblem(null))
    }
}
