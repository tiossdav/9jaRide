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

fun nairaSigned(kobo: Kobo): String = (if (kobo >= 0) "+" else "−") + "₦" + DecimalFormat("#,##0.00", groupSymbols).format(Math.abs(kobo) / 100.0)

fun nairaMinus(kobo: Kobo): String = "−₦" + DecimalFormat("#,##0.00", groupSymbols).format(Math.abs(kobo) / 100.0)

fun clock(totalSeconds: Int): String = "%02d:%02d".format(totalSeconds / 60, totalSeconds % 60)

fun minutesSeconds(totalSeconds: Int): String = "${totalSeconds / 60}m ${totalSeconds % 60}s"

