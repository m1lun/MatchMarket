package com.example.cpen321application.matching.viewmodel

import android.util.Log
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import com.example.cpen321application.matching.model.FeedApi
import com.example.cpen321application.matching.model.FeedItem
import com.example.cpen321application.matching.model.FeedQuery
import com.example.cpen321application.shared.network.SessionExpiredException
import java.io.IOException
import org.json.JSONException

private const val TAG = "FeedStateHolder"

data class FeedUiState(
    val items: List<FeedItem> = emptyList(),
    val nextCursor: String? = null,
    val endReached: Boolean = false,
    val isLoading: Boolean = false,
    val loadFailed: Boolean = false,
    val signedOut: Boolean = false
)

// Main thread only: the isLoading check stops two loads at once, and `generation`
// drops a page that arrives after the query has changed.
class FeedStateHolder(private val api: FeedApi) {
    var state by mutableStateOf(FeedUiState())
        private set
    var query by mutableStateOf(FeedQuery())
        private set
    private var generation = 0

    suspend fun show(newQuery: FeedQuery) {
        query = newQuery
        refresh()
    }

    suspend fun refresh() {
        generation++
        state = FeedUiState()
        loadMore()
    }

    suspend fun loadMore() {
        val current = state
        if (current.isLoading || current.endReached) return
        val started = generation
        state = current.copy(isLoading = true, loadFailed = false)
        val next = try {
            val page = api.page(query, current.nextCursor)
            current.copy(
                items = current.items + page.items,
                nextCursor = page.nextCursor,
                endReached = page.nextCursor == null
            )
        } catch (_: SessionExpiredException) {
            current.copy(signedOut = true)
        } catch (e: IOException) {
            Log.w(TAG, "Could not load the feed", e)
            current.copy(loadFailed = true)
        } catch (e: JSONException) {
            Log.w(TAG, "Unexpected feed response", e)
            current.copy(loadFailed = true)
        }
        if (started == generation) state = next
    }
}
