package com.ninejaride.core.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import com.ninejaride.core.ui.theme.C
import com.ninejaride.core.ui.theme.type

/** A labelled single-line text box in the apps' style. Shared by the sign-up and onboarding forms. */
@Composable
fun InputField(
    label: String,
    value: String,
    onChange: (String) -> Unit,
    hint: String,
    keyboard: KeyboardType = KeyboardType.Text,
    helper: String? = null,
    /** Tidies what was typed before it is stored, for example dates that get their slashes by themselves. */
    format: (String) -> String = { it },
    /** Shows a Nigerian mobile number as 0803 000 0010 while only the digits are stored. */
    phone: Boolean = false,
    /** A number plate: capitals and digits are stored, and it is shown with its dash (KJA-482AB) without the cursor ever moving. */
    plate: Boolean = false,
) {
    Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
        Txt(label, 12.5f, 600, C.Muted)
        BasicTextField(
            value = value, onValueChange = { onChange(if (plate) com.ninejaride.core.format.normalizePlate(it) else format(it)) }, singleLine = true,
            visualTransformation = if (phone) PhoneTransformation else if (plate) PlateTransformation else androidx.compose.ui.text.input.VisualTransformation.None,
            keyboardOptions = KeyboardOptions(keyboardType = keyboard),
            textStyle = type(15f, 500, C.Ink),
            cursorBrush = SolidColor(C.GreenAccent),
            modifier = Modifier.fillMaxWidth(),
            decorationBox = { inner ->
                Row(
                    Modifier.fillMaxWidth().clip(RoundedCornerShape(14.dp)).background(C.Surface).border(1.dp, C.Border, RoundedCornerShape(14.dp)).padding(horizontal = 16.dp, vertical = 15.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Box(Modifier.weight(1f)) { if (value.isEmpty()) Txt(hint, 15f, 500, C.Disabled); inner() }
                }
            },
        )
        helper?.let { Txt(it, 12f, 500, C.Muted) }
    }
}

/** One choice among several, drawn as a card that lights up when picked. */
@Composable
fun ChoiceCard(title: String, text: String, selected: Boolean, onClick: () -> Unit) {
    Column(
        Modifier.fillMaxWidth().clip(RoundedCornerShape(16.dp)).background(if (selected) C.GreenTint else C.Surface)
            .border(1.5.dp, if (selected) C.GreenAccent else C.Border, RoundedCornerShape(16.dp)).tap(onClick, title).padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(4.dp),
    ) {
        Txt(title, 15.5f, 700, if (selected) C.GreenAccent else C.Ink)
        Txt(text, 13f, 500, C.Muted)
    }
}

/** A small pill choice, for short lists such as the vehicle category. */
@Composable
fun PillChoice(label: String, selected: Boolean, onClick: () -> Unit, modifier: Modifier = Modifier) {
    Box(
        modifier.clip(RoundedCornerShape(12.dp)).background(if (selected) C.GreenTint else C.Raised)
            .border(1.5.dp, if (selected) C.GreenAccent else C.Border, RoundedCornerShape(12.dp)).tap(onClick, label).padding(vertical = 12.dp, horizontal = 10.dp),
        contentAlignment = Alignment.Center,
    ) { Txt(label, 13.5f, 700, if (selected) C.GreenAccent else C.Ink, maxLines = 1) }
}

/** 08030000010 shown as 0803 000 0010. */
val PhoneTransformation = androidx.compose.ui.text.input.VisualTransformation { text ->
    val shown = buildString { text.text.forEachIndexed { i, c -> if (i == 4 || i == 7) append(' '); append(c) } }
    androidx.compose.ui.text.input.TransformedText(
        androidx.compose.ui.text.AnnotatedString(shown),
        object : androidx.compose.ui.text.input.OffsetMapping {
            override fun originalToTransformed(offset: Int) = offset + (if (offset > 4) 1 else 0) + (if (offset > 7) 1 else 0)
            override fun transformedToOriginal(offset: Int) = offset - (if (offset > 5) 1 else 0) - (if (offset > 9) 1 else 0)
        },
    )
}

/** 12052026 becomes 12/05/2026 as the digits are typed. */
fun formatDateInput(typed: String): String {
    val d = typed.filter(Char::isDigit).take(8)
    return when {
        d.length <= 2 -> d
        d.length <= 4 -> d.substring(0, 2) + "/" + d.substring(2)
        else -> d.substring(0, 2) + "/" + d.substring(2, 4) + "/" + d.substring(4)
    }
}

/**
 * Shows a stored plate with its dash. Only the display changes; what is stored stays plain, and the transformation maps
 * every cursor position both ways, so typing, deleting and pasting in the middle all keep the cursor where it belongs.
 */
val PlateTransformation = androidx.compose.ui.text.input.VisualTransformation { text ->
    val raw = text.text
    val shown = com.ninejaride.core.format.formatPlate(raw)
    androidx.compose.ui.text.input.TransformedText(
        androidx.compose.ui.text.AnnotatedString(shown),
        object : androidx.compose.ui.text.input.OffsetMapping {
            override fun originalToTransformed(offset: Int) = if (raw.length > 3 && offset > 3) offset + 1 else offset
            override fun transformedToOriginal(offset: Int) = if (raw.length > 3 && offset > 3) offset - 1 else offset
        },
    )
}

/**
 * A date chosen from a calendar instead of typed, so an impossible date can never be entered. The value is kept as
 * DD/MM/YYYY (empty until chosen). [earliest] and [latest] grey out the days that are not allowed.
 */
@Composable
fun DateField(
    label: String,
    value: String,
    onPick: (String) -> Unit,
    hint: String = "Choose a date",
    earliest: java.time.LocalDate? = null,
    latest: java.time.LocalDate? = null,
    opensAt: java.time.LocalDate = java.time.LocalDate.now(),
) {
    val context = androidx.compose.ui.platform.LocalContext.current
    fun parse(v: String): java.time.LocalDate? = Regex("^([0-9]{2})/([0-9]{2})/([0-9]{4})$").matchEntire(v)?.let {
        runCatching { java.time.LocalDate.of(it.groupValues[3].toInt(), it.groupValues[2].toInt(), it.groupValues[1].toInt()) }.getOrNull()
    }
    Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
        Txt(label, 12.5f, 600, C.Muted)
        Row(
            Modifier.fillMaxWidth().clip(RoundedCornerShape(14.dp)).background(C.Surface).border(1.dp, C.Border, RoundedCornerShape(14.dp))
                .tap({
                    val start = parse(value) ?: opensAt
                    val dialog = android.app.DatePickerDialog(context, { _, y, m, d -> onPick("%02d/%02d/%04d".format(d, m + 1, y)) }, start.year, start.monthValue - 1, start.dayOfMonth)
                    val zone = java.time.ZoneId.systemDefault()
                    earliest?.let { dialog.datePicker.minDate = it.atStartOfDay(zone).toInstant().toEpochMilli() }
                    latest?.let { dialog.datePicker.maxDate = it.atStartOfDay(zone).toInstant().toEpochMilli() }
                    dialog.show()
                }, label)
                .padding(horizontal = 16.dp, vertical = 15.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Box(Modifier.weight(1f)) { Txt(value.ifEmpty { hint }, 15f, 500, if (value.isEmpty()) C.Disabled else C.Ink) }
            Icon24(Ic.Calendar, C.Muted, 20.dp)
        }
    }
}
