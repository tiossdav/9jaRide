package com.ninejaride.driver.data

import android.content.Context
import com.ninejaride.core.data.ApiClient
import com.ninejaride.core.data.ApiException
import com.ninejaride.core.data.Session
import com.ninejaride.driver.BuildConfig
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.doubleOrNull
import kotlinx.serialization.json.longOrNull
import kotlinx.serialization.json.put
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive

/** An offer from the server: a rider wants a trip and this driver is first in line. */
class ServerOffer(
    val rideId: String, val code: String, val secondsLeft: Int, val category: String, val paymentMethod: String,
    val pickup: com.ninejaride.core.data.MapPoint, val pickupAddress: String?, val dropoff: com.ninejaride.core.data.MapPoint, val dropoffAddress: String?,
    val pickupKm: Double?, val expectedKobo: Long?, val riderName: String, val riderRating: Double?,
)

/** The ride the driver is on, so the app can pick up where it left off. */
class ServerRide(val rideId: String, val code: String, val status: String, val category: String, val paymentMethod: String,
                 val pickup: com.ninejaride.core.data.MapPoint, val pickupAddress: String?, val dropoff: com.ninejaride.core.data.MapPoint, val dropoffAddress: String?,
                 val expectedKobo: Long?, val riderName: String,
                 /** Metres the server has counted from this phone's GPS: on the way to the pickup, and with the rider. */
                 val pickupTravelledM: Int = 0, val tripTravelledM: Int = 0)

class ServerFare(val lines: List<Pair<String, Long>>, val totalKobo: Long, val commissionKobo: Long, val driverEarnKobo: Long, val taxKobo: Long, val vehicleDeductionKobo: Long = 0)

/** One way of getting a vehicle, as the sign-up screen offers it. */
class Arrangement(val code: String, val name: String, val description: String, val asksForVehicle: Boolean, val asksForOwner: Boolean, val hasPaymentPlan: Boolean)

class ServerDoc(val kind: String, val number: String?, val fileId: String?, val expiresOn: String?)

/** The driver's application as staff see it: where it stands, anything they asked to change, and what was entered (so it can be corrected). */
class ServerApplication(
    val status: String, val arrangement: String, val reviewNote: String?,
    val email: String, val contactPreference: String, val dateOfBirth: String, val nin: String, val lassdri: String, val address: String,
    val kinName: String, val kinPhone: String, val kinRelationship: String, val kinAddress: String,
    val category: String, val plate: String, val make: String, val colour: String, val ownerName: String, val ownerPhone: String,
    val documents: List<ServerDoc>, val deductionBps: Int = 0,
    /** What staff asked to be fixed: about_you, next_of_kin, vehicle, or a document kind (selfie is the driver photo). Empty when nothing specific was named. */
    val changeItems: List<String> = emptyList(),
)

/** Everything the application form collects, ready to send. */
class ApplicationForm(
    val arrangement: String, val category: String, val plate: String, val make: String, val colour: String, val ownerName: String, val ownerPhone: String,
    val email: String, val contactPreference: String, val dateOfBirth: String, val nin: String, val lassdri: String, val address: String,
    val kinName: String, val kinPhone: String, val kinRelationship: String, val kinAddress: String,
    val documents: List<ServerDoc>, val deductionBps: Int = 0,
)

/** The settlement page: where the driver is paid, and how the vehicle is paid for. */
class ServerSettlement(
    val done: Boolean, val needsAgreement: Boolean, val kind: String, val vehicle: String, val ownerName: String, val ownerPhone: String,
    val percent: Double, val canChange: Boolean, val waiting: Boolean, val targetKobo: Long?,
)

class AppConfig(val forceUpdate: Boolean, val updateUrl: String?, val batteryTips: List<BatteryTip>)

/** The calls the driver app makes, on top of the shared client. */
class Api(context: Context) {
    val client = ApiClient(context, BuildConfig.API_BASE_URL, BuildConfig.VERSION_NAME)

    val session: Session? get() = client.session

