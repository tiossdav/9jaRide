package com.ninejaride.rider.state

import android.app.Application
import android.content.Context
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import com.ninejaride.core.data.ApiClient
import com.ninejaride.core.data.ApiException
import com.ninejaride.core.data.MapPoint
import com.ninejaride.core.data.Geocoding
import com.ninejaride.core.data.Place
import com.ninejaride.core.data.RouteInfo
import com.ninejaride.core.data.Routing
import com.ninejaride.core.location.DeviceLocation
import com.ninejaride.core.ui.theme.C
import com.ninejaride.rider.BuildConfig
import com.ninejaride.rider.data.Profile
import com.ninejaride.rider.data.Quote
import com.ninejaride.rider.data.Receipt
import com.ninejaride.rider.data.RideListItem
import com.ninejaride.rider.data.RideView
import com.ninejaride.rider.data.RiderApi
import com.ninejaride.rider.data.ScheduleView
import com.ninejaride.rider.data.Wallet
import com.ninejaride.rider.data.WalletTx
import kotlinx.coroutines.Job
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import java.time.DayOfWeek
import java.time.LocalDate
import java.time.LocalTime
import java.time.ZoneId
import java.time.temporal.TemporalAdjusters

sealed interface Dest {
    data object Splash : Dest
    data object Welcome : Dest
    data object SignUp : Dest
    data object SignIn : Dest
    data object Otp : Dest
    data object LocationPermission : Dest
    data object Main : Dest
    data object WhereTo : Dest
    data object SetOnMap : Dest
    data object SelectRide : Dest
    data object WalletHold : Dest
    data object ScheduleForm : Dest
    data object ScheduleConfirm : Dest
    data class TripDetails(val rideId: String) : Dest
    data class Receipt(val rideId: String) : Dest
    data class ReportProblem(val rideId: String) : Dest
    data object Wallet : Dest
    data object TopUp : Dest
    data object PersonalDetails : Dest
    data object Refer : Dest
    data object Help : Dest
    data object DeleteAccount : Dest
    data object Inbox : Dest
}

/** Sheets and dialogs drawn over whatever screen is showing. */
enum class Dialog { OtpDone, NotAllowed, CancelRide, NoDriver, Logout, Appearance, SchedDate, SchedTime, SchedFirstDate, ScheduleDone, CancelScheduled, TripsFilter, Notice }

val CANCEL_REASONS = listOf("Driver is taking too long", "I changed my plans", "Booked by mistake", "Driver asked me to cancel", "Other")
/** The categories on offer right now, in the order an admin set. Filled from the server; these three are only the first-run fallback. */
var CATEGORY_NAMES: Map<String, String> = linkedMapOf("regular" to "Regular", "comfort" to "Comfort", "package" to "Send Package")
val CATEGORIES: List<String> get() = CATEGORY_NAMES.keys.toList()
val LAGOS: ZoneId = ZoneId.of("Africa/Lagos")

fun categoryLabel(c: String) = CATEGORY_NAMES[c] ?: c.replace('_', ' ').replaceFirstChar { it.uppercase() }

/** Shown until the server's cards arrive, or when they cannot be fetched. Same wording as the server's starting set. */
val DEFAULT_HOME_CARDS = listOf(
    com.ninejaride.rider.data.HomeCard("d-invite", "invite", "Invite & Earn ₦1,000", "Invite your friends to 9jaRide and earn rewards when they complete their first eligible ride."),
    com.ninejaride.rider.data.HomeCard("d-note", "announcement", "Welcome to 9jaRide", "Safe, fairly priced rides across Lagos. Book now or schedule ahead."),
    com.ninejaride.rider.data.HomeCard("d-safe1", "safety", "Check before you ride", "Verify your driver's name, photo and vehicle plate before you get in."),
    com.ninejaride.rider.data.HomeCard("d-safe2", "safety", "Share your trip", "Let someone you trust know where you are going, and keep the SOS button within reach."),
    com.ninejaride.rider.data.HomeCard("d-feat", "feature", "Schedule ahead", "Book a ride for later, or set it to repeat every week."),
    com.ninejaride.rider.data.HomeCard("d-feat2", "feature", "Pay your way", "Pay from your wallet or in cash. Top up your wallet in a few taps."),
    com.ninejaride.rider.data.HomeCard("d-safe3", "safety", "Use SOS if you need help", "The SOS button on your trip screen alerts our safety team with your location."),
)

class RiderViewModel(app: Application) : AndroidViewModel(app) {
    private val client = ApiClient(app, BuildConfig.API_BASE_URL, BuildConfig.VERSION_NAME)
    val api = RiderApi(client)
    val location = DeviceLocation(app)
    private val prefs = app.getSharedPreferences("rider_state", Context.MODE_PRIVATE)

    // ------------------------------------------------------------------ navigation
    val stack = mutableStateListOf<Dest>(Dest.Splash)
    var tab by mutableIntStateOf(0)
    var dialog by mutableStateOf<Dialog?>(null)
    var notice by mutableStateOf<String?>(null)
    val current: Dest get() = stack.last()

