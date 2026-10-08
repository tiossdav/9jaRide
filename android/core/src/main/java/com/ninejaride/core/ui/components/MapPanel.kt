package com.ninejaride.core.ui.components

import android.content.Context
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Paint
import android.graphics.RectF
import android.os.Bundle
import android.view.MotionEvent
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.background
import androidx.compose.foundation.text.BasicText
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalLifecycleOwner
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import com.google.android.gms.maps.CameraUpdateFactory
import com.google.android.gms.maps.GoogleMap
import com.google.android.gms.maps.MapView
import com.google.android.gms.maps.MapsInitializer
import com.google.android.gms.maps.model.BitmapDescriptorFactory
import com.google.android.gms.maps.model.Cap
import com.google.android.gms.maps.model.LatLng
import com.google.android.gms.maps.model.LatLngBounds
import com.google.android.gms.maps.model.MapStyleOptions
import com.google.android.gms.maps.model.MarkerOptions
import com.google.android.gms.maps.model.PolylineOptions
import com.google.android.gms.maps.model.RoundCap
import com.ninejaride.core.R
import com.ninejaride.core.data.MapPoint

enum class MarkerKind { Car, Pickup, Dropoff }

data class MapMarker(val at: MapPoint, val kind: MarkerKind)

/** A map the user cannot pan, so it can sit inside a scrolling page without stealing the scroll. */
private class StaticMapView(context: Context) : MapView(context) {
    override fun dispatchTouchEvent(ev: MotionEvent?): Boolean = false
}

private fun markerIcon(context: Context, kind: MarkerKind): com.google.android.gms.maps.model.BitmapDescriptor {
    val d = context.resources.displayMetrics.density
    val size = (when (kind) { MarkerKind.Car -> 38f; MarkerKind.Pickup -> 26f; MarkerKind.Dropoff -> 26f } * d).toInt()
    val bmp = Bitmap.createBitmap(size, size, Bitmap.Config.ARGB_8888)
    val c = Canvas(bmp)
    val p = Paint(Paint.ANTI_ALIAS_FLAG)
    val mid = size / 2f
    when (kind) {
        MarkerKind.Car -> {
            p.color = 0xFFFFFFFF.toInt(); c.drawCircle(mid, mid, mid, p)
            p.color = 0xFF0D1F12.toInt(); c.drawCircle(mid, mid, mid - 2f * d, p)
            p.color = 0xFFFFFFFF.toInt()
            c.drawRoundRect(RectF(mid - 8f * d, mid - 4f * d, mid + 8f * d, mid + 5f * d), 3f * d, 3f * d, p) // body
            c.drawRoundRect(RectF(mid - 5f * d, mid - 8f * d, mid + 5f * d, mid - 3f * d), 2.5f * d, 2.5f * d, p) // roof
            p.color = 0xFF0D1F12.toInt(); c.drawCircle(mid - 4.5f * d, mid + 5f * d, 2f * d, p); c.drawCircle(mid + 4.5f * d, mid + 5f * d, 2f * d, p)
        }
        MarkerKind.Pickup -> {
            p.color = 0xFFFFFFFF.toInt(); c.drawCircle(mid, mid, mid, p)
            p.color = 0xFF0D520D.toInt(); c.drawCircle(mid, mid, mid - 3f * d, p)
        }
        MarkerKind.Dropoff -> {
            p.color = 0xFFFFFFFF.toInt(); c.drawRoundRect(RectF(0f, 0f, size.toFloat(), size.toFloat()), 6f * d, 6f * d, p)
            p.color = 0xFFD9631A.toInt(); c.drawRoundRect(RectF(3f * d, 3f * d, size - 3f * d, size - 3f * d), 4f * d, 4f * d, p)
        }
    }
    return BitmapDescriptorFactory.fromBitmap(bmp)
}

private fun LatLng(p: MapPoint) = LatLng(p.lat, p.lng)

