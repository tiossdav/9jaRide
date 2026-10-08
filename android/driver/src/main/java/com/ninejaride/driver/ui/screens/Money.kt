package com.ninejaride.driver.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxScope
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import com.ninejaride.driver.state.Dest
import com.ninejaride.driver.state.Dialog
import com.ninejaride.driver.state.DriverViewModel
import com.ninejaride.core.format.Kobo
import com.ninejaride.driver.state.TxDirection
import com.ninejaride.core.format.naira
import com.ninejaride.core.format.nairaMinus
import com.ninejaride.core.ui.components.Btn
import com.ninejaride.core.ui.components.BtnKind
import com.ninejaride.core.ui.components.Chip
import com.ninejaride.core.ui.components.Divider
import com.ninejaride.core.ui.components.Gap
import com.ninejaride.core.ui.components.Ic
import com.ninejaride.core.ui.components.Icon24
import com.ninejaride.core.ui.components.LabeledBox
import com.ninejaride.core.ui.components.MenuRow
import com.ninejaride.core.ui.components.MoneyLine
import com.ninejaride.core.ui.components.RoundIconTile
import com.ninejaride.core.ui.components.ScreenHeader
import com.ninejaride.core.ui.components.SheetOverlay
import com.ninejaride.core.ui.components.Tab
import com.ninejaride.core.ui.components.Txt
import com.ninejaride.core.ui.components.tap
import com.ninejaride.core.ui.theme.C
import com.ninejaride.core.ui.theme.type
import java.time.LocalDate
import java.time.YearMonth
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.Locale

private val NIGERIA_TIME = ZoneId.of("Africa/Lagos")

@Composable
private fun StatTile(value: String, label: String, modifier: Modifier = Modifier, valueColor: Color = C.Ink) {
    Column(modifier.clip(RoundedCornerShape(16.dp)).background(Color.White).border(1.dp, C.Border, RoundedCornerShape(16.dp)).padding(14.dp), verticalArrangement = Arrangement.spacedBy(2.dp)) {
        Txt(label, 11f, 600, C.Muted, letterSpacing = 0.8f)
        Txt(value, 18f, 800, valueColor)
    }
}

/** E1: wallet, overview and the way into daily earnings and payouts. */
@Composable
fun EarningsScreen(vm: DriverViewModel) {
    val gross = vm.trips.sumOf { it.receipt.total }
    Box(Modifier.fillMaxSize()) {
        Column(Modifier.fillMaxSize().statusBarsPadding().verticalScroll(rememberScrollState()).padding(bottom = 36.dp)) {
            Column(Modifier.padding(start = 20.dp, end = 20.dp, top = 22.dp, bottom = 8.dp), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                Txt("Earnings", 24f, 800)
                Txt("Your wallet and earnings", 13f, 500, C.Muted)
            }
            Column(Modifier.padding(horizontal = 20.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
                Column(Modifier.fillMaxWidth().clip(RoundedCornerShape(22.dp)).background(C.Green).padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                        Icon24(Ic.Wallet, C.OnGreenMuted, 22.dp)
                        Txt("Driver wallet", 13f, 500, C.OnGreenMuted)
                    }
                    Txt(naira(vm.walletKobo, vm.walletKobo % 100L != 0L), 38f, 800, Color.White)
                    Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                        Btn("+ Fund wallet", { vm.push(Dest.FundWallet) }, Modifier.weight(1f), height = 44.dp, size = 14f, kind = BtnKind.Light)
                        Btn("Transactions", { vm.push(Dest.Transactions) }, Modifier.weight(1f), height = 44.dp, size = 14f, kind = BtnKind.Light)
                    }
                }
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Txt("EARNINGS OVERVIEW", 12f, 600, C.Muted, Modifier.weight(1f), letterSpacing = 1f)
                    Box(Modifier.clip(RoundedCornerShape(999.dp)).background(Color.White).border(1.dp, C.Border, RoundedCornerShape(999.dp)).tap({ vm.dialog = Dialog.DateFilter }, "Filter by date").padding(horizontal = 12.dp, vertical = 6.dp)) {
                        Txt(vm.filterLabel ?: "Filter", 12.5f, 600)
                    }
                }
                Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    StatTile(naira(gross), "REVENUE MADE", Modifier.weight(1f))
                    StatTile(naira(gross), "SUCCESSFUL", Modifier.weight(1f))
                }
                Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    StatTile(naira(vm.bonusKobo), "BONUS", Modifier.weight(1f))
                    StatTile(naira(0), "PENDING", Modifier.weight(1f))
                }
                MenuRow(Ic.Calendar, "Daily earnings", "Breakdown of successful trip settlements", { vm.push(Dest.DailyEarnings) })
                MenuRow(Ic.Bank, "Payout", "Your payouts and next payout balance", { vm.push(Dest.Payout) })
            }
        }
    }
}

