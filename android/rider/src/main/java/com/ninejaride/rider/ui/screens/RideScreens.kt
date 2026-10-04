package com.ninejaride.rider.ui.screens

import android.content.Intent
import android.net.Uri
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import com.ninejaride.core.data.MapPoint
import com.ninejaride.core.format.clock
import com.ninejaride.core.format.naira
import com.ninejaride.core.ui.components.Avatar
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
import com.ninejaride.core.ui.components.SheetOverlay
import com.ninejaride.core.ui.components.StarFilled
import com.ninejaride.core.ui.components.Txt
import com.ninejaride.core.ui.components.tap
import com.ninejaride.core.ui.theme.C
import com.ninejaride.rider.data.RideView
import com.ninejaride.rider.state.CANCEL_REASONS
import com.ninejaride.rider.state.Dialog
import com.ninejaride.rider.state.RiderViewModel
import com.ninejaride.rider.state.TRIP_TAGS
import com.ninejaride.rider.state.categoryLabel

/** True while a ride covers the whole screen: finding a driver, on the way, in the car, or just finished. */
fun rideIsLive(vm: RiderViewModel): Boolean {
    if (vm.tripDone != null) return true
    val s = vm.ride?.status ?: return false
    return s in setOf("REQUESTED", "SEARCHING_DRIVER", "DRIVER_ASSIGNED", "DRIVER_ARRIVED", "TRIP_STARTED")
}

@Composable
fun RideOverlay(vm: RiderViewModel) {
    val done = vm.tripDone
    if (done != null) { TripCompleteScreen(vm, done); return }
    val r = vm.ride ?: return
    Box(Modifier.fillMaxSize().background(C.Bg)) {
        val markers = buildList {
            add(MapMarker(r.pickup, MarkerKind.Pickup))
            add(MapMarker(r.dropoff, MarkerKind.Dropoff))
            vm.driverPoint?.let { add(MapMarker(it, MarkerKind.Car)) }
        }
        val searching = r.status == "REQUESTED" || r.status == "SEARCHING_DRIVER"
        MapPanel(
            // the map keeps clear of the card below so the pins and the car are never hidden behind it
            Modifier.fillMaxSize().padding(bottom = if (searching) 300.dp else 420.dp), markers = markers,
            route = if (r.status == "TRIP_STARTED") vm.tripRoute else emptyList(),
            fit = !searching, center = r.pickup, zoom = 15.0, interactive = false, fitBorderDp = 60,
        )
        if (r.status == "TRIP_STARTED" || r.status == "DRIVER_ASSIGNED" || r.status == "DRIVER_ARRIVED") {
            Box(Modifier.align(Alignment.TopEnd).statusBarsPadding().padding(16.dp)) { SosButton(vm) }
        }
        Column(Modifier.align(Alignment.BottomCenter).fillMaxWidth().padding(12.dp).navigationBarsPadding()) {
            when (r.status) {
                "REQUESTED", "SEARCHING_DRIVER" -> SearchingCard(vm, r)
                "DRIVER_ASSIGNED" -> DriverCard(vm, r, "Your driver is on the way", vm.driverEtaMin?.let { "Arriving in about $it min" } ?: "Arriving shortly", canCancel = true)
                "DRIVER_ARRIVED" -> DriverCard(vm, r, "Your driver has arrived", "Meet them at the pickup point", canCancel = true)
                "TRIP_STARTED" -> DriverCard(vm, r, "On your way", vm.tripEtaMin?.let { "About $it min to go" } ?: "Enjoy the ride", canCancel = false)
            }
        }
        if (vm.sosOpen) SosOverlay(vm)
    }
    when (vm.dialog) {
        Dialog.CancelRide -> CancelSheet(vm)
        Dialog.Notice -> com.ninejaride.rider.ui.screens.NoticeSheet(vm)
        else -> {}
    }
}

@Composable
private fun SosButton(vm: RiderViewModel) {
    Row(
        Modifier.clip(RoundedCornerShape(999.dp)).background(C.RedCard).border(1.dp, C.RedBorder, RoundedCornerShape(999.dp)).tap({ vm.confirm("Send an SOS alert?", "Our safety team gets your location and trip details straight away.", "Yes, send SOS", true, vm::sendSos) }, "SOS").padding(horizontal = 16.dp, vertical = 10.dp),
        verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Icon24(Ic.Warning, C.RedText, 18.dp)
        Txt("SOS", 13.5f, 800, C.RedText)
    }
}