    /** Asks "are you sure?" first; [action] runs only if the rider taps the confirm button. */
    var pendingConfirm by mutableStateOf<com.ninejaride.core.ui.components.ConfirmRequest?>(null)
    fun confirm(title: String, text: String, label: String, danger: Boolean = false, action: () -> Unit) {
        pendingConfirm = com.ninejaride.core.ui.components.ConfirmRequest(title, text, label, danger, action)
    }

    fun push(d: Dest) { stack.add(d) }
    fun pop() { if (stack.size > 1) stack.removeAt(stack.lastIndex) }
    fun reset(d: Dest) { stack.clear(); stack.add(d) }
    fun say(text: String) { notice = text; dialog = Dialog.Notice }

    /** Turns a failed call into a sentence the rider can act on. */
    private fun words(e: ApiException, fallback: String = "Something went wrong. Please try again."): String = when {
        e.isNetwork -> e.message
        e.status >= 500 -> fallback
        else -> e.message
    }

    // ------------------------------------------------------------------ appearance
    var appearance by mutableStateOf(prefs.getString("appearance", "dark") ?: "dark") // system | light | dark
    fun chooseAppearance(v: String) { appearance = v; prefs.edit().putString("appearance", v).apply(); dialog = null }

    // ------------------------------------------------------------------ sign-in and sign-up
    var phoneDigits by mutableStateOf("")
    var fullName by mutableStateOf("")
    var voiceCode by mutableStateOf(false)
    var otp by mutableStateOf("")
    /** How many digits the code has, and whether the server is using its fixed test code. Both come from the server with each request. */
    var otpLength by mutableIntStateOf(6)
    var otpTestMode by mutableStateOf(false)
    var resendSeconds by mutableIntStateOf(170)
    var busy by mutableStateOf(false)
    var message by mutableStateOf<String?>(null)
    var profile by mutableStateOf<Profile?>(null)
    private var ticket: String? = null
    private var resendJob: Job? = null

    val phoneValid get() = phoneDigits.length == 11 && phoneDigits.startsWith("0")
    val maskedPhone get() = if (phoneDigits.length == 11) phoneDigits.take(3) + " *** " + phoneDigits.takeLast(4) else phoneDigits
    private fun intlPhone() = "+234" + phoneDigits.drop(1)

    fun onPhoneChange(v: String) { phoneDigits = v.filter { it.isDigit() }.take(11); message = null }
    fun onOtpChange(v: String) {
        otp = v.filter { it.isDigit() }.take(otpLength); message = null
        if (otp.length == otpLength && !busy) verify() // no button to press once the code is complete
    }

    /** Sign-up asks for a name first; sign-in does not. */
    fun sendCode(needName: Boolean) {
        if (!phoneValid) { message = "Enter your 11-digit mobile number."; return }
        if (needName && fullName.trim().length < 2) { message = "Enter your full name."; return }
        requestCode()
    }

    fun requestCode(voice: Boolean = voiceCode) {
        voiceCode = voice
        message = null
        viewModelScope.launch {
            busy = true
            try {
                val info = api.requestOtp(intlPhone(), voice)
                otpLength = info.codeLength; otpTestMode = info.testMode
                otp = ""
                resendSeconds = 170
                if (current != Dest.Otp) push(Dest.Otp)
                resendJob?.cancel()
                resendJob = launch { while (resendSeconds > 0) { delay(1000); resendSeconds-- } }
            } catch (e: ApiException) { message = words(e) } finally { busy = false }
        }
    }

    fun verify() {
        if (otp.length != otpLength) return
        viewModelScope.launch {
            busy = true
            message = null
            try {
                val s = api.verifyOtp(intlPhone(), otp)
                if (s.role != "rider") { api.dropSession(); dialog = Dialog.NotAllowed; return@launch }
                signedIn()
            } catch (e: ApiException) {
                val t = e.ticket
                if (e.code == "registration_required" && t != null) {
                    ticket = t
                    if (fullName.trim().length >= 2) completeRegistration() else { message = "Welcome! Tell us your name to finish."; reset(Dest.SignUp) }
                } else message = words(e)
            } finally { busy = false }
        }
    }

    /** The code was right but the number is new: create the account with the name given at sign-up. */
    fun completeRegistration() {
        val t = ticket ?: return
        if (fullName.trim().length < 2) { message = "Enter your full name."; return }
        viewModelScope.launch {
            busy = true
            try {
                api.register(t, fullName.trim())
                ticket = null
                signedIn()
            } catch (e: ApiException) { message = words(e) } finally { busy = false }
        }
    }

    val needsNameToFinish get() = ticket != null

    /** Shown at the top of whatever comes next, with no button to press. */
    var toast by mutableStateOf<Pair<String, String>?>(null)

    private fun signedIn() {
        toast = "Sign in successful" to "You have signed in to your account."
        finishSignIn()
    }

    fun finishSignIn() {
        dialog = null
        reset(if (location.hasPermission()) Dest.Main else Dest.LocationPermission)
        afterSignIn()
    }

