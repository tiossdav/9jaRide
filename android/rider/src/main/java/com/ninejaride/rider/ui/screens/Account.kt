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
import androidx.compose.foundation.layout.imePadding
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
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import com.ninejaride.core.format.naira
import com.ninejaride.core.format.nairaSigned
import com.ninejaride.core.ui.components.Avatar
import com.ninejaride.core.ui.components.Btn
import com.ninejaride.core.ui.components.BtnKind
import com.ninejaride.core.ui.components.Card
import com.ninejaride.core.ui.components.Gap
import com.ninejaride.core.ui.components.Ic
import com.ninejaride.core.ui.components.Icon24
import com.ninejaride.core.ui.components.LabeledBox
import com.ninejaride.core.ui.components.MenuRow
import com.ninejaride.core.ui.components.ScreenHeader
import com.ninejaride.core.ui.components.SheetOverlay
import com.ninejaride.core.ui.components.Txt
import com.ninejaride.core.ui.components.tap
import com.ninejaride.core.ui.theme.C
import com.ninejaride.rider.state.Dest
import com.ninejaride.rider.state.Dialog
import com.ninejaride.rider.state.RiderViewModel

private const val SUPPORT_EMAIL = "support@9jaridepro.com"

@Composable
fun AccountTab(vm: RiderViewModel) {
    Column(Modifier.fillMaxSize().background(C.Bg)) {
        Column(Modifier.weight(1f).verticalScroll(rememberScrollState()).statusBarsPadding().padding(20.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(14.dp)) {
                Avatar((vm.profile?.name ?: "R").take(1).uppercase(), 60.dp, 24f)
                Column {
                    Txt(vm.profile?.name?.ifBlank { null } ?: "Rider", 20f, 800)
                    Txt(vm.profile?.phone ?: "", 13.5f, 500, C.Muted)
                }
            }
            Gap(10.dp)
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                MenuRow(Ic.User, "Personal details", null, { vm.push(Dest.PersonalDetails) })
                MenuRow(Ic.Wallet, "Wallet", vm.wallet?.let { naira(it.availableKobo) + " available" }, { vm.refreshWallet(); vm.push(Dest.Wallet) })
                MenuRow(Ic.Bell, "Inbox", null, { vm.push(Dest.Inbox) })
                MenuRow(Ic.Gift, "Refer a friend", null, { vm.push(Dest.Refer) })
            }
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                MenuRow(Ic.Home, "Appearance", when (vm.appearance) { "light" -> "Light"; "dark" -> "Dark"; else -> "Match my phone" }, { vm.dialog = Dialog.Appearance })
                MenuRow(Ic.Help, "Help and support", null, { vm.push(Dest.Help) })
            }
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                MenuRow(Ic.Logout, "Log out", null, { vm.dialog = Dialog.Logout }, tint = C.RedText, titleColor = C.RedText, showChevron = false)
                MenuRow(Ic.Trash, "Delete account", null, { vm.push(Dest.DeleteAccount) }, tint = C.RedText, titleColor = C.RedText, showChevron = false)
            }
            Txt("9jaRide 0.1.0  -  Powered by Nexenno", 11.5f, 500, C.Faint, Modifier.padding(top = 8.dp))
        }
    }
    when (vm.dialog) {
        Dialog.Appearance -> AppearanceSheet(vm)
        Dialog.Logout -> SheetOverlay(onDismiss = { vm.dialog = null }) {
            Txt("Log out?", 18f, 800)
            Txt("You will need your phone number and a code to sign in again.", 13.5f, 500, C.Muted)
            Btn("Log out", vm::logout, Modifier.fillMaxWidth(), kind = BtnKind.Danger)
            Btn("Stay signed in", { vm.dialog = null }, Modifier.fillMaxWidth(), kind = BtnKind.Outline)
        }
        Dialog.Notice -> NoticeSheet(vm)
        else -> {}
    }
}

@Composable
private fun AppearanceSheet(vm: RiderViewModel) {
    SheetOverlay(onDismiss = { vm.dialog = null }) {
        Txt("Appearance", 18f, 800)
        listOf("system" to "Match my phone", "light" to "Light", "dark" to "Dark").forEach { (key, label) ->
            val on = vm.appearance == key
            Row(Modifier.fillMaxWidth().clip(RoundedCornerShape(14.dp)).background(if (on) C.GreenTint else C.Raised).border(1.5.dp, if (on) C.GreenAccent else C.Border, RoundedCornerShape(14.dp)).tap({ vm.chooseAppearance(key) }, label).padding(14.dp), verticalAlignment = Alignment.CenterVertically) {
                Txt(label, 15f, 700, modifier = Modifier.weight(1f))
                if (on) Icon24(Ic.Check, C.GreenAccent, 20.dp, 2.4f)
            }
        }
    }
}

