package com.ninejaride.driver.alert

import com.ninejaride.driver.data.ServerOffer
import kotlinx.coroutines.flow.MutableStateFlow

/**
 * The booking offer the driver currently has, if any. The background service keeps it up to date (it is the only thing
 * asking the server for offers), and the screens read it from here, so the phone makes one set of requests, not two.
 */
object OfferFeed {
    val offer = MutableStateFlow<ServerOffer?>(null)
}
