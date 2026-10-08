package com.ninejaride.driver.state

import com.ninejaride.core.data.chatPage
import com.ninejaride.core.data.chatRead
import com.ninejaride.core.data.chatSend
import androidx.compose.ui.graphics.asImageBitmap
import com.ninejaride.core.format.Kobo
import com.ninejaride.core.format.naira
import android.Manifest
import android.app.Application
import android.content.pm.PackageManager
import android.location.Location
import android.location.LocationListener
import android.location.LocationManager
import android.os.Bundle
import android.os.Looper
import androidx.core.content.ContextCompat
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import com.ninejaride.driver.BuildConfig
import com.ninejaride.driver.data.Api
import com.ninejaride.core.data.ApiException
import androidx.compose.ui.graphics.asImageBitmap
import com.ninejaride.core.format.properName
import com.ninejaride.driver.data.ApplicationForm
import com.ninejaride.driver.data.Arrangement
import com.ninejaride.driver.data.ServerDoc
import com.ninejaride.driver.data.ServerSettlement
import com.ninejaride.driver.data.BatteryGuidance
import com.ninejaride.driver.data.ServerApplication
import com.ninejaride.driver.data.BatteryTip
import com.ninejaride.driver.location.LocationService
import com.ninejaride.driver.location.LocationStatus
import android.os.PowerManager
import com.ninejaride.core.data.MapPoint
import com.ninejaride.core.data.Routing
import com.ninejaride.core.ui.components.Tab
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

sealed interface Dest {
    data object Splash : Dest
    data object SignIn : Dest
    data object SignUp : Dest
    data object Apply : Dest
    data object ApplicationStatus : Dest
    data object Settlement : Dest
    data object Otp : Dest
    data object LocationPermission : Dest
    data object Main : Dest
    data object Inbox : Dest
    data object GoOnlineChecks : Dest
    data object DailyEarnings : Dest
    data object Payout : Dest
    data object BankAccountForm : Dest
    data object Transactions : Dest
    data object FundWallet : Dest
    data object PersonalDetails : Dest
    data object VehicleDetails : Dest
    data object Bonus : Dest
    data object Help : Dest
    data object DeleteAccount : Dest
    data object UpdateRequired : Dest
    data class TripDetails(val code: String) : Dest
}

enum class Dialog { Verifying, Approved, OtpMethod, SignedIn, GoOnline, GoOffline, Sos, Logout, DateFilter, NotRegistered, LocationDenied, Battery }

/** The sheet that asks "are you sure?" before an action runs. */
enum class Phase { None, Offer, ToPickup, Waiting, InTrip, Collect, Rate, SosSent }

val STOP_REASONS = listOf("Traffic", "Vehicle issue", "Rider request", "Security concern")

/**
 * Everything the screens show, and everything they can do.
 *
 * With DEMO_MODE the whole app runs on the design's sample data and a scripted ride, so every screen can be seen and
 * clicked through with no server. With DEMO_MODE off, sign-in and the app-config check go to the real backend; the
 * rest is still sample data until the matching server endpoints exist (see the README).
 */
class DriverViewModel(app: Application) : AndroidViewModel(app) {
    private val api = Api(app)
    val demo = BuildConfig.DEMO_MODE

    // ------------------------------------------------------------------ navigation
    val stack = mutableStateListOf<Dest>(Dest.Splash)
    var tab by mutableStateOf(Tab.Home)
    var dialog by mutableStateOf<Dialog?>(null)
    val current: Dest get() = stack.last()

    fun push(d: Dest) { stack.add(d) }
    fun pop() { if (stack.size > 1) stack.removeAt(stack.lastIndex) }
    fun reset(d: Dest) { stack.clear(); stack.add(d) }

    // ------------------------------------------------------------------ sign-in
    var phoneDigits by mutableStateOf("")
    var voiceCode by mutableStateOf(false)
    var otp by mutableStateOf("")
    /** How many digits the code has, and whether the server is using its fixed test code. Both come from the server with each request. */
    var otpLength by mutableIntStateOf(6)
    var otpTestMode by mutableStateOf(false)
    var fullName by mutableStateOf("")
    private var ticket: String? = null
    var resendSeconds by mutableIntStateOf(170)
    var busy by mutableStateOf(false)
    var message by mutableStateOf<String?>(null)
    var updateUrl by mutableStateOf<String?>(null)
    /** Battery-saver steps shown the first time the driver goes online. From the server when reachable, else built in. */
    var batteryTips by mutableStateOf<List<BatteryTip>>(BatteryGuidance.DEFAULTS)

    val phoneValid get() = phoneDigits.length == 11 && phoneDigits.startsWith("0")
    val maskedPhone get() = if (phoneDigits.length == 11) phoneDigits.take(3) + " *** " + phoneDigits.takeLast(4) else phoneDigits

    fun onPhoneChange(v: String) { phoneDigits = v.filter { it.isDigit() }.take(11); message = null }

    fun startSignIn() {
        if (!phoneValid) { message = "Enter your 11-digit mobile number."; return }
        dialog = Dialog.OtpMethod
    }

    /** Sign-up asks for a name first; the code and the rest follow the same path as signing in. */
    fun startSignUp() {
        if (fullName.trim().length < 2) { message = "Enter your full name."; return }
        startSignIn()
    }

    private var resendJob: Job? = null

    fun sendCode() {
        dialog = null
        message = null
        viewModelScope.launch {
            busy = true
            try {
                if (!demo) api.requestOtp(intlPhone(), voiceCode).let { otpLength = it.codeLength; otpTestMode = it.testMode }
                otp = ""
                resendSeconds = 170
                push(Dest.Otp)
                resendJob?.cancel()
                resendJob = launch { while (resendSeconds > 0) { delay(1000); resendSeconds-- } }
            } catch (e: ApiException) {
                message = e.message
            } finally { busy = false }
        }
    }

    fun resend() { if (resendSeconds == 0) sendCode() }

    fun onOtpChange(v: String) {
        otp = v.filter { it.isDigit() }.take(otpLength); message = null
        if (otp.length == otpLength && !busy) verify() // no button to press once the code is complete
    }

    fun verify() {
        if (otp.length != otpLength) return
        viewModelScope.launch {
            busy = true
            message = null
            try {
                if (!demo) api.verifyOtp(intlPhone(), otp)
                signedIn()
            } catch (e: ApiException) {
                val t = e.ticket
                if (e.code == "registration_required" && t != null) {
                    // right code, new number: make the account, using the name given at sign-up
                    ticket = t
                    if (fullName.trim().length >= 2) completeRegistration() else { message = "Welcome! Tell us your name to finish."; reset(Dest.SignUp) }
                } else if (e.code == "not_a_driver") dialog = Dialog.NotRegistered
                else message = e.message
            } finally { busy = false }
        }
    }

    fun completeRegistration() {
        val t = ticket ?: return
        if (fullName.trim().length < 2) { message = "Enter your full name."; return }
        viewModelScope.launch {
            busy = true
            try {
                api.register(t, fullName.trim())
                ticket = null
                signedIn()
            } catch (e: ApiException) { message = e.message } finally { busy = false }
        }
    }

    /** Shown at the top of whatever comes next, with no button to press. */
    var toast by mutableStateOf<Pair<String, String>?>(null)
    /** True for a notice about something that went wrong: it gets a warning icon, not a tick. */
    var toastWarn by mutableStateOf(false)

    private fun signedIn() {
        toastWarn = false; toast = "Sign in successful" to "You have signed in to your account."
        finishSignIn()
    }

    /** A driver goes on to the app once approved; a new or unfinished one goes to onboarding first. */
    fun finishSignIn() {
        dialog = null
        if (demo) { reset(Dest.LocationPermission); return }
        viewModelScope.launch { routeByApplication(reset = Dest.LocationPermission) }
    }

    fun locationDone() {
        reset(Dest.Main)
        tab = Tab.Home
    }

    private fun intlPhone() = "+234" + phoneDigits.drop(1)

    // ------------------------------------------------------------------ onboarding
    var application by mutableStateOf<ServerApplication?>(null)
    val arrangements = mutableStateListOf<Arrangement>()
    var applyStep by mutableIntStateOf(0)
    var applying by mutableStateOf(false)
    var applyError by mutableStateOf<String?>(null)
    var arrangementCode by mutableStateOf("")

    // personal information
    var email by mutableStateOf("")
    var contactPreference by mutableStateOf("whatsapp")
    var dateOfBirth by mutableStateOf("")
    var nin by mutableStateOf("")
    var lassdri by mutableStateOf("")
    var address by mutableStateOf("")
    var kinName by mutableStateOf("")
    var kinPhone by mutableStateOf("")
    var kinRelationship by mutableStateOf("")
    var kinAddress by mutableStateOf("")

    // vehicle
    var vehicleCategory by mutableStateOf("regular")
    var plate by mutableStateOf("")
    var make by mutableStateOf("")
    var colour by mutableStateOf("")
    var ownerName by mutableStateOf("")
    var ownerPhone by mutableStateOf("")
    /** For someone else's car: the share of earnings (in percent) that goes toward it. */
    var sharePercent by mutableStateOf("20")

