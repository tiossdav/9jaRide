package com.ninejaride.core.ui.components

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxScope
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.composed
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.drawscope.scale
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.foundation.text.BasicText
import androidx.compose.foundation.layout.IntrinsicSize
import androidx.compose.ui.unit.TextUnit
import androidx.compose.ui.unit.TextUnitType
import com.ninejaride.core.ui.theme.C
import com.ninejaride.core.ui.theme.type

/** Text with the design's size/weight/colour. */
@Composable
fun Txt(
    text: String,
    size: Float = 14f,
    weight: Int = 500,
    color: Color = C.Ink,
    modifier: Modifier = Modifier,
    align: TextAlign? = null,
    letterSpacing: Float? = null,
    maxLines: Int = Int.MAX_VALUE,
) {
    val base = type(size, weight, color, letterSpacing = if (letterSpacing == null) TextUnit.Unspecified else TextUnit(letterSpacing, TextUnitType.Sp))
    // The app font draws the Naira sign with a single stroke. The real sign has two, so it is drawn with the system font.
    val shown = if ('\u20A6' !in text) androidx.compose.ui.text.AnnotatedString(text) else androidx.compose.ui.text.buildAnnotatedString {
        text.forEach { ch ->
            if (ch == '₦') { pushStyle(androidx.compose.ui.text.SpanStyle(fontFamily = androidx.compose.ui.text.font.FontFamily.SansSerif)); append(ch); pop() } else append(ch)
        }
    }
    BasicText(
        text = shown,
        modifier = modifier,
        style = if (align != null) base.copy(textAlign = align) else base,
        maxLines = maxLines,
    )
}

/** A tap target without the stock grey ripple, 44dp or larger where it matters. */
fun Modifier.tap(onClick: () -> Unit, label: String? = null, role: Role = Role.Button): Modifier = composed {
    val source = remember { MutableInteractionSource() }
    val base = this.clickable(interactionSource = source, indication = null, role = role, onClick = onClick)
    if (label != null) base.semantics { contentDescription = label } else base
}

enum class BtnKind { Primary, Outline, Danger, Dark, Light }

@Composable
fun Btn(
    label: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    kind: BtnKind = BtnKind.Primary,
    enabled: Boolean = true,
    height: Dp = 52.dp,
    size: Float = 16f,
) {
    val (bg, fg, border) = when (kind) {
        BtnKind.Primary -> Triple(C.Green, Color.White, null)
        BtnKind.Danger -> Triple(C.Red, Color.White, null)
        BtnKind.Dark -> Triple(Color(0xFF16231A), Color.White, null)
        BtnKind.Light -> Triple(Color.White, Color(0xFF0D520D), null)
        BtnKind.Outline -> Triple(Color.Transparent, C.Ink, C.Border)
    }
    Box(
        modifier
            .height(height)
            .clip(RoundedCornerShape(16.dp))
            .background(bg)
            .let { if (border != null) it.border(BorderStroke(1.5.dp, border), RoundedCornerShape(16.dp)) else it }
            .let { if (enabled) it.tap(onClick) else it.semantics { contentDescription = "$label, unavailable" } }
            .let { if (enabled) it else it.background(Color.Transparent) },
        contentAlignment = Alignment.Center,
    ) {
        Txt(label, size, 700, if (enabled) fg else fg.copy(alpha = 0.5f))
    }
}

@Composable
fun CircleIconButton(paths: List<String>, label: String, onClick: () -> Unit, size: Dp = 44.dp) {
    Box(
        Modifier
            .size(size)
            .clip(CircleShape)
            .background(C.Surface)
            .border(1.dp, C.Border, CircleShape)
            .tap(onClick, label),
        contentAlignment = Alignment.Center,
    ) { Icon24(paths, C.Ink, 20.dp) }
}

/** The back button + title used at the top of inner screens. */
@Composable
fun ScreenHeader(title: String, subtitle: String? = null, onBack: (() -> Unit)? = null, trailing: (@Composable RowScope.() -> Unit)? = null) {
    Row(
        Modifier.fillMaxWidth().statusBarsPadding().padding(start = 20.dp, end = 20.dp, top = 18.dp, bottom = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        if (onBack != null) CircleIconButton(Ic.Back, "Back", onBack)
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Txt(title, 18f, 700)
            if (subtitle != null) Txt(subtitle, 12.5f, 500, C.Muted)
        }
        trailing?.invoke(this)
    }
}

