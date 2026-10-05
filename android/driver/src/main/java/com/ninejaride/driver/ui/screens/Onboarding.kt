package com.ninejaride.driver.ui.screens

import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import com.ninejaride.core.ui.components.Btn
import com.ninejaride.core.ui.components.BtnKind
import com.ninejaride.core.ui.components.Card
import com.ninejaride.core.ui.components.Chip
import com.ninejaride.core.ui.components.SheetOverlay
import com.ninejaride.core.ui.components.ChoiceCard
import com.ninejaride.core.ui.components.Gap
import com.ninejaride.core.ui.components.InputField
import com.ninejaride.core.ui.components.PillChoice
import com.ninejaride.core.ui.components.DateField
import com.ninejaride.core.ui.components.ScreenHeader
import com.ninejaride.core.ui.components.Txt
import com.ninejaride.core.ui.components.tap
import com.ninejaride.core.ui.theme.C
import com.ninejaride.driver.state.Dialog
import com.ninejaride.driver.state.DriverViewModel
import com.ninejaride.driver.state.documentLabel

private val CATEGORIES = listOf("regular" to "Regular", "comfort" to "Comfort")

/** Name and number for a new driver; the code and everything after it work as in sign-in. */
@Composable
fun SignUpScreen(vm: DriverViewModel) {
    Column(Modifier.fillMaxSize().background(C.Bg).imePadding().verticalScroll(rememberScrollState())) {
        ScreenHeader("Create your account", "Drive with 9jaRide Pro and earn on your own time.", onBack = { vm.message = null; vm.pop() })
        Column(Modifier.padding(horizontal = 20.dp, vertical = 12.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
            InputField("Full name", vm.fullName, { vm.fullName = it; vm.message = null }, "As on your driver's licence")
            InputField("Mobile number", vm.phoneDigits, vm::onPhoneChange, "0803 000 0010", KeyboardType.Phone, phone = true)
            Txt(vm.message ?: "We will send a one-time code to confirm it is you.", 12.5f, 500, if (vm.message != null) C.Red else C.Muted)
            Btn("Continue", vm::startSignUp, Modifier.fillMaxWidth(), enabled = vm.phoneValid && vm.fullName.trim().length >= 2 && !vm.busy)
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.Center) {
                Txt("Already have an account?  ", 13f, 500, C.Muted)
                Txt("Sign in", 13f, 700, C.GreenAccent, Modifier.tap({ vm.message = null; vm.pop() }, "Sign in"))
            }
        }
    }
    if (vm.dialog == Dialog.OtpMethod) OtpMethodSheet(vm)
}

private fun heading(vm: DriverViewModel) = when (vm.applyStep) {
    0 -> "How will you drive with us?"
    1 -> "About you"
    2 -> "Next of kin"
    3 -> if (vm.chosen?.hasPaymentPlan == true) "Which vehicle do you want?" else "Your vehicle"
    else -> "Upload your documents"
}

