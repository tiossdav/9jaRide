package com.ninejaride.driver.ui.screens

import android.Manifest
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.Settings
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.heightIn
import androidx.compose.ui.platform.LocalContext
import com.ninejaride.driver.data.BatteryGuidance
import com.ninejaride.driver.location.LocationService
import com.ninejaride.driver.location.LocationStatus
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import com.ninejaride.driver.state.Dest
import com.ninejaride.driver.state.Dialog
import com.ninejaride.driver.state.DriverViewModel
import com.ninejaride.core.format.naira
import androidx.compose.runtime.LaunchedEffect
import com.ninejaride.core.data.MapPoint
import com.ninejaride.core.ui.components.Avatar
import com.ninejaride.core.ui.components.MapMarker
import com.ninejaride.core.ui.components.MapPanel
import com.ninejaride.core.ui.components.MarkerKind
import com.ninejaride.core.ui.components.Tab
import com.ninejaride.core.ui.components.Btn
import com.ninejaride.core.ui.components.BtnKind
import com.ninejaride.core.ui.components.CarDot
import com.ninejaride.core.ui.components.Chip
import com.ninejaride.core.ui.components.CircleIconButton
import com.ninejaride.core.ui.components.Gap
import com.ninejaride.core.ui.components.Ic
import com.ninejaride.core.ui.components.Icon24
import com.ninejaride.core.ui.components.RoundIconTile
import com.ninejaride.core.ui.components.ScreenHeader
import com.ninejaride.core.ui.components.SheetOverlay
import com.ninejaride.core.ui.components.StreetMap
import com.ninejaride.core.ui.components.Toggle
import com.ninejaride.core.ui.components.Txt
import com.ninejaride.core.ui.theme.C

private val LAGOS = MapPoint(6.5244, 3.3792)