    fun locationDone() { reset(Dest.Main); afterSignIn(); location.start() }

    /** Which kinds of ride to show. Asked of the server so an admin's changes appear without a new app. */
    fun loadCategories() {
        viewModelScope.launch { runCatching { api.categories() }.getOrNull()?.takeIf { it.isNotEmpty() }?.let { list -> CATEGORY_NAMES = list.associate { it.code to it.label }; categoriesVersion++ } }
    }
    var categoriesVersion by mutableIntStateOf(0)

    private fun afterSignIn() {
        loadCategories()
        viewModelScope.launch { com.ninejaride.core.data.Push.register(getApplication(), client) } // so trip updates reach this phone
        viewModelScope.launch { profile = runCatching { api.profile() }.getOrNull() }
        refreshWallet()
        refreshTrips()
        resumeRide()
    }

    fun boot() {
        // a hosted server that went to sleep starts now, while the splash screen is showing
        viewModelScope.launch(kotlinx.coroutines.Dispatchers.IO) { runCatching { client.wake() } }
        viewModelScope.launch {
            delay(1200)
            if (api.session == null) { reset(Dest.Welcome); return@launch }
            try {
                profile = api.profile()
                loadCategories()
                reset(Dest.Main)
                location.start()
                refreshWallet(); refreshTrips(); resumeRide()
            } catch (e: ApiException) {
                if (e.status == 401 || e.status == 403) reset(Dest.Welcome) else { reset(Dest.Main); location.start() } // offline: keep the session
            }
        }
    }

    fun logout() {
        dialog = null
        viewModelScope.launch {
            pollJob?.cancel(); ride = null
            api.logout()
            profile = null; phoneDigits = ""; otp = ""; fullName = ""
            history.clear(); schedules.clear(); wallet = null
            reset(Dest.Welcome)
        }
    }

    // ------------------------------------------------------------------ places and booking
    var pickup by mutableStateOf<Place?>(null)
    var dropoff by mutableStateOf<Place?>(null)
    var pickupText by mutableStateOf("")
    var dropoffText by mutableStateOf("")
    var activeField by mutableIntStateOf(1) // 0 pickup, 1 drop-off
    var suggestions by mutableStateOf<List<Place>>(emptyList())
    var searching by mutableStateOf(false)
    var mapPinAddress by mutableStateOf<String?>(null)
    private var mapPinPoint: MapPoint? = null
    private var searchJob: Job? = null

    /** The pickup defaults to where the phone is. Called when the Where-to screen opens. */
    /** Bumped each time the rider taps "my location", so the map moves back to them even if they had panned away. */
    var focusTick by mutableIntStateOf(0)

    /** The location button on the map: centre on the rider and use that spot as the pickup. */
    fun locateMe() {
        if (!location.hasPermission()) { push(Dest.LocationPermission); return }
        location.start()
        focusTick++
        val here = location.point ?: run { say("We are still finding you. Try again in a moment."); return }
        pickup = Place("Current location", here)
        pickupText = "Current location"
        viewModelScope.launch { Geocoding.reverse(here)?.let { pickup = Place(it, here); pickupText = it } }
    }

    fun prepareBooking() {
        if (pickup == null) {
            val here = location.point
            if (here != null) {
                pickup = Place("Current location", here)
                pickupText = "Current location"
                viewModelScope.launch { Geocoding.reverse(here)?.let { pickup = Place(it, here); pickupText = it } }
            }
        }
        activeField = 1
    }

    fun onFieldText(field: Int, text: String) {
        activeField = field
        if (field == 0) { pickupText = text; pickup = null } else { dropoffText = text; dropoff = null }
        searchJob?.cancel()
        if (text.trim().length < 3) { suggestions = emptyList(); searching = false; return }
        searching = true
        searchJob = viewModelScope.launch {
            delay(if (Geocoding.fast) 600 else 800) // a short pause after typing; the OpenStreetMap half of the search allows about one request a second
            suggestions = Geocoding.search(text.trim(), location.point)
            searching = false
        }
    }

    fun choosePlace(p: Place) {
        suggestions = emptyList()
        if (activeField == 0) { pickup = p; pickupText = p.address; activeField = 1 } else { dropoff = p; dropoffText = p.address }
        if (pickup != null && dropoff != null) goToRideSelection()
    }

    // set-on-map
    fun onMapMoved(p: MapPoint) {
        mapPinPoint = p
        searchJob?.cancel()
        searchJob = viewModelScope.launch {
            delay(900)
            mapPinAddress = Geocoding.reverse(p) ?: "Pinned location"
        }
    }

    fun confirmMapPin() {
        val p = mapPinPoint ?: return
        val place = Place(mapPinAddress ?: "Pinned location", p)
        if (activeField == 0) { pickup = place; pickupText = place.address } else { dropoff = place; dropoffText = place.address }
        pop() // back to Where to
        if (pickup != null && dropoff != null) goToRideSelection()
    }

