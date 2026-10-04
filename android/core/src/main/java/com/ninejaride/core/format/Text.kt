package com.ninejaride.core.format

/** "omoluabi olabanjo" shown as "Omoluabi Olabanjo": each word starts with a capital, the rest is left as typed. */
fun properName(name: String): String =
    name.trim().split(Regex("\\s+")).filter { it.isNotEmpty() }.joinToString(" ") { w -> w.replaceFirstChar { it.uppercase() } }
