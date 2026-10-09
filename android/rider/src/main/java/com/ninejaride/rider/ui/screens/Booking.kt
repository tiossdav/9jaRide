package com.ninejaride.rider.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.setValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import com.ninejaride.core.data.MapPoint
import com.ninejaride.core.format.naira
import com.ninejaride.core.ui.components.Btn
import com.ninejaride.core.ui.components.BtnKind
import com.ninejaride.core.ui.components.Card
import com.ninejaride.core.ui.components.CircleIconButton
import com.ninejaride.core.ui.components.Gap
import com.ninejaride.core.ui.components.Ic
import com.ninejaride.core.ui.components.Icon24
import com.ninejaride.core.ui.components.MapMarker
import com.ninejaride.core.ui.components.MapPanel
import com.ninejaride.core.ui.components.MarkerKind
import com.ninejaride.core.ui.components.RoundIconTile
import com.ninejaride.core.ui.components.ScreenHeader
import com.ninejaride.core.ui.components.SheetOverlay
import com.ninejaride.core.ui.components.Txt
import com.ninejaride.core.ui.components.tap
import com.ninejaride.core.ui.theme.C
import com.ninejaride.core.ui.theme.type
import com.ninejaride.rider.state.CATEGORIES
import com.ninejaride.rider.state.Dest
import com.ninejaride.rider.state.Dialog
import com.ninejaride.rider.state.NIGERIA_TIME
import com.ninejaride.rider.state.RiderViewModel
import com.ninejaride.rider.state.categoryLabel
import java.time.DayOfWeek
import java.time.LocalDate
import java.time.LocalTime
import java.time.format.DateTimeFormatter
import java.time.format.TextStyle
import java.util.Locale

private val IBADAN = MapPoint(7.3775, 3.9470)
private val dayFmt = DateTimeFormatter.ofPattern("EEE d MMM", Locale.ENGLISH)
private val timeFmt = DateTimeFormatter.ofPattern("h:mm a", Locale.ENGLISH)

fun fareRange(low: Long, high: Long) = if (low == high) naira(low) else "${naira(low)} - ${naira(high)}"

private fun categoryBlurb(c: String) = when (c) {
    "regular" -> "Affordable everyday rides"
    "comfort" -> "Newer cars, more space"
    else -> "Send a parcel across town"
}

private fun categoryIcon(c: String) = if (c == "package") Ic.Box else Ic.Car

// ---------------------------------------------------------------- the Home tab

/**
 * The home screen, in two parts that fill it: the map with the rider's position takes the top 55% of the height, and one
 * continuous panel takes the bottom 45% (it is the screen's bottom half, not a card floating over a background). The panel's
 * rounded top edge sits a little over the map so the two read as one surface. Everything in it fits without scrolling:
 * where to, pickup and scheduling, then the ride options.
 */
@Composable
fun HomeTab(vm: RiderViewModel) {
    val here = vm.location.point
    androidx.compose.foundation.layout.BoxWithConstraints(Modifier.fillMaxSize().background(C.Surface)) {
        val mapH = maxHeight * 0.55f
        val panelH = maxHeight - mapH
        val overlap = 22.dp // the panel's rounded corners show the map behind them
        Box(Modifier.fillMaxWidth().height(mapH + overlap)) {
            MapPanel(
                Modifier.fillMaxSize(),
                markers = here?.let { listOf(MapMarker(it, MarkerKind.Pickup)) } ?: emptyList(),
                center = here ?: IBADAN,
                zoom = 15.5 + (vm.focusTick % 2) * 0.0001, // a tiny change is what makes the map move back after the rider panned away
                interactive = true,
            )
            Row(Modifier.align(Alignment.TopStart).statusBarsPadding().padding(16.dp), verticalAlignment = Alignment.CenterVertically) {
                Box(Modifier.clip(RoundedCornerShape(999.dp)).background(C.Surface).border(1.dp, C.Border, RoundedCornerShape(999.dp)).padding(horizontal = 14.dp, vertical = 9.dp)) {
                    Txt("Hi, " + (vm.profile?.name?.substringBefore(' ')?.ifBlank { null }?.replaceFirstChar { it.uppercase() } ?: "there"), 13.5f, 700)
                }
            }
            // the usual "find me" button, top right of the map
            Box(
                Modifier.align(Alignment.TopEnd).statusBarsPadding().padding(16.dp).size(46.dp).clip(CircleShape).background(C.Surface)
                    .border(1.dp, C.Border, CircleShape).tap(vm::locateMe, "Use my location"),
                contentAlignment = Alignment.Center,
            ) { Icon24(Ic.Locate, C.GreenAccent, 24.dp) }
        }
        Column(
            Modifier.align(Alignment.BottomCenter).fillMaxWidth().height(panelH + overlap)
                .clip(RoundedCornerShape(topStart = 24.dp, topEnd = 24.dp)).background(C.Surface)
                .padding(top = 8.dp, bottom = 12.dp),
            // Nothing scrolls: every section is sized to fit, and the space left over is shared out between them.
            verticalArrangement = Arrangement.SpaceEvenly,
        ) {
            Box(Modifier.align(Alignment.CenterHorizontally).size(width = 40.dp, height = 4.dp).clip(RoundedCornerShape(2.dp)).background(C.Border))
            BookingBlock(vm, here != null)
            QuickActions(vm)
        }
    }
}