    var route by mutableStateOf<RouteInfo?>(null)
    val quotes = mutableStateOf<Map<String, Quote?>>(emptyMap())
    var quotesLoading by mutableStateOf(false)
    var quotesError by mutableStateOf<String?>(null)
    var selectedCategory by mutableStateOf("regular")
    var payMethod by mutableStateOf("cash")
    var requesting by mutableStateOf(false)

    // ---- promo code
    var promoText by mutableStateOf("")
    var promo by mutableStateOf<com.ninejaride.rider.data.PromoResult?>(null)
    var promoMessage by mutableStateOf<String?>(null)
    var promoChecking by mutableStateOf(false)

    fun applyPromo() {
        val r = route ?: return
        val code = promoText.trim()
        if (code.length < 3) { promoMessage = "Enter a promo code."; return }
        viewModelScope.launch {
            promoChecking = true; promoMessage = null
            try { promo = api.checkPromo(code, selectedCategory, r.distanceM, r.durationS); promoText = promo!!.code }
            catch (e: ApiException) { promo = null; promoMessage = words(e, "We could not check that code. Please try again.") }
            finally { promoChecking = false }
        }
    }

    fun clearPromo() { promo = null; promoMessage = null; promoText = "" }

    /** A code is checked against one category; choosing another one asks again. */
    fun chooseCategory(c: String) { selectedCategory = c; if (promo != null) { val keep = promoText; promo = null; promoText = keep; applyPromo() } }
    private var rideKey: String? = null

    fun goToRideSelection() {
        val a = pickup ?: return
        val b = dropoff ?: return
        route = null; quotes.value = emptyMap(); quotesError = null
        if (current != Dest.SelectRide) push(Dest.SelectRide)
        loadQuotes(a, b)
    }

    private fun loadQuotes(a: Place, b: Place) {
        viewModelScope.launch {
            quotesLoading = true
            val r = Routing.routeInfo(a.point, b.point)
            route = r
            val results = CATEGORIES.map { c ->
                async {
                    try { c to api.quote(c, r.distanceM, r.durationS) } catch (e: ApiException) { c to null }
                }
            }.awaitAll().toMap()
            quotes.value = results
            quotesError = if (results.values.all { it == null }) "Fares are not available right now. Check your connection and try again." else null
            if (quotes.value[selectedCategory] == null) selectedCategory = CATEGORIES.firstOrNull { quotes.value[it] != null } ?: "regular"
            quotesLoading = false
        }
        refreshWallet()
    }

    /** Wallet rides hold the top of the fare range, so the rider must have at least that much free. */
    fun requestRide() {
        val a = pickup ?: return
        val b = dropoff ?: return
        val q = quotes.value[selectedCategory] ?: return
        val w = wallet
        if (payMethod == "wallet" && (w == null || w.availableKobo < q.highKobo)) { push(Dest.WalletHold); return }
        if (requesting) return
        viewModelScope.launch {
            requesting = true
            val key = rideKey ?: RiderApi.newKey().also { rideKey = it }
            try {
                val id = try {
                    api.requestRide(key, q.id, selectedCategory, payMethod, a.point, a.address, b.point, b.address, promo?.code)
                } catch (e: ApiException) {
                    if (e.code != "quote_invalid") throw e
                    // The quote only lasts five minutes: take a fresh one and try again once.
                    val r = route ?: Routing.routeInfo(a.point, b.point)
                    val fresh = api.quote(selectedCategory, r.distanceM, r.durationS)
                    api.requestRide(RiderApi.newKey().also { rideKey = it }, fresh.id, selectedCategory, payMethod, a.point, a.address, b.point, b.address, promo?.code)
                }
                rideKey = null
                startWatching(id)
                // leave the booking screens behind: the ride screens take over
                reset(Dest.Main)
                tab = 0
            } catch (e: ApiException) {
                when {
                    e.status == 402 -> push(Dest.WalletHold)
                    else -> say(words(e, "We could not request a ride. Please try again."))
                }
            } finally { requesting = false }
        }
    }

    fun clearBooking() { promo = null; promoText = ""; promoMessage = null; pickup = null; dropoff = null; pickupText = ""; dropoffText = ""; suggestions = emptyList(); route = null; quotes.value = emptyMap(); rideKey = null }

