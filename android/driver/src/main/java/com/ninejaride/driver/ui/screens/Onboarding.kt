package com.ninejaride.driver.ui.screens

import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import com.ninejaride.core.format.naira
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.border
import androidx.compose.ui.draw.clip
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
    val pics = rememberPictureSource(vm)
    // the phone's Back button goes to the step before, like the arrow at the top, instead of leaving the application
    androidx.activity.compose.BackHandler(enabled = vm.dialog == null && !vm.applying) { vm.applyBack() }
    Column(Modifier.fillMaxSize().background(C.Bg).imePadding()) {
        ScreenHeader(heading(vm), if (vm.updateMode) "Update ${vm.applySteps.indexOf(step) + 1} of ${vm.applySteps.size}" else "Step ${step + 1} of 5", onBack = vm::applyBack)
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
                    InputField("NIN (National Identification Number)", vm.nin, edit { vm.nin = it.filter { c -> c.isDigit() }.take(11); vm.checkIdentifier("nin", "nin", vm.nin, vm.nin.length == 11) }, "11 digits", KeyboardType.Number,
                        helper = "We check this number for you. There is no card photo to upload.", error = vm.fieldErrors["nin"])
                    InputField("LASDRI number", vm.lassdri, edit { vm.lassdri = it.uppercase(); vm.checkIdentifier("lassdri", "lassdri", vm.lassdri, vm.lassdri.trim().length >= 4) }, "Your LASDRI card number", error = vm.fieldErrors["lassdri"])
                    InputField("Email address", vm.email, edit { vm.email = it.trim() }, "you@example.com", KeyboardType.Email)
                    DriverPhoto(vm, pics)
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
                    if (a?.code == "business_vehicle") {
                        Card { Txt("A business will give you a vehicle", 15f, 700); Gap(4.dp); Txt("Once you are approved, the business assigns a vehicle to you. It sets the share of your earnings that goes toward that vehicle, and you will see it before you start. You only need to be verified yourself; the business looks after the vehicle.", 13f, 500, C.Muted) }
                    }
                    if (a?.asksForVehicle == true) {
                        InputField("Plate number", vm.plate, edit { vm.plate = it; vm.fieldErrors.remove("plate") }, "ABC-123XY", plate = true, helper = "Three letters, three digits, two letters", error = vm.fieldErrors["plate"])
                        InputField("Model", vm.make, edit { vm.make = it }, "Toyota Corolla")
                        InputField("Colour", vm.colour, edit { vm.colour = it }, "Silver")
                        Txt(if (a.asksForOwner) "Owner: someone else, details below." else "Owner: you.", 12.5f, 600, C.Muted)
                    }
                    if (a?.asksForOwner == true) {
                        Txt("WHO OWNS THE CAR", 11f, 500, C.Muted, letterSpacing = 1f)
                        InputField("Owner name", vm.ownerName, edit { vm.ownerName = it }, "Full name of the owner")
                        InputField("Owner phone number", vm.ownerPhone, edit { vm.ownerPhone = it.filter { c -> c.isDigit() }.take(11) }, "0803 000 0010", KeyboardType.Phone, phone = true)
                        InputField("Share of your earnings toward the car (%)", vm.sharePercent, edit { vm.sharePercent = it.filter { c -> c.isDigit() || c == '.' }.take(5) }, "e.g. 20", KeyboardType.Decimal,
                            helper = "This share comes off each trip you earn and goes to the owner, like a regular repayment. You can change it later.")
                    }
                }
                else -> DocumentsStep(vm, pics)
            }
            vm.applyError?.let { Txt(it, 13f, 600, C.Red) }
        }
        Column(Modifier.padding(horizontal = 20.dp, vertical = 12.dp).navigationBarsPadding().padding(bottom = 12.dp)) {
            Btn(
                if (!vm.isLastApplyStep) "Continue" else if (vm.applying) "Sending..." else "Send application",
                vm::applyNext, Modifier.fillMaxWidth(), enabled = !vm.applying && vm.uploading == null && (step > 0 || vm.arrangements.isNotEmpty()),
            )
        }
    }
}

/** The two ways of getting a picture in: the camera, and the phone's gallery. Made once for the whole application. */
class PictureSource(val camera: (kind: String) -> Unit, val gallery: (kind: String) -> Unit)

/**
 * One camera and one gallery for the whole application, always present while the application is on screen, so a picture that
 * comes back after Android closed or recreated the app still finds its way (the document it is for is kept on the phone).
 */
