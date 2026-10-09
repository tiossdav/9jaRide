package com.ninejaride.core.data

import android.content.Context
import com.ninejaride.core.format.naira
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.longOrNull

/** Where a wallet top-up stands, as Paystack confirmed it to the server. Only [Success] means the money is in the wallet. */
enum class TopUpState { Success, Pending, Failed, Cancelled, Mismatch }

data class TopUpStart(val reference: String, val url: String)
data class TopUpOutcome(val state: TopUpState, val amountKobo: Long)

/**
 * Wallet top-ups through Paystack, shared by the rider and driver apps. The app only opens Paystack's page and later asks the server
 * what happened; the server asks Paystack and credits the wallet itself. The app never tells the server that a payment succeeded.
 */
object TopUps {
    /** Starts a payment. The returned page is where the person pays; [TopUpStart.reference] is what to ask about afterwards. */
    suspend fun start(client: ApiClient, amountKobo: Long): TopUpStart {
        val o = client.call("POST", "/wallet/topups", """{"amountKobo":$amountKobo}""", auth = true)
        val reference = o["reference"]?.jsonPrimitive?.contentOrNull
        val url = o["authorizationUrl"]?.jsonPrimitive?.contentOrNull
        if (reference.isNullOrBlank() || url.isNullOrBlank()) throw ApiException(502, null, "The payment page could not be opened. Please try again.")
        return TopUpStart(reference, url)
    }

    /** Asks the server (which asks Paystack) how the payment went. */
    suspend fun status(client: ApiClient, reference: String): TopUpOutcome {
        val o = client.call("GET", "/wallet/topups/$reference", auth = true)
        return TopUpOutcome(parseState(o["state"]?.jsonPrimitive?.contentOrNull), o["amountKobo"]?.jsonPrimitive?.longOrNull ?: 0)
    }

    /** An unknown word is treated as "still waiting", never as success. */
    internal fun parseState(s: String?): TopUpState = when (s) {
        "success" -> TopUpState.Success
        "failed" -> TopUpState.Failed
        "cancelled" -> TopUpState.Cancelled
        "mismatch" -> TopUpState.Mismatch
        else -> TopUpState.Pending
    }

    /** True once there is nothing more to wait for, so the saved reference can be dropped. */
    fun isFinal(o: TopUpOutcome) = o.state != TopUpState.Pending

    /** What to tell the person. */
    fun message(o: TopUpOutcome): Pair<String, String> = when (o.state) {
        TopUpState.Success -> "Payment received" to "${naira(o.amountKobo)} has been added to your wallet."
        TopUpState.Pending -> "Confirming your payment" to "We have not heard back from Paystack yet. If you paid, your balance will update in a minute or two."
        TopUpState.Cancelled -> "Payment not completed" to "You left the payment page before paying. Nothing was charged."
        TopUpState.Failed -> "Payment failed" to "The payment did not go through and you were not charged. Please try again."
        TopUpState.Mismatch -> "Payment needs checking" to "The amount paid did not match, so it was not added. Please contact support and we will sort it out."
    }
}

/** The payment the person is in the middle of, kept on the phone so the answer is still asked for if the app was closed meanwhile. */
class PendingTopUp(context: Context) {
    private val prefs = context.getSharedPreferences("pending_topup", Context.MODE_PRIVATE)
    var reference: String?
        get() = prefs.getString("reference", null)
        set(v) { prefs.edit().apply { if (v == null) remove("reference") else putString("reference", v) }.apply() }
}
