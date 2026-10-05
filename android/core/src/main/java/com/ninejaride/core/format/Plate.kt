package com.ninejaride.core.format

/** What is stored and sent: capital letters and digits only. "kja 482-ab" becomes "KJA482AB". */
fun normalizePlate(typed: String): String = typed.filter { it.isLetterOrDigit() && it.code < 128 }.uppercase().take(10)

/** What people read: the standard Nigerian layout, three letters, a dash, then the rest. "KJA482AB" shows as "KJA-482AB". */
fun formatPlate(stored: String): String {
    val p = normalizePlate(stored)
    return if (p.length <= 3) p else p.substring(0, 3) + "-" + p.substring(3)
}
