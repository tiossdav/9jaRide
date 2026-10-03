package com.ninejaride.core.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import com.ninejaride.core.ui.theme.C
import com.ninejaride.core.ui.theme.type

/** What a report is about. The first word is what the server stores; the second is what the person reads. */
val REPORT_TOPICS = listOf("trip" to "A trip", "payment" to "Money or payments", "safety" to "Safety", "account" to "My account", "app" to "The app", "other" to "Something else")

/** A report already sent, as the person sees it: its code, whether it is sorted, and what staff said. */
class MyReport(val code: String, val topic: String, val message: String, val status: String, val resolution: String?)

/** The "Report a problem" form shared by the rider and driver apps. */
@Composable
fun ReportProblemForm(sending: Boolean, notice: String?, onSend: (topic: String, message: String) -> Unit) {
    var topic by rememberSaveable { mutableStateOf("other") }
    var message by rememberSaveable { mutableStateOf("") }
    Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Txt("WHAT IS IT ABOUT?", 11f, 500, C.Muted, letterSpacing = 1f)
        Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
            REPORT_TOPICS.chunked(2).forEach { row ->
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    row.forEach { (code, label) ->
                        val on = topic == code
                        Box(
                            Modifier.weight(1f).clip(RoundedCornerShape(12.dp)).background(if (on) C.GreenTint else C.Raised)
                                .border(1.5.dp, if (on) C.GreenAccent else C.Border, RoundedCornerShape(12.dp)).tap({ topic = code }, label).padding(vertical = 12.dp, horizontal = 10.dp),
                        ) { Txt(label, 13f, 700, if (on) C.GreenAccent else C.Ink, maxLines = 1) }
                    }
                }
            }
        }
        Txt("TELL US WHAT HAPPENED", 11f, 500, C.Muted, letterSpacing = 1f)
        BasicTextField(
            value = message, onValueChange = { message = it.take(2000) },
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Text),
            textStyle = type(14.5f, 500, C.Ink), cursorBrush = SolidColor(C.GreenAccent),
            modifier = Modifier.fillMaxWidth(),
            decorationBox = { inner ->
                Box(Modifier.fillMaxWidth().height(130.dp).clip(RoundedCornerShape(14.dp)).background(C.Surface).border(1.dp, C.Border, RoundedCornerShape(14.dp)).padding(14.dp)) {
                    if (message.isEmpty()) Txt("What went wrong, and when?", 14.5f, 500, C.Disabled)
                    inner()
                }
            },
        )
        notice?.let { Txt(it, 13f, 600, C.GreenAccent) }
        Btn(if (sending) "Sending..." else "Send report", { onSend(topic, message.trim()); }, Modifier.fillMaxWidth(), enabled = !sending && message.trim().length >= 5)
    }
}

@Composable
fun MyReports(reports: List<MyReport>) {
    if (reports.isEmpty()) return
    Column(verticalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.padding(top = 6.dp)) {
        Txt("YOUR REPORTS", 11f, 500, C.Muted, letterSpacing = 1f)
        reports.forEach { r ->
            Card(padding = 14.dp) {
                Row(verticalAlignment = androidx.compose.ui.Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Txt(r.code, 13f, 800, modifier = Modifier.weight(1f))
                    when (r.status) {
                        "RESOLVED" -> Chip("Resolved")
                        "IN_PROGRESS" -> Chip("Being looked at", C.OrangeIcon, C.OrangeTint)
                        else -> Chip("Received", C.Muted, C.Raised)
                    }
                }
                Txt(r.message, 13f, 500, C.Muted, maxLines = 2)
                r.resolution?.let { Txt("Our reply: $it", 13f, 600) }
            }
        }
    }
}
