package com.example.cpen321application.support

import androidx.compose.ui.test.onAllNodesWithTag
import androidx.compose.ui.test.onFirst
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.performClick
import com.example.cpen321application.deals.DealsTags
import com.example.cpen321application.deals.RateTags
import org.json.JSONObject

// Helpers for the backend's /api/e2e/deals routes (needs ENABLE_E2E_ROUTES=true).
private const val SEED_PATH = "/api/e2e/deals"
private const val LOAD_WAIT_MS = 15_000L

// Seeds a fresh deal and returns its id.
fun seedDeal(): String = JSONObject(send("POST", SEED_PATH).orFail("Seeding a deal").body).getString("dealId")

// Removes the seeded deal.
fun clearSeededDeals() {
    send("DELETE", SEED_PATH).orFail("Removing the seeded deals")
}

// Rates the deal as the signed-in user.
fun rateThroughApi(dealId: String, stars: Int, comment: String = "") {
    send("POST", "/api/deals/$dealId/ratings", JSONObject().put("stars", stars).put("comment", comment))
        .orFail("Rating the deal through the API")
}

data class SavedRating(val stars: Int, val comment: String)

private fun dealsJson(limit: Int) =
    JSONObject(send("GET", "/api/deals?limit=$limit").orFail("Loading the deals").body).getJSONArray("deals")

// The user's rating of the deal, or null.
fun myRating(dealId: String): SavedRating? {
    val deals = dealsJson(limit = 50)
    for (index in 0 until deals.length()) {
        val deal = deals.getJSONObject(index)
        if (deal.getString("id") == dealId) {
            if (deal.isNull("myRating")) return null
            val rating = deal.getJSONObject("myRating")
            return SavedRating(rating.getInt("stars"), rating.getString("comment"))
        }
    }
    error("Deal $dealId is not in the deals list")
}

fun myStars(dealId: String): Int? = myRating(dealId)?.stars

// Opens the Deals tab.
fun MainRule.openDeals() {
    tab("Deals").performClick()
}

// Reloads the Deals tab.
fun MainRule.reopenDeals() {
    tab("Profile").performClick()
    openDeals()
}

// The seeded deal is the first card.
fun MainRule.waitForRateButton() {
    waitUntil(LOAD_WAIT_MS) { onAllNodesWithTag(DealsTags.RATE).fetchSemanticsNodes().isNotEmpty() }
}

fun MainRule.tapRateOnSeededDeal() {
    waitForRateButton()
    onAllNodesWithTag(DealsTags.RATE).onFirst().performClick()
    waitUntil(LOAD_WAIT_MS) { onAllNodesWithTag(RateTags.SUBMIT).fetchSemanticsNodes().isNotEmpty() }
}

// The seeded deal's Edit is the first one.
fun MainRule.tapEditOnSeededDeal() {
    waitUntil(LOAD_WAIT_MS) { onAllNodesWithTag(DealsTags.EDIT).fetchSemanticsNodes().isNotEmpty() }
    onAllNodesWithTag(DealsTags.EDIT).onFirst().performClick()
    waitUntil(LOAD_WAIT_MS) { onAllNodesWithTag(RateTags.SUBMIT).fetchSemanticsNodes().isNotEmpty() }
}

fun MainRule.pickStars(stars: Int) {
    onNodeWithTag("${RateTags.STAR_PREFIX}$stars").performClick()
}
