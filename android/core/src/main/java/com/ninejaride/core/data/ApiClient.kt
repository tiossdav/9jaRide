package com.ninejaride.core.data

import android.content.Context
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.intOrNull
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import java.io.IOException
import java.util.concurrent.TimeUnit

/** What the server said when a call did not succeed. status 0 means the phone could not reach it at all. */
class ApiException(val status: Int, val code: String?, override val message: String, val ticket: String? = null) : Exception(message) {
    val isNetwork get() = status == 0
}

/** How long the code the server just sent is. [testMode] is true while the server uses its fixed test code instead of a real SMS. */
class OtpInfo(val codeLength: Int, val testMode: Boolean)

class Session(val accessToken: String, val refreshToken: String, val role: String)

/**
 * The one way the apps talk to the 9jaRide backend: sends the sign-in token, refreshes it when it has expired, and turns
 * failures into [ApiException]. Safe to share between the screens and a background service.
 */
class ApiClient(context: Context, private val baseUrl: String, private val appVersion: String, private val prefsName: String = "session") {
    val json = Json { ignoreUnknownKeys = true }
    private val http = OkHttpClient.Builder()
        .connectTimeout(10, TimeUnit.SECONDS)
        .readTimeout(15, TimeUnit.SECONDS)
        .build()
    private val jsonType = "application/json".toMediaType()
    /** For requests the server holds open on purpose (it answers when something happens, up to 25 s), so the phone asks far less often. */
    private val patientHttp: OkHttpClient by lazy { http.newBuilder().readTimeout(40, TimeUnit.SECONDS).build() }
    private val prefs = context.applicationContext.getSharedPreferences(prefsName, Context.MODE_PRIVATE)
    // One lock per stored sign-in, shared by every client in the app (the driver app has two: the screens and the location
    // service). Two renewals with the same refresh token would look like theft to the server and end the sign-in.
    private val refreshLock = LOCKS.getOrPut(prefsName) { Mutex() }
    /** This installation's own id, made once. Sent with every request. */
    private val deviceId: String = prefs.getString("device_id", null) ?: java.util.UUID.randomUUID().toString().also { prefs.edit().putString("device_id", it).apply() }

    // Tokens sit in app-private storage. Move them to the Android Keystore before a public release.
    var session: Session?
        get() = prefs.getString("access", null)?.let { Session(it, prefs.getString("refresh", "") ?: "", prefs.getString("role", "") ?: "") }
        set(value) {
            prefs.edit().apply {
                if (value == null) clear() else { putString("access", value.accessToken); putString("refresh", value.refreshToken); putString("role", value.role) }
            }.apply()
        }

    private fun rawCall(method: String, path: String, body: String?, token: String?, extraHeaders: Map<String, String>, multipart: okhttp3.RequestBody? = null, patient: Boolean = false): Pair<Int, JsonObject> {
        val req = Request.Builder().url(baseUrl + path)
            .header("X-App-Platform", "android")
            .header("X-Device-Id", deviceId)
            .header("X-App-Version", appVersion)
            .apply { token?.let { header("Authorization", "Bearer $it") }; extraHeaders.forEach { (k, v) -> header(k, v) } }
            .method(method, multipart ?: if (method == "GET" || method == "HEAD") null else (body ?: "").toRequestBody(jsonType))
            .build()
        try {
            (if (patient) patientHttp else http).newCall(req).execute().use { res ->
                val text = res.body?.string().orEmpty()
                val obj = runCatching { json.parseToJsonElement(text) }.getOrNull()
                // Some routes answer with a list; callers that need one read it from "items".
                val wrapped = when (obj) {
                    is JsonObject -> obj
                    null -> JsonObject(emptyMap())
                    else -> buildJsonObject { put("items", obj) }
                }
                return res.code to wrapped
            }
        } catch (e: IOException) {
            throw ApiException(0, null, "No connection. Check your network and try again.")
        }
    }

    private fun failure(status: Int, o: JsonObject) =
        ApiException(status, o["code"]?.jsonPrimitive?.contentOrNull, o["message"]?.jsonPrimitive?.contentOrNull ?: "Something went wrong ($status).", o["registrationTicket"]?.jsonPrimitive?.contentOrNull)

    /** Sends one file (a photo or PDF) as the form field "file". Signed in, with the same one retry after a token refresh. */
    suspend fun upload(path: String, bytes: ByteArray, filename: String, mime: String): JsonObject = withContext(Dispatchers.IO) {
        fun form() = okhttp3.MultipartBody.Builder().setType(okhttp3.MultipartBody.FORM)
            .addFormDataPart("file", filename, bytes.toRequestBody(mime.toMediaType())).build()
        val before = session
        var (status, obj) = rawCall("POST", path, null, before?.accessToken, emptyMap(), form())
        if (status == 401 && before != null && refresh(before)) {
            val r = rawCall("POST", path, null, session?.accessToken, emptyMap(), form())
            status = r.first; obj = r.second
        }
        if (status !in 200..299) throw failure(status, obj)
        obj
    }