    suspend fun requestOtp(phone: String, voice: Boolean) = client.requestOtp(phone, voice)

    /** A number with no account throws ApiException(422, "registration_required"); a rider account is turned away. */
    suspend fun verifyOtp(phone: String, code: String): Session {
        val s = client.verifyOtp(phone, code)
        if (s.role != "driver") {
            client.session = null // a rider must not stay signed in inside the driver app
            throw ApiException(403, "not_a_driver", "This number is not registered as a driver.")
        }
        return s
    }

    /** Finishes sign-up for a number that passed the code check. */
    suspend fun register(ticket: String, fullName: String): Session = client.register(ticket, "driver", fullName)

    suspend fun arrangements(): List<Arrangement> = client.call("GET", "/driver/application/arrangements", auth = true)["items"]?.jsonArray?.map {
        val o = it.jsonObject
        Arrangement(o.str("code") ?: "", o.str("name") ?: "", o.str("description") ?: "", o["asksForVehicle"]?.jsonPrimitive?.booleanOrNull == true, o["asksForOwner"]?.jsonPrimitive?.booleanOrNull == true, o["hasPaymentPlan"]?.jsonPrimitive?.booleanOrNull == true)
    } ?: emptyList()

    /** Null when the driver has not applied yet. */
    suspend fun application(): ServerApplication? {
        val o = client.call("GET", "/driver/application", auth = true)
        val status = o.str("status") ?: return null
        val pe = o.obj("personal"); val kin = pe?.obj("nextOfKin"); val v = o.obj("vehicle"); val ow = o.obj("owner")
        return ServerApplication(
            status, o.str("arrangement") ?: "own", o.str("reviewNote"),
            pe?.str("email") ?: "", pe?.str("contactPreference") ?: "whatsapp", pe?.str("dateOfBirth")?.take(10) ?: "", pe?.str("nin") ?: "", pe?.str("lassdri") ?: "", pe?.str("address") ?: "",
            kin?.str("name") ?: "", kin?.str("phone") ?: "", kin?.str("relationship") ?: "", kin?.str("address") ?: "",
            v?.str("category") ?: "regular", v?.str("plate") ?: "", v?.str("make") ?: "", v?.str("colour") ?: "", ow?.str("name") ?: "", ow?.str("phone") ?: "",
            o["documents"]?.jsonArray?.map { val d = it.jsonObject; ServerDoc(d.str("kind") ?: "", d.str("number"), d.str("fileId"), d.str("expiresOn")?.take(10)) } ?: emptyList(),
            (o.lng("deductionBps") ?: 0).toInt(),
            o["changeItems"]?.jsonArray?.mapNotNull { it.jsonPrimitive.contentOrNull } ?: emptyList(),
        )
    }

    /** Sends one photo as proof of a document; returns the id to attach to the application. */
    suspend fun uploadFile(bytes: ByteArray, filename: String, mime: String): String =
        client.upload("/files", bytes, filename, mime).str("id") ?: throw ApiException(500, null, "The upload did not work. Please try again.")

    suspend fun submitApplication(f: ApplicationForm) {
        client.call("POST", "/driver/application", buildJsonObject {
            put("arrangement", f.arrangement)
            put("vehicle", buildJsonObject { put("category", f.category); if (f.plate.isNotBlank()) { put("make", f.make); put("colour", f.colour); put("plate", f.plate) } })
            if (f.ownerName.isNotBlank()) { put("owner", buildJsonObject { put("name", f.ownerName); put("phone", f.ownerPhone) }); put("deductionBps", f.deductionBps) }
            put("personal", buildJsonObject {
                put("email", f.email); put("contactPreference", f.contactPreference); if (f.dateOfBirth.isNotBlank()) put("dateOfBirth", f.dateOfBirth)
                put("nin", f.nin); put("lassdri", f.lassdri); put("address", f.address)
                put("nextOfKin", buildJsonObject { put("name", f.kinName); put("phone", f.kinPhone); if (f.kinRelationship.isNotBlank()) put("relationship", f.kinRelationship); put("address", f.kinAddress) })
            })
            put("documents", JsonArray(f.documents.map { d -> buildJsonObject { put("kind", d.kind); d.number?.let { put("number", it) }; put("fileId", d.fileId ?: ""); d.expiresOn?.let { put("expiresOn", it) } } }))
        }.toString(), auth = true)
    }