    // ------------------------------------------------------------------ the ride in progress
    var ride by mutableStateOf<RideView?>(null)
    var driverPoint by mutableStateOf<MapPoint?>(null)
    var driverEtaMin by mutableStateOf<Int?>(null)
    var tripEtaMin by mutableStateOf<Int?>(null)
    var tripRoute by mutableStateOf<List<MapPoint>>(emptyList()) // the road still to go to the drop-off, from where the driver is now
    var pickupRoute by mutableStateOf<List<MapPoint>>(emptyList()) // the road from the driver to the pickup
    /** Metres of road left to the pickup / the drop-off, from the latest route. */
    var toPickupM by mutableStateOf<Int?>(null)
    var toDropM by mutableStateOf<Int?>(null)
    /** Metres the driver has really driven (from their GPS): to the pickup, and with the rider. */
    var pickupTravelledM by mutableStateOf(0)
    var tripTravelledM by mutableStateOf(0)
    /** When the driver's phone last reported, and the clock the screen compares it with. A reading older than 30 s is shown as not live. */
    var carAtMs by mutableStateOf(0L)
    var nowMs by mutableStateOf(System.currentTimeMillis())
    val carLive: Boolean get() = carAtMs > 0 && nowMs - carAtMs <= 30_000
    private var carAnim: Job? = null
    private var tripRouteFor: String? = null
    var searchSeconds by mutableIntStateOf(0)
    var rating by mutableIntStateOf(5)
    var ratingTags by mutableStateOf(setOf<String>())
    var ratingSent by mutableStateOf(false)
    var ratingComment by mutableStateOf("")
    /** True for the moment after feedback is sent, so the thank-you shows. */
    var feedbackThanks by mutableStateOf(false)
    var sosOpen by mutableStateOf(false)
    var sosSteps by mutableIntStateOf(0)
    var tripDone by mutableStateOf<RideView?>(null) // a finished ride waiting to be rated
    var cancelReason by mutableStateOf<String?>(null)
    private var pollJob: Job? = null
    private var etaAt = 0L

    private fun resumeRide() {
        viewModelScope.launch { runCatching { api.activeRideId() }.getOrNull()?.let { startWatching(it) } }
    }

    /** Whether the app is on screen. The phone's GPS and the live position of the car are only used while it is. */
    var visible by mutableStateOf(true)
    private var carJob: Job? = null
    private var clockJob: Job? = null
    private val watchedStatuses = setOf("DRIVER_ASSIGNED", "DRIVER_ARRIVED", "TRIP_STARTED")

    /** The "For you" cards. Starts with a built-in set so the home screen is never bare, and is replaced by what staff have set up. */
    var homeCards by mutableStateOf(DEFAULT_HOME_CARDS)
    private var homeCardsAt = 0L

    private fun loadHomeCards() {
        if (api.session == null || System.currentTimeMillis() - homeCardsAt < 120_000) return
        homeCardsAt = System.currentTimeMillis()
        viewModelScope.launch { runCatching { api.homeCards() }.getOrNull()?.takeIf { it.isNotEmpty() }?.let { homeCards = it } }
    }

    fun onVisible(v: Boolean) {
        visible = v
        if (v) loadHomeCards()
        if (v) { if (api.session != null && location.hasPermission()) location.start() } else location.stop()
    }

    /**
     * Follows a ride until it ends. Three light jobs instead of one busy one:
     *  - the ride's status is asked for with the server holding the answer until it changes (about three requests a minute,
     *    and a change such as "driver arrived" is heard at once);
     *  - the car's position is fetched every 5 s, only while the app is on screen and the car is on its way;
     *  - the search clock counts in memory, with no network at all.
     * It survives the screen changing and stops on a terminal state.
     */
    fun startWatching(id: String) {
        pollJob?.cancel(); carJob?.cancel(); clockJob?.cancel()
        searchSeconds = 0
        fun stopHelpers() { carJob?.cancel(); clockJob?.cancel() }
        pollJob = viewModelScope.launch {
            var seen: String? = null
            while (true) {
                try {
                    val r = api.ride(id, waitFor = seen, waitSeconds = 20)
                    ride = r
                    seen = r.status
                    when (r.status) {
                        "TRIP_COMPLETED" -> { stopHelpers(); tripDone = r; ratingSent = r.myRating != null; refreshWallet(); refreshTrips(); return@launch }
                        "NO_DRIVER_FOUND" -> { stopHelpers(); dialog = Dialog.NoDriver; refreshTrips(); return@launch }
                        "CANCELLED_BY_RIDER", "CANCELLED_BY_DRIVER", "CANCELLED_BY_SYSTEM" -> {
                            stopHelpers()
                            if (r.status != "CANCELLED_BY_RIDER") say(if (r.status == "CANCELLED_BY_DRIVER") "Your driver cancelled this ride." else "This ride was cancelled.")
                            endRide(); refreshTrips(); return@launch
                        }
                    }
                } catch (e: ApiException) {
                    if (e.status == 404) { stopHelpers(); endRide(); return@launch }
                    delay(5_000) // a dropped connection is not the end of the ride: try again shortly
                }
            }
        }
        carJob = viewModelScope.launch {
            while (true) {
                val r = ride
                if (visible && r != null && r.status in watchedStatuses) {
                    runCatching { api.driverLocation(id) }.getOrNull()?.let { fix ->
                        pickupTravelledM = fix.pickupTravelledM; tripTravelledM = fix.tripTravelledM; carAtMs = fix.atMs
                        followRoad(r, fix.point)
                    }
                    nowMs = System.currentTimeMillis()
                    runCatching { updateEtas(r) }
                }
                delay(if (r == null) 1_000 else if (r.status == "DRIVER_ARRIVED") 10_000 else 5_000)
            }
        }
        clockJob = viewModelScope.launch {
            while (true) {
                val r = ride
                if (visible && (r?.status == "SEARCHING_DRIVER" || r?.status == "REQUESTED")) {
                    searchSeconds = ((System.currentTimeMillis() - (r.createdAt?.let { runCatching { java.time.Instant.parse(it).toEpochMilli() }.getOrNull() } ?: System.currentTimeMillis())) / 1000).toInt()
                }
                delay(1_000)
            }
        }
    }

