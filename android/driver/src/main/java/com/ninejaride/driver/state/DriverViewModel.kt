package com.ninejaride.driver.state

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
import com.ninejaride.driver.data.BatteryGuidance
import com.ninejaride.driver.data.ServerApplication
import com.ninejaride.driver.data.BatteryTip
import com.ninejaride.driver.location.LocationService
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

    private fun signedIn() {
        toast = "Sign in successful" to "You have signed in to your account."
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

    // documents: the numbers and dates typed in, and the id of the photo uploaded for each
    var licenceNumber by mutableStateOf("")
    var licenceExpiry by mutableStateOf("")
    var insuranceNumber by mutableStateOf("")
    var insuranceExpiry by mutableStateOf("")
    var inspectionExpiry by mutableStateOf("")
    val uploads = androidx.compose.runtime.mutableStateMapOf<String, String>() // document kind -> uploaded file id
    var uploading by mutableStateOf<String?>(null)

    val chosen: Arrangement? get() = arrangements.firstOrNull { it.code == arrangementCode }

    /** The documents asked for, in order. Mirrors what the server requires for this way of driving. */
    fun neededDocuments(): List<String> {
        val a = chosen ?: return emptyList()
        return buildList {
            add("drivers_licence"); add("lassdri") // the NIN is checked by a service, so no photo of it is asked for
            if (a.asksForVehicle) { add("vehicle_photo"); add("insurance"); add("inspection_certificate") }
            if (a.asksForOwner) add("owner_consent")
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
    fun openApplication() {
        applyStep = 0; applyError = null
        application?.let { prefill(it) }
        viewModelScope.launch {
            if (arrangements.isEmpty()) runCatching { api.arrangements() }.getOrNull()?.let { arrangements.addAll(it) }
            if (arrangementCode.isEmpty()) arrangementCode = arrangements.firstOrNull()?.code ?: "own"
            reset(Dest.Apply)
        }
    }

    private fun prefill(a: ServerApplication) {
        arrangementCode = a.arrangement; vehicleCategory = a.category.takeIf { it == "regular" || it == "comfort" } ?: "regular"
        email = a.email; contactPreference = a.contactPreference; nin = a.nin; lassdri = a.lassdri; address = a.address
        dateOfBirth = a.dateOfBirth.takeIf { it.length == 10 }?.let { "${it.substring(8, 10)}/${it.substring(5, 7)}/${it.substring(0, 4)}" } ?: ""
        kinName = a.kinName; kinPhone = a.kinPhone.replace("+234", "0"); kinRelationship = a.kinRelationship; kinAddress = a.kinAddress
        plate = a.plate; make = a.make; colour = a.colour; ownerName = a.ownerName; ownerPhone = a.ownerPhone.replace("+234", "0")
        uploads.clear()
        a.documents.forEach { d ->
            d.fileId?.let { uploads[d.kind] = it }
            fun show(iso: String?) = iso?.takeIf { it.length == 10 }?.let { "${it.substring(8, 10)}/${it.substring(5, 7)}/${it.substring(0, 4)}" } ?: ""
            when (d.kind) {
                "drivers_licence" -> { licenceNumber = d.number ?: ""; licenceExpiry = show(d.expiresOn) }
                "insurance" -> { insuranceNumber = d.number ?: ""; insuranceExpiry = show(d.expiresOn) }
                "inspection_certificate" -> inspectionExpiry = show(d.expiresOn)
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

    private suspend fun settlementDone(): Boolean = runCatching { api.settlement().done }.getOrDefault(false)

    /** "Continue" in the congratulations box: on to settlement, or past it if it was already finished. */
    fun continueAfterApproval() {
        dialog = null
        viewModelScope.launch {
            if (settlementDone()) { loadAccount(); reset(Dest.LocationPermission) } else openSettlement()
        }
    }

    // ---- settlement: where the driver is paid
    var bankName by mutableStateOf("")
    var accountNumber by mutableStateOf("")
    var accountName by mutableStateOf("")
    var settlementVehicle by mutableStateOf("")
    var settlementTerms by mutableStateOf("")
    var settling by mutableStateOf(false)
    var settleError by mutableStateOf<String?>(null)

    private suspend fun openSettlement() {
        runCatching { api.settlement() }.getOrNull()?.let {
            bankName = it.bank; accountNumber = it.number; accountName = it.holder.ifBlank { properName(runCatching { api.profile().name }.getOrDefault(fullName)).uppercase() }
            settlementVehicle = it.vehicle; settlementTerms = it.terms
        }
        settleError = null
        reset(Dest.Settlement)
    }

    fun finishSettlement() {
        when {
            bankName.trim().length < 2 -> { settleError = "Enter your bank's name."; return }
            accountNumber.length != 10 -> { settleError = "An account number has 10 digits."; return }
            accountName.trim().length < 2 -> { settleError = "Enter the name on the account."; return }
        }
        viewModelScope.launch {
            settling = true; settleError = null
            try {
                api.saveAccount(bankName.trim(), accountNumber, accountName.trim())
                api.completeSettlement()
                toast = "You are all set" to "Your payout account is saved."
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
                dateOrNull(dateOfBirth, future = false) == null -> "Choose your date of birth. You must be at least 18."
                address.trim().length < 5 -> "Enter your home address."
                nin.filter { it.isDigit() }.length != 11 -> "Your NIN is 11 digits."
                lassdri.trim().length < 4 -> "Enter your LASSDRI number."
                !emailOk -> "Enter a valid email address."
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
                else -> null
            }
            else -> when {
                licenceNumber.trim().length < 4 -> "Enter your driver's licence number."
                dateOrNull(licenceExpiry) == null -> "Choose when your licence expires. It must be in the future."
                a.asksForVehicle && insuranceNumber.trim().length < 3 -> "Enter the insurance policy number."
                a.asksForVehicle && dateOrNull(insuranceExpiry) == null -> "Choose when the insurance expires. It must be in the future."
                a.asksForVehicle && dateOrNull(inspectionExpiry) == null -> "Choose when the inspection certificate expires."
                neededDocuments().any { uploads[it] == null } -> "Upload a photo for: " + neededDocuments().filter { uploads[it] == null }.joinToString(", ") { documentLabel(it) } + "."
                else -> null
            }
        }
    }

    fun applyNext() {
        applyProblem()?.let { applyError = it; return }
        applyError = null
        if (applyStep < 4) applyStep++ else submitApplication()
    }

    fun applyBack() { applyError = null; if (applyStep > 0) applyStep-- else if (application != null) reset(Dest.ApplicationStatus) else pop() }

    /** Reads the picked photo, shrinks it so it uploads quickly on mobile data, and sends it. */
    fun uploadDocument(kind: String, uri: android.net.Uri) {
        viewModelScope.launch {
            uploading = kind; applyError = null
            try {
                val bytes = kotlinx.coroutines.withContext(kotlinx.coroutines.Dispatchers.IO) { shrinkedJpeg(uri) } ?: throw ApiException(0, null, "That photo could not be read. Try another.")
                uploads[kind] = api.uploadFile(bytes, "$kind.jpg", "image/jpeg")
            } catch (e: ApiException) { applyError = if (e.status >= 500) "The upload did not work. Please try again." else e.message } finally { uploading = null }
        }
    }

    private fun shrinkedJpeg(uri: android.net.Uri): ByteArray? {
        val cr = getApplication<Application>().contentResolver
        val bounds = android.graphics.BitmapFactory.Options().apply { inJustDecodeBounds = true }
        cr.openInputStream(uri)?.use { android.graphics.BitmapFactory.decodeStream(it, null, bounds) }
        if (bounds.outWidth <= 0) return null
        var sample = 1
        while (maxOf(bounds.outWidth, bounds.outHeight) / sample > 2000) sample *= 2
        val bmp = cr.openInputStream(uri)?.use { android.graphics.BitmapFactory.decodeStream(it, null, android.graphics.BitmapFactory.Options().apply { inSampleSize = sample }) } ?: return null
        val out = java.io.ByteArrayOutputStream()
        bmp.compress(android.graphics.Bitmap.CompressFormat.JPEG, 82, out)
        return out.toByteArray()
    }

    private fun submitApplication() {
        val a = chosen ?: return
        fun doc(kind: String, number: String? = null, expires: String? = null) = ServerDoc(kind, number?.trim()?.takeIf { it.isNotEmpty() }, uploads[kind], expires?.let { dateOrNull(it) })
        val docs = neededDocuments().map {
            when (it) {
                "drivers_licence" -> doc(it, licenceNumber, licenceExpiry)
                "insurance" -> doc(it, insuranceNumber, insuranceExpiry)
                "inspection_certificate" -> doc(it, null, inspectionExpiry)
                else -> doc(it)
            }
        }
        val form = ApplicationForm(
            a.code, vehicleCategory, if (a.asksForVehicle) plate.trim().uppercase() else "", make.trim(), colour.trim(),
            if (a.asksForOwner) ownerName.trim() else "", "+234" + ownerPhone.filter { it.isDigit() }.drop(1),
            email.trim(), contactPreference, dateOrNull(dateOfBirth, future = false) ?: "", nin.filter { it.isDigit() }, lassdri.trim().uppercase(), address.trim(),
            kinName.trim(), "+234" + kinPhone.filter { it.isDigit() }.drop(1), kinRelationship.trim(), kinAddress.trim(), docs,
        )
        viewModelScope.launch {
            applying = true; applyError = null
            try {
                api.submitApplication(form)
                application = api.application()
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
            phoneDigits = ""; otp = ""; fullName = ""; application = null; arrangementCode = ""; uploads.clear(); photo = null; profile = if (demo) DEMO_PROFILE else EMPTY_PROFILE; trips.clear(); transactions.clear(); walletKobo = 0; earningsKobo = 0; tripsToday = 0; kmToday = 0.0
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

    /** Pulls everything the screens show from the server: profile, photo, trips, today's earnings and the wallet. */
    fun loadAccount() {
        if (demo) return
        viewModelScope.launch {
            runCatching { api.profile() }.getOrNull()?.let { p ->
                profile = p
                if (p.photoId != null) loadPhoto(p.photoId)
            }
            runCatching { api.trips() }.getOrNull()?.let { (list, today) ->
                trips.clear(); trips.addAll(list)
                tripsToday = today.trips; earningsKobo = today.earnedKobo; kmToday = today.distanceM / 1000.0; hoursToday = today.durationS / 3600.0
            }
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
            out += if (v != null) Check(true, "Vehicle added", "${v.model} · ${v.colour} · ${v.plate}") else Check(false, "No vehicle on your account", "Contact support")
            out += if (walletKobo >= 0) Check(true, "Wallet is clear", "Balance ${naira(walletKobo)}")
            else Check(false, "Wallet balance is ${naira(walletKobo)}", "Top up at least ${naira(-walletKobo)} to continue", "Top up")
            if (walletKobo < 0 && !profile.emailVerified) out += Check(false, "Email not verified", "Needed to fund your wallet", "Verify")
            // Booking alerts. These do not stop you going online, but without them a booking can be missed.
            checksTick
            val app = getApplication<Application>()
            if (!demo) {
                if (!com.ninejaride.driver.alert.BookingAlert.notificationsAllowed(app)) out += Check(false, "Booking alerts are off", "Allow notifications so new bookings can ring", "Allow", soft = true, fix = "notifications")
                if (!com.ninejaride.driver.alert.BookingAlert.fullScreenAllowed(app)) out += Check(false, "Bookings cannot open the screen", "Allow full-screen alerts so a booking shows over other apps", "Allow", soft = true, fix = "fullscreen")
                if (com.ninejaride.driver.alert.BookingAlert.needsDndAccess(app)) out += Check(false, "Bookings may stay silent in Do Not Disturb", "Allow Do Not Disturb access so the booking ring is heard", "Allow", soft = true, fix = "dnd")
            }
            return out
        }

    fun askGoOnline() {
        if (goOnlineChecks.all { it.ok }) dialog = Dialog.GoOnline else push(Dest.GoOnlineChecks)
    }

    fun confirmGoOnline() { dialog = null; wentOnline(true) }
    fun confirmGoOffline() { dialog = null; wentOnline(false) }

    private var offerJob: Job? = null

    private var watchingAlerts = false

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
            }
        }
    }

    /** Bumped when the driver comes back from a settings page, so the checks are read again. */
    var checksTick by mutableIntStateOf(0)

    /** Opens the phone setting that fixes a booking-alert check. */
    fun openAlertSetting(kind: String) {
        val app = getApplication<Application>()
        val intent = when (kind) {
            "notifications" -> android.content.Intent(android.provider.Settings.ACTION_APP_NOTIFICATION_SETTINGS).putExtra(android.provider.Settings.EXTRA_APP_PACKAGE, app.packageName)
            "fullscreen" -> if (android.os.Build.VERSION.SDK_INT >= 34) android.content.Intent(android.provider.Settings.ACTION_MANAGE_APP_USE_FULL_SCREEN_INTENT, android.net.Uri.parse("package:${app.packageName}")) else null
            else -> android.content.Intent(android.provider.Settings.ACTION_NOTIFICATION_POLICY_ACCESS_SETTINGS)
        } ?: return
        runCatching { app.startActivity(intent.addFlags(android.content.Intent.FLAG_ACTIVITY_NEW_TASK)) }
    }

    private fun wentOnline(on: Boolean) {
        offerJob?.cancel()
        if (!demo) {
            // With a real server, "online" means the service is sharing the phone's position. No permission, no online.
            if (on && !LocationService.start(getApplication())) { online = false; dialog = Dialog.LocationDenied; return }
            if (!on) LocationService.stop(getApplication())
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
                lm.requestLocationUpdates(provider, 5_000L, 10f, listener, Looper.getMainLooper())
            }
            locationListener = listener
        } catch (e: SecurityException) {
            // Permission was withdrawn between the check and the call: stay on the default view.
        }
    }

    override fun onCleared() {
        locationListener?.let { l -> getApplication<Application>().getSystemService(LocationManager::class.java)?.removeUpdates(l) }
        super.onCleared()
    }

    private fun clearRide() { carPoint = null; routeToPickup = emptyList(); routeTrip = emptyList() }

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
    var stopReason by mutableStateOf<String?>(null)
    var rating by mutableIntStateOf(5)
    var ratingTags by mutableStateOf(setOf("Polite", "On time"))
    var sosSteps by mutableIntStateOf(1)
    var sosAdmin by mutableStateOf<String?>(null)
    private var rideJob: Job? = null

    // ------------------------------------------------------------------ real rides (a server, not the script)
    private var pollJob: Job? = null
    private var tripStartedPoint: MapPoint? = null

    private fun say(title: String, text: String) { toast = title to text }

    /** While online: pick up a ride already in progress, then keep asking the server for offers and watching the ride. */
    private fun startRealRideLoop() {
        if (demo) return
        pollJob?.cancel()
        pollJob = viewModelScope.launch {
            runCatching { api.activeRide() }.getOrNull()?.let { restoreRide(it) }
            while (true) {
                try {
                    when (phase) {
                        Phase.None -> if (online) api.offer()?.let { showRealOffer(it) }
                        Phase.ToPickup, Phase.Waiting -> if (api.activeRide() == null) {
                            // The rider cancelled (or the ride ended some other way): nothing left to do here.
                            rideJob?.cancel(); clearRide(); realRideId = null; phase = Phase.None
                            say("Ride cancelled", "The rider cancelled this ride.")
                        }
                        else -> {}
                    }
                } catch (e: ApiException) {
                    if (e.status == 401 || e.status == 403) return@launch // signed out or suspended: stop asking
                }
                delay(3000)
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
        deviceLocation?.let { from -> viewModelScope.launch { routeToPickup = Routing.route(from, demoPickup) } }
        rideJob?.cancel()
        rideJob = viewModelScope.launch { while (phase == Phase.ToPickup) { carPoint = deviceLocation ?: carPoint; delay(1000) } }
    }

    private fun beginWaiting() {
        waitingSeconds = 0
        phase = Phase.Waiting
        rideJob?.cancel()
        rideJob = viewModelScope.launch { while (phase == Phase.Waiting) { delay(1000); waitingSeconds++ } }
    }

    private fun beginTripLeg() {
        tripSeconds = 0; tripKm = 0.0; stopReason = null
        tripStartedPoint = deviceLocation
        phase = Phase.InTrip
        rideJob?.cancel()
        rideJob = viewModelScope.launch {
            var last = deviceLocation
            while (phase == Phase.InTrip) {
                delay(1000)
                tripSeconds++
                val now = deviceLocation
                if (now != null) {
                    // distance really driven, from the phone's own readings; tiny jumps are GPS noise
                    if (last != null) { val d = Routing.haversineKm(last, now); if (d > 0.008) { tripKm += d; last = now } } else last = now
                    carPoint = now
                }
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
            receipt = FareReceipt(fare.lines.map { FareLine(it.first, it.second) }, fare.totalKobo, fare.commissionKobo, fare.driverEarnKobo, if (fare.totalKobo > 0) Math.round(fare.commissionKobo * 100.0 / Math.max(1L, fare.totalKobo - fare.taxKobo)).toInt() else 0)
            phase = Phase.Collect
            loadAccount() // today's earnings, the trip list and the wallet now include this trip
        }
    }

    /** Cash trip: the service charge comes out of the wallet, which can take it below zero. */
    fun cashCollected() {
        if (!demo) { rating = 5; phase = Phase.Rate; return } // the server settled the trip when it ended
        val r = DEMO_RECEIPT
        walletKobo -= r.serviceCharge
        transactions.add(0, WalletTx("Service charge · trip ${offer.code}", "Just now", r.serviceCharge, TxDirection.Out))
        earningsKobo += r.earn
        tripsToday += 1
        kmToday += 0.65
        trips.add(0, TripRecord(offer.code, "Today, just now", r, offer.pickup, offer.dropoff, 0.65, 555, offer.payment, offer.rider))
        rating = 5
        phase = Phase.Rate
    }

    fun toggleTag(tag: String) { ratingTags = if (tag in ratingTags) ratingTags - tag else ratingTags + tag }

    fun finishRide() {
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
        if (!demo) server("The alert could not be sent. Call 112 now.") { api.sos(java.util.UUID.randomUUID().toString(), deviceLocation ?: demoPickup.takeIf { realRideId != null }) }
        dialog = null
        phaseBeforeSos = phase
        sosSteps = 1
        sosAdmin = null
        phase = Phase.SosSent
        sosJob?.cancel()
        sosJob = viewModelScope.launch {
            delay(1500); sosSteps = 2
            delay(5000); sosSteps = 3; sosAdmin = "Ada, Safety team"
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
