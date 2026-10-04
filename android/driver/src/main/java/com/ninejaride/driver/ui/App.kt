package com.ninejaride.driver.ui

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusManager
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.platform.LocalSoftwareKeyboardController
import androidx.lifecycle.viewmodel.compose.viewModel
import com.ninejaride.driver.state.Dest
import com.ninejaride.driver.state.Dialog
import com.ninejaride.driver.state.DriverViewModel
import com.ninejaride.driver.state.Phase
import com.ninejaride.core.ui.components.Tab
import com.ninejaride.core.ui.components.TabBar
import com.ninejaride.driver.ui.screens.DateFilterSheet
import com.ninejaride.driver.ui.screens.LogoutSheet
import com.ninejaride.driver.ui.screens.BankAccountScreen
import com.ninejaride.driver.ui.screens.BonusScreen
import com.ninejaride.driver.ui.screens.DailyEarningsScreen
import com.ninejaride.driver.ui.screens.DeleteAccountScreen
import com.ninejaride.driver.ui.screens.EarningsScreen
import com.ninejaride.driver.ui.screens.FundWalletScreen
import com.ninejaride.driver.ui.screens.GoOnlineChecksScreen
import com.ninejaride.driver.ui.screens.HelpScreen
import com.ninejaride.driver.ui.screens.HomeDialogs
import com.ninejaride.driver.ui.screens.HomeScreen
import com.ninejaride.driver.ui.screens.InboxScreen
import com.ninejaride.driver.ui.screens.LocationPermissionScreen
import com.ninejaride.driver.ui.screens.OtpScreen
import com.ninejaride.driver.ui.screens.PayoutScreen
import com.ninejaride.driver.ui.screens.PersonalDetailsScreen
import com.ninejaride.driver.ui.screens.ProfileScreen
import com.ninejaride.driver.ui.screens.RideFlow
import com.ninejaride.driver.ui.screens.SignInScreen
import com.ninejaride.driver.ui.screens.SplashScreen
import com.ninejaride.driver.ui.screens.TransactionsScreen
import com.ninejaride.driver.ui.screens.TripDetailsScreen
import com.ninejaride.driver.ui.screens.TripsScreen
import com.ninejaride.driver.ui.screens.UpdateRequiredScreen
import com.ninejaride.driver.ui.screens.VehicleScreen
import com.ninejaride.core.ui.theme.C

@Composable
fun App(vm: DriverViewModel = viewModel()) {
    LaunchedEffect(Unit) { vm.boot() }
    LaunchedEffect(vm.toast) { if (vm.toast != null) { kotlinx.coroutines.delay(3000); vm.toast = null } }
    LaunchedEffect(vm.phase) { vm.pendingConfirm = null } // an offer that times out takes its question with it

    // A sheet opening over a text field must not stay hidden behind the keyboard.
    val keyboard = LocalSoftwareKeyboardController.current
    val focus = LocalFocusManager.current
    LaunchedEffect(vm.dialog) { if (vm.dialog != null) { focus.clearFocus(); keyboard?.hide() } }

    BackHandler(enabled = vm.phase == Phase.None && (vm.dialog != null || vm.stack.size > 1 || vm.tab != Tab.Home)) {
        when {
            vm.dialog != null && vm.dialog != Dialog.SignedIn -> vm.dialog = null
            vm.dialog != null -> {}
            vm.stack.size > 1 -> vm.pop()
            vm.tab != Tab.Home -> vm.tab = Tab.Home
        }
    }

    Box(Modifier.fillMaxSize().background(C.Bg)) {
        when (val d = vm.current) {
            Dest.Splash -> SplashScreen()
            Dest.SignIn -> SignInScreen(vm)
            Dest.SignUp -> com.ninejaride.driver.ui.screens.SignUpScreen(vm)
            Dest.Apply -> com.ninejaride.driver.ui.screens.ApplyScreen(vm)
            Dest.ApplicationStatus -> com.ninejaride.driver.ui.screens.ApplicationStatusScreen(vm)
            Dest.Otp -> OtpScreen(vm)
            Dest.LocationPermission -> LocationPermissionScreen(vm)
            Dest.UpdateRequired -> UpdateRequiredScreen(vm)
            Dest.Main -> Box(Modifier.fillMaxSize()) {
                Column(Modifier.fillMaxSize()) {
                    // The page takes whatever room is left; the tab bar below it never overlaps what scrolls.
                    Box(Modifier.weight(1f).fillMaxWidth()) {
                        when (vm.tab) {
                            Tab.Home -> HomeScreen(vm)
                            Tab.Trips -> TripsScreen(vm)
                            Tab.Earnings -> EarningsScreen(vm)
                            Tab.Profile -> ProfileScreen(vm)
                        }
                    }
                    TabBar(vm.tab, vm::selectTab)
                }
                if (vm.phase == Phase.None) {
                    HomeDialogs(vm)
                    if (vm.dialog == Dialog.DateFilter) DateFilterSheet(vm)
                    if (vm.dialog == Dialog.Logout) LogoutSheet(vm)
                }
            }
            Dest.Inbox -> InboxScreen(vm)
            Dest.GoOnlineChecks -> GoOnlineChecksScreen(vm)
            Dest.DailyEarnings -> DailyEarningsScreen(vm)
            Dest.Payout -> PayoutScreen(vm)
            Dest.BankAccountForm -> BankAccountScreen(vm)
            Dest.Transactions -> TransactionsScreen(vm)
            Dest.FundWallet -> FundWalletScreen(vm)
            Dest.PersonalDetails -> PersonalDetailsScreen(vm)
            Dest.VehicleDetails -> VehicleScreen(vm)
            Dest.Bonus -> BonusScreen(vm)
            Dest.Help -> HelpScreen(vm)
            Dest.DeleteAccount -> DeleteAccountScreen(vm)
            is Dest.TripDetails -> TripDetailsScreen(vm, d.code)
        }
        // The live ride covers everything else until it ends.
        if (vm.phase != Phase.None) {
            Box(Modifier.fillMaxSize().background(C.Bg)) { RideFlow(vm) }
        }
        vm.toast?.let { com.ninejaride.core.ui.components.TopToast(it.first, it.second) }
        vm.pendingConfirm?.let { com.ninejaride.core.ui.components.ConfirmSheet(it) { vm.pendingConfirm = null } }
    }
}