/** The main thing on the screen: where to, from where, and when. */
@Composable
private fun BookingBlock(vm: RiderViewModel, located: Boolean) {
    Column(Modifier.padding(horizontal = 16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Txt("Where are you going?", 20f, 800)
        Row(
            Modifier.fillMaxWidth().clip(RoundedCornerShape(16.dp)).background(C.Raised).border(1.5.dp, C.GreenAccent, RoundedCornerShape(16.dp))
                .tap({ vm.prepareBooking(); vm.push(Dest.WhereTo) }, "Where to").padding(horizontal = 16.dp, vertical = 13.dp),
            verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Icon24(Ic.Pin, C.Orange, 22.dp)
            Txt("Search destination", 16f, 700, C.Muted, modifier = Modifier.weight(1f))
            Box(Modifier.clip(RoundedCornerShape(999.dp)).background(C.GreenAccent).padding(horizontal = 12.dp, vertical = 5.dp)) { Txt("Now", 12.5f, 800, androidx.compose.ui.graphics.Color.White) }
        }
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Row(
                Modifier.weight(1f).clip(RoundedCornerShape(14.dp)).border(1.dp, C.Border, RoundedCornerShape(14.dp))
                    .tap({ vm.prepareBooking(); vm.activeField = 0; vm.push(Dest.WhereTo) }, "Pickup location").padding(horizontal = 12.dp, vertical = 9.dp),
                verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                Box(Modifier.size(9.dp).clip(CircleShape).background(C.Green))
                Column(Modifier.weight(1f)) {
                    Txt("Pickup", 10.5f, 600, C.Muted)
                    Txt(vm.pickupText.ifBlank { if (located) "Current location" else "Finding you..." }, 13.5f, 700, maxLines = 1)
                }
            }
            Row(
                Modifier.clip(RoundedCornerShape(14.dp)).background(C.GreenTint).tap(vm::openSchedule, "Schedule a ride").padding(horizontal = 12.dp, vertical = 9.dp),
                verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                Icon24(Ic.Calendar, C.GreenAccent, 20.dp)
                Column { Txt("Schedule", 13.5f, 800, C.GreenAccent); Txt("a ride", 10.5f, 600, C.GreenAccent) }
            }
        }
    }
}

/** Ride options and other things people come for, as one row of tiles. */
@Composable
private fun QuickActions(vm: RiderViewModel) {
    val actions = buildList {
        CATEGORIES.forEach { c -> add(Triple(categoryLabel(c), categoryIcon(c)) { vm.bookCategory(c) }) }
        add(Triple("Wallet", Ic.Wallet) { vm.push(Dest.Wallet) })
    }.take(4)
    Column(Modifier.padding(horizontal = 16.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
        Txt("Ride options", 14f, 800)
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            actions.forEach { (label, icon, go) ->
                Column(
                    Modifier.weight(1f).clip(RoundedCornerShape(14.dp)).background(C.Raised).tap(go, label).padding(vertical = 9.dp, horizontal = 4.dp),
                    horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(5.dp),
                ) {
                    Box(Modifier.size(34.dp).clip(CircleShape).background(C.Surface), contentAlignment = Alignment.Center) { Icon24(icon, C.GreenAccent, 19.dp) }
                    Txt(label, 12f, 700, maxLines = 1)
                }
            }
        }
    }
}

// ---------------------------------------------------------------- where to

