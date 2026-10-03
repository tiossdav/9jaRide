package com.ninejaride.core.ui.components

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.drawscope.scale
import androidx.compose.ui.graphics.vector.PathParser
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp

/** The line icons from the design, as the same 24x24 SVG paths, so they match it exactly. */
object Ic {
    val Pin = listOf("M12 21s7-6.2 7-11a7 7 0 1 0-14 0c0 4.8 7 11 7 11z", "M9.5 10a2.5 2.5 0 1 0 5 0a2.5 2.5 0 1 0-5 0")
    val Home = listOf("M3 10.5L12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z")
    val Check = listOf("M5 12.5l4.5 4.5L19 7")
    val Star = listOf("M12 3l2.8 5.7 6.2.9-4.5 4.4 1 6.2L12 17.2l-5.5 3 1-6.2L3 9.6l6.2-.9z")
    val Navigate = listOf("M12 3l7 17-7-4-7 4z")
    val Phone = listOf("M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2z")
    val Clock = listOf("M3 12a9 9 0 1 0 18 0a9 9 0 1 0-18 0", "M12 7v5l3 2")
    val Wallet = listOf("M6 6h12a3 3 0 0 1 3 3v7a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3V9a3 3 0 0 1 3-3z", "M16 12.5h2M3 9V7a2 2 0 0 1 2-2h11")
    val Warning = listOf("M12 3l10 18H2z", "M12 10v5M12 18v.5")
    val Back = listOf("M15 5l-7 7 7 7")
    val Chevron = listOf("M9 5l7 7-7 7")
    val Close = listOf("M6 6l12 12M18 6L6 18")
    val Bank = listOf("M3 10l9-6 9 6M5 10v8M10 10v8M14 10v8M19 10v8M3 20h18")
    val Car = listOf("M4 15l1.5-5A2 2 0 0 1 7.4 8.5h9.2a2 2 0 0 1 1.9 1.5L20 15v3h-3v-1.5H7V18H4z")
    val Box = listOf("M3 7.5L12 3l9 4.5v9L12 21l-9-4.5z", "M3 7.5l9 4.5 9-4.5M12 12v9")
    val User = listOf("M8 8a4 4 0 1 0 8 0a4 4 0 1 0-8 0", "M4 21a8 8 0 0 1 16 0")
    val Mail = listOf("M5 5h14a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2z", "M3 7l9 6 9-6")
    val Help = listOf("M3 12a9 9 0 1 0 18 0a9 9 0 1 0-18 0", "M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.7.4-1 .9-1 1.7M12 17v.5")
    val Logout = listOf("M9 4H5a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h4", "M16 8l4 4-4 4M20 12H9")
    val Trash = listOf("M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3")
    val Plus = listOf("M12 5v14M5 12h14")
    val Gift = listOf("M4 11h16v9H4z", "M3 7h18v4H3zM12 7v13", "M12 7S10 3 8 4s0 3 4 3zM12 7s2-4 4-3-0 3-4 3z")
    val Bell = listOf("M6 17V11a6 6 0 0 1 12 0v6l1.5 2h-15z", "M10 21h4")
    val Calendar = listOf("M5 5h14a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2z", "M3 10h18M8 3v4M16 3v4")
    val ArrowUp = listOf("M12 19V5M6 11l6-6 6 6")
    val ArrowDown = listOf("M12 5v14M6 13l6 6 6-6")
    val Headset = listOf("M4 14v-2a8 8 0 0 1 16 0v2", "M4 14h3v5H5a1 1 0 0 1-1-1zM20 14h-3v5h2a1 1 0 0 0 1-1z")
    val Wifi = listOf("M2.5 9.2a14 14 0 0 1 19 0M5.5 12.6a9.5 9.5 0 0 1 13 0M8.6 16a5 5 0 0 1 6.8 0M12 19.4h.01")
    val Flag = listOf("M5 21V4M5 4h11l-2 4 2 4H5")
}

/** Draws a design icon. [size] is the box in dp; the paths live in a 24x24 space. */
@Composable
fun Icon24(paths: List<String>, tint: Color, size: Dp = 22.dp, stroke: Float = 1.8f, modifier: Modifier = Modifier) {
    val parsed = remember(paths) { paths.map { PathParser().parsePathString(it).toPath() } }
    Canvas(modifier.size(size)) {
        val k = this.size.width / 24f
        scale(k, k, pivot = Offset.Zero) {
            val s = Stroke(width = stroke, cap = StrokeCap.Round, join = StrokeJoin.Round)
            parsed.forEach { p: Path -> drawPath(p, tint, style = s) }
        }
    }
}

val Star16 = Ic.Star

/** A filled star, for ratings. */
@Composable
fun StarFilled(tint: Color, size: Dp = 16.dp, modifier: Modifier = Modifier) {
    val p = remember { PathParser().parsePathString(Ic.Star[0]).toPath() }
    Canvas(modifier.size(size)) {
        val k = this.size.width / 24f
        scale(k, k, pivot = Offset.Zero) {
            drawPath(p, tint)
            drawPath(p, tint, style = Stroke(width = 1.5f, cap = StrokeCap.Round, join = StrokeJoin.Round))
        }
    }
}
