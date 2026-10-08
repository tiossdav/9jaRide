package com.ninejaride.driver.ui.screens

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
import androidx.compose.foundation.layout.width
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
import com.ninejaride.driver.state.TripRecord
import com.ninejaride.core.format.minutesSeconds
import com.ninejaride.core.format.naira
import com.ninejaride.core.ui.components.Avatar
import com.ninejaride.core.ui.components.Btn
import com.ninejaride.core.ui.components.BtnKind
import com.ninejaride.core.ui.components.Chip
import com.ninejaride.core.ui.components.Gap
import com.ninejaride.core.ui.components.Ic
import com.ninejaride.core.ui.components.Icon24
import com.ninejaride.core.ui.components.LabeledBox
import com.ninejaride.core.ui.components.MenuRow
import com.ninejaride.core.ui.components.RoundIconTile
import com.ninejaride.core.ui.components.RouteBlock
import com.ninejaride.core.ui.components.ScreenHeader
import com.ninejaride.core.ui.components.SheetOverlay
import com.ninejaride.core.ui.components.StarFilled
import com.ninejaride.core.ui.components.Tab
import com.ninejaride.core.ui.components.Txt
import com.ninejaride.core.ui.components.tap
import com.ninejaride.core.ui.theme.C
import com.ninejaride.core.ui.theme.type

// ---------------------------------------------------------------- Trips tab (not in the design: built from the trip detail screen)

@Composable
fun TripsScreen(vm: DriverViewModel) {
    Box(Modifier.fillMaxSize()) {
        Column(Modifier.fillMaxSize().statusBarsPadding().verticalScroll(rememberScrollState()).padding(bottom = 36.dp)) {
            Column(Modifier.padding(start = 20.dp, end = 20.dp, top = 22.dp, bottom = 12.dp), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                Txt("Trips", 24f, 800)
                Txt("Your completed trips", 13f, 500, C.Muted)
            }
            Column(Modifier.padding(horizontal = 20.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                if (vm.trips.isEmpty()) {
                    Column(Modifier.fillMaxWidth().padding(top = 60.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        Box(Modifier.size(88.dp).clip(CircleShape).background(Color.White), contentAlignment = Alignment.Center) { Icon24(Ic.Box, C.Faint, 36.dp) }
                        Txt("No trips yet", 16f, 700)
                        Txt("Completed trips will show here.", 13f, 500, C.Muted)
                    }
                }
                vm.trips.forEach { t -> TripCard(t) { vm.push(Dest.TripDetails(t.code)) } }
            }
        }
    }
}

@Composable
private fun TripCard(t: TripRecord, onClick: () -> Unit) {
    Column(
        Modifier.fillMaxWidth().clip(RoundedCornerShape(18.dp)).background(Color.White).border(1.dp, C.Border, RoundedCornerShape(18.dp)).tap(onClick, "Trip ${t.code}").padding(14.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(1.dp)) {
                Txt("Trip ${t.code}", 14.5f, 700)
                Txt(t.whenText, 12.5f, 500, C.Muted)
            }
            Txt(naira(t.receipt.total), 18f, 800)
        }
        RouteBlock(t.pickup, t.dropoff)
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Chip("Completed")
            Chip(t.payment, C.DarkChipText, C.DarkChip)
        }
    }
}

