package com.ninejaride.core.ui.components

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.PathEffect
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import com.ninejaride.core.format.naira
import com.ninejaride.core.ui.theme.C

/** One line of the fare. [negative] is only for what is taken off the rider's bill (a discount, a credit, a refund). */
class ReceiptLineView(val label: String, val amountKobo: Long, val negative: Boolean = false)

/** Everything a trip receipt shows. The rider's and the driver's receipts fill it from their own data. */
class TripReceiptData(
    val reference: String,
    val dateText: String,
    val timeText: String,
    val pickup: String,
    val dropoff: String,
    val distance: String,
    val duration: String,
    val driver: String?,
    val vehicle: String?,
    val plate: String?,
    val lines: List<ReceiptLineView>,
    val totalKobo: Long,
    val paymentMethod: String,
    val paymentStatus: String,
    val paid: Boolean,
    val supportEmail: String,
)

private val BRAND_TOP = Color(0xFF0B4A0F)
private val BRAND_BOTTOM = Color(0xFF16801F)

/** The 9jaRide trip receipt: a ticket with a green header, notched dividers, the trip, the fare and where to get help. */
@Composable
fun TripReceipt(d: TripReceiptData) {
    Column(Modifier.fillMaxWidth().clip(RoundedCornerShape(24.dp)).background(C.Surface).border(1.dp, C.Border, RoundedCornerShape(24.dp))) {
        // ---- header
        Column(Modifier.fillMaxWidth().background(Brush.verticalGradient(listOf(BRAND_TOP, BRAND_BOTTOM))).padding(horizontal = 20.dp, vertical = 20.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                Box(Modifier.size(40.dp).clip(RoundedCornerShape(12.dp)).background(Color.White), contentAlignment = Alignment.Center) { Txt("9ja", 17f, 800, BRAND_TOP) }
                Column(Modifier.weight(1f)) { Txt("9jaRide", 18f, 800, Color.White); Txt("Safe rides across Nigeria", 11.5f, 500, Color.White.copy(alpha = 0.75f)) }
                Box(Modifier.clip(RoundedCornerShape(999.dp)).border(1.dp, Color.White.copy(alpha = 0.5f), RoundedCornerShape(999.dp)).padding(horizontal = 10.dp, vertical = 4.dp)) { Txt("TRIP RECEIPT", 10.5f, 800, Color.White, letterSpacing = 1f) }
            }
            Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                Txt("Total", 12.5f, 600, Color.White.copy(alpha = 0.8f))
                Txt(naira(d.totalKobo, true), 36f, 800, Color.White)
            }
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Box(Modifier.clip(RoundedCornerShape(999.dp)).background(if (d.paid) Color.White else Color(0xFFFFD9A8)).padding(horizontal = 12.dp, vertical = 5.dp)) {
                    Txt(if (d.paid) "PAID" else d.paymentStatus.uppercase(), 11.5f, 800, if (d.paid) BRAND_TOP else Color(0xFF7A3E00), letterSpacing = 0.8f)
                }
                Txt(d.paymentMethod, 12.5f, 600, Color.White.copy(alpha = 0.9f))
            }
        }

        // ---- the trip
        Column(Modifier.padding(horizontal = 20.dp, vertical = 18.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
            RouteBlock(d.pickup, d.dropoff)
            Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                Fact("Date", d.dateText, Modifier.weight(1f))
                Fact("Time", d.timeText, Modifier.weight(1f))
            }
            Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                Fact("Distance", d.distance, Modifier.weight(1f))
                Fact("Duration", d.duration, Modifier.weight(1f))
            }
            Fact("Receipt reference", d.reference)
        }
        Ticket()

        // ---- driver and vehicle
        if (d.driver != null) {
            Row(Modifier.padding(horizontal = 20.dp, vertical = 16.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                Avatar(d.driver.take(1).uppercase(), 44.dp, 17f)
                Column(Modifier.weight(1f)) {
                    Txt(d.driver, 15f, 800, maxLines = 1)
                    Txt(d.vehicle ?: "Vehicle", 12.5f, 500, C.Muted, maxLines = 1)
                }
                if (!d.plate.isNullOrBlank()) Box(Modifier.clip(RoundedCornerShape(8.dp)).border(1.5.dp, C.Ink, RoundedCornerShape(8.dp)).padding(horizontal = 9.dp, vertical = 4.dp)) { Txt(d.plate, 13f, 800, letterSpacing = 1f) }
            }
            Ticket()
        }

        // ---- the fare
        Column(Modifier.padding(horizontal = 20.dp, vertical = 16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Txt("FARE BREAKDOWN", 11f, 700, C.Muted, letterSpacing = 1.2f)
            d.lines.forEach { l ->
                Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                    Txt(l.label, 14f, 500, if (l.negative) C.GreenAccent else C.Ink, Modifier.weight(1f))
                    Txt((if (l.negative) "-" else "") + naira(l.amountKobo, true), 14f, 600, if (l.negative) C.GreenAccent else C.Ink)
                }
            }
            Box(Modifier.fillMaxWidth().height(1.dp).background(C.Border))
            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                Txt("Total", 16f, 800, modifier = Modifier.weight(1f))
                Txt(naira(d.totalKobo, true), 20f, 800)
            }
        }
        Ticket()

        // ---- payment and help
        Column(Modifier.padding(horizontal = 20.dp, vertical = 16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                Txt("Payment method", 13.5f, 500, C.Muted, Modifier.weight(1f)); Txt(d.paymentMethod, 14f, 700)
            }
            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                Txt("Payment status", 13.5f, 500, C.Muted, Modifier.weight(1f)); Txt(d.paymentStatus, 14f, 700, if (d.paid) C.GreenAccent else C.OrangeIcon)
            }
        }
        Column(Modifier.fillMaxWidth().background(C.Raised).padding(horizontal = 20.dp, vertical = 16.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(3.dp)) {
            Txt("Thank you for riding with 9jaRide", 14f, 800, C.GreenAccent, align = TextAlign.Center)
            Txt("Questions about this trip? ${d.supportEmail}", 12f, 500, C.Muted, align = TextAlign.Center)
            Txt("Quote ${d.reference} when you write to us.", 11.5f, 500, C.Muted, align = TextAlign.Center)
        }
    }
}

