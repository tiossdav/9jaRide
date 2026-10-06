package com.ninejaride.core.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import com.ninejaride.core.data.ChatController
import com.ninejaride.core.data.ChatMessage
import com.ninejaride.core.data.SendState
import com.ninejaride.core.ui.theme.C
import com.ninejaride.core.ui.theme.type
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.Locale

private val CLOCK = DateTimeFormatter.ofPattern("h:mm a", Locale.ENGLISH).withZone(ZoneId.systemDefault())
private fun clockOf(iso: String) = runCatching { CLOCK.format(Instant.parse(iso)) }.getOrDefault("")

/** The small round button that opens the chat; shows how many messages are waiting. */
@Composable
fun ChatBadge(count: Int, modifier: Modifier = Modifier) {
    if (count <= 0) return
    Box(modifier.size(18.dp).clip(CircleShape).background(C.Red), contentAlignment = Alignment.Center) { Txt(if (count > 9) "9+" else "$count", 10f, 800, Color.White) }
}

/**
 * The conversation with the other person on the trip. Messages with their times, a box to write in, and clear states for
 * loading, an empty chat, a lost connection, a message that did not go, and a chat that closed when the trip ended.
 * [other] is "driver" or "rider" in the empty-state words.
 */
@Composable
fun ChatScreen(chat: ChatController, title: String, other: String, onBack: () -> Unit) {
    DisposableEffect(Unit) { chat.screen(true); onDispose { chat.screen(false) } }
    val listState = rememberLazyListState()
    LaunchedEffect(chat.messages.size) { if (chat.messages.isNotEmpty()) listState.animateScrollToItem(chat.messages.lastIndex) }
    var draft by remember { mutableStateOf("") }

    Column(Modifier.fillMaxSize().background(C.Bg).imePadding()) {
        Row(Modifier.fillMaxWidth().statusBarsPadding().padding(horizontal = 16.dp, vertical = 12.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            CircleIconButton(Ic.Back, "Back", onBack)
            Column(Modifier.weight(1f)) {
                Txt(title, 18f, 800, maxLines = 1)
                Txt(if (!chat.open) "Chat closed" else if (chat.reconnecting) "Reconnecting..." else "Trip chat", 12f, 600, if (chat.reconnecting) C.Orange else C.Muted)
            }
        }
        if (chat.reconnecting && chat.loaded) {
            Box(Modifier.fillMaxWidth().background(C.OrangeTint).padding(horizontal = 16.dp, vertical = 8.dp)) { Txt("No connection. Trying again. Your messages are kept.", 12.5f, 600, C.OrangeIcon) }
        }
        Box(Modifier.weight(1f).fillMaxWidth()) {
            when {
                !chat.loaded && chat.reconnecting -> Column(Modifier.fillMaxSize().padding(32.dp), verticalArrangement = Arrangement.Center, horizontalAlignment = Alignment.CenterHorizontally) {
                    Txt("Could not load the chat", 16f, 800); Txt("Check your connection. We keep trying.", 13f, 500, C.Muted, align = TextAlign.Center)
                }
                !chat.loaded -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { Txt("Loading messages...", 13.5f, 500, C.Muted) }
                chat.messages.isEmpty() -> Column(Modifier.fillMaxSize().padding(32.dp), verticalArrangement = Arrangement.Center, horizontalAlignment = Alignment.CenterHorizontally) {
                    Box(Modifier.size(64.dp).clip(CircleShape).background(C.GreenTint), contentAlignment = Alignment.Center) { Icon24(Ic.Chat, C.GreenAccent, 30.dp) }
                    Gap(12.dp)
                    Txt(if (chat.open) "No messages yet" else "No messages were sent", 16f, 800)
                    Txt(if (chat.open) "Say hello to your $other. Keep it about the trip." else "Chat is only open while the trip is on.", 13f, 500, C.Muted, align = TextAlign.Center)
                }
                else -> LazyColumn(state = listState, modifier = Modifier.fillMaxSize(), contentPadding = androidx.compose.foundation.layout.PaddingValues(horizontal = 16.dp, vertical = 10.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    items(chat.messages, key = { it.clientId ?: it.id.toString() }) { m -> Bubble(m) { chat.retry(m) } }
                }
            }
        }
        if (chat.open) {
            Row(Modifier.fillMaxWidth().navigationBarsPadding().padding(horizontal = 12.dp, vertical = 10.dp), verticalAlignment = Alignment.Bottom, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                BasicTextField(
                    value = draft, onValueChange = { draft = it.take(500) }, textStyle = type(15f, 500, C.Ink), cursorBrush = SolidColor(C.GreenAccent),
                    maxLines = 4, keyboardOptions = KeyboardOptions(imeAction = ImeAction.Default),
                    modifier = Modifier.weight(1f),
                    decorationBox = { inner ->
                        Box(Modifier.fillMaxWidth().clip(RoundedCornerShape(22.dp)).background(C.Surface).border(1.dp, C.Border, RoundedCornerShape(22.dp)).padding(horizontal = 16.dp, vertical = 12.dp)) {
                            if (draft.isEmpty()) Txt("Write a message", 15f, 500, C.Disabled)
                            inner()
                        }
                    },
                )
                Box(
                    Modifier.size(48.dp).clip(CircleShape).background(if (draft.isBlank()) C.Disabled else C.GreenAccent).tap({ if (draft.isNotBlank()) { chat.sendText(draft); draft = "" } }, "Send message"),
                    contentAlignment = Alignment.Center,
                ) { Icon24(Ic.Send, Color.White, 22.dp, 2f) }
            }
        } else {
            Box(Modifier.fillMaxWidth().navigationBarsPadding().padding(16.dp).clip(RoundedCornerShape(14.dp)).background(C.Raised).padding(14.dp)) {
                Txt("Chat is closed because the trip is over.", 13f, 600, C.Muted, align = TextAlign.Center, modifier = Modifier.fillMaxWidth())
            }
        }
    }
}

@Composable
private fun Bubble(m: ChatMessage, onRetry: () -> Unit) {
    val mine = m.mine
    Column(Modifier.fillMaxWidth(), horizontalAlignment = if (mine) Alignment.End else Alignment.Start) {
        Box(
            Modifier.widthIn(max = 290.dp).clip(RoundedCornerShape(topStart = 18.dp, topEnd = 18.dp, bottomStart = if (mine) 18.dp else 4.dp, bottomEnd = if (mine) 4.dp else 18.dp))
                .background(if (m.state == SendState.Failed) C.RedCard else if (mine) C.GreenAccent else C.Raised)
                .let { if (m.state == SendState.Failed) it.tap(onRetry, "Retry sending") else it }.padding(horizontal = 14.dp, vertical = 10.dp),
        ) { Txt(m.text, 15f, 500, if (m.state == SendState.Failed) C.RedText else if (mine) Color.White else C.Ink) }
        Txt(
            when (m.state) { SendState.Sending -> "Sending..."; SendState.Failed -> m.error ?: "Not sent. Tap to try again."; SendState.Sent -> clockOf(m.atIso) },
            11f, 500, if (m.state == SendState.Failed) C.RedText else C.Muted, Modifier.padding(horizontal = 4.dp, vertical = 2.dp),
        )
    }
}