@Composable
fun PersonalDetailsScreen(vm: RiderViewModel) {
    Column(Modifier.fillMaxSize().background(C.Bg)) {
        Box(Modifier.statusBarsPadding()) { ScreenHeader("Personal details", onBack = vm::pop) }
        Column(Modifier.padding(20.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            LabeledBox("Full name", vm.profile?.name ?: "")
            LabeledBox("Mobile number", vm.profile?.phone ?: "")
            Txt("To change your name or number, contact support.", 12.5f, 500, C.Muted)
        }
    }
}

@Composable
fun WalletScreen(vm: RiderViewModel) {
    Column(Modifier.fillMaxSize().background(C.Bg)) {
        Box(Modifier.statusBarsPadding()) { ScreenHeader("Wallet", onBack = vm::pop) }
        Column(Modifier.weight(1f).verticalScroll(rememberScrollState()).padding(horizontal = 20.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
            Column(Modifier.fillMaxWidth().clip(RoundedCornerShape(22.dp)).background(C.Green).padding(20.dp)) {
                Txt("Available balance", 12.5f, 600, C.OnGreenMuted)
                Txt(naira(vm.wallet?.availableKobo ?: 0), 32f, 800, Color.White)
                val held = (vm.wallet?.balanceKobo ?: 0) - (vm.wallet?.availableKobo ?: 0)
                if (held > 0) Txt("${naira(held)} held for rides in progress", 12f, 500, C.OnGreenMuted)
            }
            Btn("Top up", { vm.push(Dest.TopUp) }, Modifier.fillMaxWidth())
            Txt("ACTIVITY", 11f, 500, C.Muted, letterSpacing = 1f)
            if (vm.walletTx.isEmpty()) EmptyState(Ic.Wallet, "No activity yet", "Top-ups and ride payments will show here.")
            vm.walletTx.forEach { t ->
                Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                    Box(Modifier.size(40.dp).clip(CircleShape).background(if (t.amountKobo >= 0) C.GreenTint else C.RedCard), contentAlignment = Alignment.Center) {
                        Icon24(if (t.amountKobo >= 0) Ic.ArrowDown else Ic.ArrowUp, if (t.amountKobo >= 0) C.GreenAccent else C.RedText, 20.dp)
                    }
                    Column(Modifier.weight(1f)) { Txt(t.memo?.ifBlank { null } ?: t.kind.replace('_', ' ').replaceFirstChar { it.uppercase() }, 14f, 700, maxLines = 1); Txt(whenText(t.at), 12f, 500, C.Muted) }
                    Txt(nairaSigned(t.amountKobo), 14f, 800, if (t.amountKobo >= 0) C.GreenAccent else C.Ink)
                }
            }
            Gap(10.dp)
        }
    }
}

@Composable
fun TopUpScreen(vm: RiderViewModel) {
    val ctx = LocalContext.current
    LaunchedEffect(vm.openUrl) {
        vm.openUrl?.let { url -> runCatching { ctx.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url))) }; vm.openUrl = null; vm.refreshWallet() }
    }
    Column(Modifier.fillMaxSize().background(C.Bg)) {
        Box(Modifier.statusBarsPadding()) { ScreenHeader("Top up wallet", onBack = vm::pop) }
        Column(Modifier.weight(1f).verticalScroll(rememberScrollState()).padding(horizontal = 20.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
            Txt("Amount", 12.5f, 600, C.Muted)
            Txt(naira(vm.topUpAmount), 36f, 800)
            listOf(listOf(100_000L, 200_000L, 500_000L), listOf(1_000_000L, 2_000_000L, 5_000_000L)).forEach { row ->
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    row.forEach { a ->
                        val on = vm.topUpAmount == a
                        Box(Modifier.weight(1f).clip(RoundedCornerShape(12.dp)).background(if (on) C.GreenTint else C.Raised).border(1.5.dp, if (on) C.GreenAccent else C.Border, RoundedCornerShape(12.dp)).tap({ vm.topUpAmount = a }, naira(a)).padding(vertical = 14.dp), contentAlignment = Alignment.Center) {
                            Txt(naira(a), 14f, 700)
                        }
                    }
                }
            }
            Txt("You will pay securely with Paystack in your browser, then come back to the app. Your balance updates as soon as the payment is confirmed.", 12.5f, 500, C.Muted)
        }
        Box(Modifier.navigationBarsPadding().padding(20.dp)) { Btn(if (vm.toppingUp) "Opening..." else "Pay ${naira(vm.topUpAmount)}", { vm.confirm("Top up ${naira(vm.topUpAmount)}?", "You will pay securely with Paystack in your browser.", "Yes, continue", false) { vm.startTopUp(vm.topUpAmount) } }, Modifier.fillMaxWidth(), enabled = !vm.toppingUp) }
    }
    if (vm.dialog == Dialog.Notice) NoticeSheet(vm)
}