    // ---- the live route: the road the driver is following, as last fetched, for the part of the ride in progress
    private var legRoute: List<MapPoint> = emptyList()
    private var legFor: String? = null
    private var legDurationS = 0
    private var legLengthM = 0.0
    private var offRoad = 0

    /** Fetches the road from the car to where it is heading: when the leg starts, after the driver leaves it, and every 30 s for traffic. */
    private suspend fun updateEtas(r: RideView, force: Boolean = false) {
        val now = System.currentTimeMillis()
        val leg = "${r.id}:${r.status}"
        if (!force && legFor == leg && now - etaAt < 30_000) return
        etaAt = now
        if (r.status == "DRIVER_ARRIVED") { driverEtaMin = null; toPickupM = null; pickupRoute = emptyList(); legRoute = emptyList(); legFor = leg; return }
        val d = carTarget ?: driverPoint ?: if (r.status == "TRIP_STARTED") r.pickup else return
        val to = if (r.status == "TRIP_STARTED") r.dropoff else r.pickup
        val info = Routing.routeInfo(d, to)
        legRoute = info.points; legDurationS = info.durationS; legLengthM = com.ninejaride.core.data.RouteProgress.lengthM(info.points); legFor = leg; offRoad = 0
        if (r.status == "TRIP_STARTED") { tripRoute = info.points; tripRouteFor = r.id; pickupRoute = emptyList(); tripEtaMin = (info.durationS / 60).coerceAtLeast(1); toDropM = info.distanceM }
        else { pickupRoute = info.points; driverEtaMin = (info.durationS / 60).coerceAtLeast(1); toPickupM = info.distanceM }
    }

    /**
     * A new position from the driver: the car is put on the road and slides there, the road behind it is no longer drawn,
     * and the time and distance left shrink with it. A driver who has left the road twice in a row gets a new route.
     */
    private suspend fun followRoad(r: RideView, p: MapPoint) {
        val fix = if (legFor == "${r.id}:${r.status}") com.ninejaride.core.data.RouteProgress.locate(legRoute, p) else null
        if (fix == null || fix.offRouteM > com.ninejaride.core.data.RouteProgress.OFF_ROUTE_M) {
            moveCarTo(p)
            if (fix != null && ++offRoad >= 2) runCatching { updateEtas(r, force = true) }
            return
        }
        offRoad = 0
        moveCarTo(fix.onRoad)
        val mins = com.ninejaride.core.data.RouteProgress.minutesLeft(legDurationS, legLengthM, fix.remainingM)
        if (r.status == "TRIP_STARTED") { tripRoute = fix.ahead; toDropM = fix.remainingM.toInt(); tripEtaMin = mins }
        else if (r.status == "DRIVER_ASSIGNED") { pickupRoute = fix.ahead; toPickupM = fix.remainingM.toInt(); driverEtaMin = mins }
    }

    private var carTarget: MapPoint? = null

    /** Slides the car to its new place over a few seconds instead of jumping, unless it is far away or has not been shown yet. */
    private fun moveCarTo(to: MapPoint) {
        carTarget = to
        val from = driverPoint
        carAnim?.cancel()
        if (from == null || Routing.haversineKm(from, to) > 0.5) { driverPoint = to; return }
        carAnim = viewModelScope.launch {
            val steps = 16
            for (i in 1..steps) {
                val t = i / steps.toDouble()
                driverPoint = MapPoint(from.lat + (to.lat - from.lat) * t, from.lng + (to.lng - from.lng) * t)
                delay(280)
            }
        }
    }

    fun askCancel() { cancelReason = null; dialog = Dialog.CancelRide }

    fun confirmCancel() {
        val r = ride ?: return
        val reason = cancelReason
        dialog = null
        viewModelScope.launch {
            try {
                api.cancel(r.id, reason)
                endRide(); refreshTrips()
            } catch (e: ApiException) { say(words(e, "We could not cancel the ride. Please try again.")) }
        }
    }

    fun submitRating() {
        val r = tripDone ?: return
        viewModelScope.launch {
            try {
                if (r.myRating == null) { api.rate(r.id, rating, ratingTags.toList(), ratingComment); feedbackThanks = true }
                ratingSent = true
            } catch (e: ApiException) { say(words(e)); finishTrip(showReceipt = true) }
        }
    }

    /** Leave the "trip complete" screen. */
    fun finishTrip(showReceipt: Boolean) {
        val id = tripDone?.id
        endRide()
        if (showReceipt && id != null) { tab = 0; push(Dest.Receipt(id)) }
    }

