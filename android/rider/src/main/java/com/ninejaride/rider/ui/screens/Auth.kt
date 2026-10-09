package com.ninejaride.rider.ui.screens

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
import androidx.compose.foundation.text.BasicText
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
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.platform.LocalSoftwareKeyboardController
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.OffsetMapping
import androidx.compose.ui.text.input.TransformedText
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
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
import com.ninejaride.rider.state.Dest
import com.ninejaride.rider.state.Dialog
import com.ninejaride.rider.state.RiderViewModel

@Composable
fun SplashScreen() {
    // white with the green 9, the same artwork as the launcher icon
    Box(Modifier.fillMaxSize().background(Color.White), contentAlignment = Alignment.Center) {
        androidx.compose.foundation.Image(
            androidx.compose.ui.res.painterResource(com.ninejaride.rider.R.drawable.brand_nine), contentDescription = "9jaRide Pro",
            Modifier.height(132.dp),
        )
    }
}

@Composable
private fun LogoTile() {
    Box(Modifier.size(52.dp).clip(RoundedCornerShape(14.dp)).background(Color.White), contentAlignment = Alignment.Center) {
        BasicText(buildAnnotatedString { append("9"); withStyle(SpanStyle(fontStyle = FontStyle.Italic)) { append("ja") } }, style = type(24f, 800, C.Green))
    }
}

@Composable
fun WelcomeScreen(vm: RiderViewModel) {
    Column(Modifier.fillMaxSize().background(C.Green).statusBarsPadding().navigationBarsPadding().padding(24.dp)) {
        LogoTile()
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.Bottom) {
            Txt("Get there,\nsafely and on time.", 34f, 800, Color.White)
            Gap(10.dp)
            Txt("Book a ride in a few taps, pay with cash or your wallet, and share your trip with people you trust.", 14.5f, 500, C.OnGreenMuted)
            Gap(28.dp)
        }
        Btn("Create account", { vm.message = null; vm.push(Dest.SignUp) }, Modifier.fillMaxWidth(), kind = BtnKind.Light)
        Gap(10.dp)
        Btn("Sign in", { vm.message = null; vm.push(Dest.SignIn) }, Modifier.fillMaxWidth(), kind = BtnKind.Dark)
    }
}

private fun formatPhone(d: String): String = buildString { d.forEachIndexed { i, c -> if (i == 4 || i == 7) append(' '); append(c) } }

@Composable
fun Field(label: String, value: String, onChange: (String) -> Unit, hint: String, keyboard: KeyboardType = KeyboardType.Text, phone: Boolean = false, prefix: String? = null) {
    Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
        Txt(label, 12.5f, 600, C.Muted)
        BasicTextField(
            value = value, onValueChange = onChange, singleLine = true,
            keyboardOptions = KeyboardOptions(keyboardType = keyboard),
            textStyle = type(15f, 500, C.Ink),
            cursorBrush = SolidColor(C.GreenAccent),
            modifier = Modifier.fillMaxWidth(),
            visualTransformation = if (!phone) VisualTransformation.None else VisualTransformation { text ->
                TransformedText(AnnotatedString(formatPhone(text.text)), object : OffsetMapping {
                    override fun originalToTransformed(offset: Int) = offset + (if (offset > 4) 1 else 0) + (if (offset > 7) 1 else 0)
                    override fun transformedToOriginal(offset: Int) = offset - (if (offset > 5) 1 else 0) - (if (offset > 9) 1 else 0)
                })
            },
            decorationBox = { inner ->
                Row(Modifier.fillMaxWidth().clip(RoundedCornerShape(14.dp)).background(C.Surface).border(1.dp, C.Border, RoundedCornerShape(14.dp)).padding(horizontal = 16.dp, vertical = 15.dp), verticalAlignment = Alignment.CenterVertically) {
                    prefix?.let { Txt("$it  ", 15f, 500) }
                    Box(Modifier.weight(1f)) { if (value.isEmpty()) Txt(hint, 15f, 500, C.Disabled); inner() }
                }
            },
        )
    }
}

