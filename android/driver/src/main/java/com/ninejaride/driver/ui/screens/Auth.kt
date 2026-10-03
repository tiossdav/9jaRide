package com.ninejaride.driver.ui.screens

import android.Manifest
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalSoftwareKeyboardController
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.foundation.text.BasicText
import com.ninejaride.driver.state.DriverViewModel
import com.ninejaride.core.format.clock
import com.ninejaride.core.ui.components.Btn
import com.ninejaride.core.ui.components.BtnKind
import com.ninejaride.core.ui.components.CircleIconButton
import com.ninejaride.core.ui.components.Gap
import com.ninejaride.core.ui.components.Ic
import com.ninejaride.core.ui.components.Icon24
import com.ninejaride.core.ui.components.SheetOverlay
import com.ninejaride.core.ui.components.Txt
import com.ninejaride.core.ui.components.tap
import com.ninejaride.core.ui.theme.C
import com.ninejaride.core.ui.theme.type

@Composable
fun SplashScreen() {
    Box(Modifier.fillMaxSize().background(Color.Black)) {
        Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
            BasicText(
                buildAnnotatedString {
                    append("9jaRide ")
                    withStyle(SpanStyle(color = C.OrangeIcon)) { append("Pro") }
                },
                style = type(46f, 800, Color.White).copy(textAlign = TextAlign.Center),
            )
        }
        Box(Modifier.align(Alignment.BottomCenter).navigationBarsPadding().padding(bottom = 28.dp)) {
            Txt("Powered by Nexenno", 12.5f, 500, C.Faint)
        }
    }
}

@Composable
private fun LogoTile() {
    Box(Modifier.size(52.dp).clip(RoundedCornerShape(14.dp)).background(Color.White), contentAlignment = Alignment.Center) {
        BasicText(
            buildAnnotatedString {
                append("9")
                withStyle(SpanStyle(fontStyle = FontStyle.Italic)) { append("ja") }
            },
            style = type(24f, 800, C.Green),
        )
    }
}

private fun formatPhone(d: String): String = buildString {
    d.forEachIndexed { i, c -> if (i == 4 || i == 7) append(' '); append(c) }
}

@Composable
fun SignInScreen(vm: DriverViewModel) {
    Column(Modifier.fillMaxSize().background(C.Bg).imePadding()) {
        Column(Modifier.fillMaxWidth().background(C.Green).statusBarsPadding().padding(start = 20.dp, end = 20.dp, top = 16.dp, bottom = 24.dp)) {
            LogoTile()
            Gap(72.dp)
            Txt("Sign in.", 34f, 800, Color.White)
            Gap(6.dp)
            Txt("Start earning on your next trip.", 14.5f, 500, C.OnGreenMuted)
        }
        Column(Modifier.padding(horizontal = 20.dp, vertical = 24.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                Txt("Mobile number", 12.5f, 600, C.Muted)
                val focus = remember { FocusRequester() }
                BasicTextField(
                    value = vm.phoneDigits,
                    onValueChange = vm::onPhoneChange,
                    singleLine = true,
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Phone),
                    textStyle = type(15f, 500, C.Ink),
                    modifier = Modifier.fillMaxWidth().focusRequester(focus),
                    decorationBox = { inner ->
                        Row(
                            Modifier.fillMaxWidth().clip(RoundedCornerShape(14.dp)).background(Color.White)
                                .border(1.dp, C.Border, RoundedCornerShape(14.dp)).padding(horizontal = 16.dp, vertical = 15.dp),
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            Txt("🇳🇬  ", 15f, 500)
                            Box(Modifier.weight(1f)) {
                                if (vm.phoneDigits.isEmpty()) Txt("0803 000 0010", 15f, 500, C.Disabled)
                                inner()
                            }
                        }
                    },
                    visualTransformation = androidx.compose.ui.text.input.VisualTransformation { text ->
                        val shown = formatPhone(text.text)
                        androidx.compose.ui.text.input.TransformedText(
                            androidx.compose.ui.text.AnnotatedString(shown),
                            object : androidx.compose.ui.text.input.OffsetMapping {
                                override fun originalToTransformed(offset: Int) = offset + (if (offset > 4) 1 else 0) + (if (offset > 7) 1 else 0)
                                override fun transformedToOriginal(offset: Int) = offset - (if (offset > 5) 1 else 0) - (if (offset > 9) 1 else 0)
                            },
                        )
                    },
                )
            }
            Txt(vm.message ?: "We'll send a one-time code to confirm it's you.", 12.5f, 500, if (vm.message != null) C.Red else C.Muted)
            Btn("Continue", vm::startSignIn, Modifier.fillMaxWidth(), enabled = vm.phoneValid && !vm.busy)
            Gap(18.dp)
            Column(Modifier.fillMaxWidth(), horizontalAlignment = Alignment.CenterHorizontally) {
                Txt("Want to drive with 9jaRide? Register and onboard on our website.", 13f, 500, C.Muted, align = TextAlign.Center)
                Txt("9jaridepro.com →", 13f, 700, C.Green, align = TextAlign.Center)
            }
        }
    }
    if (vm.dialog == com.ninejaride.driver.state.Dialog.OtpMethod) OtpMethodSheet(vm)
}