/** D12. */
@Composable
fun TripDetailsScreen(vm: DriverViewModel, code: String) {
    val t = vm.trips.firstOrNull { it.code == code }
    Column(Modifier.fillMaxSize().background(C.Bg)) {
        ScreenHeader("Trip details", "Trip $code", vm::pop)
        if (t == null) {
            Txt("This trip could not be found.", 14f, 500, C.Muted, Modifier.padding(20.dp))
            return@Column
        }
        Column(Modifier.weight(1f).verticalScroll(rememberScrollState()).padding(start = 20.dp, end = 20.dp, top = 8.dp, bottom = 36.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Column(Modifier.fillMaxWidth().clip(RoundedCornerShape(18.dp)).background(Color.White).border(1.dp, C.Border, RoundedCornerShape(18.dp)).padding(16.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                        Chip("Completed")
                        Txt(t.whenText, 12.5f, 500, C.Muted)
                    }
                    Txt(naira(t.receipt.total), 30f, 800)
                }
                RouteBlock(t.pickup, t.dropoff)
            }
            Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                Fact("DISTANCE", "%.2f km".format(t.distanceKm), Modifier.weight(1f))
                Fact("DURATION", minutesSeconds(t.durationSeconds), Modifier.weight(1f))
                Fact("PAYMENT", t.payment, Modifier.weight(1f))
            }
            ReceiptCardPlain(t)
            Row(
                Modifier.fillMaxWidth().clip(RoundedCornerShape(18.dp)).background(Color.White).border(1.dp, C.Border, RoundedCornerShape(18.dp)).padding(14.dp),
                verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                Avatar(t.rider.name.take(1), 40.dp)
                Txt(t.rider.name, 15f, 700, modifier = Modifier.weight(1f))
                StarFilled(C.OrangeIcon, 16.dp)
                Txt("${t.rider.rating}", 13.5f, 600, C.Muted)
            }
            Btn("Report a problem", { vm.push(Dest.Help) }, Modifier.fillMaxWidth(), kind = BtnKind.Outline)
        }
    }
}

@Composable
private fun ReceiptCardPlain(t: TripRecord) {
    Column(Modifier.fillMaxWidth().clip(RoundedCornerShape(18.dp)).background(Color.White).border(1.dp, C.Border, RoundedCornerShape(18.dp)).padding(16.dp)) {
        t.receipt.lines.forEach { l ->
            Box(Modifier.padding(vertical = 8.dp)) {
                com.ninejaride.core.ui.components.MoneyLine(l.label, if (l.signed) com.ninejaride.core.format.nairaSigned(l.amount) else naira(l.amount, true), labelColor = C.Ink)
            }
        }
        com.ninejaride.core.ui.components.Divider()
        Box(Modifier.padding(vertical = 8.dp)) { com.ninejaride.core.ui.components.MoneyLine("Total", naira(t.receipt.total), bold = true) }
    }
}

@Composable
private fun Fact(label: String, value: String, modifier: Modifier) {
    Column(modifier.clip(RoundedCornerShape(14.dp)).background(Color.White).border(1.dp, C.Border, RoundedCornerShape(14.dp)).padding(12.dp), verticalArrangement = Arrangement.spacedBy(2.dp)) {
        Txt(label, 10.5f, 600, C.Muted, letterSpacing = 0.8f)
        Txt(value, 14f, 700)
    }
}

// ---------------------------------------------------------------- Profile (P1)

@Composable
fun ProfileScreen(vm: DriverViewModel) {
    val p = vm.profile
    Box(Modifier.fillMaxSize()) {
        Column(Modifier.fillMaxSize().statusBarsPadding().verticalScroll(rememberScrollState()).padding(bottom = 36.dp)) {
            Column(Modifier.fillMaxWidth().padding(top = 28.dp, bottom = 16.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(4.dp)) {
                Avatar(p.name.take(1), 72.dp, 28f, vm.photo)
                Gap(6.dp)
                Txt(p.name, 20f, 800)
                Txt(p.vehicle?.category?.takeIf { it.isNotBlank() }?.let { "$it driver" } ?: p.gender, 13f, 500, C.Muted)
            }
            Row(Modifier.padding(horizontal = 20.dp), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                ProfileStat(p.ratingText, "Rating", Modifier.weight(1f), star = true)
                ProfileStat(p.vehicle?.plate ?: "None", "Vehicle", Modifier.weight(1.3f))
                ProfileStat(if (p.active) "Active" else "Inactive", "Status", Modifier.weight(1f), color = if (p.active) C.GreenAccent else C.Red)
            }
            Column(Modifier.padding(horizontal = 20.dp, vertical = 18.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                Txt("MY DETAILS", 12f, 600, C.Muted, letterSpacing = 1f)
                MenuRow(Ic.User, "Personal details", "Photo, contact, identity and next of kin", { vm.push(Dest.PersonalDetails) })
                MenuRow(Ic.Car, "Vehicle", "Everything about your vehicle", { vm.push(Dest.VehicleDetails) })
                MenuRow(Ic.Gift, "Bonus eligibility", "Daily bonus targets", { vm.push(Dest.Bonus) })
                MenuRow(Ic.Help, "Help & support", "Contact our team", { vm.push(Dest.Help) })
                Gap(6.dp)
                MenuRow(Ic.Logout, "Log out", null, { vm.dialog = Dialog.Logout }, tint = C.Red, titleColor = C.Red, showChevron = false)
                MenuRow(Ic.Trash, "Delete account", null, { vm.push(Dest.DeleteAccount) }, tint = C.Red, titleColor = C.Red, showChevron = false)
            }
        }
    }
}

/** Shown above the whole screen, tab bar included, so it lives outside the profile page. */
@Composable
fun LogoutSheet(vm: DriverViewModel) {
    SheetOverlay(onDismiss = { vm.dialog = null }) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            RoundIconTile(Ic.Logout, C.Red, Color(0xFFFDECEC), 46.dp)
            Txt("Log out of the app?", 18f, 800)
        }
        Txt("You will need to sign in again to use the app.", 13.5f, 500, C.Muted)
        Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            Btn("Cancel", { vm.dialog = null }, Modifier.weight(1f), kind = BtnKind.Outline)
            Btn("Log out", vm::logout, Modifier.weight(1f), kind = BtnKind.Danger)
        }
    }
}