@Composable
fun DateFilterSheet(vm: DriverViewModel) {
    var month by remember { mutableStateOf(YearMonth.now(NIGERIA_TIME)) }
    var start by remember { mutableStateOf<LocalDate?>(vm.filterStart) }
    var end by remember { mutableStateOf<LocalDate?>(vm.filterEnd) }
    val fmt = DateTimeFormatter.ofPattern("d MMM yyyy", Locale.ENGLISH)
    SheetOverlay(onDismiss = { vm.dialog = null }) {
        Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Txt("Filter by date", 18f, 800)
            Txt("Pick a start and end date for the overview", 13f, 500, C.Muted)
        }
        Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            DateBox("START DATE", start?.format(fmt) ?: "Select", Modifier.weight(1f), start == null || end != null)
            DateBox("END DATE", end?.format(fmt) ?: "Select", Modifier.weight(1f), start != null && end == null)
        }
        Row(verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f)) {
                Txt(month.month.getDisplayName(java.time.format.TextStyle.FULL, Locale.ENGLISH), 16f, 800)
                Txt("${month.year}", 12.5f, 500, C.Muted)
            }
            Box(Modifier.size(38.dp).clip(CircleShape).border(1.dp, C.Border, CircleShape).tap({ month = month.minusMonths(1) }, "Previous month"), contentAlignment = Alignment.Center) { Icon24(Ic.Back, C.Ink, 18.dp) }
            Box(Modifier.width(8.dp))
            Box(Modifier.size(38.dp).clip(CircleShape).border(1.dp, C.Border, CircleShape).tap({ month = month.plusMonths(1) }, "Next month"), contentAlignment = Alignment.Center) { Icon24(Ic.Chevron, C.Ink, 18.dp) }
        }
        Row { listOf("S", "M", "T", "W", "T", "F", "S").forEach { Txt(it, 12f, 600, C.Muted, Modifier.weight(1f), align = TextAlign.Center) } }
        val first = month.atDay(1)
        val offset = first.dayOfWeek.value % 7 // Sunday first
        val cells = offset + month.lengthOfMonth()
        val rows = (cells + 6) / 7
        for (r in 0 until rows) {
            Row {
                for (c in 0 until 7) {
                    val dayNum = r * 7 + c - offset + 1
                    Box(Modifier.weight(1f).aspectRatio(1f).padding(2.dp), contentAlignment = Alignment.Center) {
                        if (dayNum in 1..month.lengthOfMonth()) {
                            val d = month.atDay(dayNum)
                            val inRange = start != null && end != null && !d.isBefore(start) && !d.isAfter(end)
                            val edge = d == start || d == end
                            Box(
                                Modifier.fillMaxSize().clip(CircleShape).background(if (edge) C.Green else if (inRange) C.GreenTint else Color.Transparent)
                                    .tap({
                                        if (start == null || end != null) { start = d; end = null }
                                        else if (d.isBefore(start)) { start = d } else { end = d }
                                    }, "$dayNum"),
                                contentAlignment = Alignment.Center,
                            ) { Txt("$dayNum", 13.5f, 600, if (edge) Color.White else C.Ink) }
                        }
                    }
                }
            }
        }
        Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            Btn("Reset", { start = null; end = null; vm.setFilter(null, null); vm.dialog = null }, Modifier.weight(1f), kind = BtnKind.Outline)
            Btn("Apply", { vm.setFilter(start, end); vm.dialog = null }, Modifier.weight(1f), enabled = start != null && end != null)
        }
    }
}

@Composable
private fun DateBox(label: String, value: String, modifier: Modifier, active: Boolean) {
    Column(
        modifier.clip(RoundedCornerShape(14.dp)).background(Color.White).border(1.5.dp, if (active) C.GreenAccent else C.Border, RoundedCornerShape(14.dp)).padding(12.dp),
        verticalArrangement = Arrangement.spacedBy(2.dp),
    ) {
        Txt(label, 10.5f, 600, C.Muted, letterSpacing = 1f)
        Txt(value, 14.5f, 700, if (value == "Select") C.Faint else C.Ink)
    }
}