@Composable
fun OtpMethodSheet(vm: DriverViewModel) {
    SheetOverlay(onDismiss = { vm.dialog = null }) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Txt("Receive code via", 18f, 800, modifier = Modifier.weight(1f))
            CircleIconButton(Ic.Close, "Close", { vm.dialog = null }, 38.dp)
        }
        Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
            MethodRow(Ic.Mail, "SMS", !vm.voiceCode) { vm.voiceCode = false }
            MethodRow(Ic.Phone, "Phone call", vm.voiceCode) { vm.voiceCode = true }
        }
        Btn("Send code", vm::sendCode, Modifier.fillMaxWidth())
    }
}

@Composable
private fun MethodRow(icon: List<String>, label: String, selected: Boolean, onClick: () -> Unit) {
    val border = if (selected) C.GreenAccent else C.Border
    Row(
        Modifier.fillMaxWidth().clip(RoundedCornerShape(14.dp)).background(if (selected) C.GreenTint.copy(alpha = 0.5f) else Color.White)
            .border(1.5.dp, border, RoundedCornerShape(14.dp)).tap(onClick, label).padding(14.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Icon24(icon, C.GreenAccent)
        Txt(label, 15f, 700, modifier = Modifier.weight(1f))
        Box(Modifier.size(22.dp).clip(CircleShape).border(2.dp, border, CircleShape), contentAlignment = Alignment.Center) {
            if (selected) Box(Modifier.size(10.dp).clip(CircleShape).background(C.GreenAccent))
        }
    }
}

@Composable
fun OtpScreen(vm: DriverViewModel) {
    val focus = remember { FocusRequester() }
    val keyboard = LocalSoftwareKeyboardController.current
    LaunchedEffect(Unit) { focus.requestFocus(); keyboard?.show() }
    val n = DriverViewModel.OTP_LENGTH

    Column(Modifier.fillMaxSize().background(C.Bg).imePadding()) {
        Row(Modifier.statusBarsPadding().padding(start = 20.dp, end = 20.dp, top = 18.dp, bottom = 8.dp)) {
            CircleIconButton(Ic.Back, "Back", vm::pop)
        }
        Column(
            Modifier.padding(horizontal = 20.dp, vertical = 6.dp).fillMaxWidth(),
            verticalArrangement = Arrangement.spacedBy(14.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Box(Modifier.size(72.dp).clip(CircleShape).background(C.GreenTint), contentAlignment = Alignment.Center) {
                Icon24(if (vm.voiceCode) Ic.Phone else Ic.Mail, C.GreenAccent, 30.dp)
            }
            Txt("Verify your number", 24f, 800, align = TextAlign.Center)
            Column(horizontalAlignment = Alignment.CenterHorizontally) {
                Txt("Enter the $n-digit code we sent to", 14f, 500, C.Muted, align = TextAlign.Center)
                Row {
                    Txt(vm.maskedPhone, 14f, 700)
                    Txt("   ", 14f)
                    Txt("Change", 14f, 700, C.Green, Modifier.tap(vm::pop, "Change number"))
                }
            }
            // The real input is invisible; the boxes below only display what was typed.
            BasicTextField(
                value = vm.otp,
                onValueChange = vm::onOtpChange,
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.NumberPassword),
                modifier = Modifier.size(1.dp).alpha(0f).focusRequester(focus),
            )
            Row(
                Modifier.padding(vertical = 10.dp).tap({ focus.requestFocus(); keyboard?.show() }, "Code entry"),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                for (i in 0 until n) {
                    val active = i == vm.otp.length.coerceAtMost(n - 1)
                    Box(
                        Modifier.width(46.dp).height(60.dp).clip(RoundedCornerShape(14.dp)).background(Color.White)
                            .border(1.5.dp, if (active) C.GreenAccent else C.Border, RoundedCornerShape(14.dp)),
                        contentAlignment = Alignment.Center,
                    ) { Txt(vm.otp.getOrNull(i)?.toString() ?: "", 26f, 700) }
                }
            }
            if (vm.resendSeconds > 0) Txt("Resend code in ${clock(vm.resendSeconds)}", 13f, 500, C.Muted)
            else Txt("Resend code", 13f, 700, C.Green, Modifier.tap(vm::resend, "Resend code"))
            if (vm.message != null) Txt(vm.message!!, 13f, 600, C.Red, align = TextAlign.Center)
            Btn("Verify", vm::verify, Modifier.fillMaxWidth(), enabled = vm.otp.length == n && !vm.busy)
            Txt("Never share this code with anyone, including our staff.", 12.5f, 500, C.Muted, align = TextAlign.Center)
        }
    }
    when (vm.dialog) {
        com.ninejaride.driver.state.Dialog.SignedIn -> SignedInSheet(vm)
        com.ninejaride.driver.state.Dialog.NotRegistered -> NotRegisteredSheet(vm)
        else -> {}
    }
}

@Composable
private fun SignedInSheet(vm: DriverViewModel) {
    SheetOverlay(onDismiss = null) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            Box(Modifier.size(44.dp).clip(CircleShape).background(C.GreenAccent), contentAlignment = Alignment.Center) {
                Icon24(Ic.Check, Color.White, 22.dp, 2.6f)
            }
            Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
                Txt("Sign in successful", 17f, 800)
                Txt("You have signed in to your account.", 13f, 500, C.Muted)
            }
        }
        Btn("Continue", vm::finishSignIn, Modifier.fillMaxWidth())
    }
}