    // documents: the numbers and dates typed in, and the id of the photo uploaded for each
    var licenceNumber by mutableStateOf("")
    var licenceExpiry by mutableStateOf("")
    val uploads = androidx.compose.runtime.mutableStateMapOf<String, String>() // document kind -> uploaded file id
    var uploading by mutableStateOf<String?>(null)
    /** The driver's photo as picked, shown on the "About you" step. */
    var photoPreview by mutableStateOf<androidx.compose.ui.graphics.ImageBitmap?>(null)

    val chosen: Arrangement? get() = arrangements.firstOrNull { it.code == arrangementCode }

    /** The documents asked for on the last step, in order. The driver's own photo is asked for on the "About you" step. */
    fun neededDocuments(): List<String> {
        val a = chosen ?: return emptyList()
        return buildList {
            add("drivers_licence"); add("lassdri") // the NIN is checked by a service, so no photo of it is asked for
            if (a.asksForVehicle) { add("vehicle_photo") }
        }
    }

    /** Decides where a signed-in driver goes: straight in once approved, otherwise to the application. Returns false if the server could not be asked. */
    private suspend fun routeByApplication(reset: Dest): Boolean {
        val app = try { api.application() } catch (e: ApiException) { if (e.isNetwork) return false else null }
        application = app
        when {
            app == null -> openApplication()
            // approved: the settlement step comes first (once); a driver who finished it goes straight in
            app.status == "APPROVED" -> if (settlementDone()) { loadAccount(); reset(reset) } else { reset(Dest.ApplicationStatus); dialog = Dialog.Approved }
            else -> reset(Dest.ApplicationStatus)
        }
        return true
    }

    /** Opens the form from the first step, filled in with what was sent before when staff asked for changes. */
    /** When staff named what to fix, the driver sees only those steps; everything else stays as entered. */
    val updateItems: List<String> get() = application?.takeIf { it.status == "CHANGES_REQUESTED" }?.changeItems.orEmpty()
    val updateMode: Boolean get() = updateItems.isNotEmpty()
    /** Documents (and the photo) replaced during this update. A flagged one must be replaced, not sent again. */
    val replaced = mutableStateListOf<String>()

    private fun stepOf(item: String) = when (item) { "about_you", "selfie" -> 1; "next_of_kin" -> 2; "vehicle" -> 3; else -> 4 }
    /** The steps to go through: all five, or only the ones staff flagged. */
    val applySteps: List<Int> get() = if (updateMode) updateItems.map(::stepOf).distinct().sorted() else listOf(0, 1, 2, 3, 4)
    val isLastApplyStep: Boolean get() = applyStep == applySteps.last()

    // ---- the application in progress is kept on the phone, so closing the app (or the camera app taking over) loses nothing
    private val draftPrefs get() = getApplication<Application>().getSharedPreferences("application_draft", android.content.Context.MODE_PRIVATE)
    private var draftWatch: Job? = null

    /** The fields of the form, in one place, as the draft stores them. */
    private fun draftFields() = mapOf(
        "arrangement" to arrangementCode, "category" to vehicleCategory, "email" to email, "contact" to contactPreference, "dob" to dateOfBirth,
        "nin" to nin, "lassdri" to lassdri, "address" to address, "kinName" to kinName, "kinPhone" to kinPhone, "kinRel" to kinRelationship,
        "kinAddress" to kinAddress, "plate" to plate, "make" to make, "colour" to colour, "ownerName" to ownerName, "ownerPhone" to ownerPhone,
        "share" to sharePercent, "licence" to licenceNumber, "licenceExp" to licenceExpiry, 
        "step" to applyStep.toString(), "uploads" to uploads.entries.joinToString(",") { it.key + "=" + it.value },
    )

    private fun saveDraft() {
        if (application != null && application?.status != "REJECTED") return // a sent application is on the server
        draftPrefs.edit().apply { draftFields().forEach { (k, v) -> putString(k, v) }; putString("phone", phoneDigits) }.apply()
    }

    private fun loadDraft(): Boolean {
        val p = draftPrefs
        if (p.getString("phone", null) != phoneDigits.ifEmpty { p.getString("phone", "") }) return false // another person's draft
        if (!p.contains("arrangement")) return false
        fun g(k: String) = p.getString(k, "") ?: ""
        arrangementCode = g("arrangement"); vehicleCategory = g("category").ifEmpty { "regular" }; email = g("email"); contactPreference = g("contact").ifEmpty { "whatsapp" }
        dateOfBirth = g("dob"); nin = g("nin"); lassdri = g("lassdri"); address = g("address"); kinName = g("kinName"); kinPhone = g("kinPhone")
        kinRelationship = g("kinRel"); kinAddress = g("kinAddress"); plate = g("plate"); make = g("make"); colour = g("colour"); ownerName = g("ownerName")
        ownerPhone = g("ownerPhone"); sharePercent = g("share").ifEmpty { "20" }; licenceNumber = g("licence"); licenceExpiry = g("licenceExp")
        uploads.clear(); g("uploads").split(",").filter { it.contains("=") }.forEach { uploads[it.substringBefore("=")] = it.substringAfter("=") }
        applyStep = g("step").toIntOrNull() ?: 0
        return true
    }

    fun clearDraft() { draftPrefs.edit().clear().apply() }

    /** Saves the form half a second after anything in it changes. */
    private fun watchDraft() {
        if (draftWatch?.isActive == true) return
        draftWatch = viewModelScope.launch {
            androidx.compose.runtime.snapshotFlow { draftFields() }.collect { delay(500); saveDraft() }
        }
    }

    fun openApplication() {
        applyError = null; replaced.clear()
        val restored = application == null && loadDraft()
        application?.let { prefill(it) }
        if (!restored) applyStep = if (updateMode) applySteps.first() else 0
        watchDraft()
        viewModelScope.launch {
            if (arrangements.isEmpty()) runCatching { api.arrangements() }.getOrNull()?.let { arrangements.addAll(it) }
            if (arrangementCode.isEmpty()) arrangementCode = arrangements.firstOrNull()?.code ?: "own"
            if (arrangementCode !in arrangements.map { it.code } && arrangements.isNotEmpty()) arrangementCode = arrangements.first().code
            reset(Dest.Apply)
        }
    }

    private fun prefill(a: ServerApplication) {
        arrangementCode = a.arrangement; vehicleCategory = a.category.takeIf { it == "regular" || it == "comfort" } ?: "regular"
        email = a.email; contactPreference = a.contactPreference; nin = a.nin; lassdri = a.lassdri; address = a.address
        dateOfBirth = a.dateOfBirth.takeIf { it.length == 10 }?.let { "${it.substring(8, 10)}/${it.substring(5, 7)}/${it.substring(0, 4)}" } ?: ""
        kinName = a.kinName; kinPhone = a.kinPhone.replace("+234", "0"); kinRelationship = a.kinRelationship; kinAddress = a.kinAddress
        plate = a.plate; make = a.make; colour = a.colour; ownerName = a.ownerName; ownerPhone = a.ownerPhone.replace("+234", "0")
        if (a.deductionBps > 0) sharePercent = (a.deductionBps / 100.0).let { if (it % 1.0 == 0.0) it.toInt().toString() else it.toString() }
        uploads.clear()
        a.documents.forEach { d ->
            d.fileId?.let { uploads[d.kind] = it }
            fun show(iso: String?) = iso?.takeIf { it.length == 10 }?.let { "${it.substring(8, 10)}/${it.substring(5, 7)}/${it.substring(0, 4)}" } ?: ""
            when (d.kind) {
                "drivers_licence" -> { licenceNumber = d.number ?: ""; licenceExpiry = show(d.expiresOn) }
            }
        }
    }

    /** Asks the server where the application stands. Approval shows the congratulations box; it never moves on by itself. */
    fun refreshApplication() {
        viewModelScope.launch {
            val app = runCatching { api.application() }.getOrNull() ?: return@launch
            application = app
            if (app.status == "APPROVED" && dialog != Dialog.Approved) dialog = Dialog.Approved
        }
    }

    /** The "Check status" button: asks the server and says where the application stands. */
    fun checkStatus() {
        viewModelScope.launch {
            val app = runCatching { api.application() }.getOrNull()
            if (app == null) { say("No connection", "We could not check your status. Please try again."); return@launch }
            application = app
            when (app.status) {
                "SUBMITTED" -> dialog = Dialog.Verifying
                "APPROVED" -> dialog = Dialog.Approved
            }
        }
    }

    private suspend fun settlementDone(): Boolean = runCatching { api.settlement().done }.getOrDefault(false)

    /**
     * "Continue" in the congratulations box. A driver with their own vehicle goes straight on; one with someone else's car, or
     * a business's vehicle that has been assigned, first sees the vehicle payment and earnings agreement.
     */
    fun continueAfterApproval() {
        dialog = null
        viewModelScope.launch {
            val s = runCatching { api.settlement() }.getOrNull()
            when {
                s == null -> openSettlement()
                s.done && !s.needsAgreement -> { loadAccount(); reset(Dest.LocationPermission) }
                s.needsAgreement -> openSettlement()
                else -> { // nothing to agree to (own vehicle, or a business has not given a vehicle yet): finish the step and go on
                    runCatching { api.completeSettlement() }
                    loadAccount(); reset(Dest.LocationPermission)
                }
            }
        }
    }