/** The application, in five short steps. */
@Composable
fun ApplyScreen(vm: DriverViewModel) {
    val step = vm.applyStep
    Column(Modifier.fillMaxSize().background(C.Bg).imePadding()) {
        ScreenHeader(heading(vm), "Step ${step + 1} of 5", onBack = vm::applyBack)
        Column(Modifier.weight(1f).verticalScroll(rememberScrollState()).padding(start = 20.dp, end = 20.dp, top = 8.dp, bottom = 36.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            val a = vm.chosen
            fun edit(set: (String) -> Unit): (String) -> Unit = { set(it); vm.applyError = null }
            when (step) {
                0 -> {
                    Txt("Pick the one that fits you.", 13.5f, 500, C.Muted)
                    if (vm.arrangements.isEmpty()) Txt("Could not load the options. Check your connection and go back to try again.", 13f, 600, C.Red)
                    vm.arrangements.forEach { ChoiceCard(it.name, it.description, vm.arrangementCode == it.code) { vm.arrangementCode = it.code } }
                }
                1 -> {
                    Txt("PERSONAL INFORMATION", 11f, 500, C.Muted, letterSpacing = 1f)
                    if (vm.fullName.isNotBlank()) Txt("${vm.fullName}  ·  ${vm.phoneDigits}", 13.5f, 600, C.Muted)
                    DateField("Date of birth", vm.dateOfBirth, { vm.dateOfBirth = it; vm.applyError = null }, "Choose your date of birth",
                        latest = java.time.LocalDate.now().minusYears(18), opensAt = java.time.LocalDate.now().minusYears(30))
                    InputField("Home address", vm.address, edit { vm.address = it }, "House number, street, area, city")
                    InputField("NIN (National Identification Number)", vm.nin, edit { vm.nin = it.filter { c -> c.isDigit() }.take(11) }, "11 digits", KeyboardType.Number,
                        helper = "We check this number for you. There is no card photo to upload.")
                    InputField("LASSDRI number (Lagos State)", vm.lassdri, edit { vm.lassdri = it.uppercase() }, "Your LASSDRI card number")
                    InputField("Email address", vm.email, edit { vm.email = it.trim() }, "you@example.com", KeyboardType.Email)
                    Txt("HOW SHOULD WE REACH YOU ABOUT YOUR APPLICATION?", 11f, 500, C.Muted, letterSpacing = 1f)
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        PillChoice("WhatsApp", vm.contactPreference == "whatsapp", { vm.contactPreference = "whatsapp" }, Modifier.weight(1f))
                        PillChoice("Email", vm.contactPreference == "email", { vm.contactPreference = "email" }, Modifier.weight(1f))
                    }
                }
                2 -> {
                    Txt("Someone we can reach in an emergency.", 13.5f, 500, C.Muted)
                    InputField("Full name", vm.kinName, edit { vm.kinName = it }, "Next of kin's full name")
                    InputField("Phone number", vm.kinPhone, edit { vm.kinPhone = it.filter { c -> c.isDigit() }.take(11) }, "0803 000 0010", KeyboardType.Phone, phone = true)
                    InputField("Relationship (optional)", vm.kinRelationship, edit { vm.kinRelationship = it }, "Spouse, parent, sibling...")
                    InputField("Address", vm.kinAddress, edit { vm.kinAddress = it }, "Next of kin's address")
                }
                3 -> {
                    Txt("CATEGORY", 11f, 500, C.Muted, letterSpacing = 1f)
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        CATEGORIES.forEach { (code, label) -> PillChoice(label, vm.vehicleCategory == code, { vm.vehicleCategory = code }, Modifier.weight(1f)) }
                    }
                    Txt("Our team will inspect the vehicle and confirm the category before you are approved.", 12.5f, 500, C.Muted)
                    if (a?.hasPaymentPlan == true) {
                        Card { Txt("We will give you a car", 15f, 700); Gap(4.dp); Txt("Our team picks the car and agrees the payment plan with you: the price, the deposit, and how much you pay and how often. You will see the car once you are approved.", 13f, 500, C.Muted) }
                    }
                    if (a?.asksForVehicle == true) {
                        InputField("Plate number", vm.plate, edit { vm.plate = it }, "KJA-482AB", plate = true)
                        InputField("Model", vm.make, edit { vm.make = it }, "Toyota Corolla")
                        InputField("Colour", vm.colour, edit { vm.colour = it }, "Silver")
                        Txt(if (a.asksForOwner) "Owner: someone else, details below." else "Owner: you.", 12.5f, 600, C.Muted)
                    }
                    if (a?.asksForOwner == true) {
                        Txt("WHO OWNS THE CAR", 11f, 500, C.Muted, letterSpacing = 1f)
                        InputField("Owner name", vm.ownerName, edit { vm.ownerName = it }, "Full name of the owner")
                        InputField("Owner phone number", vm.ownerPhone, edit { vm.ownerPhone = it.filter { c -> c.isDigit() }.take(11) }, "0803 000 0010", KeyboardType.Phone, phone = true)
                    }
                }
                else -> DocumentsStep(vm)
            }
            vm.applyError?.let { Txt(it, 13f, 600, C.Red) }
        }
        Column(Modifier.padding(horizontal = 20.dp, vertical = 12.dp).navigationBarsPadding().padding(bottom = 12.dp)) {
            Btn(
                if (step < 4) "Continue" else if (vm.applying) "Sending..." else "Send application",
                vm::applyNext, Modifier.fillMaxWidth(), enabled = !vm.applying && vm.uploading == null && (step > 0 || vm.arrangements.isNotEmpty()),
            )
        }
    }
}