@Composable
private fun PlaceRow(title: String, sub: String?, onClick: () -> Unit) {
    Row(Modifier.fillMaxWidth().tap(onClick, title).padding(vertical = 12.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
        RoundIconTile(Ic.Pin, C.GreenAccent, C.GreenTint, 38.dp, iconSize = 20.dp)
        Column(Modifier.weight(1f)) { Txt(title, 14f, 600, maxLines = 2); sub?.let { Txt(it, 12f, 500, C.Muted) } }
    }
}

@Composable
private fun AddressInput(label: String, value: String, active: Boolean, hint: String, color: Color, onChange: (String) -> Unit, focus: FocusRequester?, onFocused: () -> Unit = {}) {
    // Kept as a text-and-selection pair so that tapping into a box selects what is in it: typing then replaces the old address
    // instead of being added to it ("Current location" + what the rider types is not a place).
    var field by remember { mutableStateOf(androidx.compose.ui.text.input.TextFieldValue(value)) }
    // The text comes back from the view model a moment after it is typed. A value that is just an echo of what was typed must not
    // overwrite the box (a fast typist would lose letters); only a value that did not come from this box (a picked place, a clear) does.
    val echoes = remember { ArrayDeque<String>() }
    if (field.text != value && value !in echoes) { field = androidx.compose.ui.text.input.TextFieldValue(value, androidx.compose.ui.text.TextRange(value.length)); echoes.clear() }
    var focused by remember { mutableStateOf(false) }
    LaunchedEffect(focused) { if (focused) field = field.copy(selection = androidx.compose.ui.text.TextRange(0, field.text.length)) }
    Row(
        Modifier.fillMaxWidth().clip(RoundedCornerShape(14.dp)).background(C.Surface).border(1.5.dp, if (active) C.GreenAccent else C.Border, RoundedCornerShape(14.dp)).padding(horizontal = 14.dp, vertical = 12.dp),
        verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Box(Modifier.size(10.dp).clip(CircleShape).background(color))
        BasicTextField(
            value = field, onValueChange = { field = it; if (it.text != value) { echoes.addLast(it.text); if (echoes.size > 12) echoes.removeFirst(); onChange(it.text) } }, singleLine = true,
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Text),
            textStyle = type(14.5f, 600, C.Ink), cursorBrush = SolidColor(C.GreenAccent),
            modifier = Modifier.weight(1f).let { if (focus != null) it.focusRequester(focus) else it }
                .onFocusChanged { focused = it.isFocused; if (it.isFocused) onFocused() },
            decorationBox = { inner -> Box { if (value.isEmpty()) Txt(hint, 14.5f, 500, C.Disabled); inner() } },
        )
        if (value.isNotEmpty()) Icon24(Ic.Close, C.Faint, 16.dp, modifier = Modifier.tap({ onChange("") }, "Clear $label"))
    }
}

@Composable
fun WhereToScreen(vm: RiderViewModel) {
    val dropFocus = remember { FocusRequester() }
    val pickFocus = remember { FocusRequester() }
    // the screen opens on the box the rider tapped: the pickup, or the destination
    LaunchedEffect(Unit) { runCatching { (if (vm.activeField == 0) pickFocus else dropFocus).requestFocus() } }
    Column(Modifier.fillMaxSize().background(C.Bg).imePadding()) {
        Column(Modifier.statusBarsPadding().padding(horizontal = 20.dp, vertical = 16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                CircleIconButton(Ic.Back, "Back", vm::pop)
                Txt("Plan your ride", 20f, 800)
            }
            AddressInput("Pickup", vm.pickupText, vm.activeField == 0, "Pickup address", C.Green, { vm.onFieldText(0, it) }, pickFocus, onFocused = { vm.focusField(0) })
            AddressInput("Drop-off", vm.dropoffText, vm.activeField == 1, "Where to?", C.Orange, { vm.onFieldText(1, it) }, dropFocus, onFocused = { vm.focusField(1) })
        }
        Column(Modifier.weight(1f).verticalScroll(rememberScrollState()).padding(start = 20.dp, end = 20.dp, bottom = 36.dp)) {
            if (vm.location.point != null) {
                PlaceRow("Use my current location", "Where you are right now") {
                    val p = vm.location.point!!
                    vm.choosePlace(com.ninejaride.core.data.Place("Current location", p))
                }
            }
            PlaceRow("Set ${if (vm.activeField == 0) "pickup" else "drop-off"} on map", "Move the map to place the pin") { vm.mapPinAddress = null; vm.previewStart = null; vm.push(Dest.SetOnMap) }
            if (vm.searching) Txt("Searching...", 13f, 500, C.Muted, Modifier.padding(vertical = 12.dp))
            vm.searchProblem?.let { Txt(it, 13f, 600, C.RedText, Modifier.padding(vertical = 12.dp)) }
            if (vm.suggestions.isNotEmpty()) Txt(if (vm.location.point != null) "NEARBY RESULTS" else "RESULTS", 11f, 700, C.Muted, Modifier.padding(top = 14.dp, bottom = 2.dp), letterSpacing = 1.2f)
            vm.suggestions.forEach { p ->
                val parts = p.address.split(", ")
                val away = p.distanceKm?.let { if (it < 1) "${(it * 1000).toInt().coerceAtLeast(50) / 10 * 10} m away" else "${"%.1f".format(it)} km away" }
                PlaceRow(parts.first(), (listOf(parts.drop(1).joinToString(", ")) + listOfNotNull(away)).filter { it.isNotEmpty() }.joinToString("  ·  ").ifEmpty { null }) { vm.previewPlace(p) }
            }
            if (!vm.searching && vm.searchProblem == null && vm.suggestions.isEmpty() && (if (vm.activeField == 0) vm.pickupText else vm.dropoffText).length >= 3 && (if (vm.activeField == 0) vm.pickup else vm.dropoff) == null) {
                Txt("No places found. Try adding the area or town, like \"KFC Bodija, Ibadan\", or set it on the map.", 13f, 500, C.Muted, Modifier.padding(vertical = 12.dp))
            }
        }
    }
}

