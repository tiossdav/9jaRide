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
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import com.ninejaride.core.data.ExtensionController
import com.ninejaride.core.data.Geocoding
import com.ninejaride.core.data.MapPoint
import com.ninejaride.core.data.Place
import com.ninejaride.core.data.Routing
import com.ninejaride.core.data.TripExtension
import com.ninejaride.core.format.naira
import com.ninejaride.core.ui.theme.C
import com.ninejaride.core.ui.theme.type
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

private fun km(m: Int) = "%.1f km".format(m / 1000.0)
private fun about(kobo: Long) = "about " + naira(kobo)

/** The small "Extend trip" button for the trip screens. */
@Composable
fun ExtendTripButton(controller: ExtensionController, modifier: Modifier = Modifier) {
    Btn("Extend trip", { controller.picking = true }, modifier, kind = BtnKind.Outline, height = 46.dp, size = 14.5f, enabled = !controller.busy && controller.current?.pending != true)
}

// ---------------------------------------------------------------- choosing the new destination

/**
 * Where to go on to. Type a place or move the map under the pin, and the road from the current destination to the new place is
 * worked out when the person confirms. [from] is where the trip is booked to end now.
 */
@Composable
fun ExtendTripPicker(controller: ExtensionController, from: MapPoint, fromName: String, near: MapPoint?, onBack: () -> Unit) {
    val scope = rememberCoroutineScope()
    var query by remember { mutableStateOf("") }
    var results by remember { mutableStateOf<List<Place>>(emptyList()) }
    var searching by remember { mutableStateOf(false) }
    var chosen by remember { mutableStateOf<Place?>(null) }
    // the map opens on the current destination: that is where the trip will go on from
    var mapCenter by remember { mutableStateOf(from) }
    val opened = remember { from }
    var working by remember { mutableStateOf(false) }
    var problem by remember { mutableStateOf<String?>(null) }
    var lookup by remember { mutableIntStateOf(0) }

    LaunchedEffect(query) {
        if (query.trim().length < 3 || chosen?.address == query) { results = emptyList(); searching = false; return@LaunchedEffect }
        searching = true
        delay(650)
        results = Geocoding.search(query.trim(), near ?: from) { early -> results = early }
        searching = false
    }

    Box(Modifier.fillMaxSize().background(C.Bg)) {
        MapPanel(
            Modifier.fillMaxSize(), markers = listOf(MapMarker(from, MarkerKind.Dropoff)), center = mapCenter, interactive = true,
            onCenterChange = { p ->
                val c = chosen
                if (c != null && Routing.haversineKm(c.point, p) < 0.02) return@MapPanel // the map settling on a place just chosen
                if (c == null && Routing.haversineKm(opened, p) < 0.02) return@MapPanel // the map settling where it opened
                val mine = ++lookup
                chosen = Place("Pinned location", p); problem = null
                scope.launch { delay(700); val words = Geocoding.reverse(p); if (mine == lookup) chosen = Place(words ?: "Pinned location", p) }
            },
        )
        Box(Modifier.align(Alignment.Center).padding(bottom = 30.dp)) { Icon24(Ic.Pin, C.Orange, 44.dp, 2.2f) }

        Column(Modifier.statusBarsPadding().padding(12.dp).imePadding(), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                CircleIconButton(Ic.Back, "Back", onBack)
                Row(
                    Modifier.weight(1f).clip(RoundedCornerShape(14.dp)).background(C.Surface).border(1.5.dp, C.GreenAccent, RoundedCornerShape(14.dp)).padding(horizontal = 14.dp, vertical = 12.dp),
                    verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp),
                ) {
                    BasicTextField(
                        value = query, onValueChange = { query = it; problem = null }, singleLine = true, keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Text),
                        textStyle = type(14.5f, 600, C.Ink), cursorBrush = SolidColor(C.GreenAccent), modifier = Modifier.weight(1f),
                        decorationBox = { inner -> Box { if (query.isEmpty()) Txt("Where to next?", 14.5f, 500, C.Disabled); inner() } },
                    )
                    if (query.isNotEmpty()) Icon24(Ic.Close, C.Faint, 16.dp, modifier = Modifier.tap({ query = ""; results = emptyList() }, "Clear"))
                }
            }
            val nothing = !searching && results.isEmpty() && query.trim().length >= 3 && chosen?.address != query
            if (searching || results.isNotEmpty() || nothing) {
                Column(Modifier.fillMaxWidth().clip(RoundedCornerShape(16.dp)).background(C.Surface).border(1.dp, C.Border, RoundedCornerShape(16.dp)).verticalScroll(rememberScrollState()).padding(horizontal = 14.dp, vertical = 4.dp)) {
                    if (searching) Txt("Searching...", 13f, 500, C.Muted, Modifier.padding(vertical = 10.dp))
                    if (nothing) Txt("No places found around you. Add the state, like \"Allen Avenue, Lagos\", or move the map.", 13f, 500, C.Muted, Modifier.padding(vertical = 10.dp))
                    results.take(5).forEach { p ->
                        val parts = p.address.split(", ")
                        Row(
                            Modifier.fillMaxWidth().tap({ chosen = p; query = p.address; results = emptyList(); mapCenter = p.point; problem = null }, p.address).padding(vertical = 10.dp),
                            verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp),
                        ) {
                            RoundIconTile(Ic.Pin, C.GreenAccent, C.GreenTint, 34.dp, iconSize = 18.dp)
                            Column(Modifier.weight(1f)) {
                                Txt(parts.first(), 14f, 600, maxLines = 1)
                                val sub = listOfNotNull(parts.drop(1).joinToString(", ").ifEmpty { null }, p.distanceKm?.let { "%.1f km away".format(it) }).joinToString("  ·  ")
                                if (sub.isNotEmpty()) Txt(sub, 12f, 500, C.Muted, maxLines = 1)
                            }
                        }
                    }
                }
            }
        }

        Column(Modifier.align(Alignment.BottomCenter).fillMaxWidth().padding(12.dp).navigationBarsPadding()) {
            Card {
                Txt("EXTEND TRIP", 11f, 600, C.Muted, letterSpacing = 1f)
                val shown = chosen?.address
                Txt(shown?.substringBefore(", ") ?: "Search, or move the map to choose where to go next", 16f, 800, maxLines = 2)
                shown?.substringAfter(", ", "")?.ifEmpty { null }?.let { Txt(it, 12.5f, 500, C.Muted, maxLines = 2) }
                Txt("The trip goes on from $fromName. The other person is asked first, and nothing changes unless they agree.", 11.5f, 500, C.Faint)
                (problem ?: controller.error)?.let { Txt(it, 12.5f, 600, C.RedText) }
                Gap(8.dp)
                Btn(
                    if (working) "Working out the extra fare..." else "Ask to extend", {
                        val place = chosen ?: return@Btn
                        working = true; problem = null
                        scope.launch {
                            val route = runCatching { Routing.routeInfo(from, place.point) }.getOrNull()
                            working = false
                            if (route == null || route.distanceM < 100) problem = "That is almost where the trip already ends. Choose a place further on." else controller.ask(place, route)
                        }
                    },
                    Modifier.fillMaxWidth(), enabled = chosen != null && !working && !controller.busy,
                )
            }
        }
    }
}