/** Not in the design: shown when the number has no driver account. Drivers are onboarded on the website, not in the app. */
@Composable
private fun NotRegisteredSheet(vm: DriverViewModel) {
    SheetOverlay(onDismiss = { vm.dialog = null }) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            Box(Modifier.size(46.dp).clip(CircleShape).background(C.OrangeTint), contentAlignment = Alignment.Center) {
                Icon24(Ic.Warning, C.OrangeIcon, 24.dp)
            }
            Txt("No driver account for this number", 17f, 800, modifier = Modifier.weight(1f))
        }
        Txt("Drivers register and onboard on our website. Once you are approved, sign in here with the same number.", 13.5f, 500, C.Muted)
        Txt("9jaridepro.com →", 14f, 700, C.Green)
        Btn("OK", { vm.dialog = null; vm.pop() }, Modifier.fillMaxWidth())
    }
}

/** Adapted from the rider location screen: drivers share location while online, in the background. */
@Composable
fun LocationPermissionScreen(vm: DriverViewModel) {
    val launcher = rememberLauncherForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) { vm.locationDone() }
    Column(Modifier.fillMaxSize().background(C.Bg).statusBarsPadding().navigationBarsPadding().padding(horizontal = 24.dp, vertical = 24.dp)) {
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(16.dp), horizontalAlignment = Alignment.CenterHorizontally) {
            Gap(40.dp)
            Box(Modifier.size(88.dp).clip(CircleShape).background(C.GreenTint), contentAlignment = Alignment.Center) { Icon24(Ic.Pin, C.GreenAccent, 40.dp) }
            Txt("Allow location", 24f, 800, align = TextAlign.Center)
            Txt(
                "We use your location to match you with riders near you. While you are online it is shared with the rider on your trip and our safety team.",
                14f, 500, C.Muted, align = TextAlign.Center,
            )
            Gap(8.dp)
            Column(verticalArrangement = Arrangement.spacedBy(14.dp)) {
                listOf("Receive trips near you", "Set your pickup point automatically", "Share live trip progress").forEach {
                    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                        Box(Modifier.size(28.dp).clip(CircleShape).background(C.GreenTint), contentAlignment = Alignment.Center) { Icon24(Ic.Check, C.GreenAccent, 16.dp, 2.4f) }
                        Txt(it, 14.5f, 600)
                    }
                }
            }
        }
        Btn(
            "Allow while using the app",
            { launcher.launch(arrayOf(Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION)) },
            Modifier.fillMaxWidth(),
        )
        Gap(8.dp)
        Btn("Not now", vm::locationDone, Modifier.fillMaxWidth(), kind = BtnKind.Outline)
    }
}

/** Not in the design: shown when the server says this app version is too old. */
@Composable
fun UpdateRequiredScreen(vm: DriverViewModel) {
    Column(
        Modifier.fillMaxSize().background(C.Bg).statusBarsPadding().padding(32.dp),
        verticalArrangement = Arrangement.Center,
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Txt("Please update 9jaRide Pro", 22f, 800, align = TextAlign.Center)
        Gap(10.dp)
        Txt("This version is no longer supported. Update the app to keep driving.", 14f, 500, C.Muted, align = TextAlign.Center)
        Gap(20.dp)
        if (vm.updateUrl != null) Txt(vm.updateUrl!!, 13f, 700, C.Green, align = TextAlign.Center)
    }
}