    private fun JsonObject.dbl2(k: String) = (this[k] as? JsonPrimitive)?.doubleOrNull

    /** The driver as the platform holds them: sign-up details, onboarding answers, the vehicle, rating and payment plan. */
    suspend fun profile(): com.ninejaride.driver.state.DriverProfile {
        val o = client.call("GET", "/driver/profile", auth = true)
        val p = o.obj("personal"); val kin = p?.obj("nextOfKin"); val v = o.obj("vehicle"); val pl = o.obj("plan")
        val dob = p?.str("dateOfBirth")?.take(10)?.takeIf { it.length == 10 }?.let { "${it.substring(8, 10)}/${it.substring(5, 7)}/${it.substring(0, 4)}" } ?: ""
        return com.ninejaride.driver.state.DriverProfile(
            name = com.ninejaride.core.format.properName(o.str("name") ?: ""), phone = o.str("phone")?.let { if (it.startsWith("+234")) "0" + it.drop(4) else it } ?: "", email = p?.str("email") ?: "", emailVerified = true,
            gender = "", nin = p?.str("nin"), rating = 0, active = o.str("status") == "active",
            vehicle = v?.let { com.ninejaride.driver.state.Vehicle("", it.str("make") ?: "", 0, com.ninejaride.core.format.formatPlate(it.str("plate") ?: ""), it.str("colour") ?: "", it.str("categoryLabel") ?: it.str("category") ?: "", it.str("arrangement") ?: "", it.obj("owner")?.str("name") ?: "", it.obj("owner")?.str("phone") ?: "") },
            bank = null, photoId = o.str("photoFileId"), dateOfBirth = dob, lassdri = p?.str("lassdri") ?: "", address = p?.str("address") ?: "",
            kinName = kin?.str("name") ?: "", kinPhone = kin?.str("phone")?.let { if (it.startsWith("+234")) "0" + it.drop(4) else it } ?: "", kinRelationship = kin?.str("relationship") ?: "", kinAddress = kin?.str("address") ?: "",
            contactPreference = p?.str("contactPreference") ?: "", ratingAverage = o.dbl2("rating"), arrangement = o.obj("application")?.str("arrangement") ?: "",
            plan = pl?.let { com.ninejaride.driver.state.PlanSummary(it.str("status") ?: "", it.lng("totalKobo") ?: 0, it.lng("paidKobo") ?: 0, it.lng("outstandingKobo") ?: 0, it.lng("overdueKobo") ?: 0, it.str("nextDueOn")?.take(10)) },
        )
    }

    suspend fun setPhoto(fileId: String) { client.call("POST", "/driver/profile/photo", buildJsonObject { put("fileId", fileId) }.toString(), auth = true) }
    suspend fun fileBytes(fileId: String): ByteArray = client.download("/files/$fileId")

    class Today(val trips: Int, val earnedKobo: Long, val distanceM: Long, val durationS: Long, val keptKobo: Long = 0, val vehicleKobo: Long = 0)

