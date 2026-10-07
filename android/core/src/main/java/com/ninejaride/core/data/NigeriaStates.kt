package com.ninejaride.core.data

/** A Nigerian state as the search sees it: its name, what people call it and its big towns, and roughly where it is and how far it reaches. */
class StateArea(val name: String, val names: List<String>, val centre: MapPoint, val radiusKm: Double)

/**
 * Which state a search is about. A search stays around where the person is until the words they typed end in a state (or a well-known
 * town of one): "Allen Avenue, Lagos" or "Bodija Ibadan" or "Wuse 2 Abuja". Only the END of the words counts, so a street called
 * "Lagos Street" or "Ibadan Road" does not move the search to another state.
 */
object NigeriaStates {
    private fun s(name: String, lat: Double, lng: Double, radiusKm: Double, vararg also: String) =
        StateArea(name, listOf(name.lowercase()) + also.map { it.lowercase() }, MapPoint(lat, lng), radiusKm)

    val all: List<StateArea> = listOf(
        s("Lagos", 6.55, 3.45, 45.0, "ikorodu", "badagry", "epe"),
        s("Oyo", 7.85, 3.90, 110.0, "ibadan", "ogbomosho", "ogbomoso", "oyo town", "saki"),
        s("Ogun", 6.95, 3.35, 70.0, "abeokuta", "sagamu", "ijebu ode", "sango ota", "ota"),
        s("Osun", 7.55, 4.55, 55.0, "osogbo", "ile ife", "ife", "ilesa", "ede"),
        s("Ondo", 7.10, 5.05, 80.0, "akure", "ondo town", "owo"),
        s("Ekiti", 7.65, 5.25, 45.0, "ado ekiti", "ado-ekiti", "ikere"),
        s("Kwara", 8.95, 4.55, 120.0, "ilorin", "offa"),
        s("Edo", 6.60, 5.90, 80.0, "benin city", "benin", "auchi", "ekpoma"),
        s("Delta", 5.60, 6.00, 80.0, "asaba", "warri", "sapele", "ughelli"),
        s("Rivers", 4.85, 6.95, 65.0, "port harcourt", "portharcourt", "ph"),
        s("Bayelsa", 4.85, 6.20, 50.0, "yenagoa"),
        s("Akwa Ibom", 5.05, 7.85, 55.0, "uyo", "eket", "ikot ekpene"),
        s("Cross River", 5.95, 8.60, 110.0, "calabar", "ogoja"),
        s("Abia", 5.45, 7.55, 45.0, "umuahia", "aba"),
        s("Imo", 5.55, 7.05, 40.0, "owerri", "orlu"),
        s("Anambra", 6.20, 6.95, 40.0, "awka", "onitsha", "nnewi"),
        s("Enugu", 6.50, 7.45, 55.0, "enugu city"),
        s("Ebonyi", 6.20, 8.05, 45.0, "abakaliki"),
        s("Kogi", 7.60, 6.70, 110.0, "lokoja", "okene"),
        s("Benue", 7.35, 8.75, 100.0, "makurdi", "gboko"),
        s("Nasarawa", 8.55, 8.30, 85.0, "lafia", "keffi", "karu"),
        s("Plateau", 9.30, 9.20, 85.0, "jos", "bukuru"),
        s("Taraba", 8.00, 10.75, 130.0, "jalingo"),
        s("Adamawa", 9.60, 12.40, 130.0, "yola", "mubi"),
        s("Bauchi", 10.70, 9.80, 120.0, "bauchi city"),
        s("Gombe", 10.35, 11.20, 70.0, "gombe city"),
        s("Borno", 11.60, 13.10, 150.0, "maiduguri"),
        s("Yobe", 12.20, 11.60, 120.0, "damaturu", "potiskum"),
        s("Jigawa", 12.20, 9.50, 90.0, "dutse", "hadejia"),
        s("Kano", 11.95, 8.55, 80.0, "kano city"),
        s("Katsina", 12.60, 7.60, 100.0, "katsina city"),
        s("Kaduna", 10.60, 7.60, 130.0, "kaduna city", "zaria", "kafanchan"),
        s("Zamfara", 12.15, 6.25, 100.0, "gusau"),
        s("Sokoto", 12.95, 5.25, 100.0, "sokoto city"),
        s("Kebbi", 11.60, 4.30, 110.0, "birnin kebbi"),
        s("Niger", 9.90, 5.80, 160.0, "minna", "suleja", "bida"),
        s("Federal Capital Territory", 9.05, 7.40, 45.0, "fct", "abuja", "gwagwalada", "kubwa"),
    )

    /** The state the words END in, or null. "Lagos State", "lagos", "Allen Avenue, Ikeja Lagos" all give Lagos. */
    fun trailing(query: String): StateArea? {
        val words = query.lowercase().replace(Regex("[^a-z ]"), " ").split(" ").filter { it.isNotEmpty() }.toMutableList()
        if (words.isEmpty()) return null
        if (words.size > 1 && words.last() in setOf("state", "territory")) words.removeAt(words.size - 1)
        val tail = words.joinToString(" ")
        var best: Pair<StateArea, Int>? = null
        for (st in all) for (n in st.names) {
            val key = n.replace(Regex("[^a-z ]"), " ").replace(Regex(" +"), " ").trim()
            // the whole text, or the text ending in the name after a space (so "Wuse Abuja" matches but "Newlagos" does not)
            if (tail == key || tail.endsWith(" $key")) if (best == null || key.length > best.second) best = st to key.length
        }
        return best?.first
    }

    /** The state whose centre is nearest to [p], to say where a person is. */
    fun around(p: MapPoint): StateArea = all.minBy { Routing.haversineKm(it.centre, p) }
}