    // ---- the vehicle payment and earnings agreement
    var agreement by mutableStateOf<ServerSettlement?>(null)
    var agreementShare by mutableStateOf("")
    var agreementTicked by mutableStateOf(false)
    var settling by mutableStateOf(false)
    var settleError by mutableStateOf<String?>(null)

    /** Opens the agreement for the vehicle the driver has. Used after approval, and later when a business gives them a vehicle. */
    fun openAgreement() { viewModelScope.launch { openSettlement() } }

    private suspend fun openSettlement() {
        val s = runCatching { api.settlement() }.getOrNull()
        agreement = s
        agreementShare = s?.percent?.let { if (it % 1.0 == 0.0) it.toInt().toString() else it.toString() } ?: ""
        agreementTicked = false
        settleError = null
        reset(Dest.Settlement)
    }

    /** What the share comes to on a round sum, so the driver can see it in naira before agreeing. */
    fun agreementExample(forEarned: Long = 1_000_000): Pair<Long, Long> {
        val pct = agreementShare.toDoubleOrNull() ?: agreement?.percent ?: 0.0
        val cut = Math.floor(forEarned * pct / 100.0).toLong()
        return cut to (forEarned - cut)
    }

    fun finishSettlement() {
        val a = agreement
        val pct = agreementShare.toDoubleOrNull()
        if (a != null && a.canChange && (pct == null || pct < 1.0 || pct > 90.0)) { settleError = "Choose a share between 1% and 90%."; return }
        if (!agreementTicked) { settleError = "Tick the box to say you agree."; return }
        viewModelScope.launch {
            settling = true; settleError = null
            try {
                api.acceptAgreement(if (a?.canChange == true && pct != null) Math.round(pct * 100).toInt() else null)
                api.completeSettlement()
                toastWarn = false; toast = "Agreement accepted" to "You are ready to go online."
                loadAccount()
                reset(Dest.LocationPermission)
            } catch (e: ApiException) { settleError = if (e.status >= 500) "We could not save that. Please try again." else e.message } finally { settling = false }
        }
    }


    private fun dateOrNull(text: String, future: Boolean = true): String? {
        val m = Regex("^([0-9]{1,2})[/.-]([0-9]{1,2})[/.-]([0-9]{4})$").matchEntire(text.trim()) ?: return null
        val d = runCatching { java.time.LocalDate.of(m.groupValues[3].toInt(), m.groupValues[2].toInt(), m.groupValues[1].toInt()) }.getOrNull() ?: return null
        return d.takeIf { if (future) it.isAfter(java.time.LocalDate.now()) else it.isBefore(java.time.LocalDate.now().minusYears(18).plusDays(1)) }?.toString()
    }

    private val emailOk get() = Regex("^[^\\s@]+@[^\\s@]+\\.[^\\s@]{2,}$").matches(email.trim())
    private fun phoneOk(v: String) = v.filter { it.isDigit() }.length == 11

    /** What is wrong with the current step, in words, or null when it can go on. Steps: 0 how, 1 you, 2 next of kin, 3 vehicle, 4 documents. */
    fun applyProblem(): String? {
        val a = chosen ?: return "Choose how you will drive with us."
        return when (applyStep) {
            0 -> null
            1 -> when {
                updateMode && "selfie" in updateItems && "selfie" !in replaced -> "Take a new photo of yourself. Our team asked for it to be replaced."
                dateOrNull(dateOfBirth, future = false) == null -> "Choose your date of birth. You must be at least 18."
                address.trim().length < 5 -> "Enter your home address."
                nin.filter { it.isDigit() }.length != 11 -> "Your NIN is 11 digits."
                lassdri.trim().length < 4 -> "Enter your LASSDRI number."
                !emailOk -> "Enter a valid email address."
                uploads["selfie"] == null -> "Add your photo. Riders and our team need to recognise you."
                else -> null
            }
            2 -> when {
                kinName.trim().length < 2 -> "Enter your next of kin's full name."
                !phoneOk(kinPhone) -> "Enter your next of kin's 11-digit phone number."
                kinAddress.trim().length < 5 -> "Enter your next of kin's address."
                else -> null
            }
            3 -> when {
                a.asksForVehicle && plate.trim().length < 5 -> "Enter the number plate."
                a.asksForVehicle && (make.trim().length < 2 || colour.trim().length < 2) -> "Enter the model and colour of the vehicle."
                a.asksForOwner && ownerName.trim().length < 2 -> "Enter the name of the person who owns the car."
                a.asksForOwner && !phoneOk(ownerPhone) -> "Enter the owner's 11-digit phone number."
                a.asksForOwner && (sharePercent.toDoubleOrNull() ?: 0.0) !in 1.0..90.0 -> "Choose what share of your earnings goes toward the car, between 1% and 90%."
                else -> null
            }
            else -> when {
                licenceNumber.trim().length < 4 -> "Enter your driver's licence number."
                dateOrNull(licenceExpiry) == null -> "Choose when your licence expires. It must be in the future."
                updateMode && updateItems.any { it !in setOf("about_you", "next_of_kin", "vehicle", "selfie") && it !in replaced } -> "Take a new photo of: " + updateItems.filter { it !in setOf("about_you", "next_of_kin", "vehicle", "selfie") && it !in replaced }.joinToString(", ") { documentLabel(it) } + "."
                neededDocuments().any { uploads[it] == null } -> "Upload a photo for: " + neededDocuments().filter { uploads[it] == null }.joinToString(", ") { documentLabel(it) } + "."
                else -> null
            }
        }
    }

    fun applyNext() {
        applyProblem()?.let { applyError = it; return }
        applyError = null
        if (isLastApplyStep) submitApplication() else applyStep = applySteps.first { it > applyStep }
    }

    fun applyBack() {
        applyError = null
        val before = applySteps.lastOrNull { it < applyStep }
        if (before != null) applyStep = before else if (application != null) reset(Dest.ApplicationStatus) else pop()
    }

    // ---- a picture on its way back from the camera or the gallery
    /**
     * Writes down, on the phone itself, which document the next picture is for (and where the camera saves it). The camera app can
     * need so much memory that Android closes or recreates this app while it is open; the picture then comes back to a fresh copy
     * that would otherwise not know what it was for, and the driver would be left at the start with nothing uploaded.
     */
    fun expectPicture(kind: String, cameraFile: String? = null) {
        draftPrefs.edit().putString("shot_kind", kind).putString("shot_uri", cameraFile).apply()
    }

    /** The camera or the gallery has answered. [galleryUri] is set when it was the gallery. */
    fun pictureArrived(galleryUri: android.net.Uri? = null) {
        val kind = draftPrefs.getString("shot_kind", null) ?: return
        val uri = galleryUri ?: draftPrefs.getString("shot_uri", null)?.let { android.net.Uri.parse(it) } ?: return
        draftPrefs.edit().remove("shot_kind").remove("shot_uri").apply()
        uploadDocument(kind, uri)
    }

    /** The driver backed out of the camera or gallery without a picture. */
    fun pictureCancelled() { draftPrefs.edit().remove("shot_kind").remove("shot_uri").apply() }

    /** Reads the picked photo, shrinks it so it uploads quickly on mobile data, and sends it. */
    fun uploadDocument(kind: String, uri: android.net.Uri) {
        viewModelScope.launch {
            uploading = kind; applyError = null
            try {
                val bytes = kotlinx.coroutines.withContext(kotlinx.coroutines.Dispatchers.IO) { shrinkedJpeg(uri) } ?: throw ApiException(0, null, "That photo could not be read. Try another.")
                uploads[kind] = api.uploadFile(bytes, "$kind.jpg", "image/jpeg")
                if (kind !in replaced) replaced.add(kind)
                if (kind == "selfie") photoPreview = android.graphics.BitmapFactory.decodeByteArray(bytes, 0, bytes.size, android.graphics.BitmapFactory.Options().apply { inSampleSize = 4 })?.asImageBitmap()
            } catch (e: kotlinx.coroutines.CancellationException) { throw e
            } catch (e: ApiException) { applyError = if (e.status >= 500) "The upload did not work. Please try again." else e.message
            } catch (e: Throwable) { applyError = "That photo could not be used. Please take or choose it again." // a huge picture or a file that cannot be read must never close the app
            } finally { uploading = null }
        }
    }

    /** The picture as a JPEG small enough to send on mobile data, turned the right way up. Tries a smaller size if memory runs short. */
    private fun shrinkedJpeg(uri: android.net.Uri): ByteArray? {
        val cr = getApplication<Application>().contentResolver
        val bounds = android.graphics.BitmapFactory.Options().apply { inJustDecodeBounds = true }
        cr.openInputStream(uri)?.use { android.graphics.BitmapFactory.decodeStream(it, null, bounds) }
        if (bounds.outWidth <= 0) return null
        var sample = 1
        while (maxOf(bounds.outWidth, bounds.outHeight) / sample > 2000) sample *= 2
        var bmp: android.graphics.Bitmap? = null
        for (attempt in 0..2) {
            try {
                bmp = cr.openInputStream(uri)?.use { android.graphics.BitmapFactory.decodeStream(it, null, android.graphics.BitmapFactory.Options().apply { inSampleSize = sample }) }
                break
            } catch (e: OutOfMemoryError) { sample *= 2 }
        }
        var pic = bmp ?: return null
        val turn = cr.openInputStream(uri)?.use { s ->
            runCatching {
                when (android.media.ExifInterface(s).getAttributeInt(android.media.ExifInterface.TAG_ORIENTATION, android.media.ExifInterface.ORIENTATION_NORMAL)) {
                    android.media.ExifInterface.ORIENTATION_ROTATE_90 -> 90f
                    android.media.ExifInterface.ORIENTATION_ROTATE_180 -> 180f
                    android.media.ExifInterface.ORIENTATION_ROTATE_270 -> 270f
                    else -> 0f
                }
            }.getOrDefault(0f)
        } ?: 0f
        if (turn != 0f) pic = runCatching { android.graphics.Bitmap.createBitmap(pic, 0, 0, pic.width, pic.height, android.graphics.Matrix().apply { postRotate(turn) }, true) }.getOrDefault(pic)
        val out = java.io.ByteArrayOutputStream()
        pic.compress(android.graphics.Bitmap.CompressFormat.JPEG, 82, out)
        return out.toByteArray()
    }