@Composable
fun HomeScreen(vm: DriverViewModel) {
    LaunchedEffect(Unit) { vm.startDeviceLocation() }
    BoxWithConstraints(Modifier.fillMaxSize().statusBarsPadding()) {
    // Tall phones get the design's 150dp map; shorter ones a smaller map so the SOS card stays above the tab bar.
    val mapHeight = (maxHeight - 530.dp).coerceIn(96.dp, 170.dp)
    Column(
        Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(top = 12.dp, bottom = 36.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Row(Modifier.padding(horizontal = 20.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            Avatar(vm.profile.name.take(1), photo = vm.photo)
            Column(Modifier.weight(1f)) {
                Txt("Hello", 12f, 500, C.Muted)
                Txt(vm.profile.name.substringBefore(' '), 17f, 800)
            }
            CircleIconButton(Ic.Mail, "Notifications", { vm.push(Dest.Inbox) })
        }

        EarningsCard(vm)

        Box(Modifier.padding(horizontal = 20.dp).fillMaxWidth().height(mapHeight).clip(RoundedCornerShape(20.dp))) {
            // The phone's real position when location is allowed; otherwise a wider view of Lagos.
            val here = vm.deviceLocation
            MapPanel(
                Modifier.fillMaxSize(),
                markers = listOf(MapMarker(here ?: LAGOS, MarkerKind.Car)),
                center = here ?: LAGOS,
                zoom = if (here != null) 16.0 else 12.0,
                interactive = false,
            )
            Canvas(Modifier.fillMaxSize()) {
                val c = Offset(size.width / 2, size.height / 2)
                drawCircle(C.Green.copy(alpha = 0.10f), 90.dp.toPx(), c)
                drawCircle(C.Green.copy(alpha = 0.16f), 54.dp.toPx(), c)
            }
        }

        StatusCard(vm)
        SosCard(vm)
    }
    }
}

@Composable
private fun EarningsCard(vm: DriverViewModel) {
    Column(
        Modifier.padding(horizontal = 20.dp).fillMaxWidth().clip(RoundedCornerShape(22.dp)).background(C.Green).padding(horizontal = 16.dp, vertical = 10.dp),
        verticalArrangement = Arrangement.spacedBy(2.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Txt("Earnings", 13f, 500, C.OnGreenMuted, Modifier.weight(1f))
            Chip("Today ▾", Color.White, Color.White.copy(alpha = 0.16f))
        }
        Txt(naira(vm.earningsKobo), 26f, 800, Color.White)
        Row(Modifier.padding(top = 4.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Stat("${vm.tripsToday}", "Trips", Modifier.weight(1f))
            Stat("%.1f".format(vm.hoursToday), "Hours", Modifier.weight(1f))
            Stat("%.2f".format(vm.kmToday), "Km", Modifier.weight(1f))
        }
    }
}

@Composable
private fun Stat(value: String, label: String, modifier: Modifier) {
    Column(modifier.clip(RoundedCornerShape(14.dp)).background(Color.White.copy(alpha = 0.12f)).padding(horizontal = 12.dp, vertical = 7.dp)) {
        Txt(value, 17f, 800, Color.White)
        Txt(label, 11.5f, 500, C.OnGreenMuted)
    }
}

@Composable
private fun StatusCard(vm: DriverViewModel) {
    val v = vm.profile.vehicle
    Column(
        Modifier.padding(horizontal = 20.dp).fillMaxWidth().clip(RoundedCornerShape(20.dp)).background(Color.White)
            .border(1.dp, C.Border, RoundedCornerShape(20.dp)).padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            RoundIconTile(
                Ic.Wifi,
                if (vm.online) Color.White else C.GreenAccent,
                if (vm.online) C.GreenAccent else C.GreenTint,
                46.dp, round = false, iconSize = 24.dp,
            )
            Column(verticalArrangement = Arrangement.spacedBy(1.dp)) {
                // The design sets this title in near-white on a white card; dark ink is used so it can be read.
                Txt(if (vm.online) "You're online" else "You're offline", 16f, 800)
                Txt(if (vm.online) "Waiting for trip requests near you" else "Go online to start receiving trips", 12.5f, 500, C.Muted)
            }
        }
        if (v != null) {
            Row(
                Modifier.fillMaxWidth().clip(RoundedCornerShape(14.dp)).background(C.Bg).padding(horizontal = 12.dp, vertical = 10.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                Icon24(Ic.Car, C.Muted, 20.dp)
                Column(Modifier.weight(1f)) {
                    Txt(v.model, 14f, 700)
                    Txt(v.colour, 12f, 500, C.Muted)
                }
                Box(Modifier.clip(RoundedCornerShape(10.dp)).background(Color.White).border(1.5.dp, C.Border, RoundedCornerShape(10.dp)).padding(horizontal = 12.dp, vertical = 7.dp)) {
                    Txt(v.plate, 14f, 700, letterSpacing = 0.5f)
                }
            }
        }
        Row(verticalAlignment = Alignment.CenterVertically) {
            Txt(if (vm.online) "Toggle to go offline" else "Toggle to go online", 13f, 500, C.Muted, Modifier.weight(1f))
            Toggle(
                on = vm.online,
                onToggle = { if (vm.online) vm.dialog = Dialog.GoOffline else vm.askGoOnline() },
                label = if (vm.online) "Go offline" else "Go online",
            )
        }
        LocationLine(vm)
    }
}

@Composable
fun SosCard(vm: DriverViewModel) {
    Row(
        Modifier.padding(horizontal = 20.dp).fillMaxWidth().clip(RoundedCornerShape(18.dp)).background(C.RedCard)
            .border(1.dp, C.RedBorder, RoundedCornerShape(18.dp)).padding(horizontal = 14.dp, vertical = 12.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        RoundIconTile(Ic.Warning, C.RedText, Color.White, 42.dp, round = false, iconSize = 22.dp)
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(1.dp)) {
            Txt("Emergency SOS", 15f, 800, C.RedText)
            Txt("In danger? Alert the admin team.", 12f, 500, C.RedText, maxLines = 2)
        }
        Btn("SOS", vm::askSos, Modifier.width(70.dp), kind = BtnKind.Danger, height = 42.dp, size = 14f)
    }
}

/** The dialogs drawn over Home (and over the ride screens for SOS). */
@Composable
fun HomeDialogs(vm: DriverViewModel) {
    when (vm.dialog) {
        Dialog.GoOnline -> GoOnlineSheet(vm)
        Dialog.LocationDenied -> LocationDeniedSheet(vm)
        Dialog.Battery -> BatterySheet(vm)
        Dialog.GoOffline -> SheetOverlay(onDismiss = { vm.dialog = null }) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                RoundIconTile(Ic.Help, C.OrangeIcon, C.OrangeTint, 46.dp)
                Txt("Go offline?", 18f, 800)
            }
            Txt("You'll stop receiving trip requests.", 13.5f, 500, C.Muted)
            Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                Btn("Cancel", { vm.dialog = null }, Modifier.weight(1f), kind = BtnKind.Outline)
                Btn("Yes, go offline", vm::confirmGoOffline, Modifier.weight(1f))
            }
        }
        Dialog.Sos -> SheetOverlay(onDismiss = { vm.dialog = null }) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                RoundIconTile(Ic.Warning, C.Red, Color(0xFFFDECEC), 46.dp)
                Txt("Send SOS alert?", 18f, 800)
            }
            Txt("This sends an emergency alert, with your live location and trip, to the admin team.", 13.5f, 500, C.Muted)
            Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                Btn("Cancel", { vm.dialog = null }, Modifier.weight(1f), kind = BtnKind.Outline)
                Btn("Send SOS", vm::sendSos, Modifier.weight(1f), kind = BtnKind.Danger)
            }
        }
        else -> {}
    }
}