@Composable
fun SetOnMapScreen(vm: RiderViewModel) {
    val start = vm.previewStart ?: (if (vm.activeField == 0) vm.pickup?.point else vm.dropoff?.point) ?: vm.location.point ?: IBADAN
    Box(Modifier.fillMaxSize()) {
        MapPanel(Modifier.fillMaxSize(), center = start, interactive = true, onCenterChange = vm::onMapMoved)
        // the pin stays in the middle while the map moves under it
        Box(Modifier.align(Alignment.Center).padding(bottom = 30.dp)) { Icon24(Ic.Pin, if (vm.activeField == 0) C.Green else C.Orange, 44.dp, 2.2f) }
        Box(Modifier.align(Alignment.TopStart).statusBarsPadding().padding(16.dp)) { CircleIconButton(Ic.Back, "Back", { vm.previewStart = null; vm.pop() }) }
        Column(Modifier.align(Alignment.BottomCenter).fillMaxWidth().padding(16.dp)) {
            Card {
                Txt(if (vm.activeField == 0) "PICKUP" else "DROP-OFF", 11f, 500, C.Muted, letterSpacing = 1f)
                val shown = vm.mapPinAddress
                Txt(shown?.substringBefore(", ") ?: "Move the map to choose a spot", 16f, 800, maxLines = 2)
                shown?.substringAfter(", ", "")?.ifEmpty { null }?.let { Txt(it, 12.5f, 500, C.Muted, maxLines = 2) }
                Txt("Move the map to adjust the pin.", 11.5f, 500, C.Faint)
                Gap(8.dp)
                Btn("Confirm location", vm::confirmMapPin, Modifier.fillMaxWidth(), enabled = vm.mapPinAddress != null)
            }
        }
    }
}

// ---------------------------------------------------------------- choosing the ride

