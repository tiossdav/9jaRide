package com.ninejaride.driver.ui.screens

import android.content.Intent
import android.net.Uri
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
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
import com.ninejaride.driver.state.DEMO_RECEIPT
import com.ninejaride.driver.state.Dialog
import com.ninejaride.driver.state.DriverViewModel
import com.ninejaride.driver.state.FareReceipt
import com.ninejaride.driver.state.Phase
import com.ninejaride.driver.state.STOP_REASONS
import com.ninejaride.core.format.clock
import com.ninejaride.core.format.naira
import com.ninejaride.core.format.nairaMinus
import com.ninejaride.core.format.nairaSigned
import com.ninejaride.core.ui.components.Btn
import com.ninejaride.core.ui.components.BtnKind
import com.ninejaride.core.ui.components.CarDot
import com.ninejaride.core.ui.components.CircleIconButton
import com.ninejaride.core.ui.components.Divider
import com.ninejaride.core.ui.components.Gap
import com.ninejaride.core.ui.components.MapMarker
import com.ninejaride.core.ui.components.MapPanel
import com.ninejaride.core.ui.components.MarkerKind
import com.ninejaride.core.ui.components.Ic
import com.ninejaride.core.ui.components.Icon24
import com.ninejaride.core.ui.components.MoneyLine
import com.ninejaride.core.ui.components.RouteBlock
import com.ninejaride.core.ui.components.StarFilled
import com.ninejaride.core.ui.components.StreetMap
import com.ninejaride.core.ui.components.Txt
import com.ninejaride.core.ui.components.tap
import com.ninejaride.core.ui.theme.C

private fun carMarkers(vm: DriverViewModel) = vm.carPoint?.let { listOf(MapMarker(it, MarkerKind.Car)) } ?: emptyList()

/** White sheet pinned to the bottom of a map screen, as in the design. */
@Composable
private fun androidx.compose.foundation.layout.BoxScope.BottomSheetCard(content: @Composable androidx.compose.foundation.layout.ColumnScope.() -> Unit) {
    Column(
        Modifier.align(Alignment.BottomCenter).fillMaxWidth()
            .clip(RoundedCornerShape(topStart = 26.dp, topEnd = 26.dp)).background(Color.White)
            .border(1.dp, C.Border, RoundedCornerShape(topStart = 26.dp, topEnd = 26.dp))
            .navigationBarsPadding().padding(start = 20.dp, end = 20.dp, top = 10.dp, bottom = 22.dp),
        verticalArrangement = Arrangement.spacedBy(14.dp),
    ) {
        Box(Modifier.align(Alignment.CenterHorizontally).padding(bottom = 4.dp).width(40.dp).height(4.dp).clip(RoundedCornerShape(4.dp)).background(C.Border))
        content()
    }
}

/** Banner on top with the SOS button directly under it, so a long street name can never push them into each other. */
@Composable
private fun TopOverlay(vm: DriverViewModel, banner: (@Composable () -> Unit)?, onBannerClick: (() -> Unit)? = null) {
    Column(Modifier.fillMaxWidth().statusBarsPadding().padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        if (banner != null) Box(Modifier.let { if (onBannerClick != null) it.tap(onBannerClick, "Open navigation") else it }) { banner() }
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
            Btn("SOS", vm::askSos, Modifier.width(64.dp), kind = BtnKind.Danger, height = 46.dp, size = 14f)
        }
    }
}

