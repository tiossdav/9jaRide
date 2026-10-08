package com.ninejaride.core.format

/** What is stored and sent: capital letters and digits only, at most eight. "kja 482-ab" becomes "KJA482AB". */
fun normalizePlate(typed: String): String = typed.filter { it.isLetterOrDigit() && it.code < 128 }.uppercase().take(8)

/** What people read: the standard Nigerian layout, three letters, a dash, then the rest. "KJA482AB" shows as "KJA-482AB". */
fun formatPlate(stored: String): String {
    val p = normalizePlate(stored)
    return if (p.length <= 3) p else p.substring(0, 3) + "-" + p.substring(3)
}

private val PLATE_PATTERN = Regex("^[A-Z]{3}[0-9]{3}[A-Z]{2}$")

/** Three letters, three digits, two letters (ABC-123XY). The server checks the same rule. */
fun isValidPlate(stored: String): Boolean = PLATE_PATTERN.matches(normalizePlate(stored))

/** The sentence to show beside the plate field, or null when the plate is fine. */
fun plateProblem(typed: String): String? =
    if (isValidPlate(typed)) null else "The plate number must look like ABC-123XY: three letters, three digits, then two letters."
