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
import com.ninejaride.core.data.ApiException
import com.ninejaride.core.data.DestinationChange
import com.ninejaride.core.data.DestinationController
import com.ninejaride.core.data.Geocoding
import com.ninejaride.core.data.MapPoint
import com.ninejaride.core.data.Place
import com.ninejaride.core.data.Routing
import com.ninejaride.core.ui.theme.C
import com.ninejaride.core.ui.theme.type
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

private fun km(m: Int) = "%.1f km".format(m / 1000.0)
private fun minutes(s: Int) = "${(s / 60).coerceAtLeast(1)} min"

/** "Edit destination", for the trip screens. Shown only once the driver has arrived; the server refuses it before then as well. */
@Composable
fun EditDestinationButton(controller: DestinationController, modifier: Modifier = Modifier) {
    Btn("Edit destination", { controller.picking = true }, modifier, kind = BtnKind.Outline, height = 46.dp, size = 14.5f)
}

/**
 * Choosing the new drop-off. Type a place (the search covers Nigeria and puts nearby matches first) or move the map under the pin. The
 * pickup cannot be changed, and the trip stays the same trip. [current] is where the trip is going now; [near] is the best guess of where
 * the person is, which steers the search.
 */
@Composable
fun DestinationPicker(controller: DestinationController, current: MapPoint, currentName: String, near: MapPoint?, onBack: () -> Unit) {
    val scope = rememberCoroutineScope()
    var query by remember { mutableStateOf("") }
    var results by remember { mutableStateOf<List<Place>>(emptyList()) }
    var searching by remember { mutableStateOf(false) }
    var searchProblem by remember { mutableStateOf<String?>(null) }
    var chosen by remember { mutableStateOf<Place?>(null) }
    var mapCenter by remember { mutableStateOf(current) }
    val opened = remember { current }
    var lookup by remember { mutableIntStateOf(0) }

    LaunchedEffect(query) {
        if (query.trim().length < 3 || chosen?.address == query) { results = emptyList(); searching = false; return@LaunchedEffect }
        searching = true; searchProblem = null
        delay(450) // a short pause after typing
        try { results = Geocoding.search(query.trim(), near ?: current) }
        catch (e: ApiException) { results = emptyList(); searchProblem = e.message }
        catch (e: kotlinx.coroutines.CancellationException) { throw e }
        catch (e: Exception) { results = emptyList(); searchProblem = "Search is not available right now." }
        searching = false
    }

    Box(Modifier.fillMaxSize().background(C.Bg)) {
        MapPanel(
            Modifier.fillMaxSize(), markers = listOf(MapMarker(current, MarkerKind.Dropoff)), center = mapCenter, interactive = true,
            onCenterChange = { p ->
                val c = chosen
                if (c != null && Routing.haversineKm(c.point, p) < 0.02) return@MapPanel // the map settling on a place just chosen
                if (c == null && Routing.haversineKm(opened, p) < 0.02) return@MapPanel // the map settling where it opened
                val mine = ++lookup
                chosen = Place("Pinned location", p); controller.dismiss()
                scope.launch { delay(600); val words = Geocoding.reverse(p); if (mine == lookup) chosen = Place(words ?: "Pinned location", p) }
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
                        value = query, onValueChange = { query = it; controller.dismiss() }, singleLine = true, keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Text),
                        textStyle = type(14.5f, 600, C.Ink), cursorBrush = SolidColor(C.GreenAccent), modifier = Modifier.weight(1f),
                        decorationBox = { inner -> Box { if (query.isEmpty()) Txt("New destination", 14.5f, 500, C.Disabled); inner() } },
                    )
                    if (query.isNotEmpty()) Icon24(Ic.Close, C.Faint, 16.dp, modifier = Modifier.tap({ query = ""; results = emptyList() }, "Clear"))
                }
            }
            val nothing = !searching && results.isEmpty() && searchProblem == null && query.trim().length >= 3 && chosen?.address != query
            if (searching || results.isNotEmpty() || nothing || searchProblem != null) {
                Column(Modifier.fillMaxWidth().clip(RoundedCornerShape(16.dp)).background(C.Surface).border(1.dp, C.Border, RoundedCornerShape(16.dp)).verticalScroll(rememberScrollState()).padding(horizontal = 14.dp, vertical = 4.dp)) {
                    if (searching) Txt("Searching...", 13f, 500, C.Muted, Modifier.padding(vertical = 10.dp))
                    searchProblem?.let { Txt(it, 13f, 600, C.RedText, Modifier.padding(vertical = 10.dp)) }
                    if (nothing) Txt("No places found. Try the area or town too, like \"KFC Bodija, Ibadan\", or move the map.", 13f, 500, C.Muted, Modifier.padding(vertical = 10.dp))
                    results.take(6).forEach { p ->
                        val parts = p.address.split(", ")
                        Row(
                            Modifier.fillMaxWidth().tap({ chosen = p; query = p.address; results = emptyList(); mapCenter = p.point; controller.dismiss() }, p.address).padding(vertical = 10.dp),
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
                Txt("EDIT DESTINATION", 11f, 600, C.Muted, letterSpacing = 1f)
                val shown = chosen?.address
                Txt(shown?.substringBefore(", ") ?: "Search, or move the map to choose the new drop-off", 16f, 800, maxLines = 2)
                shown?.substringAfter(", ", "")?.ifEmpty { null }?.let { Txt(it, 12.5f, 500, C.Muted, maxLines = 2) }
                Txt("Now heading to $currentName. Your pickup stays the same. The route is worked out again from where your driver is now.", 11.5f, 500, C.Faint)
                controller.error?.let { Txt(it, 12.5f, 600, C.RedText) }
                Gap(8.dp)
                Btn("Confirm new destination", { chosen?.let(controller::change) }, Modifier.fillMaxWidth(), enabled = chosen != null && chosen?.address != "Pinned location")
            }
        }
    }
}

/**
 * Tells the person the drop-off changed: the rider sees a confirmation with what is left to drive; the driver sees the new place so they
 * know the route has changed.
 *
 * @param role "rider" or "driver": the person looking.
 */
@Composable
fun DestinationNotice(controller: DestinationController, role: String) {
    val n: DestinationChange = controller.notice ?: return
    Box(Modifier.fillMaxSize()) {
        Column(
            Modifier.align(Alignment.TopCenter).statusBarsPadding().padding(12.dp).fillMaxWidth().clip(RoundedCornerShape(20.dp)).background(C.Surface)
                .border(1.dp, C.Border, RoundedCornerShape(20.dp)).padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                RoundIconTile(Ic.Check, C.GreenAccent, C.GreenTint, 38.dp, iconSize = 20.dp)
                Column(Modifier.weight(1f)) {
                    Txt(if (role == "rider") "Destination updated" else "Your rider changed the destination", 15.5f, 800)
                    Txt("Now heading to ${n.newAddress ?: "the new destination"}.", 13f, 500, C.Muted)
                    Txt(
                        if (n.estimated) "About ${km(n.remainingDistanceM)} to go (estimated)." else "${km(n.remainingDistanceM)} to go, about ${minutes(n.remainingDurationS)}.",
                        12.5f, 600, C.GreenAccent,
                    )
                }
            }
            Btn("OK", controller::dismiss, Modifier.fillMaxWidth(), height = 42.dp, size = 14f)
        }
    }
}
