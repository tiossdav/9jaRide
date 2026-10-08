package com.ninejaride.core.ui.components

import androidx.activity.compose.BackHandler
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import com.ninejaride.core.ui.theme.C

/**
 * Keeps track of slow work so the screen can say "Please wait..." while it runs. Wrap any request in [run]: the message shows at once, a
 * second tap on the same button is ignored while it runs (the work does not start twice), and the message is always cleared afterwards,
 * whether the work succeeded or failed.
 */
class BusyTracker {
    /** What to tell the person, or null when nothing is running. */
    var message by mutableStateOf<String?>(null); private set
    private var running by mutableIntStateOf(0)
    val isBusy get() = running > 0

    /**
     * Runs [block] behind the overlay. If something else is already running it is refused (returns null) rather than started twice.
     * Errors still reach the caller, who shows them; the overlay is gone by then.
     */
    suspend fun <T> run(text: String = "Please wait...", block: suspend () -> T): T? {
        if (running > 0) return null
        running++
        message = text
        try { return block() } finally { running--; if (running == 0) message = null }
    }
}

/** A turning ring. */
@Composable
private fun Spinner() {
    val turn = rememberInfiniteTransition(label = "spin")
    val angle by turn.animateFloat(0f, 360f, infiniteRepeatable(tween(900, easing = LinearEasing), RepeatMode.Restart), label = "angle")
    Canvas(Modifier.size(44.dp)) {
        val stroke = 5.dp.toPx()
        drawArc(C.Border, 0f, 360f, false, topLeft = Offset(stroke / 2, stroke / 2), size = Size(size.width - stroke, size.height - stroke), style = Stroke(stroke))
        drawArc(C.GreenAccent, angle, 100f, false, topLeft = Offset(stroke / 2, stroke / 2), size = Size(size.width - stroke, size.height - stroke), style = Stroke(stroke, cap = StrokeCap.Round))
    }
}

/**
 * A "please wait" screen over everything: a ring and a sentence ("Please wait while your document is being uploaded..."). It swallows
 * every touch and the back button until it goes away, so nothing can be tapped twice or run on top of the work in progress.
 */
@Composable
fun LoadingOverlay(message: String?) {
    if (message == null) return
    BackHandler { /* wait for the work to finish */ }
    Box(
        Modifier.fillMaxSize().background(C.Scrim).clickable(interactionSource = remember { MutableInteractionSource() }, indication = null) { }
            .semantics { liveRegion = LiveRegionMode.Polite; contentDescription = message },
        contentAlignment = Alignment.Center,
    ) {
        Column(
            Modifier.padding(32.dp).widthIn(max = 300.dp).clip(RoundedCornerShape(22.dp)).background(C.Surface).border(1.dp, C.Border, RoundedCornerShape(22.dp)).padding(horizontal = 24.dp, vertical = 26.dp),
            horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(16.dp),
        ) {
            Spinner()
            Txt(message, 15f, 600, C.Ink, align = TextAlign.Center)
        }
    }
}