@Composable
private fun ProfileStat(value: String, label: String, modifier: Modifier, star: Boolean = false, color: Color = C.Ink) {
    Column(modifier.clip(RoundedCornerShape(16.dp)).background(Color.White).border(1.dp, C.Border, RoundedCornerShape(16.dp)).padding(12.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(2.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(4.dp)) {
            if (star) StarFilled(C.OrangeIcon, 14.dp)
            Txt(value, 15f, 800, color, maxLines = 1)
        }
        Txt(label, 11.5f, 500, C.Muted)
    }
}

/** What the driver gave at sign-up and onboarding, with a photo they can replace. */
@Composable
fun PersonalDetailsScreen(vm: DriverViewModel) {
    val p = vm.profile
    var adding by remember { mutableStateOf(false) }
    val picker = androidx.activity.compose.rememberLauncherForActivityResult(androidx.activity.result.contract.ActivityResultContracts.GetContent()) { uri -> if (uri != null) vm.changePhoto(uri) }
    Box(Modifier.fillMaxSize().background(C.Bg)) {
        Column(Modifier.fillMaxSize()) {
            ScreenHeader("Personal details", "What you gave us when you signed up", vm::pop)
            Column(Modifier.weight(1f).verticalScroll(rememberScrollState()).padding(start = 20.dp, end = 20.dp, top = 8.dp, bottom = 36.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                Column(Modifier.fillMaxWidth(), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Box(Modifier.size(76.dp).tap({ if (!vm.photoBusy) picker.launch("image/*") }, "Change photo")) {
                        Avatar(p.name.take(1), 76.dp, 30f, vm.photo)
                        if (vm.photoBusy) Box(Modifier.matchParentSize().clip(CircleShape).background(Color.Black.copy(alpha = 0.35f)), contentAlignment = Alignment.Center) { Txt("...", 22f, 800, Color.White) }
                        Box(
                            Modifier.align(Alignment.BottomEnd).size(26.dp).clip(CircleShape).background(C.OrangeIcon).border(2.dp, C.Bg, CircleShape),
                            contentAlignment = Alignment.Center,
                        ) { Icon24(Ic.Edit, Color.White, 13.dp) }
                    }
                    vm.photoError?.let { Txt(it, 12.5f, 600, C.Red, align = TextAlign.Center) }
                    Txt(p.name, 18f, 800)
                }
                Txt("CONTACT", 12f, 600, C.Muted, letterSpacing = 1f)
                LabeledBox("Phone number", p.phone) { Chip("Verified") }
                LabeledBox("Email address", p.email.ifBlank { "Not added" })
                if (p.contactPreference.isNotBlank()) LabeledBox("We contact you by", if (p.contactPreference == "email") "Email" else "WhatsApp")
                Txt("IDENTITY", 12f, 600, C.Muted, letterSpacing = 1f)
                if (p.dateOfBirth.isNotBlank()) LabeledBox("Date of birth", p.dateOfBirth)
                LabeledBox("NIN", p.nin?.let { "*******" + it.takeLast(4) } ?: "Not added") {
                    if (p.nin == null && vm.demo) Txt("Add", 13.5f, 700, C.Green, Modifier.tap({ adding = true }, "Add NIN")) else if (p.nin != null) Chip("Added")
                }
                if (p.lassdri.isNotBlank()) LabeledBox("LASDRI number", p.lassdri)
                if (p.address.isNotBlank()) { Txt("ADDRESS", 12f, 600, C.Muted, letterSpacing = 1f); LabeledBox("Home address", p.address) }
                if (p.kinName.isNotBlank()) {
                    Txt("NEXT OF KIN", 12f, 600, C.Muted, letterSpacing = 1f)
                    LabeledBox("Name", p.kinName + if (p.kinRelationship.isNotBlank()) " (${p.kinRelationship})" else "")
                    LabeledBox("Phone number", p.kinPhone)
                    LabeledBox("Address", p.kinAddress)
                }
                Txt("Your phone number cannot be changed. To change anything else, contact support.", 12.5f, 500, C.Muted)
            }
        }
        if (adding) {
            var nin by remember { mutableStateOf("") }
            SheetOverlay(onDismiss = { adding = false }) {
                Txt("Add your NIN", 18f, 800)
                Txt("Your 11-digit National Identification Number. It is used to confirm who you are.", 13.5f, 500, C.Muted)
                BasicTextField(
                    value = nin,
                    onValueChange = { nin = it.filter(Char::isDigit).take(11) },
                    singleLine = true,
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
                    textStyle = type(16f, 600, C.Ink),
                    modifier = Modifier.fillMaxWidth(),
                    decorationBox = { inner ->
                        Box(Modifier.fillMaxWidth().clip(RoundedCornerShape(14.dp)).background(Color.White).border(1.dp, C.Border, RoundedCornerShape(14.dp)).padding(horizontal = 16.dp, vertical = 15.dp)) {
                            if (nin.isEmpty()) Txt("11 digits", 16f, 500, C.Disabled)
                            inner()
                        }
                    },
                )
                Btn("Save", { vm.saveNin(nin); adding = false }, Modifier.fillMaxWidth(), enabled = nin.length == 11)
            }
        }
    }
}

/** The driver's vehicle, as onboarding recorded it and staff confirmed it. */
@Composable
fun VehicleScreen(vm: DriverViewModel) {
    val v = vm.profile.vehicle
    val plan = vm.profile.plan
    Column(Modifier.fillMaxSize().background(C.Bg)) {
        ScreenHeader("Vehicle", "Your vehicle details", vm::pop)
        Column(Modifier.weight(1f).verticalScroll(rememberScrollState()).padding(start = 20.dp, end = 20.dp, top = 8.dp, bottom = 36.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            if (v == null) {
                Txt("No vehicle is linked to your account yet. Contact support.", 14f, 500, C.Muted)
            } else {
                Row(
                    Modifier.fillMaxWidth().clip(RoundedCornerShape(18.dp)).background(Color.White).border(1.dp, C.Border, RoundedCornerShape(18.dp)).padding(16.dp),
                    verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(14.dp),
                ) {
                    RoundIconTile(Ic.Car, C.GreenAccent, C.GreenTint, 52.dp, round = false, iconSize = 26.dp)
                    Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                        Txt((listOf(v.make, v.model).filter { it.isNotBlank() }.joinToString(" ")).ifBlank { "Vehicle" }, 16f, 800)
                        Txt(v.colour, 13f, 500, C.Muted)
                    }
                    Box(Modifier.clip(RoundedCornerShape(10.dp)).background(C.Bg).border(1.5.dp, C.Border, RoundedCornerShape(10.dp)).padding(horizontal = 12.dp, vertical = 7.dp)) { Txt(v.plate, 14f, 700, letterSpacing = 0.5f) }
                }
                LabeledBox("Plate number", v.plate)
                LabeledBox("Model", (listOf(v.make, v.model).filter { it.isNotBlank() }.joinToString(" ")))
                LabeledBox("Colour", v.colour)
                if (v.category.isNotBlank()) LabeledBox("Category", v.category) { Chip("Confirmed by our team") }
                if (v.arrangement.isNotBlank()) LabeledBox("How you drive", when (v.arrangement) { "platform_plan" -> "Platform vehicle (payment plan)"; "third_party" -> "Someone else's vehicle"; else -> "Your own vehicle" })
                LabeledBox("Owner", if (v.ownerName.isNotBlank()) "${v.ownerName} · ${v.ownerPhone}" else vm.profile.name.ifBlank { "You" })
                if (plan != null) {
                    Txt("VEHICLE PAYMENT PLAN", 12f, 600, C.Muted, letterSpacing = 1f)
                    LabeledBox("Paid so far", naira(plan.paidKobo) + " of " + naira(plan.totalKobo))
                    LabeledBox("Still owed", naira(plan.outstandingKobo))
                    if (plan.overdueKobo > 0 && plan.status != "cancelled") LabeledBox("Behind by", naira(plan.overdueKobo), valueColor = C.Red)
                    plan.nextDueOn?.let { LabeledBox("Next payment due", it) }
                }
                vm.vehicleTerms?.let { ShareSection(vm, it) }
                Txt("To change vehicle details, contact support.", 12.5f, 700, C.Ink)
            }
        }
    }
}

/** P4. */
@Composable
fun BonusScreen(vm: DriverViewModel) {
    Column(Modifier.fillMaxSize().background(C.Bg)) {
        ScreenHeader("Bonus eligibility", "Today's bonus targets", vm::pop)
        Column(Modifier.weight(1f).verticalScroll(rememberScrollState()).padding(start = 20.dp, end = 20.dp, top = 8.dp, bottom = 36.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                Fact("TRIPS TODAY", "${vm.tripsToday}", Modifier.weight(1f))
                Fact("DISTANCE TODAY", "%.2f km".format(vm.kmToday), Modifier.weight(1f))
                Fact("EARNED TODAY", naira(vm.earningsKobo), Modifier.weight(1f))
            }
            Txt("TODAY'S BONUS", 12f, 600, C.Muted, letterSpacing = 1f)
            Column(Modifier.fillMaxWidth().clip(RoundedCornerShape(18.dp)).background(Color.White).border(1.dp, C.Border, RoundedCornerShape(18.dp)).padding(18.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                Txt("No bonus is running today. Check back tomorrow.", 14.5f, 600)
            }
            Txt("Bonuses are paid into your wallet automatically after 12:00 am. Each day starts again at 12:00 am Nigeria time. If you qualify for more than one bonus, you get the one that pays the most.", 12.5f, 500, C.Muted)
            Column(Modifier.fillMaxWidth().clip(RoundedCornerShape(18.dp)).background(C.OrangeTint).padding(16.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                Txt("Stay available for requests", 14.5f, 800)
                Txt("Declining or ignoring trip requests, or cancelling trips after accepting them, could affect how often you receive requests.", 12.5f, 500, C.Muted)
            }
        }
    }
}

/** P5. Reports go to the support desk in the admin portal; the reply shows here once staff resolve them. */
@Composable
fun HelpScreen(vm: DriverViewModel) {
    androidx.compose.runtime.LaunchedEffect(Unit) { vm.loadReports() }
    Column(Modifier.fillMaxSize().background(C.Bg).imePadding()) {
        ScreenHeader("Help & support", "Tell us what went wrong", vm::pop)
        Column(Modifier.weight(1f).verticalScroll(rememberScrollState()).padding(start = 20.dp, end = 20.dp, top = 8.dp, bottom = 36.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            com.ninejaride.core.ui.components.ReportProblemForm(vm.reportSending, vm.reportNotice) { topic, message -> vm.sendReport(topic, message) }
            com.ninejaride.core.ui.components.MyReports(vm.reports)
            Txt("In danger? Use the SOS button on the home screen, or call 112.", 12.5f, 600, C.RedText, Modifier.padding(top = 8.dp))
        }
    }
}

/** D13: what stops an account being deleted. */
@Composable
fun DeleteAccountScreen(vm: DriverViewModel) {
    val checks = vm.deleteBlockers
    val blocked = checks.any { !it.ok }
    Column(Modifier.fillMaxSize().background(C.Bg)) {
        ScreenHeader("Delete account", "Review before you continue", vm::pop)
        Column(Modifier.weight(1f).verticalScroll(rememberScrollState()).padding(start = 20.dp, end = 20.dp, top = 8.dp, bottom = 36.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            if (blocked) {
                Row(Modifier.fillMaxWidth().clip(RoundedCornerShape(18.dp)).background(C.RedCard).padding(16.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                    Icon24(Ic.Warning, C.RedText, 26.dp)
                    Column(verticalArrangement = Arrangement.spacedBy(1.dp)) {
                        Txt("You cannot delete yet", 16f, 800, C.RedText)
                        Txt("Fix these first", 12.5f, 500, C.RedText)
                    }
                }
            }
            checks.forEach { c ->
                Row(Modifier.fillMaxWidth().clip(RoundedCornerShape(18.dp)).background(Color.White).border(1.dp, C.Border, RoundedCornerShape(18.dp)).padding(14.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                    Box(Modifier.size(36.dp).clip(CircleShape).background(if (c.ok) C.GreenAccent else C.Red), contentAlignment = Alignment.Center) { Icon24(if (c.ok) Ic.Check else Ic.Close, Color.White, 18.dp, 2.4f) }
                    Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(1.dp)) { Txt(c.title, 14.5f, 700); Txt(c.detail, 12.5f, 500, C.Muted) }
                    if (c.action != null) Btn(c.action, { vm.push(Dest.FundWallet) }, Modifier.width(84.dp), height = 38.dp, size = 13.5f)
                }
            }
            Txt("When you delete, we remove your name, phone, email and NIN. Trip and payment records are kept without your personal details.", 12.5f, 500, C.Muted)
        }
        Column(Modifier.padding(horizontal = 20.dp).navigationBarsPadding().padding(bottom = 20.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Btn("Delete account", { vm.confirm("Delete your account?", "This removes your account and cannot be undone.", "Yes, delete", true, vm::logout) }, Modifier.fillMaxWidth(), kind = BtnKind.Danger, enabled = !blocked)
            Btn("Back to profile", vm::pop, Modifier.fillMaxWidth(), kind = BtnKind.Outline)
        }
    }
}

/** How much of each trip goes toward the vehicle. A share the driver chose can be changed here; one a business set cannot. */
@Composable
private fun ShareSection(vm: DriverViewModel, t: com.ninejaride.driver.state.VehicleTerms) {
    var text by remember(t.percent) { mutableStateOf(if (t.percent % 1.0 == 0.0) t.percent.toInt().toString() else t.percent.toString()) }
    Txt("PAYING TOWARD THIS VEHICLE", 12f, 600, C.Muted, letterSpacing = 1f)
    LabeledBox("Share of your earnings", "${text.ifBlank { "0" }}%") { if (!t.canChange) Chip(if (t.setByOwner) "Set by ${t.ownerName.ifBlank { "the owner" }}" else "Fixed", C.Muted, C.Raised) }
    if (t.ownerName.isNotBlank()) LabeledBox("Paid to", t.ownerName)
    t.targetKobo?.let { LabeledBox("Paid so far", naira(t.paidKobo) + " of " + naira(it)) } ?: LabeledBox("Paid so far", naira(t.paidKobo))
    if (t.canChange) {
        com.ninejaride.core.ui.components.InputField("Change the share (%)", text, { text = it.filter { c -> c.isDigit() || c == '.' }.take(5); vm.termsError = null }, "1 to 90", KeyboardType.Decimal,
            helper = "The new share applies from your next trip. Past trips stay as they were.")
        vm.termsError?.let { Txt(it, 12.5f, 600, C.Red) }
        Btn(if (vm.termsBusy) "Saving..." else "Save share", { val p = text.toDoubleOrNull() ?: 0.0; if (p in 1.0..90.0) vm.saveShare(p) else vm.termsError = "Choose a share between 1% and 90%." }, Modifier.fillMaxWidth(), enabled = !vm.termsBusy && text.toDoubleOrNull() != t.percent)
    } else Txt("This share is set by ${t.ownerName.ifBlank { "the owner" }}. You cannot change it. Ask them if it needs to change.", 12.5f, 500, C.Muted)
}