    private fun submitApplication() {
        val a = chosen ?: return
        fun doc(kind: String, number: String? = null, expires: String? = null) = ServerDoc(kind, number?.trim()?.takeIf { it.isNotEmpty() }, uploads[kind], expires?.let { dateOrNull(it) })
        val docs = (listOf("selfie") + neededDocuments()).map {
            when (it) {
                "drivers_licence" -> doc(it, licenceNumber, licenceExpiry)
                else -> doc(it)
            }
        }
        val form = ApplicationForm(
            a.code, vehicleCategory, if (a.asksForVehicle) plate.trim().uppercase() else "", make.trim(), colour.trim(),
            if (a.asksForOwner) ownerName.trim() else "", "+234" + ownerPhone.filter { it.isDigit() }.drop(1),
            email.trim(), contactPreference, dateOrNull(dateOfBirth, future = false) ?: "", nin.filter { it.isDigit() }, lassdri.trim().uppercase(), address.trim(),
            kinName.trim(), "+234" + kinPhone.filter { it.isDigit() }.drop(1), kinRelationship.trim(), kinAddress.trim(), docs,
            if (a.asksForOwner) Math.round((sharePercent.toDoubleOrNull() ?: 0.0) * 100).toInt() else 0,
        )
        viewModelScope.launch {
            applying = true; applyError = null
            try {
                api.submitApplication(form)
                application = api.application()
                clearDraft()
                reset(Dest.ApplicationStatus)
                dialog = Dialog.Verifying
            } catch (e: ApiException) { applyError = if (e.status >= 500) "We could not send that. Please try again." else e.message } finally { applying = false }
        }
    }


    // ------------------------------------------------------------------ start-up
    fun boot() {
        watchAlerts()
        // a hosted server that went to sleep starts now, while the splash screen is showing
        if (!demo) viewModelScope.launch(kotlinx.coroutines.Dispatchers.IO) { runCatching { api.client.wake() } }
        viewModelScope.launch {
            delay(1200)
            if (!demo) {
                val cfg = runCatching { api.appConfig() }.getOrNull()
                if (cfg?.forceUpdate == true) { updateUrl = cfg.updateUrl; reset(Dest.UpdateRequired); return@launch }
                if (cfg != null && cfg.batteryTips.isNotEmpty()) batteryTips = cfg.batteryTips
                if (api.session != null) {
                    // A restarted app picks up where it was: the location service may still be running.
                    online = LocationService.isOnline(getApplication())
                    // If the app was closed or the phone restarted, sharing stopped with it: pick it up again, or show offline.
                    if (online && !LocationService.start(getApplication())) online = false
                    val app = runCatching { api.application() }
                    val approved = app.getOrNull()?.status == "APPROVED"
                    if (app.isSuccess && !approved) { routeByApplication(Dest.Main); return@launch }
                    loadAccount()
                    reset(Dest.Main)
                    startRealRideLoop() // pick up a ride that was already in progress, and watch for new offers
                    return@launch
                }
            }
            reset(Dest.SignIn)
        }
    }

    // ---- report a problem
    var reportSending by mutableStateOf(false)
    var reportNotice by mutableStateOf<String?>(null)
    val reports = androidx.compose.runtime.mutableStateListOf<com.ninejaride.core.ui.components.MyReport>()
    private var reportKey: String? = null

    fun loadReports() { if (!demo) viewModelScope.launch { runCatching { api.myReports() }.getOrNull()?.let { reports.clear(); reports.addAll(it) } } }

    fun sendReport(topic: String, message: String) {
        if (demo) { reportNotice = "Demo mode: reports are not sent anywhere."; return }
        val key = reportKey ?: java.util.UUID.randomUUID().toString().also { reportKey = it }
        viewModelScope.launch {
            reportSending = true; reportNotice = null
            try { api.reportProblem(key, topic, message); reportKey = null; reportNotice = "Thank you. We have your report and will look into it."; loadReports() }
            catch (e: ApiException) { reportNotice = if (e.status >= 500) "We could not send that. Please try again." else e.message }
            finally { reportSending = false }
        }
    }

    fun logout() {
        dialog = null
        viewModelScope.launch {
            if (!demo) LocationService.stop(getApplication())
            api.logout()
            wentOnline(false)
            clearDraft(); phoneDigits = ""; otp = ""; fullName = ""; application = null; arrangementCode = ""; uploads.clear(); photo = null; profile = if (demo) DEMO_PROFILE else EMPTY_PROFILE; trips.clear(); transactions.clear(); walletKobo = 0; earningsKobo = 0; tripsToday = 0; kmToday = 0.0
            reset(Dest.SignIn)
        }
    }

    fun selectTab(t: Tab) { tab = t }

    // ------------------------------------------------------------------ profile and wallet
    var filterStart by mutableStateOf<java.time.LocalDate?>(null)
    var filterEnd by mutableStateOf<java.time.LocalDate?>(null)
    val filterLabel: String?
        get() {
            val s = filterStart ?: return null
            val e = filterEnd ?: return null
            val f = java.time.format.DateTimeFormatter.ofPattern("d MMM", java.util.Locale.ENGLISH)
            return s.format(f) + " – " + e.format(f)
        }

    fun setFilter(start: java.time.LocalDate?, end: java.time.LocalDate?) { filterStart = start; filterEnd = end }

    /** The profile photo, once loaded. */
    var photo by mutableStateOf<androidx.compose.ui.graphics.ImageBitmap?>(null)
    var photoBusy by mutableStateOf(false)
    var photoError by mutableStateOf<String?>(null)
    /** What went toward the vehicle today, and the terms of that share. */
    var vehicleSharedToday by mutableLongStateOf(0L)
    var vehicleTerms by mutableStateOf<VehicleTerms?>(null)
    var termsBusy by mutableStateOf(false)
    var termsError by mutableStateOf<String?>(null)

    /** Saves a new share. Only possible when the driver chose it themselves; the server refuses otherwise. */
    fun saveShare(percent: Double) {
        viewModelScope.launch {
            termsBusy = true; termsError = null
            try { api.setVehicleShare(Math.round(percent * 100).toInt()); vehicleTerms = api.vehicleTerms(); toast = "Saved" to "The new share applies from your next trip." }
            catch (e: ApiException) { termsError = e.message } finally { termsBusy = false }
        }
    }

    /** Pulls everything the screens show from the server: profile, photo, trips, today's earnings and the wallet. */
    fun loadAccount() {
        if (!demo) viewModelScope.launch { com.ninejaride.core.data.Push.register(getApplication(), api.client) } // so bookings reach this phone when the app is closed
        if (demo) return
        viewModelScope.launch {
            runCatching { api.profile() }.getOrNull()?.let { p ->
                profile = p
                if (p.photoId != null) loadPhoto(p.photoId)
            }
            runCatching { api.trips() }.getOrNull()?.let { (list, today) ->
                trips.clear(); trips.addAll(list)
                tripsToday = today.trips; earningsKobo = if (today.vehicleKobo > 0) today.keptKobo else today.earnedKobo; vehicleSharedToday = today.vehicleKobo; kmToday = today.distanceM / 1000.0; hoursToday = today.durationS / 3600.0
            }
            vehicleTerms = runCatching { api.vehicleTerms() }.getOrNull()
            if (vehicleTerms?.accepted == false && current == Dest.Main && phase == Phase.None) openSettlement()
            runCatching { api.walletBalance() }.getOrNull()?.let { walletKobo = it }
            runCatching { api.walletTransactions() }.getOrNull()?.let { transactions.clear(); transactions.addAll(it) }
        }
    }

    private suspend fun loadPhoto(id: String) {
        val bytes = runCatching { api.fileBytes(id) }.getOrNull() ?: return
        photo = android.graphics.BitmapFactory.decodeByteArray(bytes, 0, bytes.size)?.asImageBitmap()
    }

    /** Uploads a new profile photo and shows it. The old one stays on file but is no longer used. */
    fun changePhoto(uri: android.net.Uri) {
        if (demo) { photoError = "Demo mode: photos are not saved."; return }
        viewModelScope.launch {
            photoBusy = true; photoError = null
            try {
                val bytes = kotlinx.coroutines.withContext(kotlinx.coroutines.Dispatchers.IO) { shrinkedJpeg(uri) } ?: throw ApiException(0, null, "That photo could not be read. Try another.")
                val id = api.uploadFile(bytes, "profile.jpg", "image/jpeg")
                api.setPhoto(id)
                profile = profile.copy(photoId = id)
                loadPhoto(id)
            } catch (e: ApiException) { photoError = if (e.status >= 500) "The upload did not work. Please try again." else e.message } finally { photoBusy = false }
        }
    }