/** D10: how today's money adds up. Cash and wallet are kept apart. */
@Composable
fun DailyEarningsScreen(vm: DriverViewModel) {
    val today = LocalDate.now(NIGERIA_TIME)
    val trips = vm.trips
    val gross = trips.sumOf { it.receipt.total }
    val cash = trips.filter { it.payment == "Cash" }.sumOf { it.receipt.total }
    val wallet = gross - cash
    val tax = trips.sumOf { t -> t.receipt.lines.filter { it.label == "Tax" }.sumOf { it.amount } }
    val service = trips.sumOf { it.receipt.serviceCharge }
    val earned = gross - service
    val takenFromWallet = trips.filter { it.payment == "Cash" }.sumOf { it.receipt.serviceCharge }
    Column(Modifier.fillMaxSize().background(C.Bg)) {
        ScreenHeader("Daily earnings", today.format(DateTimeFormatter.ofPattern("EEE d MMM", Locale.ENGLISH)) + " · Nigeria time", vm::pop)
        Column(Modifier.weight(1f).verticalScroll(rememberScrollState()).padding(start = 20.dp, end = 20.dp, top = 8.dp, bottom = 36.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Column(Modifier.fillMaxWidth().clip(RoundedCornerShape(22.dp)).background(C.Green).padding(18.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                Txt("You earned", 13f, 500, C.OnGreenMuted)
                Txt(naira(earned), 38f, 800, Color.White)
                Txt("${trips.size} trip${if (trips.size == 1) "" else "s"} · Cash ${naira(cash)} · Wallet ${naira(wallet)}", 12.5f, 500, C.OnGreenMuted)
            }
            Column(Modifier.fillMaxWidth().clip(RoundedCornerShape(18.dp)).background(Color.White).border(1.dp, C.Border, RoundedCornerShape(18.dp)).padding(16.dp)) {
                listOf(
                    "Total gross" to naira(gross, true),
                    "Wallet trips" to naira(wallet, true),
                    "Cash trips" to naira(cash, true),
                    "Daily tax" to naira(tax, true),
                ).forEach { (l, v) -> Box(Modifier.padding(vertical = 9.dp)) { MoneyLine(l, v, labelColor = C.Ink) } }
                Box(Modifier.padding(vertical = 9.dp)) { MoneyLine("9jaRide service charge · 12%", naira(service, true), labelColor = C.Ink) }
                listOf("Toll fee" to naira(0, true), "Trip bonus" to naira(vm.bonusKobo, true)).forEach { (l, v) -> Box(Modifier.padding(vertical = 9.dp)) { MoneyLine(l, v, labelColor = C.Ink) } }
                Divider()
                Box(Modifier.padding(vertical = 9.dp)) { MoneyLine("You earned", naira(earned, true), bold = true) }
            }
            Column(Modifier.fillMaxWidth().clip(RoundedCornerShape(18.dp)).background(Color.White).border(1.dp, C.Border, RoundedCornerShape(18.dp)).padding(16.dp)) {
                Box(Modifier.padding(vertical = 6.dp)) { MoneyLine("Cash in your hand", naira(cash, true), labelColor = C.Ink) }
                Box(Modifier.padding(vertical = 6.dp)) { MoneyLine("Taken from wallet", nairaMinus(takenFromWallet), amountColor = C.RedText, labelColor = C.RedText) }
            }
        }
    }
}

/** E4: automatic payouts. Only wallet earnings count; cash stays with the driver. */
@Composable
fun PayoutScreen(vm: DriverViewModel) {
    Column(Modifier.fillMaxSize().background(C.Bg)) {
        ScreenHeader("Payout", "Paid out automatically to your bank", vm::pop)
        Column(Modifier.weight(1f).verticalScroll(rememberScrollState()).padding(start = 20.dp, end = 20.dp, top = 8.dp, bottom = 36.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Column(Modifier.fillMaxWidth().clip(RoundedCornerShape(22.dp)).background(C.Green).padding(18.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                Txt("Next payout balance", 13f, 500, C.OnGreenMuted)
                Txt(naira(maxOf(0L, vm.walletKobo)), 38f, 800, Color.White)
                Txt("Paid out automatically once wallet earnings reach ₦5,000", 12.5f, 500, C.OnGreenMuted)
            }
            Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                StatTile(naira(0), "IN PROGRESS", Modifier.weight(1f))
                StatTile(naira(vm.payouts.sumOf { it.amount }), "TOTAL PAID", Modifier.weight(1f))
            }
            Row(
                Modifier.fillMaxWidth().clip(RoundedCornerShape(18.dp)).background(Color.White).border(1.dp, C.Border, RoundedCornerShape(18.dp)).padding(14.dp),
                verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                RoundIconTile(Ic.Bank, C.GreenAccent, C.GreenTint, 42.dp, round = false, iconSize = 20.dp)
                Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(1.dp)) {
                    Txt("Bank account", 15f, 700)
                    val b = vm.profile.bank
                    Txt(if (b == null) "Not added yet" else "${b.bank} · ${b.number.takeLast(4).padStart(10, '*')}", 12.5f, 500, C.Muted)
                }
                Btn(if (vm.profile.bank == null) "Add" else "Change", { vm.push(Dest.BankAccountForm) }, Modifier.width(78.dp), height = 38.dp, size = 13.5f)
            }
            Row(Modifier.fillMaxWidth().clip(RoundedCornerShape(14.dp)).background(Color.White.copy(alpha = 0.6f)).padding(12.dp), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                Icon24(Ic.Wallet, C.Muted, 18.dp)
                Txt("Cash you collect from riders stays with you. Only wallet-trip earnings are paid out.", 12.5f, 500, C.Muted, Modifier.weight(1f))
            }
            if (vm.payouts.isEmpty()) {
                Column(Modifier.fillMaxWidth().padding(top = 28.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Box(Modifier.size(72.dp).clip(CircleShape).background(Color.White), contentAlignment = Alignment.Center) { Icon24(Ic.Bank, C.Faint, 30.dp) }
                    Txt("No payouts yet", 16f, 700)
                    Txt("Your payouts will show here.", 13f, 500, C.Muted)
                }
            } else {
                vm.payouts.forEach { p ->
                    Row(Modifier.fillMaxWidth().clip(RoundedCornerShape(16.dp)).background(Color.White).border(1.dp, C.Border, RoundedCornerShape(16.dp)).padding(14.dp), verticalAlignment = Alignment.CenterVertically) {
                        Column(Modifier.weight(1f)) { Txt(naira(p.amount), 15f, 700); Txt(p.whenText, 12.5f, 500, C.Muted) }
                        Chip(p.status)
                    }
                }
            }
        }
    }
}

private val BANKS = listOf(
    "Access Bank", "Fidelity Bank", "First Bank", "FCMB", "GTBank", "Kuda", "Moniepoint", "Opay", "PalmPay",
    "Polaris Bank", "Stanbic IBTC", "Sterling Bank", "UBA", "Union Bank", "Wema Bank", "Zenith Bank",
)

/** D09. The account name comes back from the bank and is shown to the driver to confirm; they cannot type it. */
@Composable
fun BankAccountScreen(vm: DriverViewModel) {
    var bank by remember { mutableStateOf(vm.profile.bank?.bank ?: "") }
    var number by remember { mutableStateOf(vm.profile.bank?.number ?: "") }
    var picking by remember { mutableStateOf(false) }
    val nameShown = if (number.length == 10 && bank.isNotEmpty()) vm.profile.name.uppercase() else null
    Box(Modifier.fillMaxSize().background(C.Bg)) {
        Column(Modifier.fillMaxSize()) {
            ScreenHeader("Payout bank account", "Where we send your earnings", vm::pop)
            Column(Modifier.weight(1f).verticalScroll(rememberScrollState()).padding(start = 20.dp, end = 20.dp, top = 8.dp, bottom = 36.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
                Column(Modifier.tap({ picking = true }, "Select bank")) {
                    LabeledBox("Bank", bank.ifEmpty { "Select your bank" }, if (bank.isEmpty()) C.Faint else C.Ink) { Icon24(Ic.Chevron, C.Faint, 18.dp) }
                }
                Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    Txt("Account number", 12.5f, 600, C.Muted)
                    BasicTextField(
                        value = number,
                        onValueChange = { number = it.filter(Char::isDigit).take(10) },
                        singleLine = true,
                        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
                        textStyle = type(15f, 500, C.Ink),
                        modifier = Modifier.fillMaxWidth(),
                        decorationBox = { inner ->
                            Box(Modifier.fillMaxWidth().clip(RoundedCornerShape(14.dp)).background(Color.White).border(1.dp, C.Border, RoundedCornerShape(14.dp)).padding(horizontal = 16.dp, vertical = 15.dp)) {
                                if (number.isEmpty()) Txt("0123456789", 15f, 500, C.Disabled)
                                inner()
                            }
                        },
                    )
                }
                LabeledBox("Account name", nameShown ?: "Shown after we check your account", if (nameShown == null) C.Faint else C.Ink) {
                    if (nameShown != null) Icon24(Ic.Check, C.GreenAccent, 20.dp, 2.4f)
                }
                Txt("Wallet earnings of ₦5,000 or more are paid out automatically. Cash you collect stays with you.", 12.5f, 500, C.Muted)
            }
            Box(Modifier.padding(horizontal = 20.dp).navigationBarsPadding().padding(bottom = 20.dp)) {
                Btn("Save bank account", { vm.confirm("Save this bank account?", "Your payouts will go to this account. Check the name shown is yours.", "Yes, save", false) { vm.saveBank(bank, number) } }, Modifier.fillMaxWidth(), enabled = nameShown != null)
            }
        }
        if (picking) {
            SheetOverlay(onDismiss = { picking = false }) {
                Txt("Select your bank", 18f, 800)
                LazyColumn(Modifier.height(380.dp)) {
                    items(BANKS) { b ->
                        Row(Modifier.fillMaxWidth().tap({ bank = b; picking = false }, b).padding(vertical = 14.dp), verticalAlignment = Alignment.CenterVertically) {
                            Txt(b, 15f, 600, modifier = Modifier.weight(1f))
                            if (b == bank) Icon24(Ic.Check, C.GreenAccent, 20.dp, 2.4f)
                        }
                        Divider()
                    }
                }
            }
        }
    }
}

/** E5. */
@Composable
fun TransactionsScreen(vm: DriverViewModel) {
    var filter by remember { mutableStateOf("All") }
    val inflow = vm.transactions.filter { it.direction == TxDirection.In }.sumOf { it.amount }
    val outflow = vm.transactions.filter { it.direction == TxDirection.Out }.sumOf { it.amount }
    val shown = vm.transactions.filter { filter == "All" || (filter == "Inflow") == (it.direction == TxDirection.In) }
    Column(Modifier.fillMaxSize().background(C.Bg)) {
        ScreenHeader("Transactions", null, vm::pop)
        Column(Modifier.weight(1f).verticalScroll(rememberScrollState()).padding(start = 20.dp, end = 20.dp, top = 8.dp, bottom = 36.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                Column(Modifier.weight(1f).clip(RoundedCornerShape(16.dp)).background(Color.White).border(1.dp, C.Border, RoundedCornerShape(16.dp)).padding(14.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) { Icon24(Ic.ArrowDown, C.GreenAccent, 16.dp); Txt("INFLOW", 11f, 600, C.Muted, letterSpacing = 0.8f) }
                    Txt(naira(inflow), 18f, 800)
                }
                Column(Modifier.weight(1f).clip(RoundedCornerShape(16.dp)).background(Color.White).border(1.dp, C.Border, RoundedCornerShape(16.dp)).padding(14.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) { Icon24(Ic.ArrowUp, C.Orange, 16.dp); Txt("OUTFLOW", 11f, 600, C.Muted, letterSpacing = 0.8f) }
                    Txt(naira(outflow), 18f, 800)
                }
            }
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                listOf("All", "Inflow", "Outflow").forEach { f ->
                    val on = f == filter
                    Box(Modifier.clip(RoundedCornerShape(999.dp)).background(if (on) C.Green else Color.White).border(1.dp, if (on) C.Green else C.Border, RoundedCornerShape(999.dp)).tap({ filter = f }, f).padding(horizontal = 14.dp, vertical = 7.dp)) {
                        Txt(f, 13f, 600, if (on) Color.White else C.Ink)
                    }
                }
            }
            Txt("HISTORY", 12f, 600, C.Muted, letterSpacing = 1f)
            if (shown.isEmpty()) {
                Column(Modifier.fillMaxWidth().padding(top = 30.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    Box(Modifier.size(72.dp).clip(CircleShape).background(Color.White), contentAlignment = Alignment.Center) { Icon24(Ic.Wallet, C.Faint, 30.dp) }
                    Txt("No transactions yet", 15f, 700, C.Muted)
                }
            } else shown.forEach { t ->
                Row(Modifier.fillMaxWidth().clip(RoundedCornerShape(16.dp)).background(Color.White).border(1.dp, C.Border, RoundedCornerShape(16.dp)).padding(14.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                    RoundIconTile(if (t.direction == TxDirection.In) Ic.ArrowDown else Ic.ArrowUp, if (t.direction == TxDirection.In) C.GreenAccent else C.Orange, if (t.direction == TxDirection.In) C.GreenTint else C.OrangeTint, 40.dp, iconSize = 18.dp)
                    Column(Modifier.weight(1f)) { Txt(t.title, 14f, 700); Txt(t.whenText, 12f, 500, C.Muted) }
                    Txt((if (t.direction == TxDirection.In) "+" else "−") + naira(t.amount, true), 14.5f, 800, if (t.direction == TxDirection.In) C.GreenAccent else C.Ink)
                }
            }
        }
    }
}

/** E6 then top-up. Paying needs a verified email, because the payment provider sends the receipt there. */
@Composable
fun FundWalletScreen(vm: DriverViewModel) {
    val debt: Kobo = if (vm.walletKobo < 0) -vm.walletKobo else 0
    val presets = listOf(50_000L, 100_000L, 200_000L, 500_000L, 1_000_000L)
    var amount by remember { mutableStateOf(if (debt > 0) ((debt + 9_999) / 10_000) * 10_000 else 100_000L) }
    Column(Modifier.fillMaxSize().background(C.Bg)) {
        ScreenHeader("Fund wallet", null, vm::pop)
        Column(Modifier.weight(1f).verticalScroll(rememberScrollState()).padding(start = 20.dp, end = 20.dp, top = 8.dp, bottom = 36.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
            if (!vm.profile.emailVerified) {
                Column(Modifier.fillMaxWidth().clip(RoundedCornerShape(18.dp)).background(Color.White).border(1.dp, C.Border, RoundedCornerShape(18.dp)).padding(18.dp), verticalArrangement = Arrangement.spacedBy(14.dp), horizontalAlignment = Alignment.CenterHorizontally) {
                    Box(Modifier.size(64.dp).clip(CircleShape).background(C.GreenTint), contentAlignment = Alignment.Center) { Icon24(Ic.Mail, C.GreenAccent, 28.dp) }
                    Txt("Verify your email first", 18f, 800, align = TextAlign.Center)
                    Txt("We need a verified email to start a payment and send your receipt.", 13.5f, 500, C.Muted, align = TextAlign.Center)
                }
                LabeledBox("Email address", vm.profile.email) { Chip("Unverified", C.Orange, C.OrangeTint) }
                if (!vm.emailSent) Btn("Send verification email", vm::sendVerificationEmail, Modifier.fillMaxWidth())
                else {
                    Txt("Open the link in your email, then come back here.", 13f, 500, C.Muted, align = TextAlign.Center, modifier = Modifier.fillMaxWidth())
                    if (vm.demo) Btn("Demo: I opened the link", vm::emailVerifiedNow, Modifier.fillMaxWidth(), kind = BtnKind.Outline)
                }
                Btn("Back to earnings", vm::pop, Modifier.fillMaxWidth(), kind = BtnKind.Outline)
            } else {
                if (debt > 0) {
                    Column(Modifier.fillMaxWidth().clip(RoundedCornerShape(18.dp)).background(C.OrangeTint).padding(14.dp)) {
                        Txt("Your wallet is ${naira(vm.walletKobo)}. Top up at least ${naira(debt)} to go online.", 13.5f, 600, C.Ink)
                    }
                }
                Txt("Amount", 12.5f, 600, C.Muted)
                presets.chunked(3).forEach { row ->
                    Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                        row.forEach { p ->
                            val on = p == amount
                            Box(
                                Modifier.weight(1f).height(52.dp).clip(RoundedCornerShape(14.dp)).background(if (on) C.GreenTint else Color.White)
                                    .border(1.5.dp, if (on) C.GreenAccent else C.Border, RoundedCornerShape(14.dp)).tap({ amount = p }, naira(p)),
                                contentAlignment = Alignment.Center,
                            ) { Txt(naira(p), 15f, 700, if (on) C.Green else C.Ink) }
                        }
                        repeat(3 - row.size) { Box(Modifier.weight(1f)) }
                    }
                }
                Txt("You pay with your card or bank transfer on a secure Paystack page.", 12.5f, 500, C.Muted)
            }
        }
        if (vm.profile.emailVerified) {
            Box(Modifier.padding(horizontal = 20.dp).navigationBarsPadding().padding(bottom = 20.dp)) {
                Btn("Pay ${naira(amount)}", { vm.confirm("Pay ${naira(amount)}?", "This amount is added to your wallet to cover what you owe.", "Yes, pay", false) { vm.topUp(amount); vm.pop() } }, Modifier.fillMaxWidth(), enabled = amount >= debt)
            }
        }
    }
}