@Composable
private fun rememberPictureSource(vm: DriverViewModel): PictureSource {
    val ctx = androidx.compose.ui.platform.LocalContext.current
    val camera = rememberLauncherForActivityResult(ActivityResultContracts.TakePicture()) { ok -> if (ok) vm.pictureArrived() else vm.pictureCancelled() }
    val gallery = rememberLauncherForActivityResult(ActivityResultContracts.GetContent()) { uri -> if (uri != null) vm.pictureArrived(uri) else vm.pictureCancelled() }
    return remember(camera, gallery) {
        PictureSource(
            camera = { kind ->
                val dir = java.io.File(ctx.cacheDir, "photos").apply { mkdirs() }
                val uri = androidx.core.content.FileProvider.getUriForFile(ctx, ctx.packageName + ".files", java.io.File(dir, "shot_${System.currentTimeMillis()}.jpg"))
                vm.expectPicture(kind, uri.toString())
                camera.launch(uri)
            },
            gallery = { kind -> vm.expectPicture(kind); gallery.launch("image/*") },
        )
    }
}

/** Documents that must be photographed on the spot: the driver's own face and the car. Everything else may also come from the gallery. */
private val CAMERA_ONLY = setOf("selfie", "vehicle_photo")

/** The driver's own photo, taken with the camera. Riders see it when the driver is on the way. */
@Composable
private fun DriverPhoto(vm: DriverViewModel, pics: PictureSource) {
    val takePhoto = { pics.camera("selfie") }
    val has = vm.uploads["selfie"] != null
    Txt("YOUR PHOTO", 11f, 500, C.Muted, letterSpacing = 1f)
    Card {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(14.dp)) {
            Box(Modifier.size(84.dp).clip(androidx.compose.foundation.shape.CircleShape).background(C.GreenTint).border(1.5.dp, if (has) C.GreenAccent else C.Border, androidx.compose.foundation.shape.CircleShape), contentAlignment = Alignment.Center) {
                val img = vm.photoPreview
                if (img != null) androidx.compose.foundation.Image(img, "Your photo", Modifier.fillMaxSize(), contentScale = androidx.compose.ui.layout.ContentScale.Crop)
                else com.ninejaride.core.ui.components.Icon24(com.ninejaride.core.ui.components.Ic.User, if (has) C.GreenAccent else C.Disabled, 38.dp)
            }
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                Txt(if (has) "Photo added" else "Add a clear photo of your face", 14.5f, 700)
                Txt("Face the camera in good light, with no sunglasses or hat. This is the photo riders and our team will see.", 12.5f, 500, C.Muted)
            }
        }
        Gap(10.dp)
        Btn(if (vm.uploading == "selfie") "Uploading..." else if (has) "Retake photo" else "Take photo", takePhoto, Modifier.fillMaxWidth(), enabled = vm.uploading == null, height = 46.dp, size = 14.5f)
    }
}