    fun endRide() {
        pollJob?.cancel()
        ride = null; tripDone = null; driverPoint = null; driverEtaMin = null; tripEtaMin = null; tripRoute = emptyList(); tripRouteFor = null
        pickupRoute = emptyList(); toPickupM = null; toDropM = null; pickupTravelledM = 0; tripTravelledM = 0; carAtMs = 0; carTarget = null; carAnim?.cancel()
        legRoute = emptyList(); legFor = null; offRoad = 0
        rating = 5; ratingTags = emptySet(); ratingComment = ""; feedbackThanks = false; ratingSent = false; sosOpen = false; sosSteps = 0; cancelReason = null
        clearBooking()
        if (dialog == Dialog.CancelRide || dialog == Dialog.NoDriver) dialog = null
        etaAt = 0
    }

    fun setStars(n: Int) { rating = n; ratingTags = com.ninejaride.core.ui.components.QuickComments.keep(n, ratingTags) }

    fun toggleTag(t: String) { ratingTags = if (t in ratingTags) ratingTags - t else ratingTags + t }

    fun retryAfterNoDriver() {
        dialog = null
        val a = ride?.let { Place(it.pickupAddress ?: "Pickup", it.pickup) }
        val b = ride?.let { Place(it.dropoffAddress ?: "Drop-off", it.dropoff) }
        endRide()
        if (a != null && b != null) { pickup = a; dropoff = b; pickupText = a.address; dropoffText = b.address; push(Dest.WhereTo); goToRideSelection() }
    }

    // ------------------------------------------------------------------ report a problem
    var reportSending by mutableStateOf(false)
    var reportNotice by mutableStateOf<String?>(null)
    val reports = mutableStateListOf<com.ninejaride.core.ui.components.MyReport>()
    private var reportKey: String? = null

    fun loadReports() { viewModelScope.launch { runCatching { api.myReports() }.getOrNull()?.let { reports.clear(); reports.addAll(it) } } }

    fun sendReport(topic: String, message: String) {
        val key = reportKey ?: RiderApi.newKey().also { reportKey = it }
        viewModelScope.launch {
            reportSending = true; reportNotice = null
            try { api.reportProblem(key, topic, message); reportKey = null; reportNotice = "Thank you. We have your report and will look into it."; loadReports() }
            catch (e: ApiException) { reportNotice = words(e, "We could not send that. Please try again.") }
            finally { reportSending = false }
        }
    }

    // ------------------------------------------------------------------ SOS
    private var sosKey: String? = null

    fun sendSos() {
        sosOpen = true
        sosSteps = 0
        val key = sosKey ?: RiderApi.newKey().also { sosKey = it }
        viewModelScope.launch {
            try {
                val res = api.sos(key, location.point ?: ride?.pickup)
                if (res.stored) { sosSteps = 2; sosKey = null }
            } catch (e: ApiException) { sosOpen = false; say("The alert could not be sent. Call 112 now.") }
        }
    }

    fun cancelSos() { sosOpen = false; sosSteps = 0 }

    // ------------------------------------------------------------------ wallet
    var wallet by mutableStateOf<Wallet?>(null)
    val walletTx = mutableStateListOf<WalletTx>()
    var openUrl by mutableStateOf<String?>(null)
    var topUpAmount by mutableStateOf(200_000L)
    var toppingUp by mutableStateOf(false)

    fun refreshWallet() {
        viewModelScope.launch {
            runCatching { api.wallet() }.getOrNull()?.let { wallet = it }
            runCatching { api.walletTransactions() }.getOrNull()?.let { walletTx.clear(); walletTx.addAll(it) }
        }
    }

    fun startTopUp(amountKobo: Long) {
        viewModelScope.launch {
            toppingUp = true
            try { openUrl = api.topUp(amountKobo) } catch (e: ApiException) {
                say(if (e.status >= 500) "Top-up is not available yet. Please try again later." else words(e))
            } finally { toppingUp = false }
        }
    }

    // ------------------------------------------------------------------ trips
    val history = mutableStateListOf<RideListItem>()

    /** The last few different places the rider went, newest first, for one-tap booking from the home screen. */
    val recentPlaces: List<Place>
        get() = history.filter { it.status == "TRIP_COMPLETED" && it.dropoff != null && !it.dropoffAddress.isNullOrBlank() }
            .distinctBy { it.dropoffAddress!!.substringBefore(',').trim().lowercase() }
            .take(3).map { Place(it.dropoffAddress!!, it.dropoff!!) }

    /** Books to a place picked on the home screen: straight to the ride options when the pickup is known, else to "Plan your ride". */
    fun bookTo(place: Place) {
        prepareBooking()
        activeField = 1
        dropoff = place; dropoffText = place.address
        if (pickup != null) goToRideSelection() else { activeField = 0; push(Dest.WhereTo) }
    }

    /** A quick action: start booking with this kind of ride already chosen. */
    fun bookCategory(code: String) {
        selectedCategory = code
        prepareBooking(); push(Dest.WhereTo)
    }
    val schedules = mutableStateListOf<ScheduleView>()
    var historyLoaded by mutableStateOf(false)
    var tripsTab by mutableIntStateOf(0) // 0 history, 1 scheduled
    var filterUpTo by mutableStateOf<LocalDate?>(null)
    var receipt by mutableStateOf<Receipt?>(null)
    var detailRide by mutableStateOf<RideView?>(null)