@Composable
private fun DirectionBanner(title: String, detail: String) {
    Row(
        Modifier.fillMaxWidth().clip(RoundedCornerShape(18.dp)).background(C.Green).padding(horizontal = 16.dp, vertical = 14.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Box(Modifier.size(46.dp).clip(RoundedCornerShape(12.dp)).background(Color.White.copy(alpha = 0.14f)), contentAlignment = Alignment.Center) {
            Icon24(Ic.Navigate, Color.White, 24.dp)
        }
        Column(verticalArrangement = Arrangement.spacedBy(1.dp)) {
            Txt(title, 16f, 700, Color.White)
            Txt(detail, 12.5f, 500, C.OnGreenMuted)
        }
    }
}

/** D01: a new request with a 15 second countdown. */
@Composable
fun OfferScreen(vm: DriverViewModel) {
    val o = vm.offer
    Box(Modifier.fillMaxSize().background(C.Bg)) {
        MapPanel(
            Modifier.fillMaxWidth().fillMaxHeight(0.42f),
            markers = listOf(MapMarker(vm.demoPickup, MarkerKind.Pickup), MapMarker(vm.demoDropoff, MarkerKind.Dropoff)),
            route = vm.routeTrip, fit = true, fitBorderDp = 48,
        )
        BottomSheetCard {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Txt("New ride request", 20f, 800)
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        com.ninejaride.core.ui.components.Chip(o.category)
                        com.ninejaride.core.ui.components.Chip(o.payment, C.DarkChipText, C.DarkChip)
                    }
                }
                Column(
                    Modifier.size(84.dp).clip(CircleShape).background(Color.White).border(6.dp, C.Green, CircleShape),
                    horizontalAlignment = Alignment.CenterHorizontally,
                    verticalArrangement = Arrangement.Center,
                ) {
                    Txt("${vm.offerSeconds}", 30f, 800, C.Green)
                    Txt("sec", 11f, 500, C.Muted)
                }
            }
            Row(verticalAlignment = Alignment.CenterVertically) {
                Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(1.dp)) {
                    Txt("Pickup", 12f, 500, C.Muted)
                    Txt("${o.pickupKm} km · ${o.pickupMin} min away", 15f, 700)
                }
                Column(horizontalAlignment = Alignment.End, verticalArrangement = Arrangement.spacedBy(1.dp)) {
                    Txt("Estimated fare", 12f, 500, C.Muted)
                    Txt(naira(o.fare), 20f, 800)
                }
            }
            RouteBlock(o.pickup, o.dropoff)
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                com.ninejaride.core.ui.components.Avatar(o.rider.name.take(1), 34.dp, 14f)
                Txt(o.rider.name, 14.5f, 700)
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                    StarFilled(C.OrangeIcon, 14.dp)
                    Txt("${o.rider.rating}", 13f, 600, C.Muted)
                }
                Box(Modifier.weight(1f))
                Txt("Trip ${o.code}", 12f, 500, C.Muted)
            }
            Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                Btn("Decline", { vm.confirm("Decline this ride?", "The rider will be matched with another driver.", "Yes, decline", true, vm::decline) }, Modifier.weight(1f), kind = BtnKind.Outline)
                Btn("Accept", { vm.confirm("Accept this ride?", "You will head to the pickup point straight away.", "Yes, accept", false, vm::accept) }, Modifier.weight(1f))
            }
            Txt("Declining or ignoring many requests can affect how often you receive them.", 12f, 500, C.Muted, align = TextAlign.Center, modifier = Modifier.fillMaxWidth())
        }
    }
}

private fun openNavigation(context: android.content.Context, query: String) {
    // Turn-by-turn is handed to the phone's maps app until an in-app map SDK is chosen.
    val uri = Uri.parse("google.navigation:q=" + Uri.encode(query))
    val intent = Intent(Intent.ACTION_VIEW, uri).setPackage("com.google.android.apps.maps")
    runCatching { context.startActivity(intent) }.onFailure {
        runCatching { context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse("geo:0,0?q=" + Uri.encode(query)))) }
    }
}

