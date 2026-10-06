package com.ninejaride.core.ui.components

import android.content.Context
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Paint
import android.graphics.RectF
import android.graphics.drawable.BitmapDrawable
import android.view.MotionEvent
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalLifecycleOwner
import androidx.compose.ui.viewinterop.AndroidView
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import com.ninejaride.core.data.MapPoint
import org.osmdroid.config.Configuration
import org.osmdroid.tileprovider.tilesource.TileSourceFactory
import org.osmdroid.util.BoundingBox
import org.osmdroid.util.GeoPoint
import org.osmdroid.views.CustomZoomButtonsController
import org.osmdroid.views.MapView
import org.osmdroid.views.overlay.Marker
import org.osmdroid.views.overlay.Polyline
import java.io.File

enum class MarkerKind { Car, Pickup, Dropoff }

data class MapMarker(val at: MapPoint, val kind: MarkerKind)

/** A map the user cannot pan, so it can sit inside a scrolling page without stealing the scroll. */
private class StaticMapView(context: Context) : MapView(context) {
    override fun dispatchTouchEvent(ev: MotionEvent?): Boolean = false
}

private var osmReady = false

private val MAPBOX_TOKEN = com.ninejaride.core.BuildConfig.MAPBOX_TOKEN

/** Mapbox map tiles (streets, or dark at night), drawn by the same map view. */
private class MapboxTiles(style: String, private val token: String) : org.osmdroid.tileprovider.tilesource.OnlineTileSourceBase(
    "mapbox-$style", 1, 20, 256, "", arrayOf("https://api.mapbox.com/styles/v1/mapbox/$style/tiles/256/"), "© Mapbox © OpenStreetMap",
) {
    override fun getTileURLString(index: Long): String =
        baseUrl + org.osmdroid.util.MapTileIndex.getZoom(index) + "/" + org.osmdroid.util.MapTileIndex.getX(index) + "/" + org.osmdroid.util.MapTileIndex.getY(index) + "@2x?access_token=" + token
}

private val mapboxLight by lazy { MapboxTiles("streets-v12", MAPBOX_TOKEN) }
private val mapboxDark by lazy { MapboxTiles("dark-v11", MAPBOX_TOKEN) }

/** The tiles to draw: Mapbox when a token is set, OpenStreetMap otherwise. */
private fun tilesFor(dark: Boolean): org.osmdroid.tileprovider.tilesource.ITileSource =
    if (MAPBOX_TOKEN.isBlank()) TileSourceFactory.MAPNIK else if (dark) mapboxDark else mapboxLight

private fun configureOsm(context: Context) {
    if (osmReady) return
    val cfg = Configuration.getInstance()
    cfg.load(context, context.getSharedPreferences("osmdroid", Context.MODE_PRIVATE))
    // Keep tiles in the app's own cache: no storage permission, and Android clears it when space is short.
    cfg.osmdroidBasePath = File(context.cacheDir, "osmdroid")
    cfg.osmdroidTileCache = File(context.cacheDir, "osmdroid/tiles")
    cfg.userAgentValue = context.packageName // OpenStreetMap's tile policy requires an identifying user agent
    osmReady = true
}

private fun markerIcon(context: Context, kind: MarkerKind): BitmapDrawable {
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
    return BitmapDrawable(context.resources, bmp)
}

/**
 * Frames [points] in the view, keeping [borderDp] clear around them. The map library loops endlessly (freezing the app) if
 * asked to frame while the view has no size (screen off, app in the background) or with more border than view, or to frame
 * a single spot; so those cases are handled here. False when the view is not ready and framing should be tried again.
 */
private fun frame(v: MapView, points: List<MapPoint>, borderDp: Int): Boolean {
    if (!v.isAttachedToWindow || v.width <= 0 || v.height <= 0) return false
    val ok = points.filter { it.lat.isFinite() && it.lng.isFinite() && Math.abs(it.lat) <= 85 && Math.abs(it.lng) <= 180 }
    if (ok.isEmpty()) return true
    val latSpan = ok.maxOf { it.lat } - ok.minOf { it.lat }
    val lngSpan = ok.maxOf { it.lng } - ok.minOf { it.lng }
    if (ok.size < 2 || (latSpan < 0.0003 && lngSpan < 0.0003)) { // one spot (about 30 m): just centre on it
        v.controller.setZoom(16.5)
        v.controller.setCenter(GeoPoint(ok.first()))
        return true
    }
    // never more border than a quarter of the view, so there is always room left to fit into
    val border = minOf((borderDp * v.resources.displayMetrics.density).toInt(), v.width / 4, v.height / 4)
    return runCatching {
        v.zoomToBoundingBox(BoundingBox.fromGeoPoints(ok.map { GeoPoint(it) }).increaseByScale(1.15f), false, border)
    }.isSuccess
}