@Composable
private fun AuthFrame(title: String, subtitle: String, content: @Composable () -> Unit) {
    Column(Modifier.fillMaxSize().background(C.Bg).imePadding()) {
        Column(Modifier.fillMaxWidth().background(C.Green).statusBarsPadding().padding(start = 20.dp, end = 20.dp, top = 16.dp, bottom = 24.dp)) {
            LogoTile(); Gap(56.dp)
            Txt(title, 34f, 800, Color.White); Gap(6.dp)
            Txt(subtitle, 14.5f, 500, C.OnGreenMuted)
        }
        Column(Modifier.padding(horizontal = 20.dp, vertical = 24.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) { content() }
    }
}

@Composable
fun SignUpScreen(vm: RiderViewModel) {
    AuthFrame("Create account.", "Tell us who you are, then confirm your number.") {
        Field("Full name", vm.fullName, { vm.fullName = it; vm.message = null }, "Olaoluwa Taiwo")
        Field("Mobile number", vm.phoneDigits, vm::onPhoneChange, "0803 000 0010", KeyboardType.Phone, phone = true, prefix = "🇳🇬")
        Txt(vm.message ?: "We will send a one-time code to confirm it is you.", 12.5f, 500, if (vm.message != null) C.RedText else C.Muted)
        Btn("Continue", { vm.sendCode(needName = true) }, Modifier.fillMaxWidth(), enabled = vm.phoneValid && vm.fullName.trim().length >= 2 && !vm.busy)
        Gap(8.dp)
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.Center) {
            Txt("Already have an account?  ", 13f, 500, C.Muted)
            Txt("Sign in", 13f, 700, C.GreenAccent, Modifier.tap({ vm.message = null; vm.pop(); vm.push(Dest.SignIn) }, "Sign in"))
        }
    }
    if (vm.dialog == Dialog.Notice) NoticeSheet(vm)
}

@Composable
fun SignInScreen(vm: RiderViewModel) {
    AuthFrame("Sign in.", "Welcome back. Where to today?") {
        Field("Mobile number", vm.phoneDigits, vm::onPhoneChange, "0803 000 0010", KeyboardType.Phone, phone = true, prefix = "🇳🇬")
        Txt(vm.message ?: "We will send a one-time code to confirm it is you.", 12.5f, 500, if (vm.message != null) C.RedText else C.Muted)
        Btn("Continue", { vm.sendCode(needName = false) }, Modifier.fillMaxWidth(), enabled = vm.phoneValid && !vm.busy)
        Gap(8.dp)
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.Center) {
            Txt("New to 9jaRide?  ", 13f, 500, C.Muted)
            Txt("Create account", 13f, 700, C.GreenAccent, Modifier.tap({ vm.message = null; vm.pop(); vm.push(Dest.SignUp) }, "Create account"))
        }
    }
    if (vm.dialog == Dialog.Notice) NoticeSheet(vm)
}

