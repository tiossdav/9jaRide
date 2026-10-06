package com.ninejaride.core.ui.components

import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.unit.dp
import com.ninejaride.core.ui.theme.C
import com.ninejaride.core.ui.theme.type

/**
 * The quick comments offered after a trip, by the number of stars. The same lists serve riders rating drivers and drivers rating
 * riders, so what staff read in the admin portal is comparable.
 */
object QuickComments {
    private val byStars = mapOf(
        5 to listOf("Great service", "Excellent driver", "Very polite", "Smooth ride", "Arrived on time", "Clean vehicle"),
        4 to listOf("Good service", "Friendly driver", "Comfortable ride", "Arrived on time", "Good experience"),
        3 to listOf("Average experience", "Ride was okay", "Could be improved", "Service was satisfactory"),
        2 to listOf("Driver was late", "Vehicle could be cleaner", "Ride could be better", "Service needs improvement"),
        1 to listOf("Very poor service", "Driver was late", "Unprofessional behaviour", "Vehicle was not satisfactory", "Safety concern"),
    )

    /** What a driver can say about a rider: the same five levels, worded for a passenger. */
    private val riderByStars = mapOf(
        5 to listOf("Great passenger", "Very polite", "Respectful", "Ready on time", "Easy pickup"),
        4 to listOf("Good passenger", "Friendly", "Ready on time", "Pleasant ride", "Good experience"),
        3 to listOf("Average experience", "Slight delay at pickup", "Could be more courteous", "Ride was okay"),
        2 to listOf("Late to the pickup", "Impolite", "Changed the destination", "Service needs improvement"),
        1 to listOf("Very poor behaviour", "Unsafe or aggressive", "Refused to pay", "Damaged the vehicle", "Safety concern"),
    )

    /** The quick comments for this many stars. [ofRider] is true when a driver is rating a rider. */
    fun forStars(stars: Int, ofRider: Boolean = false): List<String> = (if (ofRider) riderByStars else byStars)[stars.coerceIn(1, 5)].orEmpty()

    /** When the stars change, comments that belong to another level are dropped. */
    fun keep(stars: Int, selected: Set<String>, ofRider: Boolean = false): Set<String> = selected.filter { it in forStars(stars, ofRider) }.toSet()

    const val MAX_COMMENT = 500
    const val THANKS = "Thank you for your feedback! Your response helps us improve 9jaRide."
}

/** Stars, the quick comments for that many stars (several can be picked), and an optional written comment. */
@OptIn(ExperimentalLayoutApi::class, ExperimentalFoundationApi::class)
@Composable
fun FeedbackForm(
    stars: Int,
    onStars: (Int) -> Unit,
    selected: Set<String>,
    onToggle: (String) -> Unit,
    comment: String,
    onComment: (String) -> Unit,
    starSize: androidx.compose.ui.unit.Dp = 38.dp,
    /** True when a driver is rating a rider: the quick comments are worded for a passenger. */
    ofRider: Boolean = false,
) {
    Column(verticalArrangement = Arrangement.spacedBy(14.dp), horizontalAlignment = Alignment.CenterHorizontally) {
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            for (i in 1..5) {
                Box(Modifier.size(starSize + 8.dp).tap({ onStars(i) }, "$i stars"), contentAlignment = Alignment.Center) {
                    StarFilled(if (i <= stars) C.OrangeIcon else C.ToggleOff, starSize)
                }
            }
        }
        FlowRow(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp, Alignment.CenterHorizontally), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            QuickComments.forStars(stars, ofRider).forEach { t ->
                val on = t in selected
                Box(Modifier.clip(RoundedCornerShape(999.dp)).background(if (on) C.GreenTint else C.Raised).border(1.dp, if (on) C.GreenAccent else C.Border, RoundedCornerShape(999.dp)).tap({ onToggle(t) }, t).padding(horizontal = 14.dp, vertical = 9.dp)) {
                    Txt(t, 13f, 700, if (on) C.GreenAccent else C.Ink)
                }
            }
        }
        BasicTextField(
            value = comment, onValueChange = { onComment(it.take(QuickComments.MAX_COMMENT)) }, textStyle = type(14.5f, 500, C.Ink), cursorBrush = SolidColor(C.GreenAccent),
            modifier = Modifier.fillMaxWidth(), minLines = 2, maxLines = 4,
            decorationBox = { inner ->
                Box(Modifier.fillMaxWidth().defaultMinSize(minHeight = 70.dp).clip(RoundedCornerShape(14.dp)).background(C.Surface).border(1.dp, C.Border, RoundedCornerShape(14.dp)).padding(horizontal = 14.dp, vertical = 12.dp)) {
                    if (comment.isEmpty()) Txt("Add a comment (optional)", 14.5f, 500, C.Disabled)
                    inner()
                }
            },
        )
    }
}

/** What is shown once feedback has been sent. */
@Composable
fun FeedbackThanks(tint: Color = C.GreenAccent) {
    Column(Modifier.fillMaxWidth().clip(RoundedCornerShape(16.dp)).background(C.GreenTint).padding(16.dp), horizontalAlignment = Alignment.CenterHorizontally) {
        Txt(QuickComments.THANKS, 14f, 700, tint, align = androidx.compose.ui.text.style.TextAlign.Center)
    }
}