@Composable
fun SelectRideScreen(vm: RiderViewModel) {
    Column(Modifier.fillMaxSize().background(C.Bg)) {
        Box(Modifier.weight(0.42f).fillMaxWidth()) {
            val r = vm.route
            MapPanel(
                Modifier.fillMaxSize(),
                markers = listOfNotNull(vm.pickup?.let { MapMarker(it.point, MarkerKind.Pickup) }, vm.dropoff?.let { MapMarker(it.point, MarkerKind.Dropoff) }),
                route = r?.points ?: emptyList(), fit = true, interactive = false, fitBorderDp = 70,
            )
            Box(Modifier.statusBarsPadding().padding(16.dp)) { CircleIconButton(Ic.Back, "Back", vm::pop) }
        }
        Column(Modifier.weight(0.58f).fillMaxWidth().clip(RoundedCornerShape(topStart = 26.dp, topEnd = 26.dp)).background(C.Surface).navigationBarsPadding().padding(20.dp)) {
            Column(Modifier.weight(1f).verticalScroll(rememberScrollState()).padding(bottom = 24.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Txt("Choose a ride", 18f, 800, modifier = Modifier.weight(1f))
                    vm.route?.let { Txt("${"%.1f".format(it.distanceM / 1000.0)} km  -  ${(it.durationS / 60).coerceAtLeast(1)} min", 12.5f, 600, C.Muted) }
                }
                if (vm.quotesLoading) Txt("Getting fares...", 14f, 500, C.Muted, Modifier.padding(vertical = 14.dp))
                vm.quotesError?.let { Txt(it, 13.5f, 600, C.RedText) }
                CATEGORIES.forEach { c ->
                    val q = vm.quotes.value[c]
                    if (q != null) {
                        val sel = vm.selectedCategory == c
                        Row(
                            Modifier.fillMaxWidth().clip(RoundedCornerShape(16.dp)).background(if (sel) C.GreenTint else C.Raised)
                                .border(1.5.dp, if (sel) C.GreenAccent else C.Border, RoundedCornerShape(16.dp)).tap({ vm.chooseCategory(c) }, categoryLabel(c)).padding(14.dp),
                            verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp),
                        ) {
                            RoundIconTile(categoryIcon(c), C.GreenAccent, C.Surface, 44.dp, iconSize = 24.dp)
                            Column(Modifier.weight(1f)) { Txt(categoryLabel(c), 15f, 800); Txt(categoryBlurb(c), 12f, 500, C.Muted) }
                            Column(horizontalAlignment = Alignment.End) { Txt(naira(q.expectedKobo), 15.5f, 800); Txt(fareRange(q.lowKobo, q.highKobo), 11f, 500, C.Muted) }
                        }
                    }
                }
                Txt("The final fare is worked out from the actual trip and may differ a little from the estimate.", 11.5f, 500, C.Muted)
                PromoBox(vm)
                Gap(2.dp)
                Txt("PAY WITH", 11f, 500, C.Muted, letterSpacing = 1f)
                Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    PayChoice("Cash", Ic.Bank, vm.payMethod == "cash", Modifier.weight(1f)) { vm.payMethod = "cash" }
                    PayChoice("Wallet" + (vm.wallet?.let { "  " + naira(it.availableKobo) } ?: ""), Ic.Wallet, vm.payMethod == "wallet", Modifier.weight(1f)) { vm.payMethod = "wallet" }
                }
            }
            Gap(10.dp)
            val q = vm.quotes.value[vm.selectedCategory]
            Btn(if (vm.requesting) "Requesting..." else "Request ${categoryLabel(vm.selectedCategory)}", { vm.confirm("Request ${categoryLabel(vm.selectedCategory)}?", "We will start looking for a driver now. You pay ${if (vm.payMethod == "wallet") "from your wallet" else "in cash"}.", "Yes, request", false, vm::requestRide) }, Modifier.fillMaxWidth(), enabled = q != null && !vm.requesting)
        }
    }
    if (vm.dialog == Dialog.Notice) com.ninejaride.rider.ui.screens.NoticeSheet(vm)
}

@Composable
private fun PromoBox(vm: RiderViewModel) {
    val applied = vm.promo
    if (applied != null) {
        Row(Modifier.fillMaxWidth().clip(RoundedCornerShape(14.dp)).background(C.GreenTint).padding(12.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            Icon24(Ic.Gift, C.GreenAccent, 20.dp)
            Column(Modifier.weight(1f)) { Txt("${applied.code} applied", 14f, 800, C.GreenAccent); Txt("You save about ${naira(applied.discountKobo)}. You pay about ${naira(applied.payKobo)}.", 12f, 500, C.Muted) }
            Txt("Remove", 13f, 700, C.GreenAccent, Modifier.tap(vm::clearPromo, "Remove promo code"))
        }
        return
    }
    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
        BasicTextField(
            value = vm.promoText, onValueChange = { vm.promoText = it.filter { c -> c.isLetterOrDigit() }.take(20).uppercase(); vm.promoMessage = null },
            singleLine = true, textStyle = type(14.5f, 700, C.Ink), cursorBrush = SolidColor(C.GreenAccent), modifier = Modifier.weight(1f),
            decorationBox = { inner -> Box(Modifier.fillMaxWidth().clip(RoundedCornerShape(12.dp)).background(C.Raised).border(1.dp, C.Border, RoundedCornerShape(12.dp)).padding(horizontal = 14.dp, vertical = 12.dp)) { if (vm.promoText.isEmpty()) Txt("Promo code", 14.5f, 500, C.Disabled); inner() } },
        )
        Btn(if (vm.promoChecking) "..." else "Apply", vm::applyPromo, Modifier.width(88.dp), kind = BtnKind.Outline, height = 46.dp, size = 14f, enabled = vm.promoText.length >= 3 && !vm.promoChecking)
    }
    vm.promoMessage?.let { Txt(it, 12.5f, 600, C.RedText) }
}