    fun refreshTrips() {
        viewModelScope.launch {
            runCatching { api.rides("history") }.getOrNull()?.let { history.clear(); history.addAll(it); historyLoaded = true }
            runCatching { api.schedules() }.getOrNull()?.let { schedules.clear(); schedules.addAll(it.filter { s -> s.status == "ACTIVE" }) }
        }
    }

    fun openTrip(id: String) {
        detailRide = null; receipt = null
        push(Dest.TripDetails(id))
        viewModelScope.launch { detailRide = runCatching { api.ride(id) }.getOrNull() }
    }

    fun loadReceipt(id: String) {
        receipt = null
        viewModelScope.launch { receipt = runCatching { api.receipt(id) }.getOrNull() }
    }

    // ------------------------------------------------------------------ scheduled rides
    var schedWeekly by mutableStateOf(false)
    var schedDate by mutableStateOf<LocalDate?>(null)
    var schedFirstDate by mutableStateOf<LocalDate?>(null)
    var schedTime by mutableStateOf(LocalTime.of(8, 0))
    var schedDays by mutableStateOf(setOf<DayOfWeek>())
    var schedSaving by mutableStateOf(false)
    private var schedKeys: List<String> = emptyList()

    fun openSchedule() {
        if (schedDate == null) schedDate = LocalDate.now(LAGOS).plusDays(1)
        if (schedFirstDate == null) schedFirstDate = LocalDate.now(LAGOS).plusDays(1)
        prepareBooking()
        push(Dest.ScheduleForm)
    }

    fun toggleDay(d: DayOfWeek) { schedDays = if (d in schedDays) schedDays - d else schedDays + d }

    val scheduleReady get() = pickup != null && dropoff != null && (if (schedWeekly) schedDays.isNotEmpty() && schedFirstDate != null else schedDate != null)

    /** How many weeks each weekday is booked for: the server allows 12 weeks and 30 waiting rides in all. */
    val scheduleWeeks get() = if (schedDays.isEmpty()) 12 else minOf(12, 30 / schedDays.size)

    fun reviewSchedule() {
        val a = pickup ?: return
        val b = dropoff ?: return
        route = null; quotes.value = emptyMap()
        push(Dest.ScheduleConfirm)
        loadQuotes(a, b)
    }

    private fun firstRideAt(day: LocalDate): java.time.Instant = day.atTime(schedTime).atZone(LAGOS).toInstant()

    fun saveSchedule() {
        val a = pickup ?: return
        val b = dropoff ?: return
        val r = route ?: return
        if (schedSaving) return
        val plan: List<Pair<LocalDate, Int?>> = if (!schedWeekly) listOf((schedDate ?: return) to null) else {
            val start = schedFirstDate ?: return
            // each chosen weekday starts on its first occurrence on or after the first ride date
            schedDays.sortedBy { it.value }.map { start.with(TemporalAdjusters.nextOrSame(it)) to scheduleWeeks }
        }
        if (schedKeys.size != plan.size) schedKeys = plan.map { RiderApi.newKey() }
        viewModelScope.launch {
            schedSaving = true
            try {
                plan.forEachIndexed { i, (day, weeks) ->
                    api.schedule(schedKeys[i], selectedCategory, payMethod, a.point, a.address, b.point, b.address, r.distanceM, r.durationS, firstRideAt(day).toString(), weeks)
                }
                schedKeys = emptyList()
                refreshTrips()
                dialog = Dialog.ScheduleDone
            } catch (e: ApiException) {
                say(if (e.code == "too_soon") "Pick a time at least 30 minutes from now." else words(e, "We could not save the schedule. Please try again."))
            } finally { schedSaving = false }
        }
    }

    fun finishSchedule() {
        dialog = null
        clearBooking()
        schedKeys = emptyList()
        reset(Dest.Main)
        tab = 1
        tripsTab = 1
    }

    var cancelTarget by mutableStateOf<ScheduleView?>(null)

    fun askCancelSchedule(s: ScheduleView) { cancelTarget = s; dialog = Dialog.CancelScheduled }

    /** [onlyNext]: cancel just the next ride, or the whole schedule. */
    fun cancelScheduled(onlyNext: Boolean) {
        val s = cancelTarget ?: return
        dialog = null
        viewModelScope.launch {
            try {
                if (onlyNext && s.rides.size > 1) {
                    val next = s.rides.firstOrNull { it.status == "SCHEDULED" }
                    if (next != null) api.cancel(next.rideId, "Cancelled one scheduled ride")
                } else api.cancelSchedule(s.id)
                refreshTrips()
            } catch (e: ApiException) { say(words(e)) }
        }
    }

    // ------------------------------------------------------------------ the day-to-day numbers
    val tripCount get() = history.count { it.status == "TRIP_COMPLETED" }

    override fun onCleared() { location.stop(); super.onCleared() }

    companion object {}
}