@Composable
private fun DocumentsStep(vm: DriverViewModel) {
    var pending by remember { mutableStateOf<String?>(null) }
    val picker = rememberLauncherForActivityResult(ActivityResultContracts.GetContent()) { uri ->
        val kind = pending
        if (uri != null && kind != null) vm.uploadDocument(kind, uri)
        pending = null
    }
    Txt("Take a clear photo of each document, or pick one from your gallery. Make sure the details can be read.", 13.5f, 500, C.Muted)
    fun clear(set: (String) -> Unit): (String) -> Unit = { set(it); vm.applyError = null }
    vm.neededDocuments().forEach { kind ->
        val done = vm.uploads[kind] != null
        Card {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Txt(documentLabel(kind), 15f, 700, modifier = Modifier.weight(1f))
                if (done) Chip("Uploaded")
            }
            Gap(8.dp)
            when (kind) {
                "drivers_licence" -> {
                    InputField("Licence number", vm.licenceNumber, clear { vm.licenceNumber = it.uppercase() }, "ABC12345AA01")
                    Gap(8.dp); DateField("Expiry date", vm.licenceExpiry, { vm.licenceExpiry = it; vm.applyError = null }, earliest = java.time.LocalDate.now().plusDays(1), opensAt = java.time.LocalDate.now().plusYears(1))
                }
                "insurance" -> {
                    InputField("Policy number", vm.insuranceNumber, clear { vm.insuranceNumber = it }, "Policy number")
                    Gap(8.dp); DateField("Expiry date", vm.insuranceExpiry, { vm.insuranceExpiry = it; vm.applyError = null }, earliest = java.time.LocalDate.now().plusDays(1), opensAt = java.time.LocalDate.now().plusYears(1))
                }
                "inspection_certificate" -> DateField("Expiry date", vm.inspectionExpiry, { vm.inspectionExpiry = it; vm.applyError = null }, earliest = java.time.LocalDate.now().plusDays(1), opensAt = java.time.LocalDate.now().plusYears(1))
                "owner_consent" -> Txt("A letter or photo showing the owner agrees you can drive this car for 9jaRide Pro.", 12.5f, 500, C.Muted)
                "lassdri" -> Txt("Both sides of your LASSDRI card.", 12.5f, 500, C.Muted)
                "vehicle_photo" -> Txt("A clear photo of the car showing the plate number.", 12.5f, 500, C.Muted)
            }
            Gap(10.dp)
            Btn(
                if (vm.uploading == kind) "Uploading..." else if (done) "Replace photo" else "Add photo",
                { pending = kind; picker.launch("image/*") }, Modifier.fillMaxWidth(), kind = if (done) BtnKind.Outline else BtnKind.Primary,
                enabled = vm.uploading == null, height = 46.dp, size = 14.5f,
            )
        }
    }
}

/**
 * Where the application stands. While it is under review a box says so and the driver can go no further; the page asks the
 * server every 15 seconds, and when the application is approved the congratulations box takes them on to settlement.
 */
