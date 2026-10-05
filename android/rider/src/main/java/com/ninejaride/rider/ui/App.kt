package com.ninejaride.rider.ui

import androidx.activity.ComponentActivity
import androidx.activity.SystemBarStyle
import androidx.activity.compose.BackHandler
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.background
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.SideEffect
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.toArgb
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.platform.LocalSoftwareKeyboardController
import androidx.lifecycle.viewmodel.compose.viewModel
import com.ninejaride.core.ui.components.Ic
import com.ninejaride.core.ui.components.NavBar
import com.ninejaride.core.ui.components.NavItem
import com.ninejaride.core.ui.theme.C
import com.ninejaride.rider.state.Dest
import com.ninejaride.rider.state.Dialog
import com.ninejaride.rider.state.RiderViewModel
import com.ninejaride.rider.ui.screens.AccountTab
import com.ninejaride.rider.ui.screens.DeleteAccountScreen
import com.ninejaride.rider.ui.screens.HelpScreen
import com.ninejaride.rider.ui.screens.HomeTab
import com.ninejaride.rider.ui.screens.InboxScreen
import com.ninejaride.rider.ui.screens.LocationPermissionScreen
import com.ninejaride.rider.ui.screens.NoDriverSheet
import com.ninejaride.rider.ui.screens.OtpScreen
import com.ninejaride.rider.ui.screens.PersonalDetailsScreen
import com.ninejaride.rider.ui.screens.ReceiptScreen
import com.ninejaride.rider.ui.screens.ReferScreen
import com.ninejaride.rider.ui.screens.RideOverlay
import com.ninejaride.rider.ui.screens.ScheduleConfirmScreen
import com.ninejaride.rider.ui.screens.ScheduleFormScreen
import com.ninejaride.rider.ui.screens.SelectRideScreen
import com.ninejaride.rider.ui.screens.SetOnMapScreen
import com.ninejaride.rider.ui.screens.SignInScreen
import com.ninejaride.rider.ui.screens.SignUpScreen
import com.ninejaride.rider.ui.screens.SplashScreen
import com.ninejaride.rider.ui.screens.TopUpScreen
import com.ninejaride.rider.ui.screens.TripDetailsScreen
import com.ninejaride.rider.ui.screens.TripsTab
import com.ninejaride.rider.ui.screens.WalletHoldScreen
import com.ninejaride.rider.ui.screens.WalletScreen
import com.ninejaride.rider.ui.screens.WelcomeScreen
import com.ninejaride.rider.ui.screens.WhereToScreen
import com.ninejaride.rider.ui.screens.rideIsLive

private val NAV = listOf(NavItem("Home", Ic.Home), NavItem("Trips", Ic.Route), NavItem("Account", Ic.User))

@Composable
fun App(vm: RiderViewModel = viewModel()) {
    LaunchedEffect(Unit) { vm.boot() }
    val lifecycle = androidx.compose.ui.platform.LocalLifecycleOwner.current.lifecycle
    androidx.compose.runtime.DisposableEffect(lifecycle) {
        val watcher = androidx.lifecycle.LifecycleEventObserver { _, e ->
            if (e == androidx.lifecycle.Lifecycle.Event.ON_START) vm.onVisible(true)
            if (e == androidx.lifecycle.Lifecycle.Event.ON_STOP) vm.onVisible(false)
        }
        lifecycle.addObserver(watcher)
        onDispose { lifecycle.removeObserver(watcher) }
    }
    LaunchedEffect(vm.toast) { if (vm.toast != null) { kotlinx.coroutines.delay(3000); vm.toast = null } }

    // Light, dark, or whatever the phone is set to.
    val systemDark = isSystemInDarkTheme()
    C.dark = vm.appearance == "dark" || (vm.appearance == "system" && systemDark)
    val activity = LocalContext.current as? ComponentActivity
    SideEffect {
        val bar = if (C.dark) SystemBarStyle.dark(android.graphics.Color.TRANSPARENT) else SystemBarStyle.light(android.graphics.Color.TRANSPARENT, android.graphics.Color.TRANSPARENT)
        activity?.enableEdgeToEdge(statusBarStyle = bar, navigationBarStyle = bar)
    }

    // A sheet opening over a text field must not stay hidden behind the keyboard.
    val keyboard = LocalSoftwareKeyboardController.current
    val focus = LocalFocusManager.current
    LaunchedEffect(vm.dialog) { if (vm.dialog != null) { focus.clearFocus(); keyboard?.hide() } }

    val live = rideIsLive(vm)
    BackHandler(enabled = !live && (vm.dialog != null || vm.stack.size > 1 || vm.tab != 0)) {
        when {
            vm.dialog != null && vm.dialog != Dialog.OtpDone -> vm.dialog = null
            vm.dialog != null -> {}
            vm.stack.size > 1 -> vm.pop()
            vm.tab != 0 -> vm.tab = 0
        }
    }

    Box(Modifier.fillMaxSize().background(C.Bg)) {
        when (val d = vm.current) {
            Dest.Splash -> SplashScreen()
            Dest.Welcome -> WelcomeScreen(vm)
            Dest.SignUp -> SignUpScreen(vm)
            Dest.SignIn -> SignInScreen(vm)
            Dest.Otp -> OtpScreen(vm)
            Dest.LocationPermission -> LocationPermissionScreen(vm)
            Dest.Main -> Column(Modifier.fillMaxSize()) {
                Box(Modifier.weight(1f).fillMaxWidth()) {
                    when (vm.tab) {
                        0 -> HomeTab(vm)
                        1 -> TripsTab(vm)
                        else -> AccountTab(vm)
                    }
                }
                NavBar(NAV, vm.tab) { vm.tab = it }
            }
            Dest.WhereTo -> WhereToScreen(vm)
            Dest.SetOnMap -> SetOnMapScreen(vm)
            Dest.SelectRide -> SelectRideScreen(vm)
            Dest.WalletHold -> WalletHoldScreen(vm)
            Dest.ScheduleForm -> ScheduleFormScreen(vm)
            Dest.ScheduleConfirm -> ScheduleConfirmScreen(vm)
            is Dest.TripDetails -> TripDetailsScreen(vm, d.rideId)
            is Dest.Receipt -> ReceiptScreen(vm, d.rideId)
            is Dest.ReportProblem -> HelpScreen(vm)
            Dest.Wallet -> WalletScreen(vm)
            Dest.TopUp -> TopUpScreen(vm)
            Dest.PersonalDetails -> PersonalDetailsScreen(vm)
            Dest.Refer -> ReferScreen(vm)
            Dest.Help -> HelpScreen(vm)
            Dest.DeleteAccount -> DeleteAccountScreen(vm)
            Dest.Inbox -> InboxScreen(vm)
        }
        // A ride in progress covers everything else until it ends.
        if (live) Box(Modifier.fillMaxSize().background(C.Bg)) { RideOverlay(vm) }
        if (vm.dialog == Dialog.NoDriver) NoDriverSheet(vm)
        vm.toast?.let { com.ninejaride.core.ui.components.TopToast(it.first, it.second) }
        vm.pendingConfirm?.let { com.ninejaride.core.ui.components.ConfirmSheet(it) { vm.pendingConfirm = null } }
    }
}
