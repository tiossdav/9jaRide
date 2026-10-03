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
import com.ninejaride.driver.data.BatteryGuidance
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

enum class Dialog { OtpMethod, SignedIn, GoOnline, GoOffline, Sos, Logout, DateFilter, NotRegistered, LocationDenied, Battery }

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

    private var resendJob: Job? = null

    fun sendCode() {
        dialog = null
        message = null
        viewModelScope.launch {
            busy = true
            try {
                if (!demo) api.requestOtp(intlPhone(), voiceCode)
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

    fun onOtpChange(v: String) { otp = v.filter { it.isDigit() }.take(OTP_LENGTH); message = null }

    fun verify() {
        if (otp.length != OTP_LENGTH) return
        viewModelScope.launch {
            busy = true
            message = null
            try {
                if (!demo) api.verifyOtp(intlPhone(), otp)
                signedIn()
            } catch (e: ApiException) {
                if (e.code == "registration_required" || e.code == "not_a_driver") dialog = Dialog.NotRegistered
                else message = e.message
            } finally { busy = false }
        }
    }

    /** Shown at the top of whatever comes next, with no button to press. */
    var toast by mutableStateOf<Pair<String, String>?>(null)

    private fun signedIn() {
        toast = "Sign in successful" to "You have signed in to your account."
        finishSignIn()
    }

    fun finishSignIn() {
        dialog = null
        reset(Dest.LocationPermission)
    }

    fun locationDone() {
        reset(Dest.Main)
        tab = Tab.Home
    }

    private fun intlPhone() = "+234" + phoneDigits.drop(1)

    // ------------------------------------------------------------------ start-up
    fun boot() {
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
                    reset(Dest.Main)
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
            phoneDigits = ""; otp = ""
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

    fun saveNin(nin: String) { profile = profile.copy(nin = nin) }

    var profile by mutableStateOf(DEMO_PROFILE)
    var walletKobo by mutableLongStateOf(0L)
    var earningsKobo by mutableLongStateOf(226_000L)
    var tripsToday by mutableIntStateOf(1)
    var kmToday by mutableStateOf(0.65)
    var hoursToday by mutableStateOf(0.0)
    var emailSent by mutableStateOf(false)
    var bonusKobo by mutableLongStateOf(0L)

    val trips = mutableStateListOf(
        TripRecord("7K3M-92QD", "Today, 10:18 AM", DEMO_RECEIPT, "CXX4+65G, Akobo, Ibadan", "Iwo Road, Ibadan", 0.65, 555, "Cash", Rider("Olaoluwa", 5)),
    )
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
            out += if (profile.active) Check(true, "Account active", "Approved by 9jaRide") else Check(false, "Account not active", "Contact support")
            out += if (v != null) Check(true, "Vehicle added", "${v.model} · ${v.colour} · ${v.plate}") else Check(false, "No vehicle on your account", "Contact support")
            out += if (walletKobo >= 0) Check(true, "Wallet is clear", "Balance ${naira(walletKobo)}")
            else Check(false, "Wallet balance is ${naira(walletKobo)}", "Top up at least ${naira(-walletKobo)} to continue", "Top up")
            if (walletKobo < 0 && !profile.emailVerified) out += Check(false, "Email not verified", "Needed to fund your wallet", "Verify")
            return out
        }

    fun askGoOnline() {
        if (goOnlineChecks.all { it.ok }) dialog = Dialog.GoOnline else push(Dest.GoOnlineChecks)
    }

    fun confirmGoOnline() { dialog = null; wentOnline(true) }
    fun confirmGoOffline() { dialog = null; wentOnline(false) }

    private var offerJob: Job? = null

    private fun wentOnline(on: Boolean) {
        offerJob?.cancel()
        if (!demo) {
            // With a real server, "online" means the service is sharing the phone's position. No permission, no online.
            if (on && !LocationService.start(getApplication())) { online = false; dialog = Dialog.LocationDenied; return }
            if (!on) LocationService.stop(getApplication())
        }
        online = on
        if (on && demo) scheduleOffer(6)
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
    val demoPickup = MapPoint(7.4303, 3.9568)
    val demoDropoff = MapPoint(7.4237, 3.9529)
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

    fun decline() { rideJob?.cancel(); clearRide(); phase = Phase.None; if (online) scheduleOffer(20) }

    fun accept() {
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
        waitingSeconds = 0
        carPoint = demoPickup
        phase = Phase.Waiting
        rideJob?.cancel()
        rideJob = viewModelScope.launch { while (phase == Phase.Waiting) { delay(1000); waitingSeconds++ } }
    }

    fun noShow() { rideJob?.cancel(); clearRide(); phase = Phase.None; if (online) scheduleOffer(20) }

    fun cancelTrip() { rideJob?.cancel(); clearRide(); phase = Phase.None; if (online) scheduleOffer(20) }

    fun startTrip() {
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

    fun endTrip() { rideJob?.cancel(); carPoint = demoDropoff; phase = Phase.Collect }

    /** Cash trip: the service charge comes out of the wallet, which can take it below zero. */
    fun cashCollected() {
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
        phase = Phase.None
        tab = Tab.Home
        if (online) scheduleOffer(25)
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

    companion object { const val OTP_LENGTH = 6 }
}