@Composable
fun GoOnlineChecksScreen(vm: DriverViewModel) {
    val checks = vm.goOnlineChecks
    Column(Modifier.fillMaxSize().background(C.Bg)) {
        ScreenHeader("Before you go online", "Complete these to start receiving trips", vm::pop)
        Column(Modifier.weight(1f).verticalScroll(rememberScrollState()).padding(start = 20.dp, end = 20.dp, top = 8.dp, bottom = 36.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            checks.forEach { c ->
                Row(
                    Modifier.fillMaxWidth().clip(RoundedCornerShape(18.dp)).background(Color.White).border(1.dp, C.Border, RoundedCornerShape(18.dp)).padding(14.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(12.dp),
                ) {
                    Box(Modifier.size(38.dp).clip(CircleShape).background(if (c.ok) C.GreenAccent else C.Red), contentAlignment = Alignment.Center) {
                        Icon24(if (c.ok) Ic.Check else Ic.Close, Color.White, 20.dp, 2.4f)
                    }
                    Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(1.dp)) {
                        Txt(c.title, 14.5f, 700)
                        Txt(c.detail, 12.5f, 500, C.Muted)
                    }
                    if (c.action != null) {
                        Btn(c.action, { vm.push(Dest.FundWallet) }, Modifier.width(84.dp), height = 38.dp, size = 13.5f)
                    }
                }
            }
        }
        Column(Modifier.padding(horizontal = 20.dp).navigationBarsPadding().padding(bottom = 20.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Btn("Go online", { vm.pop(); vm.dialog = Dialog.GoOnline }, Modifier.fillMaxWidth(), enabled = checks.all { it.ok })
            Txt("Your wallet goes below zero when 9jaRide Pro service charges on cash trips are taken.", 12.5f, 500, C.Muted, align = TextAlign.Center)
        }
    }
}

@Composable
fun InboxScreen(vm: DriverViewModel) {
    Column(Modifier.fillMaxSize().background(C.Bg)) {
        ScreenHeader("Inbox", "You're all caught up", vm::pop)
        Column(Modifier.fillMaxWidth().padding(horizontal = 30.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Gap(110.dp)
            Box(Modifier.size(96.dp).clip(CircleShape).background(Color.White), contentAlignment = Alignment.Center) { Icon24(Ic.Mail, C.Faint, 40.dp) }
            Txt("No notifications yet", 17f, 700, align = TextAlign.Center)
            Txt("Trip requests and updates will land here.", 13.5f, 500, C.Muted, align = TextAlign.Center)
        }
    }
}


@Composable
private fun GoOnlineSheet(vm: DriverViewModel) {
    val ctx = LocalContext.current
    val launcher = rememberLauncherForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) { vm.onPermissionResult() }
    SheetOverlay(onDismiss = { vm.dialog = null }) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            RoundIconTile(Ic.Help, C.OrangeIcon, C.OrangeTint, 46.dp)
            Txt("Go online?", 18f, 800)
        }
        Txt("Your wallet, email and vehicle are checked first. You will start receiving trip requests.", 13.5f, 500, C.Muted)
        Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            Btn("Cancel", { vm.dialog = null }, Modifier.weight(1f), kind = BtnKind.Outline)
            Btn("Yes, go online", {
                if (vm.demo || LocationService.hasLocationPermission(ctx)) vm.confirmGoOnline()
                else {
                    val perms = mutableListOf(Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION)
                    if (Build.VERSION.SDK_INT >= 33) perms += Manifest.permission.POST_NOTIFICATIONS
                    launcher.launch(perms.toTypedArray())
                }
            }, Modifier.weight(1f))
        }
    }
}

