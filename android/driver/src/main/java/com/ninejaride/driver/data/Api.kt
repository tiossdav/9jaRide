package com.ninejaride.driver.data

import android.content.Context
import com.ninejaride.core.data.ApiClient
import com.ninejaride.core.data.ApiException
import com.ninejaride.core.data.Session
import com.ninejaride.driver.BuildConfig
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive

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

    suspend fun logout() = client.logout()
}