/** The map's ready state: Google gives us the map object a moment after the view exists. */
private class MapHolder {
    var map: GoogleMap? = null
    var render: ((GoogleMap) -> Unit)? = null
    var lastKey: String? = null
    var following = false
    var darkApplied: Boolean? = null
}

/**
 * Frames [points] in the view, keeping [borderDp] clear around them. Does nothing and says so when the view has no size yet (screen off,
 * app in the background), and treats a single spot, or points almost on top of each other, as "centre here" because framing those
 * would zoom in endlessly. False when the view is not ready and framing should be tried again.
 */
private fun frame(v: MapView, map: GoogleMap, points: List<MapPoint>, borderDp: Int): Boolean {
    if (!v.isAttachedToWindow || v.width <= 0 || v.height <= 0) return false
    val ok = points.filter { it.lat.isFinite() && it.lng.isFinite() && Math.abs(it.lat) <= 85 && Math.abs(it.lng) <= 180 }
    if (ok.isEmpty()) return true
    val latSpan = ok.maxOf { it.lat } - ok.minOf { it.lat }
    val lngSpan = ok.maxOf { it.lng } - ok.minOf { it.lng }
    if (ok.size < 2 || (latSpan < 0.0003 && lngSpan < 0.0003)) {
        map.moveCamera(CameraUpdateFactory.newLatLngZoom(LatLng(ok.first()), 16.5f))
        return true
    }
    val border = minOf((borderDp * v.resources.displayMetrics.density).toInt(), v.width / 4, v.height / 4)
    val bounds = LatLngBounds.builder().apply { ok.forEach { include(LatLng(it)) } }.build()
    return runCatching { map.moveCamera(CameraUpdateFactory.newLatLngBounds(bounds, border)) }.isSuccess
}

/**
 * The live map, drawn by Google Maps. The rest of the app only talks to this function. Where the car is comes from the driver's GPS through
 * the 9jaRide server; this view only draws what it is given.
 *
 * @param route a road line to draw; when [fit] is true the camera frames it and all the markers.
 * @param center where to look when there is no route to frame.
 * @param interactive false makes the map a picture that does not take touches (for use inside a scrolling page).
 */
