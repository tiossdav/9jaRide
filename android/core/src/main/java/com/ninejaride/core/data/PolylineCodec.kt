package com.ninejaride.core.data

/** Google's "encoded polyline" format: a whole road line packed into one short string. */
object PolylineCodec {
    fun decode(encoded: String): List<MapPoint> {
        val points = ArrayList<MapPoint>()
        var index = 0
        var lat = 0
        var lng = 0
        while (index < encoded.length) {
            var result = 0
            var shift = 0
            var b: Int
            do {
                if (index >= encoded.length) return points
                b = encoded[index++].code - 63
                result = result or ((b and 0x1f) shl shift)
                shift += 5
            } while (b >= 0x20)
            lat += if (result and 1 != 0) (result shr 1).inv() else result shr 1
            result = 0
            shift = 0
            do {
                if (index >= encoded.length) return points
                b = encoded[index++].code - 63
                result = result or ((b and 0x1f) shl shift)
                shift += 5
            } while (b >= 0x20)
            lng += if (result and 1 != 0) (result shr 1).inv() else result shr 1
            points += MapPoint(lat / 1e5, lng / 1e5)
        }
        return points
    }
}
