package com.ninejaride.core.format

import java.util.Locale

/** Metres as people read them: "850 m" under a kilometre, "6.4 km" above. */
fun distanceText(metres: Int): String =
    if (metres < 1000) "${(metres / 10) * 10} m" else String.format(Locale.US, "%.1f km", metres / 1000.0)

/** A reading's age as people say it: "just now", "40 s ago", "3 min ago". */
fun ageText(seconds: Long): String = when {
    seconds < 10 -> "just now"
    seconds < 60 -> "$seconds s ago"
    else -> "${seconds / 60} min ago"
}