@Composable
private fun DocumentsStep(vm: DriverViewModel, pics: PictureSource) {
    Txt("Take a clear photo of each document, or choose one from your gallery. The photo of the car must be taken with the camera. Make sure the details can be read.", 13.5f, 500, C.Muted)
    fun clear(set: (String) -> Unit): (String) -> Unit = { set(it); vm.applyError = null }
    // when staff asked for specific documents, only those are shown
    vm.neededDocuments().filter { !vm.updateMode || it in vm.updateItems }.forEach { kind ->
        val done = vm.uploads[kind] != null
        Card {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Txt(documentLabel(kind), 15f, 700, modifier = Modifier.weight(1f))
                if (done) Chip("Uploaded")
            }
            Gap(8.dp)
            when (kind) {
                "drivers_licence" -> {
                    InputField("Licence number", vm.licenceNumber, clear { vm.licenceNumber = it.uppercase(); vm.checkIdentifier("licenceNumber", "drivers_licence", vm.licenceNumber, vm.licenceNumber.trim().length >= 4) }, "ABC12345AA01", error = vm.fieldErrors["licenceNumber"])
                    Gap(8.dp); DateField("Expiry date", vm.licenceExpiry, { vm.licenceExpiry = it; vm.applyError = null }, earliest = java.time.LocalDate.now().plusDays(1), opensAt = java.time.LocalDate.now().plusYears(1))
                }
                "lassdri" -> Txt("Both sides of your LASDRI card.", 12.5f, 500, C.Muted)
                "vehicle_photo" -> Txt("A clear photo of the car showing the plate number. It must be taken with the camera.", 12.5f, 500, C.Muted)
                "insurance" -> {
                    Txt("Required. A photo of your current motor insurance policy or certificate for this car (a JPEG, PNG or WebP photo, or a PDF, up to 8 MB). The expiry date must be in the future.", 12.5f, 500, C.Muted)
                    Gap(8.dp)
                    InputField("Policy number", vm.insuranceNumber, clear { vm.insuranceNumber = it }, "Policy number")
                    Gap(8.dp); DateField("Expiry date", vm.insuranceExpiry, { vm.insuranceExpiry = it; vm.applyError = null }, earliest = java.time.LocalDate.now().plusDays(1), opensAt = java.time.LocalDate.now().plusYears(1))
                }
            }
            Gap(10.dp)
            val busy = vm.uploading != null
            if (kind in CAMERA_ONLY) {
                Btn(if (vm.uploading == kind) "Uploading..." else if (done) "Retake photo" else "Take photo", { pics.camera(kind) }, Modifier.fillMaxWidth(),
                    kind = if (done) BtnKind.Outline else BtnKind.Primary, enabled = !busy, height = 46.dp, size = 14.5f)
            } else {
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Btn(if (vm.uploading == kind) "Uploading..." else if (done) "Retake" else "Take photo", { pics.camera(kind) }, Modifier.weight(1f),
                        kind = if (done) BtnKind.Outline else BtnKind.Primary, enabled = !busy, height = 46.dp, size = 14f)
                    Btn("From gallery", { pics.gallery(kind) }, Modifier.weight(1f), kind = BtnKind.Outline, enabled = !busy, height = 46.dp, size = 14f)
                }
            }
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
                if (app.changeItems.isNotEmpty()) {
                    Gap(12.dp)
                    Card(Modifier.fillMaxWidth()) {
                        val flagged = app.changeItems
                        val rows = buildList {
                            add("about_you" to "About you"); add("selfie" to "Driver photo"); add("next_of_kin" to "Next of kin"); add("vehicle" to "Vehicle details")
                            app.documents.filter { it.kind != "selfie" }.forEach { add(it.kind to documentLabel(it.kind)) }
                        }
                        rows.forEach { (k, label) ->
                            val bad = k in flagged
                            Row(Modifier.padding(vertical = 5.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                                Txt(if (bad) "Needs update" else "Looks good", 11.5f, 700, if (bad) C.OrangeIcon else C.GreenAccent)
                                Txt(label, 14f, if (bad) 700 else 500, modifier = Modifier.weight(1f))
                            }
                        }
                    }
                    Gap(6.dp)
                    Txt("Only the items marked \"Needs update\" have to be changed. Everything else stays as you entered it.", 12.5f, 500, C.Muted, align = TextAlign.Center)
                }
                Gap(14.dp)
                Btn(if (app.changeItems.isNotEmpty()) "Update now" else "Update my application", vm::openApplication, Modifier.fillMaxWidth())
            }
            "APPROVED" -> {
                Chip("Approved")
                Gap(14.dp)
                Txt("Congratulations! \uD83C\uDF89", 24f, 800, align = TextAlign.Center)
                Gap(8.dp)
                Txt("Your profile has been approved. You can now proceed to the next step.", 15f, 600, align = TextAlign.Center)
                Gap(18.dp)
                Btn("Continue", vm::continueAfterApproval, Modifier.fillMaxWidth())
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
                Btn("Check status", vm::checkStatus, Modifier.fillMaxWidth())
            }
        }
        Gap(12.dp)
        Btn("Sign out", { vm.confirm("Sign out?", "You will need your phone number and a code to sign in again.", "Yes, sign out") { vm.logout() } }, Modifier.fillMaxWidth(), kind = BtnKind.Outline)
        Gap(24.dp)
    }
    // The pop-ups come last so they are drawn over the page (drawn first, the full-screen page hid them).
    if (vm.dialog == Dialog.Verifying) SheetOverlay(onDismiss = null) {
        Txt("Profile Under Verification", 19f, 800)
        Txt("Your profile is still under verification. One of our agents will review your information soon.", 14f, 500, C.Muted)
        Btn("Got it", { vm.dialog = null }, Modifier.fillMaxWidth())
    }
    if (vm.dialog == Dialog.Approved) SheetOverlay(onDismiss = null) {
        Txt("Congratulations! \uD83C\uDF89", 21f, 800)
        Txt("Your profile has been approved. You can now proceed to the next step.", 14f, 500, C.Muted)
        Btn("Continue", vm::continueAfterApproval, Modifier.fillMaxWidth())
    }
}

/**
 * Vehicle Payment & Earnings Agreement. It appears only when there is an arrangement to agree to: a car owned by someone
 * else (the driver may choose the share) or a business's vehicle (the business decided it; the driver can only accept).
 */
