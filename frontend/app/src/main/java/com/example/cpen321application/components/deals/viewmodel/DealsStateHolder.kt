package com.example.cpen321application.components.deals.viewmodel

import android.os.SystemClock
import android.util.Log
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import com.example.cpen321application.components.deals.model.Deal
import com.example.cpen321application.components.deals.model.DealPost
import com.example.cpen321application.components.deals.model.DealRating
import com.example.cpen321application.components.deals.model.DealRole
import com.example.cpen321application.components.deals.model.DealsApi
import com.example.cpen321application.components.deals.model.RateRejectedException
import com.example.cpen321application.components.deals.model.RatingResult
import com.example.cpen321application.components.deals.model.otherPost
import com.example.cpen321application.components.posts.model.PostLocation
import com.example.cpen321application.components.posts.model.locationOf
import com.example.cpen321application.shared.network.SessionExpiredException
import java.io.IOException
import java.net.HttpURLConnection
import org.json.JSONException
import org.json.JSONObject

private const val TAG = "DealsStateHolder"
private const val STALE_AFTER_MS = 60_000L

data class DealsUiState(
    val deals: List<Deal> = emptyList(),
    val nextCursor: String? = null,
    val endReached: Boolean = false,
    val isLoading: Boolean = false,
    val isRefreshing: Boolean = false,
    val loadFailed: Boolean = false,
    val signedOut: Boolean = false
)

sealed interface RateFailure {
    data object AlreadyRated : RateFailure
    data object Unreachable : RateFailure
    data class Rejected(val message: String) : RateFailure
}

// The dialog: `dealId` is the deal being rated, null while it is closed. `previous` is the
// rating being edited, null when the deal has not been rated yet.
data class RatingUiState(
    val dealId: String? = null,
    val previous: DealRating? = null,
    val isSubmitting: Boolean = false,
    val failure: RateFailure? = null
)

// How a call to the backend ended: with its result, with the session gone, or without one
// (the server could not be reached or its answer could not be read).
private sealed interface Outcome<out T> {
    data class Done<T>(val value: T) : Outcome<T>
    data object SignedOut : Outcome<Nothing>
    data object Failed : Outcome<Nothing>
}

// Runs a backend call and logs why it failed. A rejection such as RateRejectedException passes through.
private suspend fun <T> attempt(what: String, call: suspend () -> T): Outcome<T> = try {
    Outcome.Done(call())
} catch (_: SessionExpiredException) {
    Outcome.SignedOut
} catch (e: IOException) {
    Log.w(TAG, "Could not $what", e)
    Outcome.Failed
} catch (e: JSONException) {
    Log.w(TAG, "Unexpected response: $what", e)
    Outcome.Failed
}

// Fetching a post to open: `failed` is set until the screen has shown the error.
data class OpenPostState(val isOpening: Boolean = false, val failed: Boolean = false)

// Main thread only: the isLoading check stops two page loads at once, and `generation`
// drops a response that arrives after a refresh or stop.
class DealsStateHolder(private val api: DealsApi) {
    var state by mutableStateOf(DealsUiState())
        private set
    var rating by mutableStateOf(RatingUiState())
        private set
    var opening by mutableStateOf(OpenPostState())
        private set
    // The location of each deal's other post, by deal id. Kept across refreshes, since a post's location
    // shows on its card again after every visit to the tab.
    var locations by mutableStateOf(emptyMap<String, PostLocation>())
        private set
    private val locating = mutableSetOf<String>()
    private var generation = 0
    private var loadedAt = 0L

    suspend fun loadMore() {
        val current = state
        if (current.isLoading || current.endReached) return
        load(current, current.nextCursor)
    }

    // Fetches page 1 and replaces the list. The old deals stay on screen meanwhile, and stay if it fails.
    suspend fun refresh() {
        generation++
        load(state.copy(isLoading = false, isRefreshing = false), cursor = null)
    }