@Composable
fun ReferScreen(vm: RiderViewModel) {
    val ctx = LocalContext.current
    Column(Modifier.fillMaxSize().background(C.Bg)) {
        Box(Modifier.statusBarsPadding()) { ScreenHeader("Refer a friend", onBack = vm::pop) }
        Column(Modifier.weight(1f).padding(20.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(14.dp)) {
            Gap(20.dp)
            Box(Modifier.size(88.dp).clip(CircleShape).background(C.GreenTint), contentAlignment = Alignment.Center) { Icon24(Ic.Gift, C.GreenAccent, 40.dp) }
            Txt("Share 9jaRide", 22f, 800)
            Txt("Tell a friend about safe, affordable rides. Referral rewards are coming soon.", 14f, 500, C.Muted, align = androidx.compose.ui.text.style.TextAlign.Center)
        }
        Box(Modifier.navigationBarsPadding().padding(20.dp)) {
            Btn("Share", {
                val send = Intent(Intent.ACTION_SEND).setType("text/plain").putExtra(Intent.EXTRA_TEXT, "Ride with 9jaRide - safe, affordable rides. https://9jaridepro.com")
                ctx.startActivity(Intent.createChooser(send, "Share 9jaRide"))
            }, Modifier.fillMaxWidth())
        }
    }
}

@Composable
fun HelpScreen(vm: RiderViewModel) {
    val ctx = LocalContext.current
    LaunchedEffect(Unit) { vm.loadReports() }
    Column(Modifier.fillMaxSize().background(C.Bg).imePadding()) {
        Box(Modifier.statusBarsPadding()) { ScreenHeader("Help and support", onBack = vm::pop) }
        Column(Modifier.weight(1f).verticalScroll(rememberScrollState()).padding(20.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            com.ninejaride.core.ui.components.ReportProblemForm(vm.reportSending, vm.reportNotice) { topic, message -> vm.sendReport(topic, message) }
            com.ninejaride.core.ui.components.MyReports(vm.reports)
            Gap(8.dp)
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                MenuRow(Ic.Mail, "Email support", SUPPORT_EMAIL, { ctx.startActivity(Intent(Intent.ACTION_SENDTO, Uri.parse("mailto:$SUPPORT_EMAIL"))) })
                MenuRow(Ic.Warning, "Emergency (112)", "Call the national emergency line", { ctx.startActivity(Intent(Intent.ACTION_DIAL, Uri.parse("tel:112"))) }, tint = C.RedText)
            }
            Txt("For a problem with a trip, include the trip code from Trips > Trip details.", 12.5f, 500, C.Muted, Modifier.padding(top = 8.dp))
        }
    }
}

@Composable
fun DeleteAccountScreen(vm: RiderViewModel) {
    val ctx = LocalContext.current
    Column(Modifier.fillMaxSize().background(C.Bg)) {
        Box(Modifier.statusBarsPadding()) { ScreenHeader("Delete account", onBack = vm::pop) }
        Column(Modifier.weight(1f).padding(20.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
            Txt("Deleting your account removes your profile and trip history. Money left in your wallet must be withdrawn or used first, and any ride in progress must finish.", 14f, 500, C.Muted)
            Txt("To start, contact support from the number on your account. We will confirm it is you before anything is deleted.", 14f, 500, C.Muted)
        }
        Box(Modifier.navigationBarsPadding().padding(20.dp)) { Btn("Contact support", { ctx.startActivity(Intent(Intent.ACTION_SENDTO, Uri.parse("mailto:$SUPPORT_EMAIL?subject=Delete my account"))) }, Modifier.fillMaxWidth()) }
    }
}

@Composable
fun InboxScreen(vm: RiderViewModel) {
    Column(Modifier.fillMaxSize().background(C.Bg)) {
        Box(Modifier.statusBarsPadding()) { ScreenHeader("Inbox", onBack = vm::pop) }
        EmptyState(Ic.Bell, "You are all caught up", "Messages about your rides and wallet will show here.")
    }
}