// ---------------------------------------------------------------- answering, waiting and what happened

/**
 * Everything a person sees about an extension while the trip goes on: the question to answer, the wait for an answer to
 * ours, the confirmation, and, when a request was turned down, what happens next.
 *
 * @param role "rider" or "driver": the person looking.
 * @param otherName the first name of the other person.
 * @param onChat opens the chat with them, when there is one.
 */
@Composable
fun ExtensionLayer(controller: ExtensionController, role: String, rawName: String, onChat: (() -> Unit)? = null) {
    val otherName = com.ninejaride.core.format.properName(rawName)
    val e = controller.shown
    val error = controller.error
    when {
        e == null && error != null -> TopBanner { Txt(error, 13.5f, 600, C.RedText); Btn("OK", controller::dismiss, Modifier.fillMaxWidth(), kind = BtnKind.Outline, height = 42.dp, size = 14f) }
        e == null -> {}
        e.pending && !e.mine -> Question(controller, e, role, otherName)
        e.pending -> Waiting(controller, e, otherName)
        e.status == "ACCEPTED" -> TopBanner {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                RoundIconTile(Ic.Check, C.GreenAccent, C.GreenTint, 38.dp, iconSize = 20.dp)
                Column(Modifier.weight(1f)) {
                    Txt("Destination updated", 15.5f, 800)
                    Txt("Now heading to ${e.newAddress ?: "the new destination"}.", 13f, 500, C.Muted)
                    e.newTotalKobo?.let { Txt("New trip total ${about(it)}.", 12.5f, 600, C.GreenAccent) }
                }
            }
            Btn("OK", controller::dismiss, Modifier.fillMaxWidth(), height = 42.dp, size = 14f)
        }
        else -> TurnedDown(controller, e, role, otherName, onChat)
    }
}

@Composable
private fun TopBanner(content: @Composable androidx.compose.foundation.layout.ColumnScope.() -> Unit) {
    Box(Modifier.fillMaxSize()) {
        Column(
            Modifier.align(Alignment.TopCenter).statusBarsPadding().padding(12.dp).fillMaxWidth().clip(RoundedCornerShape(20.dp)).background(C.Surface)
                .border(1.dp, C.Border, RoundedCornerShape(20.dp)).padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp), content = content,
        )
    }
}

@Composable
private fun Fact(label: String, value: String, strong: Boolean = false) {
    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
        Txt(label, 14f, 500, C.Muted, Modifier.weight(1f))
        Txt(value, if (strong) 16f else 14.5f, if (strong) 800 else 700, if (strong) C.GreenAccent else C.Ink)
    }
}

