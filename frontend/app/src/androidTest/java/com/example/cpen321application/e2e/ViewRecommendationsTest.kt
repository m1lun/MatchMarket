package com.example.cpen321application.e2e

import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onFirst
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import com.example.cpen321application.feed.FeedTags
import com.example.cpen321application.support.FEED_REQUEST_NAME
import com.example.cpen321application.support.FEED_REQUEST_TITLE
import com.example.cpen321application.support.MainRule
import com.example.cpen321application.support.UNMATCHED_CATEGORY
import com.example.cpen321application.support.applyFilters
import com.example.cpen321application.support.assertSeededListingCard
import com.example.cpen321application.support.assertTagStaysAbsent
import com.example.cpen321application.support.clearSeededConversations
import com.example.cpen321application.support.click
import com.example.cpen321application.support.closeFeedRequest
import com.example.cpen321application.support.closeOpenRequests
import com.example.cpen321application.support.createFeedRequest
import com.example.cpen321application.support.deleteFeedRequests
import com.example.cpen321application.support.feedStatus
import com.example.cpen321application.support.mainRule
import com.example.cpen321application.support.openFilters
import com.example.cpen321application.support.openUnfilteredBuyingFeed
import com.example.cpen321application.support.reopenRequests
import com.example.cpen321application.support.scrolled
import com.example.cpen321application.support.seedListing
import com.example.cpen321application.support.setAirplaneMode
import com.example.cpen321application.support.tab
import com.example.cpen321application.support.waitForTag
import com.example.cpen321application.support.waitForText
import com.example.cpen321application.support.waitUntilOnline
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Before
import org.junit.Rule
import org.junit.Test

private const val SEE_RECOMMENDATIONS = "See recommendations"
private const val MAX_PRICE = 50
private const val CLOSED_POST_STATUS = 409

// Use Case 3: View Recommendations for a Post. Each test starts with the E2E Seller's open listing "E2E lamp" at
// $30 in the category lamp, at the same place as the tester's request "E2E feed request" that the test creates, so
// the listing meets the request's hard requirements (category, the default 10 km radius and a $50 maximum price).
class ViewRecommendationsTest {
    @get:Rule
    val rule = mainRule()

    // The tester's own open requests that a test closed, to reopen afterwards.
    private var closedRequests: List<String> = emptyList()

    @Before
    fun seed() {
        deleteFeedRequests()
        seedListing()
    }

    @After
    fun cleanUp() {
        setAirplaneMode(false)
        reopenRequests(closedRequests)
        deleteFeedRequests()
        clearSeededConversations()
    }

    // Steps 1-6: from the tester's request, "See recommendations" shows the matching listing with its price,
    // condition, distance and travel time.
    @Test
    fun showsRecommendationsForOwnPost() {
        createFeedRequest(MAX_PRICE)

        rule.openMyRequest()
        rule.click(SEE_RECOMMENDATIONS)

        rule.waitForText("Recommended for: $FEED_REQUEST_TITLE")
        rule.assertSeededListingCard(recommended = true)
    }

    // Step 1, the other way in: picking the request under "Recommended for" in the feed filters.
    @Test
    fun showsRecommendationsPickedInFilters() {
        createFeedRequest(MAX_PRICE)

        rule.openUnfilteredBuyingFeed()
        rule.openFilters()
        rule.waitForTag(FeedTags.FILTER_RECOMMENDED_FOR)
        rule.onNodeWithTag(FeedTags.FILTER_RECOMMENDED_FOR).performClick()
        rule.waitForText(FEED_REQUEST_TITLE)
        rule.onNodeWithText(FEED_REQUEST_TITLE).performClick()
        rule.applyFilters()

        rule.waitForText("Recommended for: $FEED_REQUEST_TITLE")
        rule.assertSeededListingCard(recommended = true)
    }

    // 1a: with no open requests, the filters say there is nothing to get recommendations for.
    @Test
    fun saysWhenThereAreNoOpenPosts() {
        closedRequests = closeOpenRequests()

        rule.openUnfilteredBuyingFeed()
        rule.openFilters()

        rule.waitForText("You have no open posts to get recommendations for")
        rule.assertTagStaysAbsent(FeedTags.FILTER_RECOMMENDED_FOR)
    }

    // 1b: a closed request has no "See recommendations", and the server returns no feed for it.
    @Test
    fun closedPostHasNoRecommendations() {
        val requestId = createFeedRequest(MAX_PRICE)
        closeFeedRequest(requestId)

        rule.openMyRequest()

        rule.onNodeWithText(SEE_RECOMMENDATIONS).assertDoesNotExist()
        assertEquals(CLOSED_POST_STATUS, feedStatus(requestId))
    }

    // 3a: when no other post meets the request's hard requirements, the feed says so and offers "Refresh".
    @Test
    fun saysWhenNothingMatches() {
        createFeedRequest(MAX_PRICE, category = UNMATCHED_CATEGORY)

        rule.openMyRequest()
        rule.click(SEE_RECOMMENDATIONS)

        rule.waitForText("Nothing here yet. Try changing the filters or check back soon.")
        rule.onNodeWithTag(FeedTags.REFRESH).assertExists()
    }

    // 6a: when the server cannot be reached, the feed shows an error with "Retry", which loads it once back online.
    @Test
    fun showsErrorWhenFeedCannotLoad() {
        createFeedRequest(MAX_PRICE)
        rule.openMyRequest()

        setAirplaneMode(true)
        rule.click(SEE_RECOMMENDATIONS)

        rule.waitForText("Couldn't load the feed. Check your connection and try again.")
        rule.onNodeWithTag(FeedTags.RETRY).assertExists()

        setAirplaneMode(false)
        waitUntilOnline()
        rule.onNodeWithTag(FeedTags.RETRY).performClick()
        rule.assertSeededListingCard(recommended = true)
    }
}

// Opens the tester's request "E2E feed request" from My Posts. My Posts loaded when the app started, before the test
// created the request, so switching to "I'm selling" and back reloads it.
private fun MainRule.openMyRequest() {
    tab("My Posts").performClick()
    click("I'm selling")
    click("I'm buying")
    waitForText(FEED_REQUEST_NAME, substring = true)
    onAllNodesWithText(FEED_REQUEST_NAME, substring = true).onFirst().scrolled().performClick()
    // Only the post's own screen says when it was posted.
    waitForText("Posted ", substring = true)
}