@Composable
private fun Fact(label: String, value: String, modifier: Modifier = Modifier) {
    Column(modifier, verticalArrangement = Arrangement.spacedBy(2.dp)) { Txt(label, 11.5f, 600, C.Muted); Txt(value, 14f, 700, maxLines = 2) }
}

/** A torn-ticket divider: a dashed line with a bite out of each edge. */
@Composable
private fun Ticket() {
    val bite = C.Bg
    val line = C.Border
    Canvas(Modifier.fillMaxWidth().height(20.dp)) {
        val y = size.height / 2
        drawLine(line, Offset(18.dp.toPx(), y), Offset(size.width - 18.dp.toPx(), y), strokeWidth = 1.5f, pathEffect = PathEffect.dashPathEffect(floatArrayOf(10f, 10f)))
        drawCircle(bite, radius = 10.dp.toPx(), center = Offset(0f, y))
        drawCircle(bite, radius = 10.dp.toPx(), center = Offset(size.width, y))
    }
}

/** The receipt as plain words, for sharing in a message. */
fun receiptText(d: TripReceiptData): String = buildString {
    appendLine("9jaRide trip receipt")
    appendLine("Reference: ${d.reference}")
    appendLine("${d.dateText}, ${d.timeText}")
    appendLine("From: ${d.pickup}")
    appendLine("To: ${d.dropoff}")
    appendLine("Distance: ${d.distance}   Duration: ${d.duration}")
    if (d.driver != null) appendLine("Driver: ${d.driver}${d.vehicle?.let { " · $it" } ?: ""}${d.plate?.let { " · $it" } ?: ""}")
    appendLine()
    d.lines.forEach { appendLine("${it.label}: ${if (it.negative) "-" else ""}${naira(it.amountKobo, true)}") }
    appendLine("Total: ${naira(d.totalKobo, true)}")
    appendLine("Payment: ${d.paymentMethod} (${d.paymentStatus})")
    append("Support: ${d.supportEmail}")
}
