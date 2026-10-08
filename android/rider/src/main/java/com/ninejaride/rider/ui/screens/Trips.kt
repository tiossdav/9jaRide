package com.ninejaride.rider.ui.screens

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
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import com.ninejaride.core.format.naira
import com.ninejaride.core.ui.components.Btn
import com.ninejaride.core.ui.components.BtnKind
import com.ninejaride.core.ui.components.Card
import com.ninejaride.core.ui.components.Chip
import com.ninejaride.core.ui.components.Divider
import com.ninejaride.core.ui.components.Gap
import com.ninejaride.core.ui.components.Ic
import com.ninejaride.core.ui.components.Icon24
import com.ninejaride.core.ui.components.MoneyLine
import com.ninejaride.core.ui.components.RoundIconTile
import com.ninejaride.core.ui.components.RouteBlock
import com.ninejaride.core.ui.components.ScreenHeader
import com.ninejaride.core.ui.components.SheetOverlay
import com.ninejaride.core.ui.components.StarFilled
import com.ninejaride.core.ui.components.Txt
import com.ninejaride.core.ui.components.tap
import com.ninejaride.core.ui.theme.C
import com.ninejaride.rider.data.RideListItem
import com.ninejaride.rider.data.ScheduleView
import com.ninejaride.rider.state.Dest
import com.ninejaride.rider.state.Dialog
import com.ninejaride.rider.state.NIGERIA_TIME
import com.ninejaride.rider.state.RiderViewModel
import com.ninejaride.rider.state.categoryLabel
import java.time.Instant
import java.time.format.DateTimeFormatter
import java.util.Locale

private val whenFmt = DateTimeFormatter.ofPattern("EEE d MMM, h:mm a", Locale.ENGLISH).withZone(NIGERIA_TIME)

fun whenText(iso: String?): String = iso?.let { runCatching { whenFmt.format(Instant.parse(it)) }.getOrNull() } ?: ""

private fun statusLabel(s: String) = when (s) {
    "TRIP_COMPLETED" -> "Completed"
    "CANCELLED_BY_RIDER", "CANCELLED_BY_DRIVER", "CANCELLED_BY_SYSTEM" -> "Cancelled"
    "NO_DRIVER_FOUND" -> "No driver found"
    "SCHEDULED" -> "Scheduled"
    else -> "In progress"
}

@Composable
private fun StatusChip(s: String) {
    when (s) {
        "TRIP_COMPLETED" -> Chip("Completed")
        "SCHEDULED" -> Chip("Scheduled")
        else -> Chip(statusLabel(s), C.RedText, C.RedCard)
    }
}

@Composable
fun TripsTab(vm: RiderViewModel) {
    Column(Modifier.fillMaxSize().background(C.Bg)) {
        Box(Modifier.statusBarsPadding()) { ScreenHeader("Trips", "${vm.tripCount} completed") }
        Row(Modifier.padding(horizontal = 20.dp).fillMaxWidth().clip(RoundedCornerShape(999.dp)).background(C.Raised).padding(4.dp)) {
            listOf("History", "Scheduled").forEachIndexed { i, label ->
                val on = vm.tripsTab == i
                Box(Modifier.weight(1f).clip(RoundedCornerShape(999.dp)).background(if (on) C.Green else Color.Transparent).tap({ vm.tripsTab = i }, label).padding(vertical = 10.dp), contentAlignment = Alignment.Center) {
                    Txt(label + if (i == 1 && vm.schedules.isNotEmpty()) " (${vm.schedules.sumOf { s -> s.rides.count { it.status == "SCHEDULED" } }})" else "", 13.5f, 700, if (on) Color.White else C.Muted)
                }
            }
        }
        Column(Modifier.weight(1f).verticalScroll(rememberScrollState()).padding(start = 20.dp, top = 20.dp, end = 20.dp, bottom = 40.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            if (vm.tripsTab == 0) {
                if (vm.history.isEmpty()) EmptyState(Ic.Car, if (vm.historyLoaded) "No trips yet" else "Loading...", "Your completed rides will show up here.")
                vm.history.forEach { TripRow(it) { vm.openTrip(it.id) } }
            } else {
                if (vm.schedules.isEmpty()) EmptyState(Ic.Calendar, "Nothing scheduled", "Book a ride for later from the Home tab.")
                vm.schedules.forEach { s -> ScheduleCard(vm, s) }
            }
        }
    }
    when (vm.dialog) {
        Dialog.CancelScheduled -> CancelScheduledSheet(vm)
        Dialog.Notice -> NoticeSheet(vm)
        else -> {}
    }
}

@Composable
fun EmptyState(icon: List<String>, title: String, sub: String) {
    Column(Modifier.fillMaxWidth().padding(vertical = 48.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Box(Modifier.size(64.dp).clip(CircleShape).background(C.GreenTint), contentAlignment = Alignment.Center) { Icon24(icon, C.GreenAccent, 30.dp) }
        Txt(title, 16f, 800); Txt(sub, 13f, 500, C.Muted, align = TextAlign.Center)
    }
}

@Composable
private fun TripRow(t: RideListItem, onClick: () -> Unit) {
    Card(Modifier.tap(onClick, "Trip ${t.shortCode}"), padding = 14.dp) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f)) { Txt(whenText(t.createdAt), 12.5f, 600, C.Muted); Txt(t.dropoffAddress ?: "Drop-off", 15f, 800, maxLines = 1) }
            Txt(t.fareKobo?.let { naira(it) } ?: "", 15.5f, 800)
        }
        Gap(8.dp)
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            StatusChip(t.status)
            Txt(categoryLabel(t.category) + "  -  " + (if (t.paymentMethod == "wallet") "Wallet" else "Cash"), 12f, 500, C.Muted)
        }
    }
}

