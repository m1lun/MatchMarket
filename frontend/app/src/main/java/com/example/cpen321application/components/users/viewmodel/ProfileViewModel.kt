package com.example.cpen321application.components.users.viewmodel

import android.app.Application
import android.util.Log
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import com.example.cpen321application.components.posts.model.AddressSuggestion
import com.example.cpen321application.components.posts.model.Mode
import com.example.cpen321application.components.posts.viewmodel.MIN_ADDRESS_QUERY_LENGTH
import com.example.cpen321application.shared.model.AddressSearch
import com.example.cpen321application.shared.model.SUGGEST_DELAY_MS
import com.example.cpen321application.shared.network.SessionExpiredException
import com.example.cpen321application.components.users.model.Profile
import com.example.cpen321application.components.users.model.ProfileApi
import com.example.cpen321application.components.users.model.Reputation
import com.example.cpen321application.components.users.model.SessionManager
import java.io.IOException
import kotlinx.coroutines.Job
import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import org.json.JSONException

private const val TAG = "ProfileViewModel"

data class ProfileUiState(
    val profile: Profile? = null,
    val reputation: Reputation? = null,
    val listingCount: Int = 0,
    val requestCount: Int = 0,
    val isLoading: Boolean = false,
    val loadFailed: Boolean = false,
    val signedOut: Boolean = false
)

// The open address dialog. Only a picked suggestion can be saved, because the backend needs its coordinates.
data class AddressEditor(
    val text: String,
    val picked: AddressSuggestion? = null,
    val suggestions: List<AddressSuggestion> = emptyList(),
    val saving: Boolean = false,
    val saveFailed: Boolean = false
)

// Keeps the profile loaded while the user switches tabs or rotates the screen.
class ProfileViewModel(app: Application) : AndroidViewModel(app) {
    private val api = ProfileApi(SessionManager.get(app))
    private val addressSearch = AddressSearch(app)
    private var job: Job? = null
    private var suggestJob: Job? = null

    var state by mutableStateOf(ProfileUiState())
        private set

    // Null while the address dialog is closed.
    var addressEditor by mutableStateOf<AddressEditor?>(null)
        private set

    // The profile already shown stays on screen while it reloads, and stays if the reload fails.
    fun refresh() {
        if (job?.isActive == true) return
        state = state.copy(isLoading = true, loadFailed = false)
        job = viewModelScope.launch {
            state = try {
                // The counts load alongside the profile; the reputation needs the user's id, so it waits for
                // the profile. If any request fails, the others are cancelled and it lands below.
                coroutineScope {
                    val listings = async { api.countPosts(Mode.SELLING) }
                    val requests = async { api.countPosts(Mode.BUYING) }
                    val profile = api.me()
                    ProfileUiState(
                        profile = profile,
                        reputation = api.reputation(profile.id),
                        listingCount = listings.await(),
                        requestCount = requests.await(),
                    )
                }
            } catch (_: SessionExpiredException) {
                state.copy(isLoading = false, signedOut = true)
            } catch (e: IOException) {
                Log.w(TAG, "Could not load the profile", e)
                state.copy(isLoading = false, loadFailed = true)
            } catch (e: JSONException) {
                Log.w(TAG, "Unexpected profile response", e)
                state.copy(isLoading = false, loadFailed = true)
            }
        }
    }

    fun openAddressEditor() {
        addressEditor = AddressEditor(text = state.profile?.home?.label.orEmpty())
    }

    fun closeAddressEditor() {
        suggestJob?.cancel()
        addressEditor = null
    }

    // Typing drops the picked address, so Save is only possible for text that came from a suggestion.
    fun onAddressChange(text: String) {
        val editor = addressEditor ?: return
        addressEditor = editor.copy(text = text, picked = null, suggestions = emptyList(), saveFailed = false)
        suggestJob?.cancel()
        if (text.trim().length < MIN_ADDRESS_QUERY_LENGTH) return
        suggestJob = viewModelScope.launch {
            delay(SUGGEST_DELAY_MS)
            val found = addressSearch.suggest(text.trim())
            addressEditor = addressEditor?.copy(suggestions = found)
        }
    }

    fun pickAddress(suggestion: AddressSuggestion) {
        suggestJob?.cancel()
        addressEditor = addressEditor?.copy(
            text = suggestion.label,
            picked = suggestion,
            suggestions = emptyList(),
            saveFailed = false,
        )
    }

    fun saveAddress() {
        val picked = addressEditor?.picked ?: return
        save(picked)
    }

    fun removeAddress() {
        save(null)
    }

    // On failure the dialog stays open with the user's input, so they can try again.
    private fun save(place: AddressSuggestion?) {
        val editor = addressEditor ?: return
        if (editor.saving) return
        suggestJob?.cancel()
        addressEditor = editor.copy(saving = true, saveFailed = false, suggestions = emptyList())
        viewModelScope.launch {
            try {
                val profile = api.saveAddress(place)
                state = state.copy(profile = profile)
                addressEditor = null
            } catch (_: SessionExpiredException) {
                addressEditor = null
                state = state.copy(signedOut = true)
            } catch (e: IOException) {
                Log.w(TAG, "Could not save the address", e)
                addressEditor = addressEditor?.copy(saving = false, saveFailed = true)
            } catch (e: JSONException) {
                Log.w(TAG, "Unexpected response after saving the address", e)
                addressEditor = addressEditor?.copy(saving = false, saveFailed = true)
            }
        }
    }
}
