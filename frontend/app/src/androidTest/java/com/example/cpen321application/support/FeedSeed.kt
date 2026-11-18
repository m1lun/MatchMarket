package com.example.cpen321application.support

import androidx.compose.ui.test.hasClickAction
import androidx.compose.ui.test.hasSetTextAction
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.onAllNodesWithTag
import androidx.compose.ui.test.onFirst
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performTextReplacement
import com.example.cpen321application.feed.FeedTags
import org.json.JSONArray
import org.json.JSONObject

// Helpers for the Matching feed tests (View Recommendations and Filter Feed). The other user's post is the E2E
// Seller's "E2E lamp" from POST /api/e2e/listings; the tester's own post is a request created through the API.
const val FEED_REQUEST_NAME = "E2E feed request"
const val FEED_REQUEST_DESCRIPTION = "Seeded for the feed E2E tests"

// The app titles the tester's own posts "<Category> · <description>" in the feed.
const val FEED_REQUEST_TITLE = "Lamp · $FEED_REQUEST_DESCRIPTION"
const val SEEDED_LISTING_PRICE = "$30.00"
const val UNMATCHED_CATEGORY = "e2e nothing matches"
private const val SEEDED_CATEGORY = "lamp"
private const val REQUESTS_PATH = "/api/requests"
private const val UBC_LONGITUDE = -123.25
private const val UBC_LATITUDE = 49.26
private const val TRAVEL_WAIT_MS = 15_000L
private const val SUGGESTION_WAIT_MS = 8_000L
private const val ADDRESS_ATTEMPTS = 3
private const val STAYS_ABSENT_MS = 3_000L
private const val POLL_MS = 250L

// What a feed card can show for the travel time: a time for the travel mode, or why there is none.
private val TRAVEL_TEXTS =
    listOf("min walk", "min by bike", "min drive", "No route available", "Travel time unavailable")

private fun JSONArray.objects(): List<JSONObject> = (0 until length()).map(::getJSONObject)

private fun ownRequests(): List<JSONObject> =
    JSONArray(send("GET", REQUESTS_PATH).orFail("Loading my requests").body).objects()

// Creates the tester's open request at the seeded listing's location, with a hard maximum price, and returns its id.
fun createFeedRequest(maxPrice: Int, category: String = SEEDED_CATEGORY): String {
    val price = JSONObject().put("key", "price").put("value", maxPrice).put("hard", true)
    val body = JSONObject()
        .put("name", FEED_REQUEST_NAME)
        .put("category", category)
        .put("description", FEED_REQUEST_DESCRIPTION)
        .put("address", TEST_ADDRESS)
        .put("location", JSONObject().put("longitude", UBC_LONGITUDE).put("latitude", UBC_LATITUDE))
        .put("photoIds", JSONArray())
        .put("requestFields", JSONArray().put(price))
    return JSONObject(send("POST", REQUESTS_PATH, body).orFail("Creating my request").body).getString("id")
}

fun closeFeedRequest(id: String) {
    setRequestStatus(id, "closed")
}

// Deletes every request the feed tests created, so each test starts without one.
fun deleteFeedRequests() {
    ownRequests().filter { it.getString("name") == FEED_REQUEST_NAME }.forEach {
        send("DELETE", "$REQUESTS_PATH/${it.getString("id")}").orFail("Deleting my request")
    }
}

// Closes the tester's other open requests for a test that needs none, and returns them so they can be reopened.
fun closeOpenRequests(): List<String> {
    val open = ownRequests().filter { it.getString("status") == "open" }.map { it.getString("id") }
    open.forEach { setRequestStatus(it, "closed") }
    return open
}

fun reopenRequests(ids: List<String>) {
    ids.forEach { setRequestStatus(it, "open") }
}

private fun setRequestStatus(id: String, status: String) {
    send("PATCH", "$REQUESTS_PATH/$id", JSONObject().put("status", status)).orFail("Setting my request to $status")
}

// The HTTP status of GET /api/feed for one of the tester's posts.
fun feedStatus(postId: String): Int = send("GET", "/api/feed?postId=$postId").code

// Opens the Feed tab on "I'm buying" with no filters, since the feed starts filtered near the tester's home address.
fun MainRule.openUnfilteredBuyingFeed() {
    tab("Feed").performClick()
    onNodeWithTag(FeedTags.MODE_SELLING).performClick()
    onNodeWithTag(FeedTags.MODE_BUYING).performClick()
    openFilters()
    onNodeWithTag(FeedTags.FILTER_CLEAR).scrolled().performClick()
    waitForTagGone(FeedTags.FILTER_APPLY)
}

fun MainRule.openFilters() {
    onNodeWithTag(FeedTags.FILTERS).performClick()
    waitForTag(FeedTags.FILTER_APPLY)
}

fun MainRule.applyFilters() {
    onNodeWithTag(FeedTags.FILTER_APPLY).scrolled().performClick()
    waitForTagGone(FeedTags.FILTER_APPLY)
}

fun MainRule.setFilterField(tag: String, value: String) {
    onNodeWithTag(tag).scrolled().performTextReplacement(value)
}

// Types the address into "Near address" and picks the first suggestion from the geocoder. The geocoder sometimes
// answers with nothing, so like pickAddress it types the address again, up to three times.
fun MainRule.pickFilterAddress(query: String) {
    val suggestion = hasText(query.substringBefore(','), substring = true) and hasClickAction() and !hasSetTextAction()
    val showsSuggestion = {
        runCatching { waitUntil(SUGGESTION_WAIT_MS) { onAllNodes(suggestion).fetchSemanticsNodes().isNotEmpty() } }
            .isSuccess
    }
    setFilterField(FeedTags.FILTER_ADDRESS, query)
    var attempt = 1
    while (!showsSuggestion()) {
        check(attempt++ < ADDRESS_ATTEMPTS) { "No address suggestions for \"$query\"" }
        setFilterField(FeedTags.FILTER_ADDRESS, query.dropLast(1))
        setFilterField(FeedTags.FILTER_ADDRESS, query)
    }
    onAllNodes(suggestion).onFirst().performClick()
}

// The seeded listing's card: its name, price and condition. A recommendation also shows its distance, and a travel
// time or the reason there is none.
fun MainRule.assertSeededListingCard(recommended: Boolean) {
    waitForText(SEEDED_LISTING)
    waitForText(SEEDED_LISTING_PRICE)
    waitForText("Condition: good", substring = true)
    if (recommended) {
        waitForText("km away", substring = true)
        waitUntil(TRAVEL_WAIT_MS) {
            TRAVEL_TEXTS.any { onAllNodes(hasText(it, substring = true)).fetchSemanticsNodes().isNotEmpty() }
        }
    }
}

// For a node that would appear only after a network call: checks it never does, for a few seconds.
fun MainRule.assertTagStaysAbsent(tag: String) {
    val deadline = System.currentTimeMillis() + STAYS_ABSENT_MS
    while (System.currentTimeMillis() < deadline) {
        check(onAllNodesWithTag(tag).fetchSemanticsNodes().isEmpty()) { "$tag appeared" }
        Thread.sleep(POLL_MS)
    }
}