    /** Finished trips, newest first, and today's totals. */
    suspend fun trips(): Pair<List<com.ninejaride.driver.state.TripRecord>, Today> {
        val o = client.call("GET", "/driver/trips", auth = true)
        val zone = java.time.ZoneId.of("Africa/Lagos")
        val now = java.time.LocalDate.now(zone)
        val fmt = java.time.format.DateTimeFormatter.ofPattern("d MMM, h:mm a", java.util.Locale.ENGLISH)
        val items = o["items"]?.jsonArray?.map {
            val t = it.jsonObject
            val total = t.lng("totalKobo") ?: 0; val tax = t.lng("taxKobo") ?: 0; val commission = t.lng("commissionKobo") ?: 0
            val at = runCatching { java.time.Instant.parse(t.str("at")).atZone(zone) }.getOrNull()
            val whenText = at?.let { z -> (if (z.toLocalDate() == now) "Today, " else "") + z.format(if (z.toLocalDate() == now) java.time.format.DateTimeFormatter.ofPattern("h:mm a", java.util.Locale.ENGLISH) else fmt) } ?: ""
            com.ninejaride.driver.state.TripRecord(
                t.str("code") ?: "", whenText,
                com.ninejaride.driver.state.FareReceipt(listOf(com.ninejaride.driver.state.FareLine("Trip fare", total - tax), com.ninejaride.driver.state.FareLine("Tax", tax)), total, commission, t.lng("earnedKobo") ?: 0, if (total > tax) Math.round(commission * 100.0 / (total - tax)).toInt() else 0, t.lng("vehicleDeductionKobo") ?: 0),
                t.str("pickup") ?: "", t.str("dropoff") ?: "", (t.lng("distanceM") ?: 0) / 1000.0, (t.lng("durationS") ?: 0).toInt(),
                if (t.str("paymentMethod") == "cash") "Cash" else "Wallet", com.ninejaride.driver.state.Rider(t.str("rider") ?: "Rider", 5),
            )
        } ?: emptyList()
        val td = o.obj("today")
        return items to Today((td?.lng("trips") ?: 0).toInt(), td?.lng("earnedKobo") ?: 0, td?.lng("distanceM") ?: 0, td?.lng("durationS") ?: 0, td?.lng("keptKobo") ?: 0, td?.lng("vehicleDeductionKobo") ?: 0)
    }

    suspend fun walletBalance(): Long = client.call("GET", "/wallet", auth = true).lng("balanceKobo") ?: 0

    suspend fun walletTransactions(): List<com.ninejaride.driver.state.WalletTx> = client.call("GET", "/wallet/transactions", auth = true)["items"]?.jsonArray?.map {
        val t = it.jsonObject
        val amount = t.lng("amountKobo") ?: 0
        com.ninejaride.driver.state.WalletTx(t.str("memo") ?: (t.str("kind") ?: "Wallet").replace('_', ' ').replaceFirstChar { c -> c.uppercase() }, t.str("at")?.take(10) ?: "", Math.abs(amount), if (amount >= 0) com.ninejaride.driver.state.TxDirection.In else com.ninejaride.driver.state.TxDirection.Out)
    } ?: emptyList()

    suspend fun settlement(): ServerSettlement {
        val o = client.call("GET", "/driver/settlement", auth = true)
        val v = o.obj("vehicle"); val t = o.obj("terms"); val ow = t?.obj("owner")
        val vehicle = v?.let { listOfNotNull(it.str("make"), it.str("colour"), com.ninejaride.core.format.formatPlate(it.str("plate") ?: "").ifBlank { null }).joinToString(" · ") } ?: ""
        return ServerSettlement(
            o["done"]?.jsonPrimitive?.booleanOrNull == true, o["needsAgreement"]?.jsonPrimitive?.booleanOrNull == true, t?.str("kind") ?: "own", vehicle,
            ow?.str("name") ?: "", ow?.str("phone") ?: "", t?.dbl2("percent") ?: 0.0, (t?.get("canChange") as? JsonPrimitive)?.booleanOrNull == true,
            (t?.get("waiting") as? JsonPrimitive)?.booleanOrNull == true, t?.lng("targetKobo"),
        )
    }
    /** "I agree". The share is sent only when the driver is allowed to choose it. */
    suspend fun acceptAgreement(bps: Int?) {
        client.call("POST", "/driver/vehicle-terms/accept", buildJsonObject { bps?.let { put("deductionBps", it) } }.toString(), auth = true)
    }
    suspend fun completeSettlement() { client.call("POST", "/driver/settlement/complete", "{}", auth = true) }

