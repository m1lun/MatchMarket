package com.example.cpen321application.post

import android.app.Application
import androidx.annotation.StringRes
import android.net.Uri
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import com.example.cpen321application.BuildConfig
import com.example.cpen321application.R
import com.example.cpen321application.auth.SessionManager
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import org.json.JSONArray
import org.json.JSONObject

// Shorter queries match too many places to be useful.
const val MIN_ADDRESS_QUERY_LENGTH = 3

class PostViewModel(app: Application) : AndroidViewModel(app) {
    private val api = PostApi(
        BuildConfig.API_BASE_URL.trimEnd('/') + "/api",
        SessionRequestAuth(SessionManager.get(app)),
        app.resources,
    )
    private val addressSearch = AddressSearch(app)

    var tab by mutableStateOf(AppTab.POSTS)
    var selected by mutableStateOf<PostSummary?>(null)

    var mode by mutableStateOf(Mode.BUYING)
        private set
    var posts by mutableStateOf<List<PostSummary>>(emptyList())
        private set
    var loading by mutableStateOf(false)
        private set
    var message by mutableStateOf<String?>(null)

    var editing by mutableStateOf(false)
        private set
    var saving by mutableStateOf(false)
        private set
    var editingId by mutableStateOf<String?>(null)
        private set
    val existingPhotoIds = mutableStateListOf<String>()
    var addressSuggestions by mutableStateOf<List<AddressSuggestion>>(emptyList())
        private set
    var searchingAddress by mutableStateOf(false)
        private set
    var showAddressError by mutableStateOf(false)
        private set
    private var pickedAddress by mutableStateOf<String?>(null)
    private var pickedLocation by mutableStateOf<JSONObject?>(null)

    val addressConfirmed: Boolean
        get() = pickedLocation != null && address.trim() == pickedAddress
    private var suggestJob: Job? = null
    var name by mutableStateOf("")
    var category by mutableStateOf("")
    var address by mutableStateOf("")
    var description by mutableStateOf("")
    var price by mutableStateOf("")
    var condition by mutableStateOf("good")
    val photos = mutableStateListOf<Uri>()
    val rows = mutableStateListOf<RowState>()
    var categories by mutableStateOf<List<OptionItem>>(emptyList())
        private set
    var savedFields by mutableStateOf<List<FieldDef>>(emptyList())
        private set
    private val optionCache = mutableMapOf<String, List<OptionItem>>()

    init {
        refresh()
    }

    fun selectMode(newMode: Mode) {
        if (newMode == mode) return
        mode = newMode
        refresh()
    }

    fun refresh() {
        viewModelScope.launch { load() }
    }

    private suspend fun load() {
        loading = true
        try {
            posts = api.listPosts(mode)
        } catch (e: ApiException) {
            message = e.message
        } finally {
            loading = false
        }
    }

    /** Set by "See recommendations"; MainActivity hands it to the Feed tab and clears it. */
    var recommendationsFor by mutableStateOf<PostSummary?>(null)

    fun showRecommendations(post: PostSummary) {
        recommendationsFor = post
        selected = null
        tab = AppTab.FEED
    }

    /** Another user's post opened from the Feed, shown read-only; null when none is open. */
    var openPost by mutableStateOf<PostSummary?>(null)
        private set
    var openPostMode by mutableStateOf(Mode.SELLING)
        private set

    fun open(raw: JSONObject, postMode: Mode) {
        openPostMode = postMode
        openPost = api.summarise(postMode, raw)
    }

    fun closeOpenPost() {
        openPost = null
    }

    fun toggleStatus(post: PostSummary) {
        launchCatching {
            val next = if (post.status == STATUS_OPEN) STATUS_CLOSED else STATUS_OPEN
            api.setStatus(mode, post.id, next)
            selected = selected?.takeIf { it.id == post.id }?.copy(status = next)
            refresh()
        }
    }

    fun delete(post: PostSummary) {
        launchCatching {
            api.deletePost(mode, post.id)
            selected = null
            refresh()
        }
    }

    fun startEditing(post: PostSummary? = null) {
        name = ""
        category = ""
        address = ""
        description = ""
        price = ""
        condition = "good"
        photos.clear()
        existingPhotoIds.clear()
        addressSuggestions = emptyList()
        searchingAddress = false
        showAddressError = false
        pickedAddress = null
        pickedLocation = null
        rows.clear()
        rows.addAll(defaultRows(mode, getApplication<Application>().resources))
        editingId = post?.id
        if (post != null) prefill(post.raw)
        editing = true
        launchCatching {
            categories = api.options("category")
            savedFields = api.fields()
        }
    }

    private fun prefill(raw: JSONObject) {
        val seller = mode == Mode.SELLING
        name = raw.getString("name")
        category = raw.getString("category")
        address = raw.getString("address")
        description = raw.optString("description")
        if (seller) {
            price = raw.get("price").asPlainNumber()
            condition = raw.getString("condition")
        }
        val coords = raw.getJSONObject("location").getJSONArray("coordinates")
        pickedAddress = address
        pickedLocation = locationJson(coords.getDouble(0), coords.getDouble(1))
        raw.optJSONArray("photoIds")?.let { existingPhotoIds.addAll(it.strings()) }

        val stored = raw.optJSONArray(if (seller) "listingFields" else "requestFields") ?: return
        for (o in stored.objects()) {
            val type = o.getString("type")
            var row = RowState(
                key = o.getString("key"),
                label = o.getString("label"),
                kind = o.getString("kind"),
                type = type,
                hard = o.optBoolean("hard", false),
                importance = o.optInt("importance", DEFAULT_IMPORTANCE),
            )
            row = when (type) {
                TYPE_BOOL -> row.copy(boolValue = o.getBoolean("value"))
                TYPE_DIMENSIONS -> {
                    val d = o.getJSONObject("value")
                    row.copy(
                        width = d.get("width").asPlainNumber(),
                        height = d.get("height").asPlainNumber(),
                        depth = d.get("depth").asPlainNumber(),
                    )
                }
                else -> row.copy(value = o.get("value").asPlainNumber())
            }
            val at = rows.indexOfFirst { it.key == row.key }
            if (at >= 0) rows[at] = row.copy(required = rows[at].required) else rows.add(row)
        }
    }

