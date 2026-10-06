package com.ninejaride.core.data

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import java.util.UUID

enum class SendState { Sent, Sending, Failed }

/** One line of the conversation. A message still on its way has a negative [id] and a [clientId]. */
class ChatMessage(val id: Long, val mine: Boolean, val text: String, val atIso: String, val state: SendState = SendState.Sent, val clientId: String? = null, val error: String? = null)

/** What the server says about the conversation: the new messages, whether writing is still allowed, and the unread count. */
class ChatPage(val messages: List<ChatMessage>, val open: Boolean, val unread: Int, val with: String)

/**
 * The chat of one active trip, for either app. It asks the server for new messages with the same "hold the request until
 * something happens" pattern the ride status uses (about three requests a minute, and a message shows at once), keeps what it
 * has shown, marks messages read while the chat screen is open, and sends with a retry. The two apps give it their own calls.
 */
class ChatController(
    private val scope: CoroutineScope,
    private val fetch: suspend (after: Long, waitSeconds: Int) -> ChatPage,
    private val send: suspend (text: String, clientId: String) -> ChatMessage,
    private val markRead: suspend (upTo: Long) -> Unit,
    /** True while the app is on screen: the phone does not ask for messages while it is in the pocket (a push notification tells it instead). */
    private val appVisible: () -> Boolean,
) {
    val messages = mutableStateListOf<ChatMessage>()
    /** Can the person write? False once the trip is over. */
    var open by mutableStateOf(true)
    var unread by mutableStateOf(0)
    var other by mutableStateOf("")
    /** False until the first answer arrives. */
    var loaded by mutableStateOf(false)
    /** True while the phone cannot reach the server; it keeps trying. */
    var reconnecting by mutableStateOf(false)
    var screenOpen by mutableStateOf(false)
    private var rideId: String? = null
    private var job: Job? = null
    private var lastId = 0L

    /** Starts following this trip's chat. Safe to call again for the same trip. */
    fun start(ride: String) {
        if (rideId == ride && job?.isActive == true) return
        stop()
        rideId = ride
        job = scope.launch { loop(ride) }
    }

    fun stop() {
        job?.cancel(); job = null; rideId = null
        messages.clear(); lastId = 0; unread = 0; open = true; loaded = false; reconnecting = false; screenOpen = false; other = ""
    }

    private suspend fun loop(ride: String) {
        var failures = 0
        while (scope.isActive && rideId == ride) {
            if (!appVisible()) { delay(1_500); continue }
            try {
                val page = fetch(lastId, if (loaded) 20 else 0)
                failures = 0; reconnecting = false; loaded = true
                open = page.open; other = page.with.ifBlank { other }
                for (m in page.messages) {
                    if (messages.none { it.id == m.id }) messages.add(m)
                    if (m.id > lastId) lastId = m.id
                }
                unread = page.unread
                if (screenOpen && unread > 0) acknowledge()
            } catch (e: ApiException) {
                if (e.status == 403 || e.status == 404) { open = false; loaded = true; return } // not this person's ride, or gone
                failures++; reconnecting = true
                delay(minOf(2_000L * failures, 10_000L))
            }
        }
    }

    private fun acknowledge() {
        val up = messages.filter { it.id > 0 }.maxOfOrNull { it.id } ?: return
        unread = 0
        scope.launch { runCatching { markRead(up) } }
    }

    /** The chat screen came on screen or left it. While it is open, what arrives counts as read. */
    fun screen(on: Boolean) { screenOpen = on; if (on && messages.isNotEmpty()) acknowledge() }

    fun sendText(text: String) {
        val body = text.trim()
        if (body.isEmpty() || !open) return
        val clientId = UUID.randomUUID().toString()
        val pending = ChatMessage(-(System.nanoTime() and 0x3fffffffffffL), true, body, java.time.Instant.now().toString(), SendState.Sending, clientId)
        messages.add(pending)
        deliver(pending)
    }

    fun retry(m: ChatMessage) {
        val i = messages.indexOfFirst { it === m }
        if (i < 0) return
        val again = ChatMessage(m.id, true, m.text, m.atIso, SendState.Sending, m.clientId)
        messages[i] = again
        deliver(again)
    }

    private fun deliver(p: ChatMessage) {
        scope.launch {
            try {
                val sent = send(p.text, p.clientId!!)
                val pendingAt = messages.indexOfFirst { it.clientId == p.clientId && it.state != SendState.Sent }
                val already = messages.any { it.id == sent.id }
                if (pendingAt >= 0) { if (already) messages.removeAt(pendingAt) else messages[pendingAt] = sent }
                else if (!already) messages.add(sent)
                if (sent.id > lastId) lastId = sent.id
            } catch (e: ApiException) {
                val i = messages.indexOfFirst { it.clientId == p.clientId }
                val why = when {
                    e.code == "chat_closed" -> { open = false; "Chat is closed. The trip is over." }
                    e.status == 429 -> "You are sending too fast. Wait a moment."
                    e.isNetwork -> "No connection. Tap to try again."
                    else -> "Not sent. Tap to try again."
                }
                if (i >= 0) messages[i] = ChatMessage(p.id, true, p.text, p.atIso, SendState.Failed, p.clientId, why)
            }
        }
    }
}