@Composable
fun Chip(text: String, fg: Color = C.GreenAccent, bg: Color = C.GreenTint) {
    Box(Modifier.clip(RoundedCornerShape(999.dp)).background(bg).padding(horizontal = 11.dp, vertical = 5.dp)) {
        Txt(text, 12.5f, 600, fg, maxLines = 1)
    }
}

@Composable
fun Avatar(letter: String, size: Dp = 40.dp, fontSize: Float = 16f, photo: androidx.compose.ui.graphics.ImageBitmap? = null) {
    Box(Modifier.size(size).clip(CircleShape).background(C.GreenTint), contentAlignment = Alignment.Center) {
        if (photo != null) androidx.compose.foundation.Image(bitmap = photo, contentDescription = "Profile photo", contentScale = androidx.compose.ui.layout.ContentScale.Crop, modifier = Modifier.fillMaxSize())
        else Txt(letter, fontSize, 700, C.GreenAccent)
    }
}

@Composable
fun Card(modifier: Modifier = Modifier, padding: Dp = 16.dp, radius: Dp = 20.dp, content: @Composable ColumnScope.() -> Unit) {
    Column(
        modifier.clip(RoundedCornerShape(radius)).background(C.Surface).border(1.dp, C.Border, RoundedCornerShape(radius)).padding(padding),
        content = content,
    )
}

@Composable
fun Toggle(on: Boolean, onToggle: () -> Unit, label: String) {
    Box(
        Modifier
            .width(52.dp).height(28.dp)
            .clip(RoundedCornerShape(999.dp))
            .background(if (on) C.Green else C.ToggleOff)
            .tap(onToggle, label, Role.Switch),
    ) {
        Box(
            Modifier.padding(2.dp).padding(start = if (on) 24.dp else 0.dp).size(24.dp)
                .shadow(1.dp, CircleShape).clip(CircleShape).background(Color.White),
        )
    }
}

/** The floating pill with Home / Trips / Earnings / Profile. */
enum class Tab(val label: String, val icon: List<String>) {
    Home("Home", Ic.Home), Trips("Trips", Ic.Box), Earnings("Earnings", Ic.Wallet), Profile("Profile", Ic.User)
}

data class NavItem(val label: String, val icon: List<String>)

/**
 * The bottom bar. It is a strip of its own under the page, not something floating over it, so scrolling content
 * always ends above it. 20dp in from each side and 10dp above the bottom edge (or the system buttons).
 */
