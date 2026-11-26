package com.example.cpen321application.components.matching.model

import com.example.cpen321application.components.users.model.SessionManager
import com.example.cpen321application.components.posts.model.Mode
import com.example.cpen321application.components.posts.model.STATUS_OPEN
import com.example.cpen321application.components.posts.model.objects
import java.io.IOException
import java.math.BigDecimal
import java.net.URLEncoder
import org.json.JSONArray
import org.json.JSONObject

// price is a listing's price or a request's budget.
data class FeedItem(
    val id: String,
    val isRequest: Boolean,
    val name: String,
    val category: String,
    val price: Double?,
    val condition: String?,
    val description: String,
    val photoId: String?,
    val distanceKm: Double?,
    /** The post exactly as the backend returned it; used to open its detail screen. */
    val raw: JSONObject,
    /** Null when no travel time was asked for: when browsing, and after the first page of recommendations. */
    val travel: Travel? = null
)

sealed interface Travel {
    data class Minutes(val minutes: Int, val mode: String) : Travel
    data object NoRoute : Travel
    data object Unavailable : Travel
}

data class FeedPage(val items: List<FeedItem>, val nextCursor: String?)

data class Place(val label: String, val lat: Double, val lng: Double)

data class OwnPost(val id: String, val title: String, val place: Place)

data class FeedFilter(
    val category: String? = null,
    val minPrice: Double? = null,
    val maxPrice: Double? = null,
    val near: Place? = null,
    val radiusKm: Double? = null
)

// Buying browses listings and is recommended them for the user's requests; selling is the reverse.
data class FeedQuery(
    val mode: Mode = Mode.BUYING,
    val filter: FeedFilter = FeedFilter(),
    val recommendedFor: OwnPost? = null
)

class FeedApi(private val sessions: SessionManager) {
    suspend fun page(query: FeedQuery, cursor: String?): FeedPage {
        val params = filterParams(query) + ("limit" to PAGE_SIZE.toString())
        val recommendedFor = query.recommendedFor
        if (recommendedFor == null) {
            val key = if (query.mode == Mode.BUYING) "listings" else "requests"
            val body = get("/api/feed/$key", params + listOfNotNull(cursor?.let { "before" to it }))
            return parsePage(body, key) { parseItem(it, distanceKm = null) }
        }
        val paging = listOfNotNull("postId" to recommendedFor.id, cursor?.let { "cursor" to it })
        val body = get("/api/feed", params + paging)
        val page = JSONObject(body)
        return parsePage(body, "matches") {
            parseItem(it.getJSONObject("post"), it.getDouble("distanceKm"), travelOf(it, page, firstPage = cursor == null))
        }
    }

    suspend fun ownOpenPosts(mode: Mode): List<OwnPost> =
        JSONArray(get("/api/${mode.path}", emptyList())).objects()
            .filter { it.getString("status") == STATUS_OPEN }
            .map(::ownPostOf)

    suspend fun categories(): List<String> =
        JSONArray(get("/api/options", listOf("field" to "category"))).objects().map { it.getString("label") }

    private suspend fun get(path: String, params: List<Pair<String, String>>): String {
        val query = params.joinToString("&") { (name, value) -> "$name=${URLEncoder.encode(value, "UTF-8")}" }
        val result = sessions.authorizedRequest("GET", if (query.isEmpty()) path else "$path?$query")
        if (!result.isSuccess) {
            throw IOException("HTTP ${result.code}: ${result.errorMessage}")
        }
        return result.body
    }

    companion object {
        const val PAGE_SIZE = 20
    }
}

fun ownPostOf(post: JSONObject): OwnPost {
    val coordinates = post.getJSONObject("location").getJSONArray("coordinates")
    val category = post.getString("category").replaceFirstChar { it.titlecase() }
    val description = post.optString("description")
    return OwnPost(
        id = post.getString("id"),
        title = if (description.isBlank()) category else "$category · $description",
        place = Place(post.getString("address"), lat = coordinates.getDouble(1), lng = coordinates.getDouble(0))
    )
}

// Recommendations are centred on the post itself unless the user picked an address.
private fun filterParams(query: FeedQuery): List<Pair<String, String>> {
    val filter = query.filter
    val centre = filter.near ?: query.recommendedFor?.place
    val distance = if (centre != null && filter.radiusKm != null) {
        listOf("lat" to plain(centre.lat), "lng" to plain(centre.lng), "radiusKm" to plain(filter.radiusKm))
    } else {
        emptyList()
    }
    return listOfNotNull(
        filter.category?.let { "category" to it },
        filter.minPrice?.let { "minPrice" to plain(it) },
        filter.maxPrice?.let { "maxPrice" to plain(it) }
    ) + distance
}

// The backend rejects exponents, which Double.toString uses for very small numbers.
fun plain(number: Double): String = BigDecimal.valueOf(number).stripTrailingZeros().toPlainString()

private fun parsePage(body: String, key: String, parse: (JSONObject) -> FeedItem): FeedPage {
    val json = JSONObject(body)
    val nextCursor = if (json.isNull("nextCursor")) null else json.getString("nextCursor")
    return FeedPage(json.getJSONArray(key).objects().map(parse), nextCursor)
}

// Only the first page of recommendations asks the routing service for travel times.
private fun travelOf(match: JSONObject, page: JSONObject, firstPage: Boolean): Travel? = when {
    page.optBoolean("travelTimesAvailable") ->
        if (match.isNull("travelMinutes")) {
            Travel.NoRoute
        } else {
            Travel.Minutes(match.getInt("travelMinutes"), page.getString("travelMode"))
        }
    firstPage -> Travel.Unavailable
    else -> null
}

private fun parseItem(post: JSONObject, distanceKm: Double?, travel: Travel? = null): FeedItem {
    val isRequest = post.has("requestFields")
    return FeedItem(
        id = post.getString("id"),
        isRequest = isRequest,
        name = post.getString("name"),
        category = post.getString("category"),
        price = if (isRequest) budgetOf(post) else post.getDouble("price"),
        condition = post.optString("condition").takeIf { it.isNotEmpty() },
        description = post.optString("description"),
        photoId = post.optJSONArray("photoIds")?.optString(0)?.takeIf { it.isNotEmpty() },
        distanceKm = distanceKm,
        raw = post,
        travel = travel
    )
}

private fun budgetOf(request: JSONObject): Double? =
    request.getJSONArray("requestFields").objects()
        .firstOrNull { it.getString("key") == "price" }
        ?.optDouble("value")
        ?.takeUnless { it.isNaN() }