@Composable
private fun PayChoice(label: String, icon: List<String>, selected: Boolean, modifier: Modifier, onClick: () -> Unit) {
    Row(
        modifier.clip(RoundedCornerShape(14.dp)).background(if (selected) C.GreenTint else C.Raised)
            .border(1.5.dp, if (selected) C.GreenAccent else C.Border, RoundedCornerShape(14.dp)).tap(onClick, label).padding(12.dp),
        verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Icon24(icon, C.GreenAccent, 20.dp)
        Txt(label, 13f, 700, maxLines = 1)
    }
}

@Composable
fun WalletHoldScreen(vm: RiderViewModel) {
    val need = vm.quotes.value[vm.selectedCategory]?.highKobo ?: 0L
    val have = vm.wallet?.availableKobo ?: 0L
    Column(Modifier.fillMaxSize().background(C.Bg).statusBarsPadding().navigationBarsPadding().padding(20.dp)) {
        CircleIconButton(Ic.Back, "Back", vm::pop)
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(14.dp), horizontalAlignment = Alignment.CenterHorizontally) {
            Gap(30.dp)
            Box(Modifier.size(88.dp).clip(CircleShape).background(C.OrangeTint), contentAlignment = Alignment.Center) { Icon24(Ic.Wallet, C.OrangeIcon, 40.dp) }
            Txt("Not enough in your wallet", 22f, 800, align = TextAlign.Center)
            Txt("To pay from your wallet we hold the top of the fare range until the trip ends, then return what is not used.", 14f, 500, C.Muted, align = TextAlign.Center)
            Card {
                com.ninejaride.core.ui.components.MoneyLine("Amount held", naira(need))
                com.ninejaride.core.ui.components.MoneyLine("Available now", naira(have))
                com.ninejaride.core.ui.components.Divider()
                com.ninejaride.core.ui.components.MoneyLine("Top up at least", naira((need - have).coerceAtLeast(0)), bold = true)
            }
        }
        Btn("Top up wallet", { vm.topUpAmount = (((need - have).coerceAtLeast(com.ninejaride.core.format.MIN_TOPUP_KOBO) + 49_999L) / 50_000L) * 50_000L; vm.push(Dest.TopUp) }, Modifier.fillMaxWidth())
        Gap(8.dp)
        Btn("Pay with cash instead", { vm.payMethod = "cash"; vm.pop() }, Modifier.fillMaxWidth(), kind = BtnKind.Outline)
    }
}

// ---------------------------------------------------------------- scheduling

@Composable
fun ScheduleFormScreen(vm: RiderViewModel) {
    Column(Modifier.fillMaxSize().background(C.Bg)) {
        Box(Modifier.statusBarsPadding()) { ScreenHeader("Schedule a ride", "Book ahead, once or every week", onBack = vm::pop) }
        Column(Modifier.weight(1f).verticalScroll(rememberScrollState()).padding(start = 20.dp, end = 20.dp, bottom = 36.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
            Row(Modifier.fillMaxWidth().clip(RoundedCornerShape(999.dp)).background(C.Raised).padding(4.dp)) {
                listOf("One time" to false, "Weekly" to true).forEach { (label, weekly) ->
                    val on = vm.schedWeekly == weekly
                    Box(Modifier.weight(1f).clip(RoundedCornerShape(999.dp)).background(if (on) C.Green else Color.Transparent).tap({ vm.schedWeekly = weekly }, label).padding(vertical = 10.dp), contentAlignment = Alignment.Center) {
                        Txt(label, 13.5f, 700, if (on) Color.White else C.Muted)
                    }
                }
            }
            AddressInput("Pickup", vm.pickupText, vm.activeField == 0, "Pickup address", C.Green, { vm.onFieldText(0, it) }, null)
            AddressInput("Drop-off", vm.dropoffText, vm.activeField == 1, "Drop-off address", C.Orange, { vm.onFieldText(1, it) }, null)
            vm.suggestions.forEach { p -> val parts = p.address.split(", "); PlaceRow(parts.first(), parts.drop(1).joinToString(", ").ifEmpty { null }) { vm.suggestions = emptyList(); if (vm.activeField == 0) { vm.pickup = p; vm.pickupText = p.address } else { vm.dropoff = p; vm.dropoffText = p.address } } }
            if (vm.schedWeekly) {
                Txt("REPEATS ON", 11f, 500, C.Muted, letterSpacing = 1f)
                Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    DayOfWeek.values().forEach { d ->
                        val on = d in vm.schedDays
                        Box(Modifier.weight(1f).height(42.dp).clip(RoundedCornerShape(12.dp)).background(if (on) C.Green else C.Raised).border(1.dp, if (on) C.Green else C.Border, RoundedCornerShape(12.dp)).tap({ vm.toggleDay(d) }, d.name), contentAlignment = Alignment.Center) {
                            Txt(d.getDisplayName(TextStyle.SHORT, Locale.ENGLISH).take(3), 12f, 700, if (on) Color.White else C.Ink)
                        }
                    }
                }
                LabeledPicker("First ride", vm.schedFirstDate?.format(dayFmt) ?: "Pick a date") { vm.dialog = Dialog.SchedFirstDate }
                if (vm.schedDays.isNotEmpty()) Txt("Each chosen day is booked for ${vm.scheduleWeeks} weeks. You can cancel one ride or the whole series any time.", 12f, 500, C.Muted)
            } else {
                LabeledPicker("Date", vm.schedDate?.format(dayFmt) ?: "Pick a date") { vm.dialog = Dialog.SchedDate }
            }
            LabeledPicker("Pickup time", vm.schedTime.format(timeFmt)) { vm.dialog = Dialog.SchedTime }
            Txt("We start looking for a driver about 30 minutes before pickup. Pick a time at least 30 minutes from now.", 12f, 500, C.Muted)
            Gap(8.dp)
        }
        Box(Modifier.navigationBarsPadding().padding(20.dp)) { Btn("Review", vm::reviewSchedule, Modifier.fillMaxWidth(), enabled = vm.scheduleReady) }
    }
    when (vm.dialog) {
        Dialog.SchedDate -> DatePickerSheet(vm.schedDate) { vm.schedDate = it; vm.dialog = null }
        Dialog.SchedFirstDate -> DatePickerSheet(vm.schedFirstDate) { vm.schedFirstDate = it; vm.dialog = null }
        Dialog.SchedTime -> TimePickerSheet(vm)
        Dialog.Notice -> NoticeSheet(vm)
        else -> {}
    }
}