/** D02: heading to the pickup. */
@Composable
fun ToPickupScreen(vm: DriverViewModel) {
    val o = vm.offer
    val ctx = LocalContext.current
    Box(Modifier.fillMaxSize().background(C.Bg)) {
        MapPanel(
            Modifier.fillMaxWidth().fillMaxHeight(0.52f),
            markers = listOf(MapMarker(vm.demoPickup, MarkerKind.Pickup)) + carMarkers(vm),
            route = vm.routeToPickup, fit = true, fitBorderDp = 120,
        )
        TopOverlay(vm, { DirectionBanner("Head north on Moboluwaduro Street", "400 m · tap to open maps") }) { openNavigation(ctx, o.pickup) }
        BottomSheetCard {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                    Txt("Pickup in ${o.pickupMin} min", 20f, 800)
                    Txt("${o.pickupKm} km away", 13f, 500, C.Muted)
                }
                Box(Modifier.clip(RoundedCornerShape(10.dp)).background(C.Bg).border(1.5.dp, C.Border, RoundedCornerShape(10.dp)).padding(horizontal = 12.dp, vertical = 7.dp)) {
                    Txt("Trip ${o.code}", 14f, 700, letterSpacing = 0.5f)
                }
            }
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                com.ninejaride.core.ui.components.Avatar(o.rider.name.take(1), 46.dp, 19f)
                Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                    Txt(o.rider.name, 16f, 700)
                    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                        StarFilled(C.OrangeIcon, 14.dp); Txt("${o.rider.rating}", 13f, 500, C.Muted)
                    }
                }
                CircleIconButton(Ic.Phone, "Call rider", { ctx.startActivity(Intent(Intent.ACTION_DIAL, Uri.parse("tel:"))) })
            }
            RouteBlock(o.pickup, o.dropoff)
            Btn("I've arrived", { vm.confirm("Have you arrived?", "The rider is told you are at the pickup point and your waiting time starts.", "Yes, I've arrived", false, vm::arrived) }, Modifier.fillMaxWidth())
            Btn("Cancel trip", { vm.confirm("Cancel this trip?", "Cancelling often lowers how many rides you are offered.", "Yes, cancel trip", true, vm::cancelTrip) }, Modifier.fillMaxWidth(), kind = BtnKind.Outline, height = 46.dp)
        }
    }
}

/** D03: at the pickup point, waiting. */
@Composable
fun WaitingScreen(vm: DriverViewModel) {
    val o = vm.offer
    val ctx = LocalContext.current
    Box(Modifier.fillMaxSize().background(C.Bg)) {
        MapPanel(
            Modifier.fillMaxWidth().fillMaxHeight(0.56f),
            markers = listOf(MapMarker(vm.demoPickup, MarkerKind.Pickup)) + carMarkers(vm),
            center = vm.demoPickup, zoom = 17.0,
        )
        TopOverlay(vm, null)
        BottomSheetCard {
            Column(verticalArrangement = Arrangement.spacedBy(3.dp)) {
                Txt("Waiting for ${o.rider.name}", 22f, 800)
                Txt("Pickup point · ${o.pickup.substringBefore(',')}, ${o.pickup.split(',').getOrElse(1) { "" }.trim()}", 13f, 500, C.Muted)
            }
            Row(
                Modifier.fillMaxWidth().clip(RoundedCornerShape(18.dp)).background(C.Bg).border(1.dp, C.Border, RoundedCornerShape(18.dp)).padding(16.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(14.dp),
            ) {
                Icon24(Ic.Clock, C.OrangeIcon, 30.dp)
                Column(verticalArrangement = Arrangement.spacedBy(1.dp)) {
                    Txt(clock(vm.waitingSeconds), 26f, 800)
                    Txt("Waiting time. Charged only after the free window.", 12.5f, 500, C.Muted)
                }
            }
            Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                Btn("Call rider", { ctx.startActivity(Intent(Intent.ACTION_DIAL, Uri.parse("tel:"))) }, Modifier.weight(1f), kind = BtnKind.Outline, height = 46.dp)
                Btn("No-show", { vm.confirm("Rider did not show up?", "The trip ends and you go back to waiting for rides.", "Yes, no-show", true, vm::noShow) }, Modifier.weight(1f), kind = BtnKind.Outline, height = 46.dp)
            }
            Btn("Start trip", { vm.confirm("Start the trip?", "Only start once the rider is in the car.", "Yes, start trip", false, vm::startTrip) }, Modifier.fillMaxWidth())
        }
    }
}