    fun saveNin(nin: String) { profile = profile.copy(nin = nin) }

    var profile by mutableStateOf(if (demo) DEMO_PROFILE else EMPTY_PROFILE)
    var walletKobo by mutableLongStateOf(0L)
    var earningsKobo by mutableLongStateOf(if (demo) 226_000L else 0L)
    var tripsToday by mutableIntStateOf(if (demo) 1 else 0)
    var kmToday by mutableStateOf(if (demo) 0.65 else 0.0)
    var hoursToday by mutableStateOf(0.0)
    var emailSent by mutableStateOf(false)
    var bonusKobo by mutableLongStateOf(0L)

    val trips = mutableStateListOf<TripRecord>().apply {
        if (demo) add(TripRecord("7K3M-92QD", "Today, 10:18 AM", DEMO_RECEIPT, "CXX4+65G, Akobo, Ibadan", "Iwo Road, Ibadan", 0.65, 555, "Cash", Rider("Olaoluwa", 5)))
    }
    val transactions = mutableStateListOf<WalletTx>()
    val payouts = mutableStateListOf<PayoutRecord>()

    fun saveBank(bank: String, number: String) {
        profile = profile.copy(bank = BankAccount(bank, number, profile.name.uppercase()))
        pop()
    }

    fun sendVerificationEmail() { emailSent = true }

    /** Demo: the owner opened the link in their email. */
    fun emailVerifiedNow() { profile = profile.copy(emailVerified = true); emailSent = false }

    fun topUp(amount: Kobo) {
        walletKobo += amount
        transactions.add(0, WalletTx("Wallet top-up", "Just now", amount, TxDirection.In))
    }

    val deleteBlockers: List<Check>
        get() = listOf(
            if (walletKobo < 0) Check(false, "Wallet owes ${naira(-walletKobo, true)}", "Top up to clear it", "Top up")
            else Check(true, "Wallet is clear", "Nothing owed"),
            Check(true, "No payout in progress", "Nothing is waiting to be paid"),
            if (phase != Phase.None) Check(false, "Ride in progress", "Finish the ride first") else Check(true, "No ride in progress", "You are not on a trip"),
        )

    // ------------------------------------------------------------------ going online
    var online by mutableStateOf(false)

    /** The same four checks as the design. Email only matters when there is a wallet debt to pay. */
    val goOnlineChecks: List<Check>
        get() {
            val v = profile.vehicle
            val out = mutableListOf<Check>()
            out += if (profile.active) Check(true, "Account active", "Approved by 9jaRide Pro") else Check(false, "Account not active", "Contact support")
            out += if (v != null) Check(true, "Vehicle added", "${v.model} · ${v.colour} · ${v.plate}") else if (profile.arrangement == "business_vehicle") Check(false, "Waiting for a vehicle", "Your business has not given you a vehicle yet") else Check(false, "No vehicle on your account", "Contact support")
            out += if (walletKobo >= 0) Check(true, "Wallet is clear", "Balance ${naira(walletKobo)}")
            else Check(false, "Wallet balance is ${naira(walletKobo)}", "Top up at least ${naira(-walletKobo)} to continue", "Top up")
            if (walletKobo < 0 && !profile.emailVerified) out += Check(false, "Email not verified", "Needed to fund your wallet", "Verify")
            if (vehicleTerms?.accepted == false) out += Check(false, "Agree to your vehicle arrangement", "You pay a share of your earnings toward this vehicle", "Review", fix = "agreement")
            // Booking alerts. These do not stop you going online, but without them a booking can be missed.
            checksTick
            val app = getApplication<Application>()
            if (!demo) {
                if (!com.ninejaride.driver.alert.BookingAlert.notificationsAllowed(app)) out += Check(false, "Booking alerts are off", "Allow notifications so new bookings can ring", "Allow", soft = true, fix = "notifications")
                if (!com.ninejaride.driver.alert.BookingAlert.fullScreenAllowed(app)) out += Check(false, "Bookings cannot open the screen", "Allow full-screen alerts so a booking shows over other apps", "Allow", soft = true, fix = "fullscreen")
                // Xiaomi, Redmi and Poco phones also block showing on the lock screen and opening from the background
                if (isXiaomi && !dndPrefs().getBoolean("xiaomi_asked", false)) out += Check(false, "Let bookings show on this Xiaomi phone", "In Other permissions, allow Show on lock screen, Display pop-up windows while running in the background, and Autostart", "Open", soft = true, fix = "xiaomi")
                if (!dndAsked() && com.ninejaride.driver.alert.BookingAlert.dndSettingsAvailable(app) && com.ninejaride.driver.alert.BookingAlert.needsDndAccess(app)) out += Check(false, "Bookings may stay silent in Do Not Disturb", "Allow Do Not Disturb access so the booking ring is heard", "Allow", soft = true, fix = "dnd")
            }
            return out
        }

    fun askGoOnline() {
        // Only real problems (account, vehicle, wallet) stop the driver. Advice about alerts is shown in the confirmation, not in the way.
        if (goOnlineChecks.filter { !it.soft }.all { it.ok }) dialog = Dialog.GoOnline else push(Dest.GoOnlineChecks)
    }

    fun confirmGoOnline() { dialog = null; wentOnline(true) }
    fun confirmGoOffline() { dialog = null; wentOnline(false) }

    private var offerJob: Job? = null

    private var watchingAlerts = false
    private var lastOfferShown: String? = null

    /** Started from boot (not from the constructor, so the state it reads exists). */
    private fun watchAlerts() {
        if (watchingAlerts) return
        watchingAlerts = true
        // The alert rings for as long as an offer is on screen, and stops the moment it is answered or runs out.
        viewModelScope.launch {
            androidx.compose.runtime.snapshotFlow { phase }.collect { p ->
                val app = getApplication<Application>()
                if (p == Phase.Offer) com.ninejaride.driver.alert.BookingAlert.start(app, offer.rideId.ifEmpty { offer.code }, offer.rider.name, offer.pickup, offerSeconds)
                else com.ninejaride.driver.alert.BookingAlert.stop(app)
                // On a trip the position is asked for fast and exactly (the rider watches the car); otherwise slowly and cheaply.
                if (!demo) LocationService.setTrip(app, p == Phase.ToPickup || p == Phase.Waiting || p == Phase.InTrip)
            }
        }
        // If the server says this phone cannot be online (another phone took over, no usable vehicle, an agreement to accept),
        // the service stops itself; the screen must show offline too, with the reason, not stay "online".
        viewModelScope.launch {
            androidx.compose.runtime.snapshotFlow { LocationStatus.stoppedReason }.collect { reason ->
                if (reason != null) { online = false; offerJob?.cancel(); say("You are offline", reason); LocationStatus.stoppedReason = null }
            }
        }
        // Answered on the incoming-booking screen (over the lock screen): follow it here.
        viewModelScope.launch {
            com.ninejaride.driver.alert.OfferAnswers.answer.collect { a ->
                if (a == null || demo) return@collect
                com.ninejaride.driver.alert.OfferAnswers.answer.value = null
                lastOfferShown = a.rideId
                if (a.accepted) {
                    // the ride is this driver's now: load it from the server so the pickup screen has everything
                    val r = runCatching { api.activeRide() }.getOrNull()
                    if (r != null) { rideJob?.cancel(); restoreRide(r) } else if (realRideId == a.rideId) beginPickupLeg()
                } else if (realRideId == a.rideId || phase == Phase.Offer) { rideJob?.cancel(); clearRide(); realRideId = null; phase = Phase.None }
            }
        }
        // The background service is the only thing asking the server for offers; they arrive here.
        viewModelScope.launch {
            com.ninejaride.driver.alert.OfferFeed.offer.collect { o ->
                if (o == null) { lastOfferShown = null; return@collect }
                if (!demo && online && phase == Phase.None && o.rideId != lastOfferShown && o.secondsLeft > 2) { lastOfferShown = o.rideId; showRealOffer(o) }
            }
        }
        // While online the service already follows the phone, so the Home map borrows its position instead of running a second listener.
        viewModelScope.launch {
            androidx.compose.runtime.snapshotFlow { LocationStatus.last }.collect { p -> if (p != null && online) deviceLocation = p }
        }
    }

    /** Bumped when the driver comes back from a settings page, so the checks are read again. */
    var checksTick by mutableIntStateOf(0)

    /** True when something about booking alerts is not set up. Shown as advice when going online. */
    val alertAdvice: Boolean get() = goOnlineChecks.any { it.soft && !it.ok }

    private val isXiaomi = android.os.Build.MANUFACTURER.lowercase().let { it.contains("xiaomi") || it.contains("redmi") || it.contains("poco") }
    private fun dndPrefs() = getApplication<Application>().getSharedPreferences("driver_state", android.content.Context.MODE_PRIVATE)
    /** Some phones list the Do Not Disturb page but then say it is not available. So it is offered once and never pushed again. */
    private fun dndAsked() = dndPrefs().getBoolean("dnd_asked", false)