    fun stop() {
        generation++
        state = state.copy(isLoading = false, isRefreshing = false)
    }

    suspend fun openPost(post: DealPost, isRequest: Boolean): JSONObject? {
        if (opening.isOpening) return null
        opening = OpenPostState(isOpening = true)
        val outcome = attempt("open post") { api.post(isRequest, post.id) }
        opening = OpenPostState(failed = outcome is Outcome.Failed)
        if (outcome is Outcome.SignedOut) state = state.copy(signedOut = true)
        return (outcome as? Outcome.Done)?.value
    }

    fun stopOpening() {
        opening = OpenPostState()
    }

    // Fetches the other post of the deal for its location, once. Without it the card shows no map.
    suspend fun loadLocation(deal: Deal) {
        val post = deal.otherPost ?: return
        if (deal.id in locations || !locating.add(deal.id)) return
        val outcome = attempt("load post location") { api.post(isRequest = deal.role == DealRole.SELLER, post.id) }
        locating.remove(deal.id)
        val location = (outcome as? Outcome.Done)?.value?.let(::locationOf) ?: return
        locations = locations + (deal.id to location)
    }

    fun startRating(dealId: String) {
        rating = RatingUiState(dealId, previous = state.deals.firstOrNull { it.id == dealId }?.myRating)
    }

    fun dismissRating() {
        if (!rating.isSubmitting) rating = RatingUiState()
    }

    // Rates the deal, or edits the rating when there is one. On success the deal is updated in place, so the list is not reloaded.
    suspend fun submitRating(stars: Int, comment: String) {
        val current = rating
        val dealId = current.dealId ?: return
        if (current.isSubmitting) return
        rating = current.copy(isSubmitting = true, failure = null)
        rating = try {
            val outcome = attempt("submit rating") {
                if (current.previous == null) api.rate(dealId, stars, comment) else api.editRating(dealId, stars, comment)
            }
            when (outcome) {
                is Outcome.Done -> RatingUiState().also { applyRating(dealId, outcome.value) }
                Outcome.SignedOut -> RatingUiState().also { state = state.copy(signedOut = true) }
                Outcome.Failed -> current.copy(failure = RateFailure.Unreachable)
            }
        } catch (e: RateRejectedException) {
            current.copy(failure = if (e.code == HttpURLConnection.HTTP_CONFLICT) RateFailure.AlreadyRated else RateFailure.Rejected(e.message.orEmpty()))
        }
    }

    // The other user's new score also goes on their other deals on screen. The rating response has no
    // name, so each deal keeps the name it already shows.
    private fun applyRating(dealId: String, result: RatingResult) {
        state = state.copy(deals = state.deals.map { deal ->
            val other = if (deal.otherUser.id == result.otherUser.id) {
                result.otherUser.copy(name = deal.otherUser.name)
            } else {
                deal.otherUser
            }
            if (deal.id == dealId) deal.copy(myRating = result.rating, otherUser = other) else deal.copy(otherUser = other)
        })
    }

    fun isStale(): Boolean = loadedAt != 0L && SystemClock.elapsedRealtime() - loadedAt > STALE_AFTER_MS

    private suspend fun load(base: DealsUiState, cursor: String?) {
        val started = generation
        state = base.copy(isLoading = true, isRefreshing = cursor == null, loadFailed = false)
        val next = when (val outcome = attempt("load deals") { api.page(cursor) }) {
            is Outcome.Done -> DealsUiState(
                deals = if (cursor == null) outcome.value.deals else base.deals + outcome.value.deals,
                nextCursor = outcome.value.nextCursor,
                endReached = outcome.value.nextCursor == null
            )
            Outcome.SignedOut -> base.copy(signedOut = true)
            Outcome.Failed -> base.copy(loadFailed = true)
        }
        if (started == generation) {
            state = next
            if (!next.loadFailed && !next.signedOut) loadedAt = SystemClock.elapsedRealtime()
        }
    }
}
