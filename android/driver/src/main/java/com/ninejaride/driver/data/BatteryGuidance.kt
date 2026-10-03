package com.ninejaride.driver.data

/** Steps that stop a phone's battery saver from closing the app while the driver is online. */
data class BatteryTip(val brands: List<String>, val title: String, val steps: List<String>)

object BatteryGuidance {
    /** Used when the server's list has not been fetched. Same wording as the server's default. Not verified on real devices. */
    val DEFAULTS = listOf(
        BatteryTip(
            listOf("all"), "Keep 9jaRide running",
            listOf(
                "Open Settings, then Apps, then 9jaRide, then Battery.",
                "Choose \"Unrestricted\" or \"No restrictions\". Do not choose \"Optimised\".",
                "Turn off battery saver while you are online.",
            ),
        ),
        BatteryTip(
            listOf("tecno", "infinix", "itel"), "Tecno, Infinix and itel phones",
            listOf(
                "Open Phone Master or Phone Manager, then App management, then Auto-start. Turn 9jaRide on.",
                "Open the recent apps screen and lock 9jaRide so cleaning does not close it.",
            ),
        ),
        BatteryTip(listOf("samsung"), "Samsung phones", listOf("Settings, then Battery, then Background usage limits. Remove 9jaRide from \"Sleeping apps\" and \"Deep sleeping apps\".")),
        BatteryTip(
            listOf("xiaomi", "redmi", "poco"), "Xiaomi, Redmi and Poco phones",
            listOf("Settings, then Apps, then Manage apps, then 9jaRide. Turn on Autostart.", "In the same screen choose Battery saver, then \"No restrictions\"."),
        ),
        BatteryTip(listOf("oppo", "realme", "oneplus"), "Oppo, Realme and OnePlus phones", listOf("Settings, then Battery, then 9jaRide. Allow background activity and auto-launch.")),
    )

    /** The general tip first, then the one for this phone's maker if there is one. */
    fun forDevice(tips: List<BatteryTip>, manufacturer: String): List<BatteryTip> {
        val maker = manufacturer.lowercase()
        val general = tips.filter { "all" in it.brands }
        val specific = tips.filter { t -> t.brands.any { it != "all" && maker.contains(it) } }
        return general + specific
    }
}