    /** Opens the phone setting that fixes a booking-alert check. */
    fun openAlertSetting(kind: String) {
        if (kind == "agreement") { openAgreement(); return }
        val app = getApplication<Application>()
        if (kind == "xiaomi") {
            dndPrefs().edit().putBoolean("xiaomi_asked", true).apply()
            val miui = android.content.Intent("miui.intent.action.APP_PERM_EDITOR").putExtra("extra_pkgname", app.packageName)
            val details = android.content.Intent(android.provider.Settings.ACTION_APPLICATION_DETAILS_SETTINGS, android.net.Uri.parse("package:${app.packageName}"))
            if (runCatching { app.startActivity(miui.addFlags(android.content.Intent.FLAG_ACTIVITY_NEW_TASK)) }.isFailure) runCatching { app.startActivity(details.addFlags(android.content.Intent.FLAG_ACTIVITY_NEW_TASK)) }
            return
        }
        val intent = when (kind) {
            "notifications" -> android.content.Intent(android.provider.Settings.ACTION_APP_NOTIFICATION_SETTINGS).putExtra(android.provider.Settings.EXTRA_APP_PACKAGE, app.packageName)
            "fullscreen" -> if (android.os.Build.VERSION.SDK_INT >= 34) android.content.Intent(android.provider.Settings.ACTION_MANAGE_APP_USE_FULL_SCREEN_INTENT, android.net.Uri.parse("package:${app.packageName}")) else null
            else -> { dndPrefs().edit().putBoolean("dnd_asked", true).apply(); android.content.Intent(android.provider.Settings.ACTION_NOTIFICATION_POLICY_ACCESS_SETTINGS) }
        } ?: return
        runCatching { app.startActivity(intent.addFlags(android.content.Intent.FLAG_ACTIVITY_NEW_TASK)) }
    }

    private fun wentOnline(on: Boolean) {
        offerJob?.cancel()
        if (!demo) {
            // With a real server, "online" means the service is sharing the phone's position. No permission, no online.
            if (on && !LocationService.start(getApplication(), takeOver = true)) { online = false; dialog = Dialog.LocationDenied; return }
            if (on) viewModelScope.launch { runCatching { api.claimOnline() } } // this phone takes over from any other with the account
            if (!on) { LocationService.stop(getApplication()); viewModelScope.launch { runCatching { api.releaseOnline() } } }
            if (on) stopDeviceLocation()
        }
        online = on
        if (on && demo) scheduleOffer(6)
        if (on && !demo) startRealRideLoop()
        if (!on) { pollJob?.cancel() }
        if (on) maybeShowBatteryTips()
    }

    /** Called when the system permission prompt closes. */
    fun onPermissionResult() {
        if (LocationService.hasLocationPermission(getApplication())) confirmGoOnline() else dialog = Dialog.LocationDenied
    }

    /** Once, the first time the driver goes online, unless the phone already lets the app run freely in the background. */
    private fun maybeShowBatteryTips() {
        val ctx = getApplication<Application>()
        val prefs = ctx.getSharedPreferences("driver_state", android.content.Context.MODE_PRIVATE)
        val power = ctx.getSystemService(PowerManager::class.java)
        if (prefs.getBoolean("battery_prompt_done", false) || power?.isIgnoringBatteryOptimizations(ctx.packageName) == true) return
        prefs.edit().putBoolean("battery_prompt_done", true).apply()
        dialog = Dialog.Battery
    }

    // ------------------------------------------------------------------ the map
    /** Demo ride, somewhere in Ibadan. Real rides will bring their own coordinates from the server. */
    // Demo values until a real ride sets them. The screens read these two for the pickup and drop-off pins.
    var demoPickup by mutableStateOf(MapPoint(7.4303, 3.9568))
    var demoDropoff by mutableStateOf(MapPoint(7.4237, 3.9529))
    private val demoStart = MapPoint(7.4210, 3.9490)

    var routeToPickup by mutableStateOf<List<MapPoint>>(emptyList())
    var routeTrip by mutableStateOf<List<MapPoint>>(emptyList())
    var carPoint by mutableStateOf<MapPoint?>(null)
    /** Where this phone really is, once the driver has allowed location. Null until then. */
    var deviceLocation by mutableStateOf<MapPoint?>(null)
    private var locationListener: LocationListener? = null

    /** Starts following the phone's position for the Home map. Safe to call again; does nothing without permission. */
    fun startDeviceLocation() {
        if (locationListener != null) return
        val ctx = getApplication<Application>()
        val granted = listOf(Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION)
            .any { ContextCompat.checkSelfPermission(ctx, it) == PackageManager.PERMISSION_GRANTED }
        if (!granted) return
        val lm = ctx.getSystemService(LocationManager::class.java) ?: return
        // Written out in full: on Android 8 to 10 the interface's extra methods are not defaults, so a lambda would crash.
        val listener = object : LocationListener {
            override fun onLocationChanged(location: Location) { deviceLocation = MapPoint(location.latitude, location.longitude) }
            override fun onProviderEnabled(provider: String) {}
            override fun onProviderDisabled(provider: String) {}
            @Deprecated("Deprecated in Java")
            override fun onStatusChanged(provider: String?, status: Int, extras: Bundle?) {}
        }
        try {
            for (provider in listOf(LocationManager.GPS_PROVIDER, LocationManager.NETWORK_PROVIDER)) {
                if (!lm.isProviderEnabled(provider)) continue
                lm.getLastKnownLocation(provider)?.let { deviceLocation = deviceLocation ?: MapPoint(it.latitude, it.longitude) }
                // Only used for the map before the driver goes online (online, the service supplies the position): slow and sparse.
                lm.requestLocationUpdates(provider, if (provider == LocationManager.GPS_PROVIDER) 15_000L else 45_000L, 25f, listener, Looper.getMainLooper())
            }
            locationListener = listener
        } catch (e: SecurityException) {
            // Permission was withdrawn between the check and the call: stay on the default view.
        }
    }

    private fun stopDeviceLocation() {
        locationListener?.let { l -> getApplication<Application>().getSystemService(LocationManager::class.java)?.removeUpdates(l) }
        locationListener = null
    }

    /** The app came to the front or went behind another. Nothing here needs the GPS while the screen is not being looked at. */
    fun setVisible(visible: Boolean) {
        if (visible) { if (!online && current == Dest.Main) startDeviceLocation() } else stopDeviceLocation()
    }

    override fun onCleared() {
        stopDeviceLocation()
        super.onCleared()
    }

    private fun clearRide() { carPoint = null; routeToPickup = emptyList(); routeTrip = emptyList(); stopChat(); extension.clear() }

    // ---- going further than the booked destination
    val extension = com.ninejaride.core.data.ExtensionController(viewModelScope, { api.client }, { realRideId }, onAccepted = {
        viewModelScope.launch { runCatching { api.activeRide() }.getOrNull()?.let { applyDestination(it) } }
    })

    /** The server's view of the ride: if the destination was changed (an extension was accepted), the screens, route and fare follow it. */
    private fun applyDestination(r: com.ninejaride.driver.data.ServerRide) {
        if (r.rideId != realRideId) return
        val moved = com.ninejaride.core.data.Routing.haversineKm(demoDropoff, r.dropoff) > 0.01
        if (r.expectedKobo != null && r.expectedKobo != offer.fare) offer = offer.copy(fare = r.expectedKobo)
        if (!moved) return
        demoDropoff = r.dropoff
        offer = offer.copy(dropoff = r.dropoffAddress ?: offer.dropoff)
        legRoute = emptyList(); legRouteAt = 0
        viewModelScope.launch { routeTrip = Routing.route(deviceLocation ?: demoPickup, r.dropoff) }
    }

    // ---- talking to the rider of the trip in progress
    /** The rider's number for the dialler, known once the trip is accepted. Not shown anywhere. */
    var riderPhone by mutableStateOf<String?>(null)
    private var chatRide: String? = null
    val chat = com.ninejaride.core.data.ChatController(
        viewModelScope,
        fetch = { after, wait -> api.client.chatPage(chatRide ?: throw ApiException(404, null, "no ride"), after, wait) },
        send = { text, clientId -> api.client.chatSend(chatRide ?: throw ApiException(404, null, "no ride"), text, clientId) },
        markRead = { upTo -> chatRide?.let { api.client.chatRead(it, upTo) } },
        appVisible = { true }, // a driver on a trip keeps the app in front
    )
    /** True while the chat covers the trip screen. */
    var chatOpen by mutableStateOf(false)

    private fun startChat() {
        val id = realRideId ?: return
        if (demo) return
        chatRide = id; chat.start(id)
        viewModelScope.launch { runCatching { api.activeRide() }.getOrNull()?.let { if (it.rideId == id) riderPhone = it.riderPhone } }
    }

    private fun stopChat() { chat.stop(); chatOpen = false; chatRide = null; riderPhone = null }

