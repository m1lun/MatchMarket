package com.example.cpen321application.support

import androidx.compose.ui.test.hasClickAction
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.onAllNodesWithTag
import androidx.compose.ui.test.onFirst
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.performClick
import androidx.test.platform.app.InstrumentationRegistry
import com.example.cpen321application.auth.HttpResult
import com.example.cpen321application.auth.SessionManager
import com.example.cpen321application.deals.DealsTags
import com.example.cpen321application.deals.RateTags
import kotlinx.coroutines.runBlocking
import org.json.JSONObject
import java.io.IOException

// The deal the backend's E2E deal route makes (backend/src/routes/e2e.ts): the signed-in user sold
// to their own seed buyer, "E2E Buyer", through the buyer's closed request "E2E desk". The backend must
// run with ENABLE_E2E_ROUTES=true.
private const val SEED_PATH = "/api/e2e/deals"
private const val ONLINE_WAIT_MS = 60_000L
private const val RETRY_DELAY_MS = 1_000L
private const val LOAD_WAIT_MS = 15_000L

private val sessions by lazy { SessionManager.get(InstrumentationRegistry.getInstrumentation().targetContext) }

// Retries while the emulator is still coming back online, e.g. right after airplane mode is turned off.
private fun send(method: String, path: String, body: JSONObject? = null): HttpResult {
    val deadline = System.currentTimeMillis() + ONLINE_WAIT_MS
    while (true) {
        try {
            return runBlocking { sessions.authorizedRequest(method, path, body) }
        } catch (e: IOException) {
            if (System.currentTimeMillis() > deadline) throw e
            Thread.sleep(RETRY_DELAY_MS)
        }
    }
}

private fun HttpResult.orFail(action: String): HttpResult {
    check(isSuccess) { "$action failed with HTTP $code: $errorMessage. Is the backend running with ENABLE_E2E_ROUTES=true?" }
    return this
}

// Replaces any seeded deal with a new one and returns its id.
fun seedDeal(): String = JSONObject(send("POST", SEED_PATH).orFail("Seeding a deal").body).getString("dealId")

// Removes the seeded deal, its rating and the seed buyer's score.
fun clearSeededDeals() {
    send("DELETE", SEED_PATH).orFail("Removing the seeded deals")
}

// Rates the deal through the real ratings API, as the same user would from another device.
fun rateFromAnotherDevice(dealId: String, stars: Int) {
    send("POST", "/api/deals/$dealId/ratings", JSONObject().put("stars", stars).put("comment", ""))
        .orFail("Rating the deal from another device")
}

// The stars the signed-in user gave the deal, read from GET /api/deals, or null if they have not rated it.
fun myStars(dealId: String): Int? {
    val deals = JSONObject(send("GET", "/api/deals?limit=50").orFail("Loading the deals").body).getJSONArray("deals")
    for (index in 0 until deals.length()) {
        val deal = deals.getJSONObject(index)
        if (deal.getString("id") == dealId) {
            return if (deal.isNull("myRating")) null else deal.getJSONObject("myRating").getInt("stars")
        }
    }
    error("Deal $dealId is not in the deals list")
}

// A bottom-bar tab; the Deals screen's own "Deals" title is not clickable, so it does not match.
private fun MainRule.tab(label: String) = onNode(hasText(label) and hasClickAction())

// Taps the Deals tab in the bottom bar, which loads the deals.
fun MainRule.openDeals() {
    tab("Deals").performClick()
}

// Leaves the Deals tab and comes back, so the deals load again.
fun MainRule.reopenDeals() {
    tab("Profile").performClick()
    openDeals()
}

// The seeded deal is the newest, so it is the first card.
fun MainRule.waitForRateButton() {
    waitUntil(LOAD_WAIT_MS) { onAllNodesWithTag(DealsTags.RATE).fetchSemanticsNodes().isNotEmpty() }
}

fun MainRule.tapRateOnSeededDeal() {
    waitForRateButton()
    onAllNodesWithTag(DealsTags.RATE).onFirst().performClick()
    waitUntil(LOAD_WAIT_MS) { onAllNodesWithTag(RateTags.SUBMIT).fetchSemanticsNodes().isNotEmpty() }
}

fun MainRule.pickStars(stars: Int) {
    onNodeWithTag("${RateTags.STAR_PREFIX}$stars").performClick()
}