@Composable
fun ApplicationStatusScreen(vm: DriverViewModel) {
    val app = vm.application
    androidx.compose.runtime.LaunchedEffect(app?.status) {
        when (app?.status) {
            "SUBMITTED" -> if (vm.dialog == null) vm.dialog = Dialog.Verifying
            "APPROVED" -> vm.dialog = Dialog.Approved
        }
    }
    androidx.compose.runtime.LaunchedEffect(Unit) { while (true) { kotlinx.coroutines.delay(15_000); if (vm.dialog == null) vm.refreshApplication() } }
    if (vm.dialog == Dialog.Verifying) SheetOverlay(onDismiss = null) {
        Txt("Profile Under Verification", 19f, 800)
        Txt("Your profile is currently under verification. One of our agents will review your information shortly.", 14f, 500, C.Muted)
        Btn("Got it", { vm.dialog = null }, Modifier.fillMaxWidth())
    }
    if (vm.dialog == Dialog.Approved) SheetOverlay(onDismiss = null) {
        Txt("Congratulations! \uD83C\uDF89", 21f, 800)
        Txt("Congratulations! Your profile has been approved. You can now proceed to the settlement process.", 14f, 500, C.Muted)
        Btn("Continue", vm::continueAfterApproval, Modifier.fillMaxWidth())
    }
    Column(Modifier.fillMaxSize().background(C.Bg).verticalScroll(rememberScrollState()).padding(start = 20.dp, end = 20.dp, bottom = 36.dp), horizontalAlignment = Alignment.CenterHorizontally) {
        Gap(90.dp)
        when (app?.status) {
            "REJECTED" -> {
                Chip("Not approved", C.Red, C.OrangeTint)
                Gap(14.dp)
                Txt("We could not approve your application", 22f, 800, align = TextAlign.Center)
                app.reviewNote?.let { Gap(10.dp); Card(Modifier.fillMaxWidth()) { Txt("Reason", 12f, 600, C.Muted); Txt(it, 14f, 500) } }
            }
            "CHANGES_REQUESTED" -> {
                Chip("Changes needed", C.OrangeIcon, C.OrangeTint)
                Gap(14.dp)
                Txt("Please update your application", 22f, 800, align = TextAlign.Center)
                app.reviewNote?.let { Gap(10.dp); Card(Modifier.fillMaxWidth()) { Txt("What we need", 12f, 600, C.Muted); Txt(it, 14f, 500) } }
                Gap(18.dp)
                Btn("Update my application", vm::openApplication, Modifier.fillMaxWidth())
            }
            else -> {
                Chip("Under review")
                Gap(14.dp)
                Txt("Thank you for signing up", 24f, 800, align = TextAlign.Center)
                Gap(8.dp)
                Txt("Our agents will review your application.", 15f, 600, align = TextAlign.Center)
                Gap(6.dp)
                val how = if (app?.contactPreference == "email") "by email at ${app.email}" else "on WhatsApp"
                Txt("We will send you a notification $how as soon as there is a decision. You can close the app and come back; we will keep your place.", 14f, 500, C.Muted, align = TextAlign.Center)
                Gap(18.dp)
                Btn("Check status", vm::refreshApplication, Modifier.fillMaxWidth())
            }
        }
        Gap(12.dp)
        Btn("Sign out", { vm.confirm("Sign out?", "You will need your phone number and a code to sign in again.", "Yes, sign out") { vm.logout() } }, Modifier.fillMaxWidth(), kind = BtnKind.Outline)
        Gap(24.dp)
    }
}

/** Settlement: where earnings are paid out, and a plain statement of how the vehicle is paid for. */
@Composable
fun SettlementScreen(vm: DriverViewModel) {
    Column(Modifier.fillMaxSize().background(C.Bg).imePadding()) {
        ScreenHeader("Settlement", "Set up how you get paid")
        Column(Modifier.weight(1f).verticalScroll(rememberScrollState()).padding(start = 20.dp, end = 20.dp, top = 8.dp, bottom = 36.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            if (vm.settlementVehicle.isNotBlank()) Card { Txt("YOUR VEHICLE", 11f, 500, C.Muted, letterSpacing = 1f); Gap(4.dp); Txt(vm.settlementVehicle, 15f, 700) }
            if (vm.settlementTerms.isNotBlank()) Card { Txt("VEHICLE PAYMENT", 11f, 500, C.Muted, letterSpacing = 1f); Gap(4.dp); Txt(vm.settlementTerms, 13.5f, 500) }
            Txt("PAYOUT ACCOUNT", 11f, 500, C.Muted, letterSpacing = 1f)
            InputField("Bank name", vm.bankName, { vm.bankName = it; vm.settleError = null }, "e.g. GTBank")
            InputField("Account number", vm.accountNumber, { vm.accountNumber = it.filter { c -> c.isDigit() }.take(10); vm.settleError = null }, "10 digits", KeyboardType.Number)
            InputField("Account name", vm.accountName, { vm.accountName = it.uppercase(); vm.settleError = null }, "Name on the account")
            Txt("Your earnings are paid to this account when you ask for a payout.", 12.5f, 500, C.Muted)
            vm.settleError?.let { Txt(it, 13f, 600, C.Red) }
        }
        Column(Modifier.padding(horizontal = 20.dp, vertical = 12.dp).navigationBarsPadding().padding(bottom = 12.dp)) {
            Btn(if (vm.settling) "Saving..." else "Finish", vm::finishSettlement, Modifier.fillMaxWidth(), enabled = !vm.settling)
        }
    }
}