@Composable
private fun SosOverlay(vm: RiderViewModel) {
    SheetOverlay(onDismiss = null) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            Box(Modifier.size(46.dp).clip(CircleShape).background(C.RedCard), contentAlignment = Alignment.Center) { Icon24(Ic.Warning, C.RedText, 24.dp) }
            Column(Modifier.weight(1f)) {
                Txt(if (vm.sosSteps >= 2) "Alert sent" else "Sending alert...", 17f, 800)
                Txt(if (vm.sosSteps >= 2) "Our safety team has your location and is acting on it." else "Sharing your location with our safety team.", 13f, 500, C.Muted)
            }
        }
        val ctx = LocalContext.current
        Btn("Call emergency services (112)", { ctx.startActivity(Intent(Intent.ACTION_DIAL, Uri.parse("tel:112"))) }, Modifier.fillMaxWidth(), kind = BtnKind.Danger)
        Btn("I am safe, close", vm::cancelSos, Modifier.fillMaxWidth(), kind = BtnKind.Outline)
    }
}

@Composable
private fun SearchingCard(vm: RiderViewModel, r: RideView) {
    Card {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            Box(Modifier.size(44.dp).clip(CircleShape).background(C.GreenTint), contentAlignment = Alignment.Center) { Icon24(Ic.Car, C.GreenAccent, 24.dp) }
            Column(Modifier.weight(1f)) {
                Txt("Finding your driver", 17f, 800)
                Txt("${categoryLabel(r.category)}  -  ${clock(vm.searchSeconds)}", 13f, 500, C.Muted)
            }
            r.estimate?.let { Txt(fareRange(it.first, it.second), 13f, 700) }
        }
        Gap(10.dp)
        com.ninejaride.core.ui.components.RouteBlock(r.pickupAddress ?: "Pickup", r.dropoffAddress ?: "Drop-off")
        Gap(12.dp)
        Btn("Cancel ride", vm::askCancel, Modifier.fillMaxWidth(), kind = BtnKind.Outline)
    }
}

@Composable
private fun DriverCard(vm: RiderViewModel, r: RideView, title: String, subtitle: String, canCancel: Boolean) {
    val d = r.driver
    val ctx = LocalContext.current
    Card {
        Txt(title, 17f, 800)
        Txt(subtitle, 13f, 500, C.Muted)
        Gap(12.dp)
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            Avatar((d?.name ?: "D").take(1).uppercase(), 48.dp, 18f)
            Column(Modifier.weight(1f)) {
                Txt(d?.name ?: "Your driver", 15.5f, 800)
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                    StarFilled(C.OrangeIcon, 14.dp)
                    Txt(d?.rating?.let { "%.1f".format(it) } ?: "New", 12.5f, 600, C.Muted)
                }
            }
            d?.phone?.let { phone ->
                CircleIconButton(Ic.Phone, "Call driver", { ctx.startActivity(Intent(Intent.ACTION_DIAL, Uri.parse("tel:$phone"))) })
            }
        }
        Gap(12.dp)
        Row(Modifier.fillMaxWidth().clip(RoundedCornerShape(14.dp)).background(C.Raised).padding(14.dp), verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f)) {
                Txt(listOfNotNull(d?.colour?.ifBlank { null }, d?.make?.ifBlank { null }).joinToString(" ").ifEmpty { "Vehicle" }, 14f, 700)
                Txt(categoryLabel(r.category), 12f, 500, C.Muted)
            }
            Box(Modifier.clip(RoundedCornerShape(8.dp)).border(1.5.dp, C.Ink, RoundedCornerShape(8.dp)).padding(horizontal = 10.dp, vertical = 5.dp)) { Txt(d?.plate ?: "", 14f, 800, letterSpacing = 1f) }
        }
        Gap(10.dp)
        com.ninejaride.core.ui.components.RouteBlock(r.pickupAddress ?: "Pickup", r.dropoffAddress ?: "Drop-off")
        if (canCancel) { Gap(12.dp); Btn("Cancel ride", vm::askCancel, Modifier.fillMaxWidth(), kind = BtnKind.Outline) }
    }
}