/** D04: the trip is running. Stop reasons are saved with the trip to protect the driver. */
@Composable
fun InTripScreen(vm: DriverViewModel) {
    val o = vm.offer
    val ctx = LocalContext.current
    Box(Modifier.fillMaxSize().background(C.Bg)) {
        MapPanel(
            Modifier.fillMaxWidth().fillMaxHeight(0.56f),
            markers = listOf(MapMarker(vm.demoDropoff, MarkerKind.Dropoff)) + carMarkers(vm),
            route = vm.routeTrip, fit = true, fitBorderDp = 120,
        )
        TopOverlay(vm, { DirectionBanner("Continue on Iwo Road", "1.1 km · tap to open maps") }) { openNavigation(ctx, o.dropoff) }
        BottomSheetCard {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(1.dp)) {
                    Txt("${maxOf(1, 9 - vm.tripSeconds / 60)} min", 24f, 800)
                    Txt("to ${o.dropoff.substringBefore(',')}, Ibadan", 13f, 500, C.Muted)
                }
                Column(horizontalAlignment = Alignment.End, verticalArrangement = Arrangement.spacedBy(1.dp)) {
                    Txt("Distance", 12f, 500, C.Muted)
                    Txt("%.2f km".format(vm.tripKm), 16f, 700)
                }
            }
            Column(
                Modifier.fillMaxWidth().clip(RoundedCornerShape(18.dp)).background(C.Bg).border(1.dp, C.Border, RoundedCornerShape(18.dp)).padding(14.dp),
                verticalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                Txt("Stopped? Tell us why", 14f, 700)
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    STOP_REASONS.take(3).forEach { r -> ReasonChip(r, vm.stopReason == r) { vm.stopReason = r } }
                }
                ReasonChip(STOP_REASONS[3], vm.stopReason == STOP_REASONS[3], danger = true) { vm.stopReason = STOP_REASONS[3] }
                Txt("Your reason is saved with the trip. It helps protect you if a stop is questioned.", 12f, 500, C.Muted)
            }
            Btn("End trip", { vm.confirm("End the trip?", "Do this at the drop-off point. The fare is worked out when you end the trip.", "Yes, end trip", false, vm::endTrip) }, Modifier.fillMaxWidth())
        }
    }
}

@Composable
private fun ReasonChip(text: String, selected: Boolean, danger: Boolean = false, onClick: () -> Unit) {
    val bg = if (danger) C.RedCard else C.GreenTint
    val fg = if (danger) C.RedText else C.Green
    Box(
        Modifier.clip(RoundedCornerShape(999.dp)).background(if (selected) fg else bg).tap(onClick, text).padding(horizontal = 11.dp, vertical = 5.dp),
    ) { Txt(text, 12.5f, 600, if (selected) (if (danger) C.RedCard else Color.White) else fg) }
}

@Composable
fun ReceiptCard(r: FareReceipt, paymentIsCash: Boolean) {
    Column(Modifier.fillMaxWidth().clip(RoundedCornerShape(18.dp)).background(Color.White).border(1.dp, C.Border, RoundedCornerShape(18.dp)).padding(16.dp)) {
        r.lines.forEach { l ->
            Box(Modifier.padding(vertical = 9.dp)) {
                MoneyLine(l.label, if (l.signed) nairaSigned(l.amount) else naira(l.amount, true), labelColor = C.Ink)
            }
        }
        Divider()
        Box(Modifier.padding(vertical = 9.dp)) { MoneyLine("Fare", naira(r.total), bold = false, labelColor = C.Ink) }
        Box(Modifier.padding(vertical = 9.dp)) {
            MoneyLine("9jaRide service charge · ${r.serviceRatePercent}%", nairaMinus(r.serviceCharge), amountColor = C.RedText, labelColor = C.RedText)
        }
        Box(Modifier.padding(vertical = 9.dp)) { MoneyLine("You earn", naira(r.earn, true), bold = false, labelColor = C.Ink) }
    }
}