@Composable
private fun ScheduleCard(vm: RiderViewModel, s: ScheduleView) {
    val upcoming = s.rides.filter { it.status == "SCHEDULED" }
    Card(padding = 14.dp) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Chip(if (s.repeat == "weekly") "Weekly" else "One time")
            Txt(categoryLabel(s.category), 12f, 600, C.Muted, Modifier.weight(1f))
            Txt("${upcoming.size} upcoming", 12f, 600, C.Muted)
        }
        Gap(10.dp)
        RouteBlock(s.pickupAddress ?: "Pickup", s.dropoffAddress ?: "Drop-off")
        Gap(10.dp)
        upcoming.take(3).forEach { Txt(whenText(it.scheduledFor), 13.5f, 700) }
        if (upcoming.size > 3) Txt("+ ${upcoming.size - 3} more", 12.5f, 500, C.Muted)
        Gap(10.dp)
        Btn("Cancel", { vm.askCancelSchedule(s) }, Modifier.fillMaxWidth(), kind = BtnKind.Outline, height = 44.dp, size = 14f)
    }
}

@Composable
private fun CancelScheduledSheet(vm: RiderViewModel) {
    val s = vm.cancelTarget
    val many = (s?.rides?.count { it.status == "SCHEDULED" } ?: 0) > 1
    SheetOverlay(onDismiss = { vm.dialog = null }) {
        Txt("Cancel scheduled ride", 18f, 800)
        Txt(if (many) "Cancel only the next ride, or the whole series?" else "This ride will be cancelled. You will not be charged.", 13.5f, 500, C.Muted)
        if (many) Btn("Only the next ride", { vm.cancelScheduled(onlyNext = true) }, Modifier.fillMaxWidth(), kind = BtnKind.Outline)
        Btn(if (many) "Cancel the whole series" else "Cancel ride", { vm.cancelScheduled(onlyNext = false) }, Modifier.fillMaxWidth(), kind = BtnKind.Danger)
        Btn("Keep it", { vm.dialog = null }, Modifier.fillMaxWidth(), kind = BtnKind.Outline)
    }
}

@Composable
fun TripDetailsScreen(vm: RiderViewModel, id: String) {
    val r = vm.detailRide
    Column(Modifier.fillMaxSize().background(C.Bg)) {
        Box(Modifier.statusBarsPadding()) { ScreenHeader("Trip details", r?.shortCode, onBack = vm::pop) }
        if (r == null) { Txt("Loading...", 14f, 500, C.Muted, Modifier.padding(20.dp)); return@Column }
        Column(Modifier.weight(1f).verticalScroll(rememberScrollState()).padding(start = 20.dp, end = 20.dp, bottom = 36.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
            Card {
                Row(verticalAlignment = Alignment.CenterVertically) { Txt(whenText(r.createdAt), 13f, 600, C.Muted, Modifier.weight(1f)); StatusChip(r.status) }
                Gap(10.dp)
                RouteBlock(r.pickupAddress ?: "Pickup", r.dropoffAddress ?: "Drop-off")
            }
            Card {
                MoneyLine("Category", categoryLabel(r.category))
                MoneyLine("Paid with", if (r.paymentMethod == "wallet") "Wallet" else "Cash")
                r.distanceM?.let { MoneyLine("Distance", "%.1f km".format(it / 1000.0)) }
                if (r.fareKobo != null) {
                    Divider(); MoneyLine("Fare", naira(r.fareKobo), bold = r.discountKobo == 0L)
                    if (r.discountKobo > 0) { MoneyLine("Promo ${r.promoCode ?: ""}", "-" + naira(r.discountKobo)); Divider(); MoneyLine("You paid", naira(r.payableKobo ?: r.fareKobo), bold = true) }
                }
                else r.estimate?.let { Divider(); MoneyLine("Estimate", fareRange(it.first, it.second)) }
            }
            r.driver?.let { d ->
                Card {
                    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                        com.ninejaride.core.ui.components.Avatar(d.name.take(1).uppercase(), 44.dp, 17f)
                        Column(Modifier.weight(1f)) { Txt(d.name, 15f, 800); Txt(listOf(d.colour, d.make, d.plate).filter { it.isNotBlank() }.joinToString("  -  "), 12.5f, 500, C.Muted) }
                        r.myRating?.let { Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(4.dp)) { StarFilled(C.OrangeIcon, 14.dp); Txt("$it", 13f, 700) } }
                    }
                }
            }
        }
        Column(Modifier.navigationBarsPadding().padding(20.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            if (r.status == "TRIP_COMPLETED") Btn("View receipt", { vm.push(Dest.Receipt(id)) }, Modifier.fillMaxWidth())
            Btn("Report a problem", { vm.push(Dest.Help) }, Modifier.fillMaxWidth(), kind = BtnKind.Outline)
        }
    }
}