@Composable
private fun CancelSheet(vm: RiderViewModel) {
    SheetOverlay(onDismiss = { vm.dialog = null }) {
        Txt("Cancel this ride?", 18f, 800)
        Txt("Tell us why. This helps us improve.", 13f, 500, C.Muted)
        Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
            CANCEL_REASONS.forEach { reason ->
                val on = vm.cancelReason == reason
                Row(Modifier.fillMaxWidth().clip(RoundedCornerShape(12.dp)).background(if (on) C.GreenTint else C.Raised).border(1.dp, if (on) C.GreenAccent else C.Border, RoundedCornerShape(12.dp)).tap({ vm.cancelReason = reason }, reason).padding(14.dp), verticalAlignment = Alignment.CenterVertically) {
                    Txt(reason, 14f, 600, modifier = Modifier.weight(1f))
                    if (on) Icon24(Ic.Check, C.GreenAccent, 18.dp, 2.4f)
                }
            }
        }
        Btn("Cancel ride", vm::confirmCancel, Modifier.fillMaxWidth(), kind = BtnKind.Danger)
        Btn("Keep my ride", { vm.dialog = null }, Modifier.fillMaxWidth(), kind = BtnKind.Outline)
    }
}

@Composable
fun NoDriverSheet(vm: RiderViewModel) {
    SheetOverlay(onDismiss = null) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            Box(Modifier.size(46.dp).clip(CircleShape).background(C.OrangeTint), contentAlignment = Alignment.Center) { Icon24(Ic.Car, C.OrangeIcon, 24.dp) }
            Column(Modifier.weight(1f)) { Txt("No driver available", 17f, 800); Txt("We could not find a driver nearby. You were not charged.", 13f, 500, C.Muted) }
        }
        Btn("Try again", vm::retryAfterNoDriver, Modifier.fillMaxWidth())
        Btn("Close", { vm.dialog = null; vm.endRide() }, Modifier.fillMaxWidth(), kind = BtnKind.Outline)
    }
}

@Composable
private fun TripCompleteScreen(vm: RiderViewModel, r: RideView) {
    Column(Modifier.fillMaxSize().background(C.Bg).statusBarsPadding().navigationBarsPadding()) {
        Column(Modifier.weight(1f).verticalScroll(rememberScrollState()).padding(start = 20.dp, top = 20.dp, end = 20.dp, bottom = 40.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(14.dp)) {
            Gap(16.dp)
            Box(Modifier.size(72.dp).clip(CircleShape).background(C.GreenAccent), contentAlignment = Alignment.Center) { Icon24(Ic.Check, Color.White, 36.dp, 2.8f) }
            Txt("You have arrived", 24f, 800, align = TextAlign.Center)
            Txt((r.payableKobo ?: r.fareKobo)?.let { naira(it) } ?: "", 34f, 800, C.GreenAccent)
            if (r.discountKobo > 0) Txt("${r.promoCode ?: "Promo"} saved you ${naira(r.discountKobo)}", 13.5f, 700, C.GreenAccent)
            Txt(if (r.paymentMethod == "wallet") "Paid from your wallet" else "Pay your driver in cash", 13.5f, 600, C.Muted)
            Card(Modifier.fillMaxWidth()) { com.ninejaride.core.ui.components.RouteBlock(r.pickupAddress ?: "Pickup", r.dropoffAddress ?: "Drop-off") }
            if (r.myRating == null) {
                Txt("How was ${r.driver?.name?.substringBefore(' ') ?: "your driver"}?", 16f, 800)
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    for (i in 1..5) {
                        Box(Modifier.size(46.dp).tap({ vm.rating = i }, "$i stars"), contentAlignment = Alignment.Center) {
                            StarFilled(if (i <= vm.rating) C.OrangeIcon else C.ToggleOff, 38.dp)
                        }
                    }
                }
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    TRIP_TAGS.chunked(2).forEach { row ->
                        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            row.forEach { t ->
                                val on = t in vm.ratingTags
                                Box(Modifier.clip(RoundedCornerShape(999.dp)).background(if (on) C.GreenTint else C.Raised).border(1.dp, if (on) C.GreenAccent else C.Border, RoundedCornerShape(999.dp)).tap({ vm.toggleTag(t) }, t).padding(horizontal = 16.dp, vertical = 10.dp)) {
                                    Txt(t, 13.5f, 700, if (on) C.GreenAccent else C.Ink)
                                }
                            }
                        }
                    }
                }
            }
        }
        Column(Modifier.padding(20.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            if (r.myRating == null) Btn("Submit rating", vm::submitRating, Modifier.fillMaxWidth())
            else Btn("View receipt", { vm.finishTrip(true) }, Modifier.fillMaxWidth())
            Btn(if (r.myRating == null) "Skip" else "Done", { vm.finishTrip(showReceipt = false) }, Modifier.fillMaxWidth(), kind = BtnKind.Outline)
        }
    }
}