    /** Null when the driver has no vehicle with a share to pay. */
    suspend fun vehicleTerms(): com.ninejaride.driver.state.VehicleTerms? {
        val t = client.call("GET", "/driver/vehicle-terms", auth = true).obj("terms") ?: return null
        return com.ninejaride.driver.state.VehicleTerms(
            t.dbl2("percent") ?: 0.0, t.str("setBy") == "owner", (t["canChange"] as? JsonPrimitive)?.booleanOrNull == true, t.obj("owner")?.str("name") ?: "",
            t.lng("targetKobo"), t.lng("paidKobo") ?: 0, t.lng("remainingKobo"), (t["accepted"] as? JsonPrimitive)?.booleanOrNull != false,
        )
    }
    suspend fun setVehicleShare(bps: Int) { client.call("PUT", "/driver/vehicle-terms", buildJsonObject { put("deductionBps", bps) }.toString(), auth = true) }

    suspend fun appConfig(): AppConfig {
        val o = client.call("GET", "/app/config")
        val tips = (o["batteryGuidance"] as? JsonArray)?.map { t ->
            val ob = t.jsonObject
            BatteryTip(
                brands = ob["brands"]?.jsonArray?.map { it.jsonPrimitive.content } ?: listOf("all"),
                title = ob["title"]?.jsonPrimitive?.contentOrNull ?: "",
                steps = ob["steps"]?.jsonArray?.map { it.jsonPrimitive.content } ?: emptyList(),
            )
        } ?: emptyList()
        return AppConfig(o["forceUpdate"]?.jsonPrimitive?.booleanOrNull ?: false, o["updateUrl"]?.jsonPrimitive?.contentOrNull, tips)
    }

    suspend fun reportProblem(key: String, topic: String, message: String) {
        client.call("POST", "/support/tickets", kotlinx.serialization.json.buildJsonObject { put("topic", kotlinx.serialization.json.JsonPrimitive(topic)); put("message", kotlinx.serialization.json.JsonPrimitive(message)) }.toString(), auth = true, headers = mapOf("Idempotency-Key" to key))
    }

    suspend fun myReports(): List<com.ninejaride.core.ui.components.MyReport> = client.call("GET", "/support/tickets", auth = true)["items"]?.jsonArray?.map {
        val o = it.jsonObject
        com.ninejaride.core.ui.components.MyReport(o["code"]?.jsonPrimitive?.contentOrNull ?: "", o["topic"]?.jsonPrimitive?.contentOrNull ?: "", o["message"]?.jsonPrimitive?.contentOrNull ?: "", o["status"]?.jsonPrimitive?.contentOrNull ?: "OPEN", o["resolution"]?.jsonPrimitive?.contentOrNull)
    } ?: emptyList()


    /** With [waitSeconds] the server holds the answer until an offer arrives, so this is one request in place of many. */
    suspend fun offer(waitSeconds: Int = 0): ServerOffer? = parseOffer(client.call("GET", if (waitSeconds > 0) "/driver/offer?wait=$waitSeconds" else "/driver/offer", auth = true, patient = waitSeconds > 0))

    suspend fun activeRide(): ServerRide? {
        val o = client.call("GET", "/driver/rides/active", auth = true).obj("ride") ?: return null
        return ServerRide(
            o.str("rideId")!!, o.str("code") ?: "", o.str("status") ?: "", o.str("category") ?: "Ride", o.str("paymentMethod") ?: "cash",
            pt(o.obj("pickup")), o.obj("pickup")?.str("address"), pt(o.obj("dropoff")), o.obj("dropoff")?.str("address"), o.lng("expectedKobo"), o.obj("rider")?.str("name") ?: "Rider",
            (o.obj("tracking")?.lng("pickupTravelledM") ?: 0).toInt(), (o.obj("tracking")?.lng("tripTravelledM") ?: 0).toInt(),
        )
    }