    // ------------------------------------------------------------------ the ride (scripted in demo mode)
    var phase by mutableStateOf(Phase.None)
    var offer by mutableStateOf(DEMO_OFFER)
    /** What the last finished trip paid: the sample receipt in demo mode, the server's own figures otherwise. */
    var receipt by mutableStateOf(DEMO_RECEIPT)
    private var realRideId: String? = null
    var offerSeconds by mutableIntStateOf(15)
    var waitingSeconds by mutableIntStateOf(0)
    var tripSeconds by mutableIntStateOf(0)
    var tripKm by mutableStateOf(0.0)
    /** Live figures for the ride in progress (null in the demo): minutes and metres left to the pickup or drop-off, and what the server has counted as driven. */
    var etaMin by mutableStateOf<Int?>(null)
    var remainingM by mutableStateOf<Int?>(null)
    var pickupTravelledM by mutableStateOf(0)
    var tripTravelledM by mutableStateOf(0)
    /** Within reach of the drop-off: the screen tells the driver they have arrived, and they end the trip. */
    val atDestination: Boolean get() = phase == Phase.InTrip && (remainingM ?: Int.MAX_VALUE) <= 80
    var stopReason by mutableStateOf<String?>(null)
    var rating by mutableIntStateOf(5)
    var ratingTags by mutableStateOf(setOf<String>())
    var ratingComment by mutableStateOf("")
    var feedbackThanks by mutableStateOf(false)
    var sosSteps by mutableIntStateOf(1)
    var sosAdmin by mutableStateOf<String?>(null)
    private var rideJob: Job? = null

    // ------------------------------------------------------------------ real rides (a server, not the script)
    private var pollJob: Job? = null
    private var tripStartedPoint: MapPoint? = null

    private fun say(title: String, text: String) { toastWarn = true; toast = title to text }

    /** While online: pick up a ride already in progress, then keep asking the server for offers and watching the ride. */
    private fun startRealRideLoop() {
        if (demo) return
        pollJob?.cancel()
        pollJob = viewModelScope.launch {
            runCatching { api.activeRide() }.getOrNull()?.let { restoreRide(it) }
            while (true) {
                try {
                    when (phase) {
                        Phase.None -> {} // offers arrive from the background service
                        Phase.ToPickup, Phase.Waiting -> if (api.activeRide() == null) {
                            // The rider cancelled (or the ride ended some other way): nothing left to do here.
                            rideJob?.cancel(); clearRide(); realRideId = null; phase = Phase.None
                            say("Ride cancelled", "The rider cancelled this ride.")
                        }
                        Phase.InTrip -> api.activeRide()?.let { r -> extension.update(r.extension); applyDestination(r) }
                        else -> {}
                    }
                } catch (e: ApiException) {
                    if (e.status == 401 || e.status == 403) return@launch // signed out or suspended: stop asking
                }
                delay(if (phase == Phase.None) 30_000 else 6_000) // only a ride in progress needs watching, and not every few seconds
            }
        }
    }

    private fun kmToMinutes(km: Double?) = if (km == null) 0 else Math.max(1, Math.round(km / 25.0 * 60).toInt())

    private fun showRealOffer(o: com.ninejaride.driver.data.ServerOffer) {
        realRideId = o.rideId
        offer = RideOffer(
            code = o.code, category = o.category, payment = if (o.paymentMethod == "wallet") "Wallet" else "Cash", pickupKm = o.pickupKm ?: 0.0, pickupMin = kmToMinutes(o.pickupKm),
            fare = o.expectedKobo ?: 0L, pickup = o.pickupAddress ?: "Pickup point", dropoff = o.dropoffAddress ?: "Drop-off point", rider = Rider(o.riderName, Math.round(o.riderRating ?: 5.0).toInt()), rideId = o.rideId,
        )
        demoPickup = o.pickup; demoDropoff = o.dropoff
        carPoint = deviceLocation
        offerSeconds = o.secondsLeft
        routeToPickup = emptyList(); routeTrip = emptyList()
        viewModelScope.launch { routeTrip = Routing.route(o.pickup, o.dropoff) }
        deviceLocation?.let { from -> viewModelScope.launch { routeToPickup = Routing.route(from, o.pickup) } }
        phase = Phase.Offer
        rideJob?.cancel()
        rideJob = viewModelScope.launch {
            while (offerSeconds > 0 && phase == Phase.Offer) { delay(1000); offerSeconds-- }
            if (phase == Phase.Offer) { phase = Phase.None; realRideId = null } // not answered in time: the server moves to the next driver
        }
    }

    /** The app was closed or restarted mid-ride: show the screen the ride is up to. */
    private fun restoreRide(r: com.ninejaride.driver.data.ServerRide) {
        realRideId = r.rideId
        offer = RideOffer(r.code, r.category, if (r.paymentMethod == "wallet") "Wallet" else "Cash", 0.0, 0, r.expectedKobo ?: 0L, r.pickupAddress ?: "Pickup point", r.dropoffAddress ?: "Drop-off point", Rider(r.riderName, 5), r.rideId)
        demoPickup = r.pickup; demoDropoff = r.dropoff
        viewModelScope.launch { routeTrip = Routing.route(r.pickup, r.dropoff) }
        when (r.status) {
            "DRIVER_ASSIGNED" -> beginPickupLeg()
            "DRIVER_ARRIVED" -> beginWaiting()
            else -> beginTripLeg()
        }
    }

    private fun beginPickupLeg() {
        phase = Phase.ToPickup
        startChat()
        deviceLocation?.let { from -> viewModelScope.launch { routeToPickup = Routing.route(from, demoPickup) } }
        rideJob?.cancel()
        etaMin = null; remainingM = null; pickupTravelledM = 0; tripTravelledM = 0
        legRoute = emptyList(); offRoad = 0
        rideJob = viewModelScope.launch { var tick = 0; while (phase == Phase.ToPickup) { if (demo) carPoint = deviceLocation ?: carPoint else followRoad(); if (!demo && tick % 8 == 0) refreshProgress(); tick++; delay(1000) } }
    }

    /**
     * Asks the server how far this phone has driven (it keeps the count from the GPS readings, ignoring wild ones) and works out
     * the time and distance left to wherever the driver is heading. If the server noticed the arrival at the pickup, the screen follows.
     */
    private suspend fun refreshProgress() {
        val ride = runCatching { api.activeRide() }.getOrNull()
        if (ride != null) {
            pickupTravelledM = ride.pickupTravelledM; tripTravelledM = ride.tripTravelledM
            if (phase == Phase.InTrip && ride.tripTravelledM > 0) tripKm = ride.tripTravelledM / 1000.0 // the server's count is the one used
            if (phase == Phase.ToPickup && ride.status == "DRIVER_ARRIVED") { beginWaiting(); return }
        }
        if (legRoute.isEmpty() || System.currentTimeMillis() - legRouteAt > 30_000) reroute()
    }

    // ---- the live route, like a navigation app
    /** The road for the part of the trip in progress (to the pickup, or to the drop-off), as last fetched. */
    private var legRoute: List<MapPoint> = emptyList()
    private var legDurationS = 0
    private var legLengthM = 0.0
    private var legRouteAt = 0L
    private var offRoad = 0
    private var rerouting = false
    private var glide: Job? = null

    /** Fetches a fresh road from where the driver is now. */
    private suspend fun reroute() {
        if (rerouting) return
        val me = deviceLocation ?: return
        rerouting = true
        try {
            val target = if (phase == Phase.ToPickup) demoPickup else demoDropoff
            val info = runCatching { Routing.routeInfo(me, target) }.getOrNull() ?: return
            legRoute = info.points; legDurationS = info.durationS; legLengthM = com.ninejaride.core.data.RouteProgress.lengthM(info.points); legRouteAt = System.currentTimeMillis()
            offRoad = 0
            followRoad()
        } finally { rerouting = false }
    }

    /**
     * Once a second: puts the car on the road, draws only the road still ahead, and works out the time and distance left from
     * it. A driver who leaves the road for a few readings in a row gets a new route from where they are.
     */
    private fun followRoad() {
        val me = deviceLocation ?: return
        val fix = com.ninejaride.core.data.RouteProgress.locate(legRoute, me)
        if (fix == null) { moveCar(me); return }
        if (fix.offRouteM > com.ninejaride.core.data.RouteProgress.OFF_ROUTE_M) {
            offRoad++
            moveCar(me) // show where the car really is while a new route comes
            if (offRoad >= 3) viewModelScope.launch { reroute() }
            return
        }
        offRoad = 0
        moveCar(fix.onRoad)
        remainingM = fix.remainingM.toInt()
        etaMin = com.ninejaride.core.data.RouteProgress.minutesLeft(legDurationS, legLengthM, fix.remainingM)
        if (phase == Phase.ToPickup) routeToPickup = fix.ahead else routeTrip = fix.ahead
    }

    /** Slides the car to its new place over about a second instead of jumping. */
    private fun moveCar(to: MapPoint) {
        val from = carPoint
        glide?.cancel()
        if (from == null || Routing.haversineKm(from, to) > 0.3) { carPoint = to; return }
        glide = viewModelScope.launch {
            for (i in 1..4) { carPoint = MapPoint(from.lat + (to.lat - from.lat) * i / 4.0, from.lng + (to.lng - from.lng) * i / 4.0); delay(220) }
        }
    }

    private fun beginWaiting() {
        waitingSeconds = 0
        phase = Phase.Waiting
        startChat()
        rideJob?.cancel()
        rideJob = viewModelScope.launch { while (phase == Phase.Waiting) { delay(1000); waitingSeconds++ } }
    }