@Composable
fun NavBar(items: List<NavItem>, selected: Int, onSelect: (Int) -> Unit) {
    Row(
        Modifier
            .fillMaxWidth()
            .navigationBarsPadding()
            .padding(start = 20.dp, end = 20.dp, top = 6.dp, bottom = 10.dp)
            .shadow(8.dp, RoundedCornerShape(999.dp), ambientColor = Color(0x1F000000), spotColor = Color(0x1F000000))
            .clip(RoundedCornerShape(999.dp))
            .background(C.Surface)
            .border(1.dp, C.Border, RoundedCornerShape(999.dp))
            .padding(5.dp),
        horizontalArrangement = Arrangement.spacedBy(2.dp),
    ) {
        items.forEachIndexed { i, t ->
            val on = i == selected
            Column(
                Modifier
                    .weight(1f)
                    .clip(RoundedCornerShape(999.dp))
                    .background(if (on) C.GreenTint else Color.Transparent)
                    .tap({ onSelect(i) }, t.label)
                    .padding(vertical = 8.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.spacedBy(3.dp),
            ) {
                Icon24(t.icon, if (on) C.GreenAccent else C.Faint)
                Txt(t.label, 11.5f, 600, if (on) C.GreenAccent else C.Faint)
            }
        }
    }
}

/** The driver app's four tabs. */
@Composable
fun TabBar(selected: Tab, onSelect: (Tab) -> Unit) =
    NavBar(Tab.entries.map { NavItem(it.label, it.icon) }, selected.ordinal) { onSelect(Tab.entries[it]) }

/** Dimmed screen with a white sheet rising from the bottom. Tapping the dimmed area calls [onDismiss]. */
@Composable
fun SheetOverlay(onDismiss: (() -> Unit)?, content: @Composable ColumnScope.() -> Unit) {
    Box(Modifier.fillMaxSize()) {
        Box(Modifier.fillMaxSize().background(C.Scrim).let { if (onDismiss != null) it.tap(onDismiss, "Close") else it.tap({}) })
        Column(
            Modifier
                .align(Alignment.BottomCenter)
                .fillMaxWidth()
                .clip(RoundedCornerShape(topStart = 26.dp, topEnd = 26.dp))
                .background(C.Surface)
                .border(BorderStroke(1.dp, C.Border), RoundedCornerShape(topStart = 26.dp, topEnd = 26.dp))
                .navigationBarsPadding()
                .padding(start = 20.dp, end = 20.dp, top = 10.dp, bottom = 26.dp),
            verticalArrangement = Arrangement.spacedBy(14.dp),
        ) {
            Box(Modifier.align(Alignment.CenterHorizontally).padding(bottom = 14.dp).width(40.dp).height(4.dp).clip(RoundedCornerShape(4.dp)).background(C.Border))
            content()
        }
    }
}

@Composable
fun RoundIconTile(paths: List<String>, tint: Color, bg: Color, size: Dp = 46.dp, round: Boolean = true, iconSize: Dp = 24.dp) {
    Box(
        Modifier.size(size).clip(if (round) CircleShape else RoundedCornerShape(14.dp)).background(bg),
        contentAlignment = Alignment.Center,
    ) { Icon24(paths, tint, iconSize) }
}

/** Pickup and drop-off with the green dot, line and orange square from the design. */
@Composable
fun RouteBlock(pickup: String, dropoff: String) {
    Row(Modifier.height(IntrinsicSize.Min), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
        Column(Modifier.padding(vertical = 4.dp), horizontalAlignment = Alignment.CenterHorizontally) {
            Box(Modifier.size(10.dp).clip(CircleShape).background(C.Green))
            Box(Modifier.padding(vertical = 4.dp).width(2.dp).weight(1f).background(C.Border))
            Box(Modifier.size(10.dp).clip(RoundedCornerShape(2.dp)).background(C.Orange))
        }
        Column(verticalArrangement = Arrangement.spacedBy(14.dp)) {
            Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
                Txt("PICKUP", 11f, 500, C.Muted, letterSpacing = 1f)
                Txt(pickup, 14f, 600)
            }
            Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
                Txt("DROP-OFF", 11f, 500, C.Muted, letterSpacing = 1f)
                Txt(dropoff, 14f, 600)
            }
        }
    }
}

/** One fare line: label left, amount right. */
@Composable
fun MoneyLine(label: String, amount: String, bold: Boolean = false, amountColor: Color = C.Ink, labelColor: Color = if (bold) C.Ink else C.Muted) {
    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
        Txt(label, if (bold) 15f else 13.5f, if (bold) 800 else 500, labelColor, Modifier.weight(1f))
        Txt(amount, if (bold) 15f else 13.5f, if (bold) 800 else 600, amountColor)
    }
}

@Composable
fun Divider() {
    Box(Modifier.fillMaxWidth().height(1.dp).background(C.Border))
}

/** A read-only labelled field, like "Mobile number". */
@Composable
fun LabeledBox(label: String, value: String, valueColor: Color = C.Ink, trailing: (@Composable () -> Unit)? = null) {
    Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
        Txt(label, 12.5f, 600, C.Muted)
        Row(
            Modifier.fillMaxWidth().clip(RoundedCornerShape(14.dp)).background(C.Surface).border(1.dp, C.Border, RoundedCornerShape(14.dp)).padding(horizontal = 16.dp, vertical = 15.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Txt(value, 15f, 500, valueColor, Modifier.weight(1f))
            trailing?.invoke()
        }
    }
}

/** A tappable row with an icon tile, title, subtitle and chevron (Profile, Help, Earnings menu). */
@Composable
fun MenuRow(icon: List<String>, title: String, subtitle: String? = null, onClick: () -> Unit, tint: Color = C.GreenAccent, titleColor: Color = C.Ink, showChevron: Boolean = true) {
    Row(
        Modifier.fillMaxWidth().clip(RoundedCornerShape(18.dp)).background(C.Surface).border(1.dp, C.Border, RoundedCornerShape(18.dp))
            .tap(onClick, title).padding(14.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        RoundIconTile(icon, tint, if (tint == C.Red) Color(0xFFFDECEC) else C.GreenTint, 42.dp, round = false, iconSize = 20.dp)
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(1.dp)) {
            Txt(title, 15f, 700, titleColor)
            if (subtitle != null) Txt(subtitle, 12.5f, 500, C.Muted)
        }
        if (showChevron) Icon24(Ic.Chevron, C.Faint, 18.dp)
    }
}

