package com.ninejaride.driver.location

import android.content.Context
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import java.io.File
import java.time.Instant

/** One position reading, stamped with when the phone took it (not when it is sent). */
data class Fix(
    val lat: Double,
    val lng: Double,
    val accuracyM: Float?,
    val speedKmh: Float?,
    val mock: Boolean,
    val recordedAtMillis: Long,
)

/**
 * Readings waiting to be sent. They are written to a file first and removed only after the server accepts them, so a
 * dead zone, a killed app or a reboot loses nothing. Capped at 5,000 readings and 24 hours: older ones would be refused
 * by the server anyway.
 */
class LocationQueue(context: Context) {
    private val file = File(context.applicationContext.filesDir, "location_queue.jsonl")
    private val lock = Any()

    fun add(fix: Fix) = synchronized(lock) {
        file.appendText(encode(fix) + "\n")
        trim()
    }

    fun size(): Int = synchronized(lock) { lines().size }

    /** The oldest [n] readings, as the lines to send and as a count to remove after a successful upload. */
    fun peek(n: Int): List<String> = synchronized(lock) { lines().take(n) }

    fun drop(n: Int) = synchronized(lock) {
        val rest = lines().drop(n)
        if (rest.isEmpty()) file.delete() else file.writeText(rest.joinToString("\n") + "\n")
    }

    private fun lines(): List<String> = if (file.exists()) file.readLines().filter { it.isNotBlank() } else emptyList()

    private fun trim() {
        val all = lines()
        if (all.size <= MAX_POINTS) return
        file.writeText(all.takeLast(MAX_POINTS).joinToString("\n") + "\n")
    }

    companion object {
        const val MAX_POINTS = 5000
        const val MAX_AGE_MILLIS = 24L * 3_600_000L

        /** The JSON the server expects for one point of POST /driver/location/batch. */
        fun encode(f: Fix): String = buildJsonObject {
            put("lat", f.lat)
            put("lng", f.lng)
            f.accuracyM?.let { put("accuracyM", it.toDouble()) }
            f.speedKmh?.let { put("speedKmh", it.toDouble()) }
            if (f.mock) put("mockLocation", true)
            put("recordedAt", Instant.ofEpochMilli(f.recordedAtMillis).toString())
        }.toString()

        /** Recorded-at of a stored line, to drop readings the server would refuse for being over a day old. */
        fun recordedAt(line: String): Long? =
            Regex("\"recordedAt\":\"([^\"]+)\"").find(line)?.groupValues?.get(1)?.let { runCatching { Instant.parse(it).toEpochMilli() }.getOrNull() }
    }
}
