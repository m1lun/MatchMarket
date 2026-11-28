package com.example.cpen321application.shared.view

import android.content.Context
import androidx.compose.foundation.layout.Box
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.toArgb
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.viewinterop.AndroidView
import com.example.cpen321application.BuildConfig
import java.io.File
import kotlin.math.floor
import org.osmdroid.config.Configuration
import org.osmdroid.tileprovider.tilesource.TileSourceFactory
import org.osmdroid.util.GeoPoint
import org.osmdroid.views.CustomZoomButtonsController
import org.osmdroid.views.MapView
import org.osmdroid.views.overlay.CopyrightOverlay
import org.osmdroid.views.overlay.Marker
import org.osmdroid.views.overlay.Overlay
import org.osmdroid.views.overlay.Polygon

// An approximate area is the 0.02° grid cell the point is in, drawn as a circle around the cell's centre,
// so the circle never sits on the real address. 1.6 km reaches every corner of a cell, so the point is
// always inside the circle.
private const val GRID_DEGREES = 0.02
private const val AREA_RADIUS_M = 1_600.0
private const val AREA_ZOOM = 12.0
private const val PIN_ZOOM = 15.0
private const val AREA_FILL_ALPHA = 0.2f
private const val AREA_OUTLINE_WIDTH = 4f

/**
 * A small OpenStreetMap map that ignores touches. With approximate, it shows a circle around
 * the area the point is in instead of a pin on the point.
 */
@Composable
fun LocationMap(latitude: Double, longitude: Double, approximate: Boolean, modifier: Modifier = Modifier) {
    val colour = MaterialTheme.colorScheme.primary
    val centre = if (approximate) GeoPoint(cellCentre(latitude), cellCentre(longitude)) else GeoPoint(latitude, longitude)
    Box(modifier) {
        AndroidView(
            factory = { context ->
                configureTiles(context)
                MapView(context).apply {
                    setTileSource(TileSourceFactory.MAPNIK)
                    setTilesScaledToDpi(true)
                    setMultiTouchControls(false)
                    zoomController.setVisibility(CustomZoomButtonsController.Visibility.NEVER)
                }
            },
            onRelease = MapView::onDetach,
            update = { map ->
                val shape = if (approximate) area(map, centre, colour) else pin(map, centre)
                map.overlays.clear()
                map.overlays.addAll(listOf(shape, CopyrightOverlay(map.context)))
                map.controller.setZoom(if (approximate) AREA_ZOOM else PIN_ZOOM)
                map.controller.setCenter(centre)
                map.invalidate()
            },
            modifier = Modifier.matchParentSize(),
        )
        // Takes the touches, so the map cannot be dragged and the screen around it still scrolls.
        Box(Modifier.matchParentSize().pointerInput(Unit) {})
    }
}

private fun cellCentre(degrees: Double): Double = (floor(degrees / GRID_DEGREES) + 0.5) * GRID_DEGREES

// OpenStreetMap asks apps to name themselves when they fetch tiles, and answers an application id
// starting with "com.example" with "Access blocked" tiles, so the app sends its name instead. The tile
// cache goes in the app's cache directory, which needs no storage permission.
private fun configureTiles(context: Context) {
    Configuration.getInstance().apply {
        userAgentValue = "MatchMarket/${BuildConfig.VERSION_NAME} (Android)"
        osmdroidBasePath = File(context.cacheDir, "osmdroid")
        osmdroidTileCache = File(osmdroidBasePath, "tiles")
    }
}

private fun area(map: MapView, centre: GeoPoint, colour: Color): Overlay = Polygon(map).apply {
    points = Polygon.pointsAsCircle(centre, AREA_RADIUS_M)
    fillPaint.color = colour.copy(alpha = AREA_FILL_ALPHA).toArgb()
    outlinePaint.color = colour.toArgb()
    outlinePaint.strokeWidth = AREA_OUTLINE_WIDTH
}

private fun pin(map: MapView, point: GeoPoint): Overlay = Marker(map).apply {
    position = point
    setAnchor(Marker.ANCHOR_CENTER, Marker.ANCHOR_BOTTOM)
}