    private fun beginTripLeg() {
        tripSeconds = 0; tripKm = 0.0; stopReason = null; etaMin = null; remainingM = null
        legRoute = emptyList(); offRoad = 0
        tripStartedPoint = deviceLocation
        phase = Phase.InTrip
        startChat()
        rideJob?.cancel()
        rideJob = viewModelScope.launch {
            var last = deviceLocation
            var tick = 0
            while (phase == Phase.InTrip) {
                delay(1000)
                tripSeconds++
                val now = deviceLocation
                if (now != null) {
                    // distance really driven, from the phone's own readings; tiny moves are GPS noise and a sudden leap is not a car
                    if (last != null) { val d = Routing.haversineKm(last, now); if (d > 0.008 && d < 0.2) { tripKm += d; last = now } else if (d >= 0.2) last = now } else last = now
                    if (demo) carPoint = now
                }
                if (!demo) followRoad()
                if (!demo && tick % 8 == 0) refreshProgress()
                tick++
            }
        }
    }

    /** Runs a call to the server for the driver; a refusal is shown as a short notice instead of silently doing nothing. */
    private fun server(failTitle: String, block: suspend () -> Unit) {
        viewModelScope.launch {
            try { block() } catch (e: ApiException) { say(failTitle, if (e.status >= 500) "Something went wrong. Please try again." else e.message) }
        }
    }

    private fun scheduleOffer(afterSeconds: Int) {
        offerJob?.cancel()
        offerJob = viewModelScope.launch {
            delay(afterSeconds * 1000L)
            if (online && phase == Phase.None) showOffer()
        }
    }

    private fun showOffer() {
        offer = DEMO_OFFER.copy(code = demoTripCode())
        offerSeconds = 15
        carPoint = demoStart
        routeToPickup = emptyList(); routeTrip = emptyList()
        viewModelScope.launch { routeTrip = Routing.route(demoPickup, demoDropoff) }
        viewModelScope.launch { routeToPickup = Routing.route(demoStart, demoPickup) }
        phase = Phase.Offer
        rideJob?.cancel()
        rideJob = viewModelScope.launch {
            while (offerSeconds > 0 && phase == Phase.Offer) { delay(1000); offerSeconds-- }
            if (phase == Phase.Offer) { phase = Phase.None; scheduleOffer(20) } // ignored: counts against acceptance
        }
    }

    /** Asks first; [action] runs only if the driver taps the confirm button. */
    var pendingConfirm by mutableStateOf<com.ninejaride.core.ui.components.ConfirmRequest?>(null)
    fun confirm(title: String, text: String, label: String, danger: Boolean = false, action: () -> Unit) {
        pendingConfirm = com.ninejaride.core.ui.components.ConfirmRequest(title, text, label, danger, action)
    }

    fun decline() {
        rideJob?.cancel(); clearRide(); phase = Phase.None
        if (demo) { if (online) scheduleOffer(20) } else realRideId?.let { id -> realRideId = null; server("Could not decline") { api.decline(id) } }
    }

    fun accept() {
        if (!demo) {
            val id = realRideId ?: return
            viewModelScope.launch {
                try {
                    if (api.accept(id)) beginPickupLeg()
                    else { rideJob?.cancel(); clearRide(); realRideId = null; phase = Phase.None; say("Too late", "That ride was taken or timed out.") }
                } catch (e: ApiException) { say("Could not accept", if (e.status >= 500) "Something went wrong. Please try again." else e.message) }
            }
            return
        }
        rideJob?.cancel()
        phase = Phase.ToPickup
        // The car drives to the pickup along the road line over about 25 seconds.
        rideJob = viewModelScope.launch {
            val steps = 25
            for (i in 0..steps) {
                if (phase != Phase.ToPickup) break
                carPoint = Routing.pointAt(routeToPickup.ifEmpty { listOf(demoStart, demoPickup) }, i / steps.toDouble())
                delay(1000)
            }
        }
    }

    fun arrived() {
        if (!demo) { val id = realRideId ?: return; server("Could not update") { api.arrive(id); beginWaiting() }; return }
        waitingSeconds = 0
        carPoint = demoPickup
        phase = Phase.Waiting
        rideJob?.cancel()
        rideJob = viewModelScope.launch { while (phase == Phase.Waiting) { delay(1000); waitingSeconds++ } }
    }

    fun noShow() = giveUp("Rider did not show up")

    fun cancelTrip() = giveUp(null)

    private fun giveUp(reason: String?) {
        if (demo) { rideJob?.cancel(); clearRide(); phase = Phase.None; if (online) scheduleOffer(20); return }
        val id = realRideId ?: return
        server("Could not cancel") { api.cancelRide(id, reason); rideJob?.cancel(); clearRide(); realRideId = null; phase = Phase.None }
    }

    fun startTrip() {
        if (!demo) { val id = realRideId ?: return; server("Could not start") { api.startTrip(id); beginTripLeg() }; return }
        tripSeconds = 0; tripKm = 0.0; stopReason = null
        phase = Phase.InTrip
        rideJob?.cancel()
        rideJob = viewModelScope.launch {
            while (phase == Phase.InTrip) {
                delay(1000)
                tripSeconds++
                if (tripKm < 0.65) tripKm = Math.min(0.65, tripKm + 0.65 / 20.0)
                carPoint = Routing.pointAt(routeTrip.ifEmpty { listOf(demoPickup, demoDropoff) }, tripKm / 0.65)
            }
        }
    }

    fun endTrip() {
        if (demo) { rideJob?.cancel(); carPoint = demoDropoff; phase = Phase.Collect; return }
        val id = realRideId ?: return
        server("Could not end the trip") {
            val fare = api.completeTrip(id, (tripKm * 1000).toInt(), tripSeconds, waitingSeconds)
            rideJob?.cancel()
            receipt = FareReceipt(fare.lines.map { FareLine(it.first, it.second) }, fare.totalKobo, fare.commissionKobo, fare.driverEarnKobo, if (fare.totalKobo > 0) Math.round(fare.commissionKobo * 100.0 / Math.max(1L, fare.totalKobo - fare.taxKobo)).toInt() else 0,
                fare.vehicleDeductionKobo, vehicleTerms?.percent?.toInt() ?: 0)
            phase = Phase.Collect
            loadAccount() // today's earnings, the trip list and the wallet now include this trip
        }
    }

    /** Cash trip: the service charge comes out of the wallet, which can take it below zero. */
    fun cashCollected() {
        if (!demo) { rating = 5; phase = Phase.Rate; return } // the server settled the trip when it ended
        val r = DEMO_RECEIPT
        walletKobo -= r.serviceCharge
        transactions.add(0, WalletTx("9jaRide service charge · trip ${offer.code}", "Just now", r.serviceCharge, TxDirection.Out))
        earningsKobo += r.earn
        tripsToday += 1
        kmToday += 0.65
        trips.add(0, TripRecord(offer.code, "Today, just now", r, offer.pickup, offer.dropoff, 0.65, 555, offer.payment, offer.rider))
        rating = 5
        phase = Phase.Rate
    }

    fun setStars(n: Int) { rating = n; ratingTags = com.ninejaride.core.ui.components.QuickComments.keep(n, ratingTags, ofRider = true) }

    /** Sends the driver's rating of the rider (stars, quick comments, optional note), then shows the thank-you. */
    fun submitRating() {
        val id = realRideId
        if (!demo && id != null) server("Your feedback could not be sent.") { api.rateRider(id, rating, ratingTags.toList(), ratingComment) }
        feedbackThanks = true
    }

    fun toggleTag(tag: String) { ratingTags = if (tag in ratingTags) ratingTags - tag else ratingTags + tag }

    fun finishRide() {
        ratingTags = emptySet(); ratingComment = ""; feedbackThanks = false
        clearRide()
        realRideId = null
        phase = Phase.None
        tab = Tab.Home
        if (online && demo) scheduleOffer(25)
    }

    // ------------------------------------------------------------------ SOS
    private var sosJob: Job? = null
    private var phaseBeforeSos = Phase.None

    fun askSos() { dialog = Dialog.Sos }

    fun sendSos() {
        dialog = null
        phaseBeforeSos = phase
        sosSteps = 1
        sosAdmin = null
        phase = Phase.SosSent
        sosJob?.cancel()
        sosJob = viewModelScope.launch {
            if (demo) { delay(1500); sosSteps = 2; delay(5000); sosSteps = 3; sosAdmin = "Safety team (demo)"; return@launch }
            // Real alert: each step is ticked only when it has really happened. "Admin has acknowledged" is not ticked here, because
            // nothing tells this phone when staff acknowledge; it stays as a plain note instead of pretending.
            try {
                api.sos(java.util.UUID.randomUUID().toString(), deviceLocation ?: demoPickup.takeIf { realRideId != null })
                sosSteps = 2
            } catch (e: ApiException) { say("The alert could not be sent", "Call 112 now.") }
        }
    }

    fun cancelSos() {
        sosJob?.cancel()
        phase = if (phaseBeforeSos == Phase.SosSent) Phase.None else phaseBeforeSos
    }

    private fun demoTripCode(): String {
        val a = "ABCDEFGHJKMNPQRSTVWXYZ23456789"
        fun four() = (1..4).map { a.random() }.joinToString("")
        return four() + "-" + four()
    }

    companion object {}
}