@Composable
private fun LabeledPicker(label: String, value: String, onClick: () -> Unit) {
    Row(Modifier.fillMaxWidth().clip(RoundedCornerShape(14.dp)).background(C.Surface).border(1.dp, C.Border, RoundedCornerShape(14.dp)).tap(onClick, label).padding(horizontal = 16.dp, vertical = 14.dp), verticalAlignment = Alignment.CenterVertically) {
        Column(Modifier.weight(1f)) { Txt(label, 11.5f, 600, C.Muted); Txt(value, 15f, 700) }
        Icon24(Ic.Calendar, C.GreenAccent, 20.dp)
    }
}

@Composable
private fun DatePickerSheet(selected: LocalDate?, onPick: (LocalDate) -> Unit) {
    val today = LocalDate.now(NIGERIA_TIME)
    SheetOverlay(onDismiss = { onPick(selected ?: today) }) {
        Txt("Pick a date", 18f, 800)
        Column(Modifier.height(320.dp).verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            (0L..60L).map { today.plusDays(it) }.forEach { d ->
                val on = d == selected
                Row(Modifier.fillMaxWidth().clip(RoundedCornerShape(12.dp)).background(if (on) C.GreenTint else C.Raised).border(1.dp, if (on) C.GreenAccent else C.Border, RoundedCornerShape(12.dp)).tap({ onPick(d) }, d.toString()).padding(14.dp)) {
                    Txt(if (d == today) "Today" else if (d == today.plusDays(1)) "Tomorrow" else d.format(dayFmt), 14.5f, 700, modifier = Modifier.weight(1f))
                    if (on) Icon24(Ic.Check, C.GreenAccent, 18.dp, 2.4f)
                }
            }
        }
    }
}

@Composable
private fun TimePickerSheet(vm: RiderViewModel) {
    SheetOverlay(onDismiss = { vm.dialog = null }) {
        Txt("Pickup time", 18f, 800)
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.Center, verticalAlignment = Alignment.CenterVertically) {
            Stepper(vm.schedTime.hour.let { val h = it % 12; if (h == 0) 12 else h }.toString().padStart(2, '0'),
                { vm.schedTime = vm.schedTime.plusHours(1) }, { vm.schedTime = vm.schedTime.minusHours(1) })
            Txt(" : ", 28f, 800)
            Stepper(vm.schedTime.minute.toString().padStart(2, '0'),
                { vm.schedTime = vm.schedTime.plusMinutes(5) }, { vm.schedTime = vm.schedTime.minusMinutes(5) })
            Gap(8.dp)
            Box(Modifier.padding(start = 14.dp).clip(RoundedCornerShape(12.dp)).background(C.GreenTint).tap({ vm.schedTime = vm.schedTime.plusHours(12) }, "AM or PM").padding(horizontal = 16.dp, vertical = 12.dp)) {
                Txt(if (vm.schedTime.hour < 12) "AM" else "PM", 16f, 800, C.GreenAccent)
            }
        }
        Btn("Done", { vm.dialog = null }, Modifier.fillMaxWidth())
    }
}