/** The stylised street map from the design. A real map SDK replaces this once an API key exists. */
@Composable
fun StreetMap(modifier: Modifier = Modifier, route: Boolean = false, car: Boolean = true) {
    Canvas(modifier) {
        val k = size.width / 390f
        scale(k, k, pivot = Offset.Zero) {
            drawRect(C.MapBg, size = androidx.compose.ui.geometry.Size(390f, size.height / k))
            val road = Color.White.copy(alpha = 0.9f)
            fun line(x1: Float, y1: Float, x2: Float, y2: Float, w: Float) =
                drawLine(road, Offset(x1, y1), Offset(x2, y2), strokeWidth = w, cap = StrokeCap.Round)
            line(-10f, 120f, 400f, 70f, 9f)
            line(-10f, 260f, 400f, 230f, 11f)
            line(-10f, 400f, 400f, 380f, 9f)
            line(60f, -10f, 90f, 570f, 9f)
            line(190f, -10f, 170f, 570f, 12f)
            line(300f, -10f, 330f, 570f, 9f)
            line(-10f, 190f, 400f, 170f, 5f)
            val s = Stroke(width = 5f, cap = StrokeCap.Round)
            drawPath(Path().apply { moveTo(-10f, 330f); quadraticTo(150f, 300f, 400f, 340f) }, road, style = s)
            drawPath(Path().apply { moveTo(110f, -10f); quadraticTo(130f, 200f, 260f, 570f) }, road, style = s)
            if (route) {
                val p = Path().apply { moveTo(90f, 330f); lineTo(90f, 250f); quadraticTo(90f, 220f, 140f, 220f); lineTo(290f, 210f); lineTo(290f, 120f) }
                drawPath(p, C.Green, style = Stroke(width = 6f, cap = StrokeCap.Round, join = StrokeJoin.Round))
                drawCircle(Color.White, 14f, Offset(90f, 330f)); drawCircle(C.Green, 11f, Offset(90f, 330f))
                drawRect(Color.White, Offset(277f, 107f), androidx.compose.ui.geometry.Size(26f, 26f))
                drawRect(C.Orange, Offset(280f, 110f), androidx.compose.ui.geometry.Size(20f, 20f))
            }
        }
    }
}

/** Dark circle with a car, drawn over the map where the driver is. */
@Composable
fun CarDot(size: Dp = 34.dp) {
    Box(Modifier.size(size).clip(CircleShape).background(C.MapPin).border(2.dp, Color.White, CircleShape), contentAlignment = Alignment.Center) {
        Icon24(Ic.Car, Color.White, size * 0.55f, 2f)
    }
}

@Composable
fun Gap(h: Dp) = Spacer(Modifier.height(h))

/** What a "Are you sure?" sheet needs: what is about to happen, the button's words, and whether it is risky. */
class ConfirmRequest(val title: String, val text: String, val label: String, val danger: Boolean = false, val action: () -> Unit)

/** The second tap. Every action that sends, ends, accepts, declines or signs out goes through this before it happens. */
@Composable
fun ConfirmSheet(request: ConfirmRequest, onDismiss: () -> Unit) {
    SheetOverlay(onDismiss = onDismiss) {
        Txt(request.title, 18f, 800)
        Txt(request.text, 13.5f, 500, C.Muted)
        Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            Btn("Go back", onDismiss, Modifier.weight(1f), kind = BtnKind.Outline)
            Btn(request.label, { onDismiss(); request.action() }, Modifier.weight(1f), kind = if (request.danger) BtnKind.Danger else BtnKind.Primary)
        }
    }
}

/** A notification that slides in at the top, needs no tap, and is cleared by its owner after a few seconds. */
@Composable
fun TopToast(title: String, text: String) {
    Box(Modifier.fillMaxWidth().statusBarsPadding().padding(horizontal = 16.dp, vertical = 10.dp)) {
        Row(
            Modifier.fillMaxWidth().shadow(10.dp, RoundedCornerShape(18.dp)).clip(RoundedCornerShape(18.dp)).background(C.Surface)
                .border(BorderStroke(1.dp, C.Border), RoundedCornerShape(18.dp)).padding(14.dp),
            verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Box(Modifier.size(38.dp).clip(CircleShape).background(C.GreenAccent), contentAlignment = Alignment.Center) { Icon24(Ic.Check, Color.White, 20.dp, 2.6f) }
            Column(verticalArrangement = Arrangement.spacedBy(1.dp)) { Txt(title, 15f, 800); Txt(text, 12.5f, 500, C.Muted) }
        }
    }
}