private fun GeoPoint(p: MapPoint) = GeoPoint(p.lat, p.lng)

/**
 * The live map. Today it draws OpenStreetMap tiles with the osmdroid library, which needs no API key. The rest of the
 * app only talks to this function, so moving to Google Maps or Mapbox means rewriting this one file.
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
    val context = LocalContext.current
    val view = remember(interactive) {
        configureOsm(context)
        (if (interactive) MapView(context) else StaticMapView(context)).apply {
            setTileSource(tilesFor(com.ninejaride.core.ui.theme.C.dark))
            setMultiTouchControls(interactive)
            zoomController.setVisibility(CustomZoomButtonsController.Visibility.NEVER)
            isTilesScaledToDpi = true
            minZoomLevel = 4.0
        }
    }
    val latestCenterCallback = androidx.compose.runtime.rememberUpdatedState(onCenterChange)
    androidx.compose.runtime.DisposableEffect(view) {
        val listener = object : org.osmdroid.events.MapListener {
            override fun onScroll(event: org.osmdroid.events.ScrollEvent?): Boolean {
                latestCenterCallback.value?.let { cb -> val c = view.mapCenter; cb(MapPoint(c.latitude, c.longitude)) }
                return false
            }
            override fun onZoom(event: org.osmdroid.events.ZoomEvent?): Boolean = false
        }
        view.addMapListener(listener)
        onDispose { view.removeMapListener(listener) }
    }
    val lifecycle = LocalLifecycleOwner.current.lifecycle
    DisposableEffect(lifecycle, view) {
        val observer = LifecycleEventObserver { _, e ->
            if (e == Lifecycle.Event.ON_RESUME) view.onResume()
            if (e == Lifecycle.Event.ON_PAUSE) view.onPause()
        }
        lifecycle.addObserver(observer)
        onDispose { lifecycle.removeObserver(observer); view.onDetach() }
    }

    AndroidView(
        modifier = modifier,
        factory = { view },
        update = { v ->
            val dark = com.ninejaride.core.ui.theme.C.dark
            if (MAPBOX_TOKEN.isNotBlank()) {
                // Mapbox has a dark style of its own
                val want = tilesFor(dark)
                if (v.tileProvider.tileSource.name() != want.name()) v.setTileSource(want)
                v.overlayManager.tilesOverlay.setColorFilter(null)
            } else {
                // The OpenStreetMap tiles are light; in dark mode they are inverted so the map does not glare.
                v.overlayManager.tilesOverlay.setColorFilter(if (dark) org.osmdroid.views.overlay.TilesOverlay.INVERT_COLORS else null)
            }
            v.overlays.clear()
            if (MAPBOX_TOKEN.isNotBlank()) v.overlays.add(org.osmdroid.views.overlay.CopyrightOverlay(v.context).apply { setTextSize(9) }) // the credit Mapbox asks for
            if (route.size >= 2) {
                v.overlays.add(Polyline(v).apply {
                    setPoints(route.map { GeoPoint(it) })
                    outlinePaint.color = 0xFF0D520D.toInt()
                    outlinePaint.strokeWidth = 7f * v.resources.displayMetrics.density
                    outlinePaint.strokeCap = Paint.Cap.ROUND
                })
            }
            markers.forEach { m ->
                v.overlays.add(Marker(v).apply {
                    position = GeoPoint(m.at)
                    setAnchor(Marker.ANCHOR_CENTER, Marker.ANCHOR_CENTER)
                    icon = markerIcon(context, m.kind)
                    infoWindow = null
                    setOnMarkerClickListener { _, _ -> true }
                })
            }

            if (follow != null) {
                // glide to the car instead of jumping; set the zoom once when following starts
                if (v.tag != "follow") { v.tag = "follow"; v.controller.setZoom(followZoom); v.controller.setCenter(GeoPoint(follow)) }
                else v.controller.animateTo(GeoPoint(follow))
                v.invalidate()
                return@AndroidView
            }
            val all = (route + markers.map { it.at }).distinct()
            // The camera is reframed only when the route or the fixed pins change, never because the car moved.
            val still = (route + markers.filter { it.kind != MarkerKind.Car }.map { it.at }).distinct()
            val key = if (fit && all.size >= 2) "fit:${markers.filter { it.kind != MarkerKind.Car }.map { it.at }}:${route.lastOrNull()}" else "at:${center}:$zoom"
            if (v.tag != key) {
                v.tag = key
                if (fit && all.size >= 2) {
                    v.post { if (!frame(v, all, fitBorderDp)) v.tag = null } // not laid out yet: try again on the next update
                } else if (center != null) {
                    v.controller.setZoom(zoom)
                    v.controller.setCenter(GeoPoint(center))
                }
            }
            v.invalidate()
        },
    )
}