@Composable
fun SettlementScreen(vm: DriverViewModel) {
    val a = vm.agreement
    val owner = a?.ownerName?.ifBlank { null } ?: if (a?.kind == "business") "the business" else "the owner"
    val (cut, keep) = vm.agreementExample()
    Column(Modifier.fillMaxSize().background(C.Bg).imePadding()) {
        ScreenHeader("Vehicle Payment & Earnings Agreement", "Please read this, then accept to start driving")
        Column(Modifier.weight(1f).verticalScroll(rememberScrollState()).padding(start = 20.dp, end = 20.dp, top = 8.dp, bottom = 36.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            if (a == null) Txt("We could not load your arrangement. Check your connection and go back.", 13.5f, 600, C.Red)
            else {
                Card { Txt("YOUR VEHICLE", 11f, 500, C.Muted, letterSpacing = 1f); Gap(4.dp); Txt(a.vehicle.ifBlank { "Not assigned yet" }, 15f, 700) }
                Card {
                    Txt(if (a.kind == "business") "THE BUSINESS" else "THE OWNER", 11f, 500, C.Muted, letterSpacing = 1f); Gap(4.dp)
                    Txt(owner.replaceFirstChar { it.uppercase() }, 15f, 700)
                    if (a.ownerPhone.isNotBlank()) Txt(a.ownerPhone, 13f, 500, C.Muted)
                }
                Card {
                    Txt("THE ARRANGEMENT", 11f, 500, C.Muted, letterSpacing = 1f); Gap(4.dp)
                    Txt(
                        if (a.kind == "business") "$owner owns this vehicle and gives it to you to drive. A share of what you earn on every trip goes to $owner toward it."
                        else "This car belongs to $owner. A share of what you earn on every trip goes to them toward it.", 13.5f, 500,
                    )
                    a.targetKobo?.let { Gap(6.dp); Txt("Payments stop once ${naira(it)} has been paid.", 13f, 600, C.Muted) }
                }
                if (a.canChange) {
                    InputField("Your share of each trip's earnings (%)", vm.agreementShare, { vm.agreementShare = it.filter { c -> c.isDigit() || c == '.' }.take(5); vm.settleError = null }, "1 to 90", KeyboardType.Decimal,
                        helper = "You choose this. You can change it later from the Vehicle page; the change applies from your next trip.")
                } else {
                    Card {
                        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            Txt("Share of your earnings", 13.5f, 600, modifier = Modifier.weight(1f))
                            Txt("${vm.agreementShare}%", 18f, 800)
                        }
                        Gap(4.dp)
                        Txt("Set by $owner. You cannot change it here; ask them if it needs to change.", 12.5f, 500, C.Muted)
                    }
                }
                Card {
                    Txt("WHAT THIS MEANS", 11f, 500, C.Muted, letterSpacing = 1f); Gap(4.dp)
                    Txt("For every ${naira(1_000_000)} you earn:", 13.5f, 600)
                    Gap(4.dp)
                    Row { Txt("Goes to $owner", 13.5f, 500, C.Muted, Modifier.weight(1f)); Txt(naira(cut), 14f, 700, C.RedText) }
                    Row { Txt("You keep", 13.5f, 500, C.Muted, Modifier.weight(1f)); Txt(naira(keep), 14f, 800) }
                    Gap(6.dp)
                    Txt("This is taken from your earnings on each trip, automatically. You will see it on every receipt.", 12.5f, 500, C.Muted)
                }
                Row(
                    Modifier.fillMaxWidth().clip(RoundedCornerShape(14.dp)).background(if (vm.agreementTicked) C.GreenTint else C.Surface)
                        .border(1.5.dp, if (vm.agreementTicked) C.GreenAccent else C.Border, RoundedCornerShape(14.dp)).tap({ vm.agreementTicked = !vm.agreementTicked; vm.settleError = null }, "I agree").padding(14.dp),
                    horizontalArrangement = Arrangement.spacedBy(12.dp), verticalAlignment = Alignment.CenterVertically,
                ) {
                    Box(Modifier.size(22.dp).clip(RoundedCornerShape(6.dp)).background(if (vm.agreementTicked) C.GreenAccent else C.Raised).border(1.5.dp, if (vm.agreementTicked) C.GreenAccent else C.Border, RoundedCornerShape(6.dp)), contentAlignment = Alignment.Center) {
                        if (vm.agreementTicked) Txt("\u2713", 14f, 800, androidx.compose.ui.graphics.Color.White)
                    }
                    Txt("I have read this and I agree to the arrangement above.", 13.5f, 600, modifier = Modifier.weight(1f))
                }
                vm.settleError?.let { Txt(it, 13f, 600, C.Red) }
            }
        }
        Column(Modifier.padding(horizontal = 20.dp, vertical = 12.dp).navigationBarsPadding().padding(bottom = 12.dp)) {
            Btn(if (vm.settling) "Saving..." else "Accept and continue", vm::finishSettlement, Modifier.fillMaxWidth(), enabled = !vm.settling && a != null)
        }
    }
}
