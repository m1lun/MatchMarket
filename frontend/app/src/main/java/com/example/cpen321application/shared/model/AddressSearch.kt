package com.example.cpen321application.shared.model

import android.content.Context
import android.location.Address
import android.location.Geocoder
import android.os.Build
import com.example.cpen321application.posts.model.AddressSuggestion
import kotlin.coroutines.resume
import kotlinx.coroutines.suspendCancellableCoroutine

// How long to wait after the last keystroke before looking an address up.
const val SUGGEST_DELAY_MS = 250L

/* Address suggestions from the Android platform [Geocoder] */
class AddressSearch(private val context: Context) {
    suspend fun suggest(query: String): List<AddressSuggestion> =
        lookup(Geocoder(context), query)
            .mapNotNull { a ->
                a.getAddressLine(0)?.let { AddressSuggestion(it, a.longitude, a.latitude) }
            }
            .distinctBy { it.label.lowercase() }

    // The callback API needs Android 13; Pixel 9 and newer have it. Older versions get no suggestions.
    private suspend fun lookup(geocoder: Geocoder, query: String): List<Address> =
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            suspendCancellableCoroutine { continuation ->
                geocoder.getFromLocationName(
                    query,
                    MAX_RESULTS,
                    object : Geocoder.GeocodeListener {
                        override fun onGeocode(addresses: MutableList<Address>) = continuation.resume(addresses)

                        override fun onError(errorMessage: String?) = continuation.resume(emptyList())
                    },
                )
            }
        } else {
            emptyList()
        }

    private companion object {
        const val MAX_RESULTS = 5
    }
}