    fun stopEditing() {
        editing = false
        suggestJob?.cancel()
        addressSuggestions = emptyList()
        searchingAddress = false
    }

    fun onAddressChange(text: String) {
        address = text
        showAddressError = false
        suggestJob?.cancel()
        if (text.trim().length < MIN_ADDRESS_QUERY_LENGTH || text.trim() == pickedAddress) {
            addressSuggestions = emptyList()
            searchingAddress = false
            return
        }
        // Shown during the pause too, so the field reacts as soon as the search is due.
        searchingAddress = true
        suggestJob = viewModelScope.launch {
            delay(SUGGEST_DELAY_MS)
            addressSuggestions = addressSearch.suggest(text.trim())
            searchingAddress = false
        }
    }

    fun pickAddress(suggestion: AddressSuggestion) {
        suggestJob?.cancel()
        searchingAddress = false
        address = suggestion.label
        pickedAddress = suggestion.label
        showAddressError = false
        pickedLocation = locationJson(suggestion.longitude, suggestion.latitude)
        addressSuggestions = emptyList()
    }

    fun addCustomRow(label: String, type: String): String? {
        val trimmed = label.trim()
        if (trimmed.isEmpty()) return text(R.string.error_field_name)
        if (rows.count { it.isCustom } >= MAX_CUSTOM_FIELDS) {
            return text(R.string.error_too_many_fields, MAX_CUSTOM_FIELDS.toString())
        }
        val key = trimmed.lowercase().replace(Regex("\\s+"), " ")
        if (rows.any { it.key == key }) return text(R.string.error_duplicate_field)
        rows.add(RowState(key, trimmed, KIND_CUSTOM, type, hard = false))
        return null
    }

    fun addPhotos(uris: List<Uri>) {
        val room = MAX_PHOTOS - photos.size - existingPhotoIds.size
        if (uris.size > room) message = text(R.string.error_too_many_photos, MAX_PHOTOS.toString())
        photos.addAll(uris.take(room))
    }

    suspend fun suggestions(field: String): List<OptionItem> {
        optionCache[field]?.let { return it }
        return try {
            api.options(field).also { optionCache[field] = it }
        } catch (_: ApiException) {
            emptyList()
        }
    }

    fun submit() {
        if (saving) return
        viewModelScope.launch {
            saving = true
            try {
                val body = buildBody()
                val id = editingId
                if (id == null) api.createPost(mode, body) else api.updatePost(mode, id, body)
                optionCache.clear()
                // Reload before closing the form, so My Posts never shows the list from before the save.
                load()
                editing = false
                selected = selected?.let { s -> posts.find { it.id == s.id } }
            } catch (e: ApiException) {
                message = e.message
            } finally {
                saving = false
            }
        }
    }

    private suspend fun buildBody(): JSONObject {
        val seller = mode == Mode.SELLING
        val resources = getApplication<Application>().resources
        if (category.isBlank()) throw ApiException(text(R.string.error_choose_category))
        if (name.isBlank()) throw ApiException(text(R.string.error_name_required))
        val location = pickedLocation
        if (location == null || !addressConfirmed) {
            showAddressError = true
            throw ApiException(text(R.string.editor_address_error))
        }
        if (seller && photos.isEmpty() && existingPhotoIds.isEmpty()) {
            throw ApiException(text(R.string.error_photo_required))
        }

        val body = JSONObject()
            .put("name", name.trim())
            .put("category", category.trim())
            .put("description", description.trim())
            .put("address", address.trim())
            .put("location", location)

        if (seller) {
            val parsedPrice = price.trim().toDoubleOrNull()
                ?: throw ApiException(text(R.string.error_price_required))
            body.put("price", parsedPrice).put("condition", condition)
        }

        val rowsJson = JSONArray()
        for (row in rows) {
            if (row.required && row.isEmpty) throw ApiException(text(R.string.error_field_required, row.label))
            if (row.isEmpty) continue
            rowsJson.put(rowToJson(row, seller, resources))
        }
        body.put(if (seller) "listingFields" else "requestFields", rowsJson)

        val resolver = getApplication<Application>().contentResolver
        val uploaded = if (photos.isNotEmpty()) {
            api.uploadPhotos(readPhotos(resolver, photos, resources))
        } else {
            emptyList()
        }
        body.put("photoIds", JSONArray(existingPhotoIds + uploaded))
        return body
    }
}

private fun PostViewModel.launchCatching(block: suspend () -> Unit) {
    viewModelScope.launch {
        try {
            block()
        } catch (e: ApiException) {
            message = e.message
        }
    }
}

// A message from the string resources, for text the view model shows.
private fun PostViewModel.text(@StringRes id: Int, vararg args: Any?): String =
    getApplication<Application>().getString(id, *args)

private fun locationJson(longitude: Double, latitude: Double) =
    JSONObject().put("longitude", longitude).put("latitude", latitude)

private fun Any.asPlainNumber() = toString().removeSuffix(".0")