    /** Fetches a private file (such as a profile photo) as bytes, signed in. */
    suspend fun download(path: String): ByteArray = withContext(Dispatchers.IO) {
        fun fetch(token: String?): Pair<Int, ByteArray> {
            val req = Request.Builder().url(baseUrl + path).apply { token?.let { header("Authorization", "Bearer $it") } }.build()
            try { http.newCall(req).execute().use { return it.code to (it.body?.bytes() ?: ByteArray(0)) } }
            catch (e: IOException) { throw ApiException(0, null, "No connection. Check your network and try again.") }
        }
        val before = session
        var (status, bytes) = fetch(before?.accessToken)
        if (status == 401 && before != null && refresh(before)) { val r = fetch(session?.accessToken); status = r.first; bytes = r.second }
        if (status !in 200..299) throw ApiException(status, null, "Could not load the file.")
        bytes
    }

    private var lastWake = 0L

    /**
     * A hosted server on a free plan goes to sleep when idle and takes up to a minute or two to start again. This asks it
     * to start and waits for it to answer. True when it did.
     */
    fun wake(): Boolean {
        val patient = http.newBuilder().connectTimeout(40, TimeUnit.SECONDS).readTimeout(100, TimeUnit.SECONDS).build()
        return try { patient.newCall(Request.Builder().url("$baseUrl/health").build()).execute().use { it.isSuccessful } } catch (e: IOException) { false }
    }

    /** One request; if the phone cannot reach the server it wakes it (at most once every two minutes) and tries again. */
    private fun send(method: String, path: String, body: String?, token: String?, headers: Map<String, String>, patient: Boolean = false): Pair<Int, JsonObject> =
        try { rawCall(method, path, body, token, headers, null, patient) } catch (e: ApiException) {
            if (!e.isNetwork || System.currentTimeMillis() - lastWake < 120_000L) throw e
            lastWake = System.currentTimeMillis()
            if (!wake()) throw ApiException(0, null, "Cannot reach the server. Check your internet connection and try again.")
            rawCall(method, path, body, token, headers, null, patient)
        }

    /** Calls the API. With [auth], a 401 triggers one token refresh and one retry. */
    suspend fun call(method: String, path: String, body: String? = null, auth: Boolean = false, headers: Map<String, String> = emptyMap(), patient: Boolean = false): JsonObject =
        withContext(Dispatchers.IO) {
            val before = if (auth) session else null
            if (auth && before == null) throw ApiException(401, "signed_out", "You have been signed out. Please sign in again.")
            var (status, obj) = send(method, path, body, before?.accessToken, headers, patient)
            if (auth && status == 401 && before != null && refresh(before)) {
                val r = rawCall(method, path, body, session?.accessToken, headers, null, patient)
                status = r.first; obj = r.second
            }
            if (status !in 200..299) throw failure(status, obj)
            obj
        }

    /** Swap the refresh token for a new pair. One at a time: a refresh token works once, and reusing it ends the login. */
    private suspend fun refresh(stale: Session): Boolean = refreshLock.withLock {
        val current = session ?: return false
        if (current.accessToken != stale.accessToken) return true // another caller already refreshed
        val (status, obj) = withContext(Dispatchers.IO) {
            rawCall("POST", "/auth/refresh", buildJsonObject { put("refreshToken", current.refreshToken) }.toString(), null, emptyMap())
        }
        if (status == 200) {
            session = Session(obj["accessToken"]!!.jsonPrimitive.content, obj["refreshToken"]!!.jsonPrimitive.content, current.role)
            true
        } else {
            if (status == 401) session = null // the login is over; the app sends the person back to sign in
            false
        }
    }

    // ---- sign-in, shared by both apps
    suspend fun requestOtp(phone: String, voice: Boolean): OtpInfo {
        val o = call("POST", "/auth/otp/request", buildJsonObject { put("phone", phone); put("channel", if (voice) "voice" else "sms") }.toString())
        return OtpInfo(o["codeLength"]?.jsonPrimitive?.intOrNull ?: 6, o["testMode"]?.jsonPrimitive?.booleanOrNull == true)
    }

    /** Signs in with the code. For a number with no account the server answers 422 with a registration ticket. */
    suspend fun verifyOtp(phone: String, code: String): Session {
        val o = call("POST", "/auth/otp/verify", buildJsonObject { put("phone", phone); put("code", code) }.toString())
        return saveLogin(o)
    }

    suspend fun register(ticket: String, role: String, fullName: String): Session {
        val o = call("POST", "/auth/register", buildJsonObject { put("registrationTicket", ticket); put("role", role); put("fullName", fullName) }.toString())
        return saveLogin(o)
    }

    private fun saveLogin(o: JsonObject): Session {
        val s = Session(o["accessToken"]!!.jsonPrimitive.content, o["refreshToken"]!!.jsonPrimitive.content, o["role"]?.jsonPrimitive?.contentOrNull.orEmpty())
        session = s
        return s
    }

    suspend fun logout() {
        val s = session ?: return
        runCatching { call("POST", "/auth/logout", buildJsonObject { put("refreshToken", s.refreshToken) }.toString()) }
        session = null
    }
    private companion object {
        val LOCKS = java.util.concurrent.ConcurrentHashMap<String, Mutex>()
    }
}
