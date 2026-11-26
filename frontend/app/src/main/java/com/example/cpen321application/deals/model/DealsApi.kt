package com.example.cpen321application.deals.model

import com.example.cpen321application.users.model.SessionManager
import com.example.cpen321application.posts.model.objects
import java.io.IOException
import java.net.URLEncoder
import java.time.Instant
import java.time.ZoneId
import org.json.JSONObject

class DealsApi(private val sessions: SessionManager) {
    suspend fun page(cursor: String?): DealsPage {
        val params = listOfNotNull("limit=$PAGE_SIZE", cursor?.let { "before=${URLEncoder.encode(it, "UTF-8")}" })
        return parsePage(get("/api/deals?${params.joinToString("&")}"))
    }

    // One post, as the backend returns it; the feed's detail screen opens it from this.
    suspend fun post(isRequest: Boolean, id: String): JSONObject {
        val kind = if (isRequest) "requests" else "listings"
        return JSONObject(get("/api/feed/$kind/$id"))
    }

    suspend fun rate(dealId: String, stars: Int, comment: String): RatingResult =
        sendRating("POST", dealId, stars, comment)

    suspend fun editRating(dealId: String, stars: Int, comment: String): RatingResult =
        sendRating("PUT", dealId, stars, comment)

    private suspend fun sendRating(method: String, dealId: String, stars: Int, comment: String): RatingResult {
        val body = JSONObject().put("stars", stars).put("comment", comment.trim())
        val result = sessions.authorizedRequest(method, "/api/deals/$dealId/ratings", body)
        if (!result.isSuccess) {
            throw RateRejectedException(result.code, result.errorMessage)
        }
        val json = JSONObject(result.body)
        return RatingResult(parseRating(json.getJSONObject("rating")), parseOtherUser(json.getJSONObject("otherUser")))
    }

    // The body of a successful GET; an error status is thrown as an IOException.
    private suspend fun get(path: String): String {
        val result = sessions.authorizedRequest("GET", path)
        if (!result.isSuccess) {
            throw IOException("HTTP ${result.code}: ${result.errorMessage}")
        }
        return result.body
    }

    companion object {
        const val PAGE_SIZE = 20
    }
}

private fun parsePage(body: String): DealsPage {
    val json = JSONObject(body)
    return DealsPage(json.getJSONArray("deals").objects().map(::parseDeal), json.optText("nextCursor"))
}

private fun parseDeal(deal: JSONObject): Deal = Deal(
    id = deal.getString("id"),
    role = if (deal.getString("role") == "seller") DealRole.SELLER else DealRole.BUYER,
    agreedPrice = deal.getDouble("agreedPrice"),
    createdAt = localDate(deal.getString("createdAt")),
    title = deal.getString("title"),
    listing = deal.optObject("listing")?.let(::parsePost),
    request = deal.optObject("request")?.let(::parsePost),
    otherUser = parseOtherUser(deal.getJSONObject("otherUser")),
    myRating = deal.optObject("myRating")?.let(::parseRating),
    theirRating = deal.optObject("theirRating")?.let(::parseRating)
)

private fun parsePost(post: JSONObject): DealPost = DealPost(
    id = post.getString("id"),
    category = post.getString("category"),
    price = post.optDouble("price").takeUnless { it.isNaN() },
    photoId = post.optText("photoId")
)

private fun parseOtherUser(user: JSONObject): OtherUser = OtherUser(
    id = user.getString("id"),
    name = "${user.optString("firstName")} ${user.optString("lastName")}".trim(),
    score = if (user.isNull("score")) null else user.getDouble("score"),
    ratingCount = user.getInt("ratingCount")
)

private fun parseRating(rating: JSONObject): DealRating =
    DealRating(stars = rating.getInt("stars"), comment = rating.optString("comment"))

// The day an ISO timestamp falls on in the user's time zone, e.g. "2026-10-24".
private fun localDate(iso: String): String = Instant.parse(iso).atZone(ZoneId.systemDefault()).toLocalDate().toString()

private fun JSONObject.optObject(key: String): JSONObject? = if (isNull(key)) null else getJSONObject(key)

private fun JSONObject.optText(key: String): String? = if (isNull(key)) null else getString(key)