@Composable
fun MapPanel(
    modifier: Modifier = Modifier,
    markers: List<MapMarker> = emptyList(),
    route: List<MapPoint> = emptyList(),
    center: MapPoint? = null,
    zoom: Double = 15.5,
    interactive: Boolean = true,
    fit: Boolean = false,
    /** Clear space kept around the framed route, so it is not hidden behind a banner above or a sheet below. */
    fitBorderDp: Int = 56,
    /** Called with the point under the centre of the map after the user moves it (for placing a pin). */
    onCenterChange: ((MapPoint) -> Unit)? = null,
    /** Navigation view: the camera stays on this point (the car), close in, and glides along as it moves. Overrides [fit]. */
    follow: MapPoint? = null,
    followZoom: Double = 17.0,
) {
    if (com.ninejaride.core.BuildConfig.GOOGLE_MAPS_KEY.isBlank()) {
        // No Google key in this build: say so plainly instead of showing a blank grey box
        Box(modifier.background(Color(0xFF1B2A20)), contentAlignment = Alignment.Center) {
            BasicText("The map is not set up in this build (no Google Maps key).", Modifier.padding(16.dp), style = TextStyle(color = Color(0xFFB9C7BD), fontSize = 13.sp))
        }
        return
    }
    val context = LocalContext.current
    val holder = remember { MapHolder() }
    val view = remember(interactive) {
        MapsInitializer.initialize(context.applicationContext)
        (if (interactive) MapView(context) else StaticMapView(context)).also { v ->
            v.onCreate(Bundle())
            v.getMapAsync { map ->
                holder.map = map
                map.uiSettings.isZoomControlsEnabled = false
                map.uiSettings.isMapToolbarEnabled = false
                map.uiSettings.isCompassEnabled = false
                map.uiSettings.isMyLocationButtonEnabled = false
                map.uiSettings.isRotateGesturesEnabled = false
                map.uiSettings.isTiltGesturesEnabled = false
                if (!interactive) map.uiSettings.setAllGesturesEnabled(false)
                map.setMinZoomPreference(4f)
                holder.render?.invoke(map)
            }
        }
    }
    val latestCenterCallback = rememberUpdatedState(onCenterChange)
    val lifecycle = LocalLifecycleOwner.current.lifecycle
    DisposableEffect(lifecycle, view) {
        val observer = LifecycleEventObserver { _, e ->
            when (e) {
                Lifecycle.Event.ON_START -> view.onStart()
                Lifecycle.Event.ON_RESUME -> view.onResume()
                Lifecycle.Event.ON_PAUSE -> view.onPause()
                Lifecycle.Event.ON_STOP -> view.onStop()
                else -> Unit
            }
        }
        lifecycle.addObserver(observer)
        // the screen is already showing when this runs, so the view has missed the start and resume events
        if (lifecycle.currentState.isAtLeast(Lifecycle.State.STARTED)) view.onStart()
        if (lifecycle.currentState.isAtLeast(Lifecycle.State.RESUMED)) view.onResume()
        onDispose { lifecycle.removeObserver(observer); view.onPause(); view.onStop(); view.onDestroy() }
    }

    AndroidView(
        modifier = modifier,
        factory = { view },
        update = { v ->
            val render: (GoogleMap) -> Unit = render@{ map ->
                val dark = com.ninejaride.core.ui.theme.C.dark
                if (holder.darkApplied != dark) {
                    holder.darkApplied = dark
                    map.setMapStyle(if (dark) MapStyleOptions.loadRawResourceStyle(context, R.raw.map_style_dark) else null)
                }
                map.clear()
                if (route.size >= 2) {
                    map.addPolyline(PolylineOptions().addAll(route.map { LatLng(it) }).color(0xFF0D520D.toInt()).width(7f * v.resources.displayMetrics.density)
                        .startCap(RoundCap() as Cap).endCap(RoundCap() as Cap).jointType(com.google.android.gms.maps.model.JointType.ROUND))
                }
                markers.forEach { m ->
                    map.addMarker(MarkerOptions().position(LatLng(m.at)).icon(markerIcon(context, m.kind)).anchor(0.5f, 0.5f).flat(false))
                }
                map.setOnCameraIdleListener {
                    latestCenterCallback.value?.let { cb -> val c = map.cameraPosition.target; cb(MapPoint(c.latitude, c.longitude)) }
                }

                if (follow != null) {
                    // glide to the car instead of jumping; set the zoom once when following starts
                    if (!holder.following) { holder.following = true; map.moveCamera(CameraUpdateFactory.newLatLngZoom(LatLng(follow), followZoom.toFloat())) }
                    else map.animateCamera(CameraUpdateFactory.newLatLng(LatLng(follow)))
                    return@render
                }
                holder.following = false
                val all = (route + markers.map { it.at }).distinct()
                // The camera is reframed only when the route or the fixed pins change, never because the car moved.
                val key = if (fit && all.size >= 2) "fit:${markers.filter { it.kind != MarkerKind.Car }.map { it.at }}:${route.lastOrNull()}" else "at:${center}:$zoom"
                if (holder.lastKey != key) {
                    holder.lastKey = key
                    if (fit && all.size >= 2) {
                        v.post { holder.map?.let { m -> if (!frame(v, m, all, fitBorderDp)) holder.lastKey = null } } // not laid out yet: try again on the next update
                    } else if (center != null) {
                        map.moveCamera(CameraUpdateFactory.newLatLngZoom(LatLng(center), zoom.toFloat()))
                    }
                }
            }
            holder.render = render
            holder.map?.let(render)
        },
    )
}