/** The other person wants to go further: the distance, the fare, the new total, and Accept or Decline. */
@Composable
private fun Question(controller: ExtensionController, e: TripExtension, role: String, otherName: String) {
    var declining by remember(e.id) { mutableStateOf(false) }
    var left by remember(e.id) { mutableIntStateOf(e.secondsLeft) }
    LaunchedEffect(e.id) { while (left > 0) { delay(1000); left-- } }
    SheetOverlay(onDismiss = null) {
        Txt("Trip extension requested", 18f, 800)
        Txt(
            (if (role == "rider") "$otherName would like to take you on to " else "$otherName would like to go on to ") + (e.newAddress ?: "a new destination") + ".",
            13.5f, 500, C.Muted,
        )
        Column(Modifier.fillMaxWidth().clip(RoundedCornerShape(16.dp)).background(C.Raised).padding(14.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Fact("Additional distance", km(e.extraDistanceM))
            Fact("Additional fare", about(e.extraKobo))
            Divider()
            Fact("New trip total", e.newTotalKobo?.let(::about) ?: "-", strong = true)
        }
        Txt(
            if (role == "rider") "The final fare is worked out from the distance actually driven. If you decline, the trip carries on to the original destination at the original fare."
            else "You are paid for the extra distance you drive. If you decline, the trip carries on to the original destination.",
            11.5f, 500, C.Faint,
        )
        controller.error?.let { Txt(it, 12.5f, 600, C.RedText) }
        if (!declining) {
            Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                Btn("Decline", { declining = true }, Modifier.weight(1f), kind = BtnKind.Outline, enabled = !controller.busy)
                Btn(if (controller.busy) "..." else "Accept", controller::accept, Modifier.weight(1f), enabled = !controller.busy && left > 0)
            }
            if (left in 1..60) Txt("Answer in $left s", 11.5f, 500, C.Faint)
            if (left == 0) Txt("This request has run out of time. The trip carries on to the original destination.", 12f, 600, C.Muted)
        } else {
            Txt("Why? (optional)", 12.5f, 700)
            val reasons = if (role == "rider") listOf("Too expensive", "Not going further", "Wrong place") else listOf("Too far for me", "Cannot go that way", "End of my shift")
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                reasons.take(2).forEach { r -> PillChoice(r, false, { controller.decline(r) }, Modifier.weight(1f)) }
            }
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                PillChoice(reasons[2], false, { controller.decline(reasons[2]) }, Modifier.weight(1f))
                PillChoice("No reason", false, { controller.decline(null) }, Modifier.weight(1f))
            }
            Btn("Back", { declining = false }, Modifier.fillMaxWidth(), kind = BtnKind.Outline, height = 42.dp, size = 14f)
        }
    }
}

/** We asked and are waiting. The trip carries on normally in the meantime. */
@Composable
private fun Waiting(controller: ExtensionController, e: TripExtension, otherName: String) {
    var left by remember(e.id) { mutableIntStateOf(e.secondsLeft) }
    LaunchedEffect(e.id) { while (left > 0) { delay(1000); left-- } }
    TopBanner {
        Txt("Waiting for $otherName to answer", 15.5f, 800)
        Txt("To ${e.newAddress ?: "the new destination"}: ${km(e.extraDistanceM)} further, ${about(e.extraKobo)} more${e.newTotalKobo?.let { ", new total ${about(it)}" } ?: ""}.", 12.5f, 500, C.Muted)
        Txt(if (left > 0) "The trip carries on to the original destination meanwhile. ${left}s left." else "No answer yet. The trip carries on to the original destination.", 11.5f, 500, C.Faint)
        Btn(if (controller.busy) "..." else "Cancel request", controller::withdraw, Modifier.fillMaxWidth(), kind = BtnKind.Outline, height = 42.dp, size = 14f, enabled = !controller.busy)
    }
}

/**
 * Our request was turned down (or nobody answered). The trip goes on to the booked destination at the booked fare, and the person who
 * asked is shown what they can do next instead of being left with a dead end.
 */
@Composable
private fun TurnedDown(controller: ExtensionController, e: TripExtension, role: String, otherName: String, onChat: (() -> Unit)?) {
    val lapsed = e.status == "EXPIRED"
    TopBanner {
        Txt(if (lapsed) "No answer from $otherName" else "$otherName declined the extension", 15.5f, 800)
        e.declineReason?.let { Txt("\"$it\"", 13f, 600, C.Muted) }
        Txt(
            if (role == "driver")
                "The trip carries on to ${e.oldAddress ?: "the original destination"} at the booked fare. You are paid for the distance you drive up to there. Take the rider to the original destination and end the trip there."
            else
                "The trip carries on to ${e.oldAddress ?: "your original destination"} at the original fare. You can book a new ride from there for the rest of your journey.",
            12.5f, 500, C.Muted,
        )
        Btn("Continue to the original destination", controller::dismiss, Modifier.fillMaxWidth(), height = 44.dp, size = 14f)
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Btn("Suggest another place", { controller.dismiss(); controller.picking = true }, Modifier.weight(1f), kind = BtnKind.Outline, height = 42.dp, size = 13.5f)
            if (onChat != null) Btn("Message $otherName", { controller.dismiss(); onChat() }, Modifier.weight(1f), kind = BtnKind.Outline, height = 42.dp, size = 13.5f)
        }
    }
}
