package com.example.cpen321application.deals.viewmodel

import android.app.Application
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import com.example.cpen321application.deals.model.DealPost
import com.example.cpen321application.deals.model.DealsApi
import com.example.cpen321application.posts.model.Mode
import com.example.cpen321application.users.model.SessionManager
import kotlinx.coroutines.Job
import kotlinx.coroutines.launch
import org.json.JSONObject

// Keeps the deals loaded while the user switches tabs or rotates the screen.
class DealsViewModel(app: Application) : AndroidViewModel(app) {
    private val stateHolder = DealsStateHolder(DealsApi(SessionManager.get(app)))
    private var job: Job? = null
    private var openJob: Job? = null

    val state: DealsUiState
        get() = stateHolder.state

    val rating: RatingUiState
        get() = stateHolder.rating

    val opening: OpenPostState
        get() = stateHolder.opening

    // Fetches the post, then hands it to the screen that shows it.
    fun openPost(post: DealPost, isRequest: Boolean, onOpened: (JSONObject, Mode) -> Unit) {
        openJob = viewModelScope.launch {
            stateHolder.openPost(post, isRequest)?.let { onOpened(it, if (isRequest) Mode.BUYING else Mode.SELLING) }
        }
    }

    fun clearOpenFailure() = stateHolder.stopOpening()

    fun startRating(dealId: String) = stateHolder.startRating(dealId)

    fun dismissRating() = stateHolder.dismissRating()

    // Not tied to `job`, so leaving the tab does not cancel a rating already sent.
    fun submitRating(stars: Int, comment: String) {
        viewModelScope.launch { stateHolder.submitRating(stars, comment) }
    }

    fun refresh() {
        job?.cancel()
        job = viewModelScope.launch { stateHolder.refresh() }
    }

    fun loadMore() {
        if (job?.isActive == true) return
        job = viewModelScope.launch { stateHolder.loadMore() }
    }

    fun refreshIfStale() {
        if (stateHolder.isStale()) refresh()
    }

    // Cancels the request in flight when the user leaves the tab.
    fun stop() {
        job?.cancel()
        openJob?.cancel()
        stateHolder.stopOpening()
        stateHolder.stop()
        stateHolder.dismissRating()
    }
}
