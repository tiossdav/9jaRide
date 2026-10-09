package com.ninejaride.core.format

import java.text.DecimalFormat
import java.text.DecimalFormatSymbols
import java.util.Locale

/** Money is whole kobo everywhere, the same as the server. */
typealias Kobo = Long

private val groupSymbols = DecimalFormatSymbols(Locale.US)

/** "₦2,260" for whole naira, "₦1,988.80" otherwise. Negative amounts keep the sign in front: "-₦120". */
fun naira(kobo: Kobo, forceDecimals: Boolean = false): String {
    val neg = kobo < 0
    val abs = Math.abs(kobo)
    val whole = abs % 100L == 0L && !forceDecimals
    val text = if (whole) DecimalFormat("#,##0", groupSymbols).format(abs / 100) else DecimalFormat("#,##0.00", groupSymbols).format(abs / 100.0)
    return (if (neg) "-" else "") + "₦" + text
}

/** The least a person can put in their wallet, and the most (the server enforces both again). */
const val MIN_TOPUP_KOBO: Kobo = 100_000L      // ₦1,000
const val MAX_TOPUP_KOBO: Kobo = 50_000_000L   // ₦500,000

/** Whole naira typed into an amount box ("1,500" or "1500") as kobo. Null when it is empty or not a number. */
fun nairaTextToKobo(text: String): Kobo? {
    val digits = text.filter { it.isDigit() }
    if (digits.isEmpty() || digits.length > 9) return null
    return digits.toLong() * 100
}

/** What is wrong with a top-up amount, in words for the screen, or null when it is fine. */
fun topUpProblem(kobo: Kobo?): String? = when {
    kobo == null -> null // nothing typed yet: no complaint, the Pay button just stays off
    kobo < MIN_TOPUP_KOBO -> "The least you can top up is ${naira(MIN_TOPUP_KOBO)}."
    kobo > MAX_TOPUP_KOBO -> "The most you can top up at once is ${naira(MAX_TOPUP_KOBO)}."
    else -> null
}

fun topUpAllowed(kobo: Kobo?): Boolean = kobo != null && kobo in MIN_TOPUP_KOBO..MAX_TOPUP_KOBO

fun nairaSigned(kobo: Kobo): String = (if (kobo >= 0) "+" else "−") + "₦" + DecimalFormat("#,##0.00", groupSymbols).format(Math.abs(kobo) / 100.0)

fun nairaMinus(kobo: Kobo): String = "−₦" + DecimalFormat("#,##0.00", groupSymbols).format(Math.abs(kobo) / 100.0)

fun clock(totalSeconds: Int): String = "%02d:%02d".format(totalSeconds / 60, totalSeconds % 60)

fun minutesSeconds(totalSeconds: Int): String = "${totalSeconds / 60}m ${totalSeconds % 60}s"

