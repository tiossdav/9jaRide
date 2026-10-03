package com.ninejaride.core.ui.theme

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.ExperimentalTextApi
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.Font
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontVariation
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.TextUnit
import androidx.compose.ui.unit.sp
import com.ninejaride.core.R

/**
 * Colours from the 9jaRide Pro design. The driver app is light. The rider app follows the design's dark screens and has
 * an Appearance setting, so the entries that change between the two read a flag that Compose watches: flipping [dark]
 * redraws every screen. Colours that look the same in both (brand greens, the red button, map pins) are plain values.
 */
object C {
    /** Set once at start-up and again whenever the rider changes Appearance. */
    var dark by mutableStateOf(false)

    private fun pick(light: Long, darkValue: Long) = Color(if (dark) darkValue else light)

    val Bg get() = pick(0xFFF4F0E6, 0xFF0A100C)
    val Surface get() = pick(0xFFFFFFFF, 0xFF131B15)
    /** A slightly different surface for inputs and rows that sit on a [Surface]. */
    val Raised get() = pick(0xFFF4F0E6, 0xFF1A251D)
    val Border get() = pick(0xFFE6E1D3, 0xFF243229)
    val Ink get() = pick(0xFF16231A, 0xFFF2F5F1)
    val Muted get() = pick(0xFF5F6A5D, 0xFF98A99D)
    val Faint get() = pick(0xFF98A99D, 0xFF6F8075)
    val Disabled get() = pick(0xFFC3BEB0, 0xFF3A4A40)
    val ToggleOff get() = pick(0xFFC9C4B4, 0xFF2F3E34)

    val Green = Color(0xFF0D520D)
    /** Green for text and icons on tinted backgrounds: dark green on light, bright green on dark. */
    val GreenAccent get() = pick(0xFF0F5A14, 0xFF7AD46A)
    val GreenTint get() = pick(0xFFE3ECD9, 0xFF1C3A21)
    val OnGreenMuted = Color(0xFFD6E6D2)
    val GreenBright = Color(0xFF7AD46A)

    val Orange = Color(0xFFD9631A)
    val OrangeIcon = Color(0xFFE8762B)
    val OrangeTint get() = pick(0xFFFBE9DB, 0xFF4A2A12)

    val Red = Color(0xFFC62828)
    val RedText get() = pick(0xFFC62828, 0xFFFF6B6B) // sharp red on light red, bright red on dark
    val RedCard get() = pick(0xFFFDECEC, 0xFF3A1A1A) // SOS surfaces
    val RedBorder get() = pick(0xFFF3C4C4, 0xFF5A2A2A)

    val MapBg = Color(0xFFE7E3D6)
    val MapPin = Color(0xFF0D1F12)
    val DarkChip = Color(0xFF1A251D)
    val DarkChipText = Color(0xFFF2F5F1)
    val Scrim = Color(0x99000000)
}

@OptIn(ExperimentalTextApi::class)
private fun jakarta(weight: Int) = Font(
    R.font.plus_jakarta_sans,
    weight = FontWeight(weight),
    variationSettings = FontVariation.Settings(FontVariation.weight(weight)),
)

val Jakarta = FontFamily(jakarta(500), jakarta(600), jakarta(700), jakarta(800))

/** Multiplies every font size in the design. 1.0 is the design's own size; the phone screens are narrower, so 0.9 reads better. */
const val TEXT_SCALE = 0.9f

/** One text style per use: the design sets size, weight and colour on each piece of text, never a shared scale. */
fun type(size: Float, weight: Int = 500, color: Color = C.Ink, letterSpacing: TextUnit = TextUnit.Unspecified) = TextStyle(
    fontFamily = Jakarta,
    fontSize = (size * TEXT_SCALE).sp,
    fontWeight = FontWeight(weight),
    color = color,
    lineHeight = (size * TEXT_SCALE * 1.3f).sp,
    letterSpacing = letterSpacing,
)

/** The design is light only for the driver app. */
@Composable
fun isDark() = isSystemInDarkTheme() && false