@Composable
private fun Stepper(text: String, up: () -> Unit, down: () -> Unit) {
    Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(6.dp)) {
        CircleIconButton(Ic.ArrowUp, "Increase", up, 38.dp)
        Txt(text, 34f, 800)
        CircleIconButton(Ic.ArrowDown, "Decrease", down, 38.dp)
    }
}

@Composable
fun ScheduleConfirmScreen(vm: RiderViewModel) {
    val q = vm.quotes.value[vm.selectedCategory]
    Column(Modifier.fillMaxSize().background(C.Bg)) {
        Box(Modifier.statusBarsPadding()) { ScreenHeader("Confirm schedule", onBack = vm::pop) }
        Column(Modifier.weight(1f).verticalScroll(rememberScrollState()).padding(start = 20.dp, end = 20.dp, bottom = 36.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
            Card { com.ninejaride.core.ui.components.RouteBlock(vm.pickupText, vm.dropoffText) }
            Card {
                com.ninejaride.core.ui.components.MoneyLine("When", if (vm.schedWeekly) "Every " + vm.schedDays.sortedBy { it.value }.joinToString(", ") { it.getDisplayName(TextStyle.SHORT, Locale.ENGLISH) } else (vm.schedDate?.format(dayFmt) ?: ""))
                com.ninejaride.core.ui.components.MoneyLine("Time", vm.schedTime.format(timeFmt))
                if (vm.schedWeekly) com.ninejaride.core.ui.components.MoneyLine("Length", "${vm.scheduleWeeks} weeks")
                com.ninejaride.core.ui.components.MoneyLine("Estimated fare", q?.let { fareRange(it.lowKobo, it.highKobo) } ?: if (vm.quotesLoading) "..." else "Not available")
            }
            Txt("CATEGORY", 11f, 500, C.Muted, letterSpacing = 1f)
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                CATEGORIES.forEach { c ->
                    val on = vm.selectedCategory == c
                    Box(Modifier.weight(1f).clip(RoundedCornerShape(12.dp)).background(if (on) C.GreenTint else C.Raised).border(1.5.dp, if (on) C.GreenAccent else C.Border, RoundedCornerShape(12.dp)).tap({ vm.selectedCategory = c }, categoryLabel(c)).padding(vertical = 12.dp), contentAlignment = Alignment.Center) {
                        Txt(categoryLabel(c), 12.5f, 700, maxLines = 1)
                    }
                }
            }
            Txt("PAY WITH", 11f, 500, C.Muted, letterSpacing = 1f)
            Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                PayChoice("Cash", Ic.Bank, vm.payMethod == "cash", Modifier.weight(1f)) { vm.payMethod = "cash" }
                PayChoice("Wallet", Ic.Wallet, vm.payMethod == "wallet", Modifier.weight(1f)) { vm.payMethod = "wallet" }
            }
            Txt("You will not be charged now. Wallet rides hold the top of the fare range when the driver search starts.", 12f, 500, C.Muted)
        }
        Box(Modifier.navigationBarsPadding().padding(20.dp)) { Btn(if (vm.schedSaving) "Saving..." else "Schedule", { vm.confirm("Schedule this ride?", "We will find your driver before pickup. You can cancel it any time.", "Yes, schedule", false, vm::saveSchedule) }, Modifier.fillMaxWidth(), enabled = vm.route != null && !vm.schedSaving) }
    }
    when (vm.dialog) {
        Dialog.ScheduleDone -> SheetOverlay(onDismiss = null) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                Box(Modifier.size(44.dp).clip(CircleShape).background(C.GreenAccent), contentAlignment = Alignment.Center) { Icon24(Ic.Check, Color.White, 22.dp, 2.6f) }
                Column { Txt("Ride scheduled", 17f, 800); Txt("We will find your driver before pickup.", 13f, 500, C.Muted) }
            }
            Btn("View scheduled rides", vm::finishSchedule, Modifier.fillMaxWidth())
        }
        Dialog.Notice -> NoticeSheet(vm)
        else -> {}
    }
}
