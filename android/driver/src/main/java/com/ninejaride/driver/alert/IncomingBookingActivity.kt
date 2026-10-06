package com.ninejaride.driver.alert

import android.app.KeyguardManager
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.Bundle
import android.view.WindowManager
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import com.ninejaride.core.data.ApiException
import com.ninejaride.core.ui.components.Btn
import com.ninejaride.core.ui.components.BtnKind
import com.ninejaride.core.ui.components.Txt
import com.ninejaride.driver.MainActivity
import com.ninejaride.driver.data.Api
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.launch

/** What the driver did on the incoming-booking screen, so the main app can follow (start the pickup, or forget the offer). */
object OfferAnswers {
    data class Answer(val rideId: String, val accepted: Boolean)
    val answer = MutableStateFlow<Answer?>(null)
}

/**
 * The incoming booking, on its own small screen: it lights the screen, shows over the lock screen, and gives Accept and
 * Decline straight away, without loading the whole app. Opened by the booking alert's full-screen notification.
 */
class IncomingBookingActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        enableEdgeToEdge(androidx.activity.SystemBarStyle.dark(android.graphics.Color.TRANSPARENT), androidx.activity.SystemBarStyle.dark(android.graphics.Color.TRANSPARENT))
        super.onCreate(savedInstanceState)
        if (Build.VERSION.SDK_INT >= 27) { setShowWhenLocked(true); setTurnScreenOn(true) }
        else @Suppress("DEPRECATION") window.addFlags(WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED or WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON)
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        show(intent)
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        show(intent)
    }

    private fun show(i: Intent) {
        val rideId = i.getStringExtra(EXTRA_RIDE) ?: run { finish(); return }
        val rider = i.getStringExtra(EXTRA_RIDER) ?: "A rider"
        val pickup = i.getStringExtra(EXTRA_PICKUP) ?: "the pickup point"
        val endsAt = i.getLongExtra(EXTRA_ENDS_AT, System.currentTimeMillis() + 15_000)
        val auto = i.getStringExtra(EXTRA_AUTO) // "accept" / "decline" from the notification's buttons
        setContent { Screen(rideId, rider, pickup, endsAt, auto) }
    }

    @androidx.compose.runtime.Composable
    private fun Screen(rideId: String, rider: String, pickup: String, endsAt: Long, auto: String?) {
        val scope = rememberCoroutineScope()
        var busy by remember { mutableStateOf(false) }
        var note by remember { mutableStateOf<String?>(null) }
        var left by remember { mutableIntStateOf(((endsAt - System.currentTimeMillis()) / 1000).toInt().coerceAtLeast(0)) }

        fun answer(accept: Boolean) {
            if (busy) return
            busy = true
            BookingAlert.stop(this)
            scope.launch {
                val api = Api(this@IncomingBookingActivity)
                try {
                    if (accept) {
                        if (api.accept(rideId)) {
                            OfferAnswers.answer.value = OfferAnswers.Answer(rideId, true)
                            openApp()
                        } else { note = "Too late: the ride was taken or timed out."; delay(2500); finish() }
                    } else {
                        runCatching { api.decline(rideId) }
                        OfferAnswers.answer.value = OfferAnswers.Answer(rideId, false)
                        finish()
                    }
                } catch (e: ApiException) {
                    note = if (e.isNetwork) "No connection. Open the app and try again." else e.message
                    busy = false
                }
            }
        }

        LaunchedEffect(auto) { if (auto == "accept") answer(true) else if (auto == "decline") answer(false) }
        LaunchedEffect(Unit) {
            while (left > 0) { delay(1000); left = ((endsAt - System.currentTimeMillis()) / 1000).toInt().coerceAtLeast(0) }
            if (!busy) { BookingAlert.stop(this@IncomingBookingActivity); finish() } // ran out: the server offers it to someone else
        }

        Column(
            Modifier.fillMaxSize().background(Color(0xFF0D1F12)).statusBarsPadding().navigationBarsPadding().padding(24.dp),
            verticalArrangement = Arrangement.SpaceBetween, horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(10.dp), modifier = Modifier.padding(top = 40.dp)) {
                Txt("NEW BOOKING", 13f, 800, Color(0xFF7AD46A), letterSpacing = 2f)
                Box(Modifier.size(110.dp).clip(CircleShape).background(Color(0xFF16351C)), contentAlignment = Alignment.Center) {
                    Txt("$left", 44f, 800, Color.White)
                }
                Txt("seconds to answer", 13f, 600, Color(0xFFB7C7B9))
            }
            Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Txt(rider, 26f, 800, Color.White, align = TextAlign.Center)
                Txt("is waiting at", 14f, 500, Color(0xFFB7C7B9))
                Txt(pickup, 18f, 700, Color.White, align = TextAlign.Center)
                note?.let { Txt(it, 14f, 700, Color(0xFFFFB4A8), align = TextAlign.Center) }
            }
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                Btn(if (busy) "..." else "Decline", { answer(false) }, Modifier.weight(1f), kind = BtnKind.Danger, enabled = !busy, height = 60.dp, size = 17f)
                Btn(if (busy) "Accepting..." else "Accept", { answer(true) }, Modifier.weight(1f), kind = BtnKind.Light, enabled = !busy, height = 60.dp, size = 17f)
            }
        }
    }

    /** Accepted: ask the phone to unlock, then open the app on the trip. */
    private fun openApp() {
        val go = { startActivity(Intent(this, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP)); finish() }
        val km = getSystemService(KeyguardManager::class.java)
        if (Build.VERSION.SDK_INT >= 26 && km.isKeyguardLocked) {
            km.requestDismissKeyguard(this, object : KeyguardManager.KeyguardDismissCallback() {
                override fun onDismissSucceeded() { go() }
                override fun onDismissCancelled() { go() }
                override fun onDismissError() { go() }
            })
        } else go()
    }

    companion object {
        const val EXTRA_RIDE = "ride"; const val EXTRA_RIDER = "rider"; const val EXTRA_PICKUP = "pickup"
        const val EXTRA_ENDS_AT = "endsAt"; const val EXTRA_AUTO = "auto"

        fun intent(context: Context, rideId: String, rider: String, pickup: String, seconds: Int, auto: String? = null): Intent =
            Intent(context, IncomingBookingActivity::class.java)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_NO_USER_ACTION)
                .putExtra(EXTRA_RIDE, rideId).putExtra(EXTRA_RIDER, rider).putExtra(EXTRA_PICKUP, pickup)
                .putExtra(EXTRA_ENDS_AT, System.currentTimeMillis() + seconds * 1000L)
                .apply { if (auto != null) putExtra(EXTRA_AUTO, auto) }
    }
}
