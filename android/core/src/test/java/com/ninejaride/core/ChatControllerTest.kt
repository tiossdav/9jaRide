package com.ninejaride.core

import com.ninejaride.core.data.ApiException
import com.ninejaride.core.data.ChatController
import com.ninejaride.core.data.ChatMessage
import com.ninejaride.core.data.ChatPage
import com.ninejaride.core.data.SendState
import kotlinx.coroutines.delay
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.advanceTimeBy
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/** Unit tests: the chat of a trip, as both apps use it, with a pretend server. */
@OptIn(ExperimentalCoroutinesApi::class)
class ChatControllerTest {
    private fun msg(id: Long, mine: Boolean, text: String) = ChatMessage(id, mine, text, "2026-10-06T10:00:00Z")

    /** A pretend server: hands out the queued pages, then waits as a real held request would. */
    private class Server {
        val pages = ArrayDeque<ChatPage>()
        var down = false
        var open = true
        var unread = 0
        val read = mutableListOf<Long>()
        var sendFailsWith: ApiException? = null
        val sentIds = mutableListOf<String>()
        private var next = 100L
        suspend fun fetch(after: Long, wait: Int): ChatPage {
            if (down) throw ApiException(0, null, "No connection")
            pages.removeFirstOrNull()?.let { return it }
            delay(wait * 1000L + 1)
            return ChatPage(emptyList(), open, unread, "Chidi")
        }
        suspend fun send(text: String, clientId: String): ChatMessage {
            sendFailsWith?.let { throw it }
            sentIds += clientId
            return ChatMessage(next++, true, text, "2026-10-06T10:01:00Z")
        }
    }

    private fun TestScope.controller(s: Server, visible: () -> Boolean = { true }) =
        ChatController(backgroundScope, { a, w -> s.fetch(a, w) }, { t, c -> s.send(t, c) }, { s.read += it }, visible)

    @Test fun showsEachMessageOnceAndCountsWhatIsUnread() = runTest {
        val s = Server(); val chat = controller(s)
        s.pages += ChatPage(listOf(msg(1, false, "Where are you?")), true, 1, "Chidi")
        s.pages += ChatPage(listOf(msg(1, false, "Where are you?"), msg(2, false, "Hello?")), true, 2, "Chidi") // 1 is repeated: shown once
        chat.start("r1"); runCurrent(); advanceTimeBy(100); runCurrent()
        assertEquals(listOf("Where are you?", "Hello?"), chat.messages.map { it.text })
        assertEquals(2, chat.unread)
        assertTrue(chat.loaded)
        assertEquals("Chidi", chat.other)
    }

    @Test fun openingTheChatMarksWhatCameAsRead() = runTest {
        val s = Server(); val chat = controller(s)
        s.pages += ChatPage(listOf(msg(5, false, "Hi")), true, 1, "Chidi")
        chat.start("r1"); runCurrent()
        chat.screen(true); runCurrent()
        assertEquals(0, chat.unread)
        assertEquals(listOf(5L), s.read)
    }

    @Test fun aSentMessageIsShownAtOnceThenConfirmedWithoutDoubling() = runTest {
        val s = Server(); val chat = controller(s)
        chat.start("r1"); runCurrent()
        chat.sendText("  On my way  ");
        assertEquals(1, chat.messages.size); assertEquals(SendState.Sending, chat.messages[0].state); assertEquals("On my way", chat.messages[0].text)
        runCurrent()
        assertEquals(1, chat.messages.size); assertEquals(SendState.Sent, chat.messages[0].state); assertEquals(100L, chat.messages[0].id)
        // the same message coming back in the next poll is not added again
        s.pages += ChatPage(listOf(msg(100, true, "On my way")), true, 0, "Chidi")
        advanceTimeBy(30_000); runCurrent()
        assertEquals(1, chat.messages.size)
        chat.sendText("   "); runCurrent()
        assertEquals(1, chat.messages.size) // a blank message is not sent
    }

    @Test fun aFailedMessageStaysAndCanBeSentAgainWithTheSameId() = runTest {
        val s = Server(); val chat = controller(s)
        chat.start("r1"); runCurrent()
        s.sendFailsWith = ApiException(0, null, "No connection")
        chat.sendText("Hello"); runCurrent()
        val failed = chat.messages.single()
        assertEquals(SendState.Failed, failed.state)
        assertTrue(failed.error!!.contains("No connection"))
        s.sendFailsWith = null
        chat.retry(failed); runCurrent()
        assertEquals(1, chat.messages.size); assertEquals(SendState.Sent, chat.messages[0].state)
        assertEquals(1, s.sentIds.size)
        assertEquals(failed.clientId, s.sentIds[0]) // the server can tell it is the same message
    }

    @Test fun keepsTryingWhenTheConnectionDropsAndRecovers() = runTest {
        val s = Server(); val chat = controller(s)
        chat.start("r1"); runCurrent(); assertFalse(chat.reconnecting)
        s.down = true
        advanceTimeBy(25_000); runCurrent()
        assertTrue(chat.reconnecting)
        s.down = false; s.pages += ChatPage(listOf(msg(7, false, "Still there?")), true, 1, "Chidi")
        advanceTimeBy(20_000); runCurrent()
        assertFalse(chat.reconnecting)
        assertEquals(listOf("Still there?"), chat.messages.map { it.text })
    }

    @Test fun closesWhenTheTripIsOverAndRefusesNewMessages() = runTest {
        val s = Server(); val chat = controller(s)
        s.pages += ChatPage(emptyList(), false, 0, "Chidi")
        chat.start("r1"); runCurrent()
        assertFalse(chat.open)
        chat.sendText("late"); runCurrent()
        assertTrue(chat.messages.isEmpty())
        // and a server that says closed while the person was typing
        val s2 = Server(); val c2 = controller(s2); c2.start("r2"); runCurrent()
        s2.sendFailsWith = ApiException(409, "chat_closed", "Chat is only open while the trip is on.")
        c2.sendText("one more"); runCurrent()
        assertFalse(c2.open); assertEquals(SendState.Failed, c2.messages.single().state)
    }

    @Test fun staysQuietWhileTheAppIsNotOnScreen() = runTest {
        val s = Server(); var visible = false; val chat = controller(s) { visible }
        s.pages += ChatPage(listOf(msg(1, false, "Hi")), true, 1, "Chidi")
        chat.start("r1"); advanceTimeBy(10_000); runCurrent()
        assertTrue(chat.messages.isEmpty()) // nothing is asked for while the app is in the pocket
        visible = true; advanceTimeBy(3_000); runCurrent()
        assertEquals(1, chat.messages.size)
    }
}