@Composable
private fun LocationDeniedSheet(vm: DriverViewModel) {
    val ctx = LocalContext.current
    SheetOverlay(onDismiss = { vm.dialog = null }) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            RoundIconTile(Ic.Pin, C.OrangeIcon, C.OrangeTint, 46.dp)
            Txt("Location is needed", 18f, 800, modifier = Modifier.weight(1f))
        }
        Txt("9jaRide Pro can only send you trips near you if it can see where you are. Allow location for the app, then go online again.", 13.5f, 500, C.Muted)
        Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            Btn("Not now", { vm.dialog = null }, Modifier.weight(1f), kind = BtnKind.Outline)
            Btn("Open settings", {
                vm.dialog = null
                ctx.startActivity(Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.fromParts("package", ctx.packageName, null)))
            }, Modifier.weight(1f))
        }
    }
}

/** Shown once, the first time the driver goes online. Android phones close background apps; these steps stop that. */
@Composable
private fun BatterySheet(vm: DriverViewModel) {
    val ctx = LocalContext.current
    val tips = BatteryGuidance.forDevice(vm.batteryTips, Build.MANUFACTURER)
    SheetOverlay(onDismiss = { vm.dialog = null }) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            RoundIconTile(Ic.Warning, C.OrangeIcon, C.OrangeTint, 46.dp)
            Txt("Keep 9jaRide Pro running", 18f, 800, modifier = Modifier.weight(1f))
        }
        Txt("Some phones close apps to save battery, and you would stop getting trips. Do this once:", 13.5f, 500, C.Muted)
        Column(Modifier.heightIn(max = 280.dp).verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            tips.forEach { t ->
                Txt(t.title, 14f, 700)
                t.steps.forEachIndexed { i, step -> Txt("${i + 1}. $step", 13f, 500, C.Muted) }
            }
        }
        Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            Btn("Later", { vm.dialog = null }, Modifier.weight(1f), kind = BtnKind.Outline)
            Btn("Open settings", {
                vm.dialog = null
                val direct = Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS, Uri.parse("package:" + ctx.packageName))
                runCatching { ctx.startActivity(direct) }.onFailure {
                    runCatching { ctx.startActivity(Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS)) }
                }
            }, Modifier.weight(1f))
        }
    }
}

/** A line under the toggle that says whether the position is really being shared, and why not if it is not. */
@Composable
fun LocationLine(vm: DriverViewModel) {
    if (!vm.online || vm.demo) return
    val problem = LocationStatus.problem
    val pending = LocationStatus.pending
    Txt(
        problem ?: if (pending > 0) "Sharing your location · $pending waiting to send" else "Sharing your location",
        12.5f, 600, if (problem != null) C.RedText else C.GreenAccent,
    )
}