    /** True when the ride is now this driver's; false when it was taken, timed out or cancelled. */
    suspend fun accept(rideId: String): Boolean = client.call("POST", "/driver/rides/$rideId/accept", "{}", auth = true)["ok"]?.jsonPrimitive?.booleanOrNull == true
    suspend fun decline(rideId: String) { client.call("POST", "/driver/rides/$rideId/decline", "{}", auth = true) }
    suspend fun arrive(rideId: String) { client.call("POST", "/driver/rides/$rideId/arrive", "{}", auth = true) }
    suspend fun startTrip(rideId: String) { client.call("POST", "/driver/rides/$rideId/start", "{}", auth = true) }
    suspend fun cancelRide(rideId: String, reason: String?) {
        client.call("POST", "/driver/rides/$rideId/cancel", buildJsonObject { reason?.let { put("reason", it) } }.toString(), auth = true)
    }

    suspend fun completeTrip(rideId: String, distanceM: Int, durationS: Int, waitingS: Int): ServerFare {
        val o = client.call("POST", "/driver/rides/$rideId/complete", buildJsonObject { put("distanceM", distanceM); put("durationS", durationS); put("waitingS", waitingS) }.toString(), auth = true)
        val lines = o["lines"]?.jsonArray?.map { val l = it.jsonObject; (l.str("label") ?: "") to (l.lng("amountKobo") ?: 0L) } ?: emptyList()
        return ServerFare(lines, o.lng("totalKobo") ?: 0, o.lng("commissionKobo") ?: 0, o.lng("driverEarnKobo") ?: 0, o.lng("taxKobo") ?: 0, o.lng("vehicleDeductionKobo") ?: 0)
    }

    suspend fun sos(key: String, at: com.ninejaride.core.data.MapPoint?) {
        client.call("POST", "/sos", buildJsonObject { at?.let { put("location", buildJsonObject { put("lat", it.lat); put("lng", it.lng) }) } }.toString(), auth = true, headers = mapOf("Idempotency-Key" to key))
    }

    suspend fun rateRider(rideId: String, stars: Int, tags: List<String>, comment: String) {
        client.call("POST", "/rides/$rideId/rating", kotlinx.serialization.json.buildJsonObject { put("stars", stars); put("tags", kotlinx.serialization.json.buildJsonArray { tags.forEach { add(kotlinx.serialization.json.JsonPrimitive(it)) } }); if (comment.isNotBlank()) put("comment", comment.trim()) }.toString(), auth = true)
    }

    /** This phone is now the one the driver is online on. Any other phone with the account is told to go offline. */
    suspend fun claimOnline() { client.call("POST", "/driver/online", "{}", auth = true) }
    suspend fun releaseOnline() { client.call("POST", "/driver/offline", "{}", auth = true) }

    suspend fun logout() = client.logout()
}

internal fun JsonObject.str(k: String) = (this[k] as? JsonPrimitive)?.takeIf { it !is JsonNull }?.contentOrNull
internal fun JsonObject.lng(k: String) = (this[k] as? JsonPrimitive)?.longOrNull
internal fun JsonObject.dbl(k: String) = (this[k] as? JsonPrimitive)?.doubleOrNull
internal fun JsonObject.obj(k: String) = this[k] as? JsonObject
internal fun pt(o: JsonObject?) = com.ninejaride.core.data.MapPoint(o?.dbl("lat") ?: 0.0, o?.dbl("lng") ?: 0.0)

/** Reads the answer of GET /driver/offer; null when there is no offer. */
fun parseOffer(json: JsonObject): ServerOffer? {
    val o = json.obj("offer") ?: return null
    return ServerOffer(
        o.str("rideId")!!, o.str("code") ?: "", (o.lng("secondsLeft") ?: 0).toInt(), o.str("category") ?: "Ride", o.str("paymentMethod") ?: "cash",
        pt(o.obj("pickup")), o.obj("pickup")?.str("address"), pt(o.obj("dropoff")), o.obj("dropoff")?.str("address"),
        o.dbl("pickupKm"), o.obj("estimate")?.lng("expectedKobo"), o.obj("rider")?.str("name") ?: "Rider", o.obj("rider")?.dbl("rating"),
    )
}

