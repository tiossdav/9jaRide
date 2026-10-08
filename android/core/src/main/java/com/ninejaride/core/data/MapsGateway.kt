package com.ninejaride.core.data

/**
 * The apps' connection to the 9jaRide server's map service. Place search, addresses for a pin and road routes all go through the server,
 * so the Google key for them stays on the server and never ships inside an app. Each app sets [client] once, when it starts.
 */
object MapsGateway {
    @Volatile var client: ApiClient? = null
}