/** D05: end of trip. For a cash trip the driver collects the fare in hand. */
@Composable
fun CollectFareScreen(vm: DriverViewModel) {
    val r = DEMO_RECEIPT
    Column(Modifier.fillMaxSize().background(C.Bg).statusBarsPadding().navigationBarsPadding().verticalScroll(rememberScrollState()).padding(horizontal = 20.dp, vertical = 12.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Column(Modifier.padding(top = 24.dp, bottom = 4.dp), verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Txt("Collect cash from rider", 13f, 500, C.Muted)
            Txt(naira(r.total), 46f, 800)
        }
        ReceiptCard(r, true)
        Row(
            Modifier.fillMaxWidth().clip(RoundedCornerShape(18.dp)).background(C.Bg).border(1.dp, C.Border, RoundedCornerShape(18.dp)).padding(14.dp),
            verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            Icon24(Ic.Wallet, C.Muted, 20.dp)
            Txt("The ${naira(r.serviceCharge, true)} service charge is taken from your wallet for cash trips.", 12.5f, 500, C.Muted, Modifier.weight(1f))
        }
        Btn("Cash collected", { vm.confirm("Have you collected the cash?", "Confirm only after the rider has paid you the full fare.", "Yes, collected", false, vm::cashCollected) }, Modifier.fillMaxWidth())
        Btn("Report a problem", { vm.push(com.ninejaride.driver.state.Dest.Help) }, Modifier.fillMaxWidth(), kind = BtnKind.Outline, height = 46.dp)
    }
}

/** D06: rate the rider. */
@Composable
fun RateRiderScreen(vm: DriverViewModel) {
    val o = vm.offer
    Column(Modifier.fillMaxSize().background(C.Bg).statusBarsPadding().navigationBarsPadding().verticalScroll(rememberScrollState()).padding(horizontal = 20.dp, vertical = 40.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
        Column(Modifier.fillMaxWidth(), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Box(Modifier.padding(top = 6.dp, bottom = 8.dp).size(60.dp).clip(CircleShape).background(C.GreenAccent), contentAlignment = Alignment.Center) {
                Icon24(Ic.Check, Color.White, 30.dp, 2.6f)
            }
            Txt("Trip complete", 22f, 800)
            Txt("You earned ${naira(DEMO_RECEIPT.earn, true)}", 14f, 500, C.Muted)
        }
        Column(
            Modifier.fillMaxWidth().clip(RoundedCornerShape(18.dp)).background(Color.White).border(1.dp, C.Border, RoundedCornerShape(18.dp)).padding(18.dp),
            verticalArrangement = Arrangement.spacedBy(14.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Txt("How was ${o.rider.name}?", 16f, 700)
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                for (i in 1..5) {
                    Box(Modifier.size(40.dp).tap({ vm.rating = i }, "$i stars"), contentAlignment = Alignment.Center) {
                        if (i <= vm.rating) StarFilled(C.OrangeIcon, 32.dp) else Icon24(Ic.Star, C.Disabled, 32.dp, 1.6f)
                    }
                }
            }
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                listOf("Polite", "On time").forEach { t ->
                    val on = t in vm.ratingTags
                    Box(Modifier.clip(RoundedCornerShape(999.dp)).background(if (on) C.Green else C.GreenTint).tap({ vm.toggleTag(t) }, t).padding(horizontal = 11.dp, vertical = 5.dp)) {
                        Txt(t, 12.5f, 600, if (on) Color.White else C.Green)
                    }
                }
            }
            Btn("Submit rating", vm::finishRide, Modifier.fillMaxWidth())
            Txt("Report a problem", 14.5f, 700, C.Green, Modifier.padding(4.dp).tap({ vm.push(com.ninejaride.driver.state.Dest.Help) }))
        }
        Btn("Back to home", vm::finishRide, Modifier.fillMaxWidth(), kind = BtnKind.Outline, height = 46.dp)
    }
}

/** D07: the alert is saved first, then the staff are told, then someone acknowledges. */
@Composable
fun SosSentScreen(vm: DriverViewModel) {
    val ctx = LocalContext.current
    Column(Modifier.fillMaxSize().background(C.Bg)) {
        Row(Modifier.fillMaxWidth().background(C.RedCard).statusBarsPadding().padding(horizontal = 20.dp, vertical = 22.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            Icon24(Ic.Warning, C.RedText, 26.dp)
            Txt("Emergency alert sent", 20f, 800, C.RedText)
        }
        Column(Modifier.weight(1f).verticalScroll(rememberScrollState()).padding(20.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
            Column(Modifier.fillMaxWidth().clip(RoundedCornerShape(18.dp)).background(Color.White).border(1.dp, C.Border, RoundedCornerShape(18.dp)).padding(18.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) {
                SosStep(true, "Alert saved", "Your location and trip are attached")
                SosStep(vm.sosSteps >= 2, "Admin team notified", "Phone alert sent to staff on duty")
                SosStep(vm.sosSteps >= 3, "Admin has acknowledged", vm.sosAdmin ?: "You will see their name here when they do")
            }
            Column(Modifier.fillMaxWidth().clip(RoundedCornerShape(18.dp)).background(Color.White).border(1.dp, C.Border, RoundedCornerShape(18.dp)).padding(16.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                Txt("SHARED WITH ADMIN", 12f, 500, C.Muted, letterSpacing = 1f)
                Txt("Trip ${vm.offer.code} · ${vm.profile.vehicle?.plate ?: ""}", 14f, 600)
                Txt("Live location, updated every few seconds", 13.5f, 500, C.Muted)
            }
        }
        Column(Modifier.padding(horizontal = 20.dp).navigationBarsPadding().padding(bottom = 20.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Btn("Call emergency services (112)", { ctx.startActivity(Intent(Intent.ACTION_DIAL, Uri.parse("tel:112"))) }, Modifier.fillMaxWidth(), kind = BtnKind.Danger)
            Btn("I am safe, cancel the alert", vm::cancelSos, Modifier.fillMaxWidth(), kind = BtnKind.Outline)
        }
    }
}

@Composable
private fun SosStep(done: Boolean, title: String, detail: String) {
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
        if (done) {
            Box(Modifier.size(26.dp).clip(CircleShape).background(C.Green), contentAlignment = Alignment.Center) { Icon24(Ic.Check, Color.White, 14.dp, 2.6f) }
        } else {
            Box(Modifier.size(26.dp).clip(CircleShape).border(2.dp, C.Orange, CircleShape), contentAlignment = Alignment.Center) {
                Box(Modifier.size(9.dp).clip(CircleShape).background(C.Orange))
            }
        }
        Column(verticalArrangement = Arrangement.spacedBy(1.dp)) {
            Txt(title, 14.5f, 600)
            Txt(detail, 12.5f, 500, C.Muted)
        }
    }
}

/** Chooses the full-screen ride screen for the current phase. */
@Composable
fun RideFlow(vm: DriverViewModel) {
    when (vm.phase) {
        Phase.Offer -> OfferScreen(vm)
        Phase.ToPickup -> ToPickupScreen(vm)
        Phase.Waiting -> WaitingScreen(vm)
        Phase.InTrip -> InTripScreen(vm)
        Phase.Collect -> CollectFareScreen(vm)
        Phase.Rate -> RateRiderScreen(vm)
        Phase.SosSent -> SosSentScreen(vm)
        Phase.None -> {}
    }
    HomeDialogs(vm)
}
