package com.ninejaride.core.data

import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.longOrNull
import kotlinx.serialization.json.put

/** The chat calls, the same for the rider and the driver app. */
private fun JsonObject.text(k: String) = (this[k] as? JsonPrimitive)?.contentOrNull

private fun message(o: JsonObject) = ChatMessage(
    (o["id"] as? JsonPrimitive)?.longOrNull ?: 0L, (o["mine"] as? JsonPrimitive)?.booleanOrNull == true, o.text("text").orEmpty(), o.text("at").orEmpty(),
)

/** New messages after [after]; with [waitSeconds] the server holds the answer until one arrives. */
suspend fun ApiClient.chatPage(rideId: String, after: Long, waitSeconds: Int): ChatPage {
    val o = call("GET", "/rides/$rideId/messages?after=$after&wait=$waitSeconds", auth = true, patient = waitSeconds > 0)
    return ChatPage(
        (o["messages"] as? JsonArray)?.map { message(it.jsonObject) }.orEmpty(),
        (o["open"] as? JsonPrimitive)?.booleanOrNull != false,
        ((o["unread"] as? JsonPrimitive)?.longOrNull ?: 0L).toInt(),
        o.text("with").orEmpty(),
    )
}

/** Sends one message. [clientId] makes a retry safe: the same id is stored once. */
suspend fun ApiClient.chatSend(rideId: String, text: String, clientId: String): ChatMessage =
    message(call("POST", "/rides/$rideId/messages", buildJsonObject { put("text", text); put("clientId", clientId) }.toString(), auth = true))

suspend fun ApiClient.chatRead(rideId: String, upTo: Long) {
    call("POST", "/rides/$rideId/messages/read", buildJsonObject { put("upTo", upTo) }.toString(), auth = true)
}