private const val RECEIPT_SUPPORT_EMAIL = "support@9jaridepro.com"

/** The receipt of a finished trip, in the 9jaRide receipt design, built from the trip and its fare. */
@Composable
fun ReceiptScreen(vm: RiderViewModel, id: String) {
    LaunchedEffect(id) { vm.loadReceipt(id) }
    val rc = vm.receipt
    val ride = vm.receiptRide
    val ctx = androidx.compose.ui.platform.LocalContext.current
    val data = if (rc != null && ride != null) receiptData(rc, ride) else null
    Column(Modifier.fillMaxSize().background(C.Bg)) {
        Box(Modifier.statusBarsPadding()) { ScreenHeader("Receipt", onBack = { vm.pop() }) }
        Column(Modifier.weight(1f).verticalScroll(rememberScrollState()).padding(start = 20.dp, end = 20.dp, bottom = 24.dp, top = 6.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
            if (data == null) Txt("Loading your receipt...", 14f, 500, C.Muted)
            else com.ninejaride.core.ui.components.TripReceipt(data)
        }
        Column(Modifier.navigationBarsPadding().padding(20.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            if (data != null) Btn("Share receipt", {
                val send = android.content.Intent(android.content.Intent.ACTION_SEND).setType("text/plain")
                    .putExtra(android.content.Intent.EXTRA_SUBJECT, "9jaRide receipt ${data.reference}").putExtra(android.content.Intent.EXTRA_TEXT, com.ninejaride.core.ui.components.receiptText(data))
                runCatching { ctx.startActivity(android.content.Intent.createChooser(send, "Share receipt")) }
            }, Modifier.fillMaxWidth(), kind = BtnKind.Outline)
            Btn("Done", { vm.pop() }, Modifier.fillMaxWidth())
        }
    }
}

/** Puts the fare and the trip together. Only a promo or other credit is shown with a minus; every charge is a plain amount. */
private fun receiptData(rc: com.ninejaride.rider.data.Receipt, r: com.ninejaride.rider.data.RideView): com.ninejaride.core.ui.components.TripReceiptData {
    val lines = rc.lines.map { com.ninejaride.core.ui.components.ReceiptLineView(it.label.ifBlank { it.kind }, it.amountKobo) } +
        (if (rc.discountKobo > 0) listOf(com.ninejaride.core.ui.components.ReceiptLineView("Promo ${rc.promoCode ?: ""}".trim(), rc.discountKobo, negative = true)) else emptyList())
    val wallet = r.paymentMethod == "wallet"
    val status = when (r.paymentStatus) { "PAID" -> "Paid"; "REFUNDED" -> "Refunded"; "HELD" -> "Payment held"; else -> if (wallet) "Unpaid" else "Pay your driver in cash" }
    fun at(pattern: String) = (r.statusChangedAt ?: r.createdAt)?.let { iso ->
        runCatching { java.time.format.DateTimeFormatter.ofPattern(pattern, java.util.Locale.ENGLISH).withZone(java.time.ZoneId.systemDefault()).format(java.time.Instant.parse(iso)) }.getOrNull()
    } ?: ""
    val d = r.driver
    return com.ninejaride.core.ui.components.TripReceiptData(
        reference = r.shortCode, dateText = at("EEE d MMM yyyy"), timeText = at("h:mm a"), pickup = r.pickupAddress ?: "Pickup", dropoff = r.dropoffAddress ?: "Drop-off",
        distance = com.ninejaride.core.format.distanceText(r.distanceM ?: 0), duration = "${((r.durationS ?: 0) / 60).coerceAtLeast(1)} min",
        driver = d?.name, vehicle = listOfNotNull(d?.colour?.ifBlank { null }, d?.make?.ifBlank { null }).joinToString(" ").ifBlank { null }, plate = d?.plate?.ifBlank { null },
        lines = lines, totalKobo = rc.payableKobo, paymentMethod = if (wallet) "Wallet" else "Cash", paymentStatus = status, paid = r.paymentStatus == "PAID",
        supportEmail = RECEIPT_SUPPORT_EMAIL,
    )
}
