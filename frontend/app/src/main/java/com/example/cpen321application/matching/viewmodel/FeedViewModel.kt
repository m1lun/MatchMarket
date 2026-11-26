package com.example.cpen321application.matching.viewmodel

import android.app.Application
import android.util.Log
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import com.example.cpen321application.matching.model.FeedApi
import com.example.cpen321application.matching.model.FeedFilter
import com.example.cpen321application.matching.model.FeedQuery
import com.example.cpen321application.matching.model.OwnPost
import com.example.cpen321application.posts.model.AddressSuggestion
import com.example.cpen321application.posts.model.Mode
import com.example.cpen321application.shared.model.AddressSearch
import com.example.cpen321application.shared.model.SUGGEST_DELAY_MS
import com.example.cpen321application.users.model.ProfileApi
import com.example.cpen321application.users.model.SessionManager
import java.io.IOException
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import org.json.JSONException

private const val TAG = "FeedViewModel"

// Agreed with the team: wide enough to cover a city, so the default doesn't hide too much.
private const val HOME_RADIUS_KM = 50.0

// Keeps the feed loaded while the user switches tabs or rotates the screen.
class FeedViewModel(app: Application) : AndroidViewModel(app) {
    private val api = FeedApi(SessionManager.get(app))
    private val profileApi = ProfileApi(SessionManager.get(app))
    private val feed = FeedStateHolder(api)
    private val addressSearch = AddressSearch(app)
    private var suggestJob: Job? = null

    val state: FeedUiState
        get() = feed.state
    val query: FeedQuery
        get() = feed.query
    var ownPosts by mutableStateOf<List<OwnPost>>(emptyList())
        private set
    var categories by mutableStateOf<List<String>>(emptyList())
        private set
    var addressSuggestions by mutableStateOf<List<AddressSuggestion>>(emptyList())
        private set

    // The feed starts filtered to near the user's home address, when they have set one.
    init {
        viewModelScope.launch { feed.show(FeedQuery(filter = homeFilter())) }
    }

    fun loadMore() {
        viewModelScope.launch { feed.loadMore() }
    }

    fun refresh() {
        viewModelScope.launch { feed.refresh() }
    }

    // A post recommended for belongs to one side, so switching sides drops it.
    fun selectMode(mode: Mode) {
        if (mode != query.mode) show(query.copy(mode = mode, recommendedFor = null))
    }

    fun applyFilter(filter: FeedFilter, recommendedFor: OwnPost?) {
        show(query.copy(filter = filter, recommendedFor = recommendedFor))
    }

    fun recommendFor(post: OwnPost, mode: Mode) {
        show(FeedQuery(mode = mode, recommendedFor = post))
    }

    fun loadFilterOptions() {
        viewModelScope.launch {
            ownPosts = loadOrEmpty { api.ownOpenPosts(query.mode) }
            categories = loadOrEmpty { api.categories() }
        }
    }

    fun suggestAddresses(text: String) {
        suggestJob?.cancel()
        if (text.isBlank()) {
            addressSuggestions = emptyList()
            return
        }
        suggestJob = viewModelScope.launch {
            delay(SUGGEST_DELAY_MS)
            addressSuggestions = addressSearch.suggest(text)
        }
    }

    fun clearAddressSuggestions() {
        suggestJob?.cancel()
        addressSuggestions = emptyList()
    }

    // Without the profile the feed still works, just unfiltered. An expired session is an IOException
    // too, and the feed's own first request then signs the user out.
    private suspend fun homeFilter(): FeedFilter {
        val home = try {
            profileApi.me().home
        } catch (e: IOException) {
            Log.w(TAG, "Could not load the home address", e)
            null
        } catch (e: JSONException) {
            Log.w(TAG, "Unexpected profile response", e)
            null
        }
        return if (home == null) FeedFilter() else FeedFilter(near = home, radiusKm = HOME_RADIUS_KM)
    }

    private fun show(newQuery: FeedQuery) {
        viewModelScope.launch { feed.show(newQuery) }
    }

    // The filter sheet still works without these lists, so a failure only leaves them empty.
    private suspend fun <T> loadOrEmpty(load: suspend () -> List<T>): List<T> = try {
        load()
    } catch (e: IOException) {
        Log.w(TAG, "Could not load filter options", e)
        emptyList()
    } catch (e: JSONException) {
        Log.w(TAG, "Unexpected filter options response", e)
        emptyList()
    }
}