@Composable
fun OtpScreen(vm: RiderViewModel) {
    val focus = remember { FocusRequester() }
    val keyboard = LocalSoftwareKeyboardController.current
    LaunchedEffect(Unit) { focus.requestFocus(); keyboard?.show() }
    val n = vm.otpLength
    Column(Modifier.fillMaxSize().background(C.Bg).imePadding()) {
        Row(Modifier.statusBarsPadding().padding(start = 20.dp, end = 20.dp, top = 18.dp, bottom = 8.dp)) { CircleIconButton(Ic.Back, "Back", vm::pop) }
        Column(Modifier.padding(horizontal = 20.dp, vertical = 6.dp).fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(14.dp), horizontalAlignment = Alignment.CenterHorizontally) {
            Box(Modifier.size(72.dp).clip(CircleShape).background(C.GreenTint), contentAlignment = Alignment.Center) { Icon24(if (vm.voiceCode) Ic.Phone else Ic.Mail, C.GreenAccent, 30.dp) }
            Txt("Verify your number", 24f, 800, align = TextAlign.Center)
            Column(horizontalAlignment = Alignment.CenterHorizontally) {
                Txt("Enter the $n-digit code we sent to", 14f, 500, C.Muted, align = TextAlign.Center)
                Row { Txt(vm.maskedPhone, 14f, 700); Txt("   ", 14f); Txt("Change", 14f, 700, C.GreenAccent, Modifier.tap(vm::pop, "Change number")) }
            }
            BasicTextField(value = vm.otp, onValueChange = vm::onOtpChange, keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.NumberPassword), modifier = Modifier.size(1.dp).alpha(0f).focusRequester(focus))
            Row(Modifier.padding(vertical = 10.dp).tap({ focus.requestFocus(); keyboard?.show() }, "Code entry"), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                for (i in 0 until n) {
                    val active = i == vm.otp.length.coerceAtMost(n - 1)
                    Box(Modifier.width(46.dp).height(60.dp).clip(RoundedCornerShape(14.dp)).background(C.Surface).border(1.5.dp, if (active) C.GreenAccent else C.Border, RoundedCornerShape(14.dp)), contentAlignment = Alignment.Center) {
                        Txt(vm.otp.getOrNull(i)?.toString() ?: "", 26f, 700)
                    }
                }
            }
            if (vm.resendSeconds > 0) Txt("Resend code in ${clock(vm.resendSeconds)}", 13f, 500, C.Muted)
            else Row(horizontalArrangement = Arrangement.spacedBy(18.dp)) {
                Txt("Resend code", 13f, 700, C.GreenAccent, Modifier.tap({ vm.requestCode(false) }, "Resend code"))
                Txt("Call me instead", 13f, 700, C.GreenAccent, Modifier.tap({ vm.requestCode(true) }, "Call me"))
            }
            if (vm.otpTestMode) Txt("Testing mode: enter 0000", 13f, 700, C.GreenAccent, align = TextAlign.Center)
            if (vm.message != null) Txt(vm.message!!, 13f, 600, C.RedText, align = TextAlign.Center)
            Btn("Verify", vm::verify, Modifier.fillMaxWidth(), enabled = vm.otp.length == n && !vm.busy)
            Txt("Never share this code with anyone, including our staff.", 12.5f, 500, C.Muted, align = TextAlign.Center)
        }
    }
    when (vm.dialog) {
        Dialog.OtpDone -> SheetOverlay(onDismiss = null) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                Box(Modifier.size(44.dp).clip(CircleShape).background(C.GreenAccent), contentAlignment = Alignment.Center) { Icon24(Ic.Check, Color.White, 22.dp, 2.6f) }
                Column(verticalArrangement = Arrangement.spacedBy(2.dp)) { Txt("You are in", 17f, 800); Txt("Your number is confirmed.", 13f, 500, C.Muted) }
            }
            Btn("Continue", vm::finishSignIn, Modifier.fillMaxWidth())
        }
        Dialog.NotAllowed -> SheetOverlay(onDismiss = { vm.dialog = null }) {
            Txt("This number is a driver account", 17f, 800)
            Txt("Please use the 9jaRide Pro driver app to sign in with this number, or sign in here with a different number.", 13.5f, 500, C.Muted)
            Btn("OK", { vm.dialog = null; vm.pop() }, Modifier.fillMaxWidth())
        }
        Dialog.Notice -> NoticeSheet(vm)
        else -> {}
    }
}

@Composable
fun NoticeSheet(vm: RiderViewModel) {
    SheetOverlay(onDismiss = { vm.dialog = null }) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            Box(Modifier.size(46.dp).clip(CircleShape).background(C.OrangeTint), contentAlignment = Alignment.Center) { Icon24(Ic.Warning, C.OrangeIcon, 24.dp) }
            Txt(vm.notice ?: "", 15f, 700, modifier = Modifier.weight(1f))
        }
        Btn("OK", { vm.dialog = null }, Modifier.fillMaxWidth())
    }
}

@Composable
fun LocationPermissionScreen(vm: RiderViewModel) {
    val launcher = rememberLauncherForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) { vm.locationDone() }
    Column(Modifier.fillMaxSize().background(C.Bg).statusBarsPadding().navigationBarsPadding().padding(24.dp)) {
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(16.dp), horizontalAlignment = Alignment.CenterHorizontally) {
            Gap(40.dp)
            Box(Modifier.size(88.dp).clip(CircleShape).background(C.GreenTint), contentAlignment = Alignment.Center) { Icon24(Ic.Pin, C.GreenAccent, 40.dp) }
            Txt("Allow location", 24f, 800, align = TextAlign.Center)
            Txt("We use your location to set your pickup point and show nearby drivers. You can also type or pin any address instead.", 14f, 500, C.Muted, align = TextAlign.Center)
            Gap(8.dp)
            Column(verticalArrangement = Arrangement.spacedBy(14.dp)) {
                listOf("Set your pickup point automatically", "See your driver arrive in real time", "Share your trip with people you trust").forEach {
                    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                        Box(Modifier.size(28.dp).clip(CircleShape).background(C.GreenTint), contentAlignment = Alignment.Center) { Icon24(Ic.Check, C.GreenAccent, 16.dp, 2.4f) }
                        Txt(it, 14.5f, 600)
                    }
                }
            }
        }
        Btn("Allow while using the app", { launcher.launch(arrayOf(Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION)) }, Modifier.fillMaxWidth())
        Gap(8.dp)
        Btn("Not now", vm::locationDone, Modifier.fillMaxWidth(), kind = BtnKind.Outline)
    }
}
