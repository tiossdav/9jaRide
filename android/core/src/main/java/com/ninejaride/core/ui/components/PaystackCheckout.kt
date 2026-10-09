package com.ninejaride.core.ui.components

import android.annotation.SuppressLint
import android.graphics.Bitmap
import android.view.ViewGroup
import android.webkit.CookieManager
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import com.ninejaride.core.ui.theme.C

/** True for the addresses that mean "the person is done on Paystack's page": our own return page, or Paystack's own close address. */
internal fun isCheckoutFinished(url: String, returnUrl: String): Boolean =
    url.startsWith(returnUrl) || url.startsWith("https://standard.paystack.co/close") || url.startsWith("https://checkout.paystack.com/close")

/**
 * Paystack's payment page, shown inside the app so the person never leaves it. Cards, bank transfer, USSD and the bank's own PIN and OTP
 * steps all happen on Paystack's page, in this view. The moment the page heads back to the 9jaRide return address, or the person closes
 * the screen, [onFinished] or [onClose] runs and the caller asks the server how the payment went. Nothing about the result is read from
 * this page; the server asks Paystack itself.
 */
@SuppressLint("SetJavaScriptEnabled")
@Composable
fun PaystackCheckout(url: String, returnUrl: String, onFinished: () -> Unit, onClose: () -> Unit) {
    val finished = rememberUpdatedState(onFinished)
    BackHandler { onClose() }
    var loading by remember { mutableStateOf(true) }
    var web by remember { mutableStateOf<WebView?>(null) }
    DisposableEffect(Unit) { onDispose { web?.apply { stopLoading(); destroy() }; web = null } }
    Column(Modifier.fillMaxSize().background(C.Bg)) {
        ScreenHeader("Secure payment", "Paid with Paystack", onBack = onClose)
        Box(Modifier.weight(1f).fillMaxWidth()) {
            AndroidView(
                modifier = Modifier.fillMaxSize(),
                factory = { ctx ->
                    WebView(ctx).apply {
                        layoutParams = ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT)
                        settings.javaScriptEnabled = true       // Paystack's page needs it
                        settings.domStorageEnabled = true
                        settings.allowFileAccess = false
                        settings.allowContentAccess = false
                        settings.javaScriptCanOpenWindowsAutomatically = false
                        CookieManager.getInstance().setAcceptThirdPartyCookies(this, true) // the bank's 3-D Secure step needs it
                        webViewClient = object : WebViewClient() {
                            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                                val target = request.url.toString()
                                if (isCheckoutFinished(target, returnUrl)) { finished.value(); return true }
                                return request.url.scheme != "https" // a payment page is only ever https; anything else (a stray app link) is refused
                            }
                            override fun onPageStarted(view: WebView, u: String, favicon: Bitmap?) { loading = true }
                            override fun onPageFinished(view: WebView, u: String) { loading = false }
                        }
                        loadUrl(url)
                        web = this
                    }
                },
            )
            if (loading) Box(Modifier.fillMaxSize(), contentAlignment = Alignment.TopCenter) {
                Txt("Loading the secure payment page...", 13f, 600, C.Muted, modifier = Modifier.padding(top = 24.dp))
            }
        }
    }
}
