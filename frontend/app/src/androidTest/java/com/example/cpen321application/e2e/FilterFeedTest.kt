package com.example.cpen321application.e2e

import androidx.compose.ui.test.assertIsEnabled
import androidx.compose.ui.test.assertIsNotEnabled
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.performClick
import com.example.cpen321application.feed.FeedTags
import com.example.cpen321application.support.MainRule
import com.example.cpen321application.support.SEEDED_LISTING
import com.example.cpen321application.support.TEST_ADDRESS
import com.example.cpen321application.support.UNMATCHED_CATEGORY
import com.example.cpen321application.support.applyFilters
import com.example.cpen321application.support.assertSeededListingCard
import com.example.cpen321application.support.clearSeededConversations
import com.example.cpen321application.support.mainRule
import com.example.cpen321application.support.openFilters
import com.example.cpen321application.support.openUnfilteredBuyingFeed
import com.example.cpen321application.support.pickFilterAddress
import com.example.cpen321application.support.scrolled
import com.example.cpen321application.support.seedListing
import com.example.cpen321application.support.setAirplaneMode
import com.example.cpen321application.support.setFilterField
import com.example.cpen321application.support.waitForText
import com.example.cpen321application.support.waitForTextGone
import com.example.cpen321application.support.waitUntilOnline
import org.junit.After
import org.junit.Before
import org.junit.Rule
import org.junit.Test

private const val NOTHING_HERE = "Nothing here yet. Try changing the filters or check back soon."
private const val FEED_ERROR = "Couldn't load the feed. Check your connection and try again."

// Use Case 5: Filter Feed, on the "I'm buying" side (other users' listings). Each test starts with the E2E Seller's
// open listing "E2E lamp" at $30 in the category lamp, at 6335 Thunderbird Crescent. The feed starts filtered near
// the tester's home address, so each test first clears the filters.
class FilterFeedTest {
    @get:Rule
    val rule = mainRule()

    @Before
    fun seed() {
        seedListing()
    }

    @After
    fun cleanUp() {
        setAirplaneMode(false)
        clearSeededConversations()
    }

    // Steps 1-5 and 5a: category and price filters narrow the feed, a filter nothing passes shows the empty
    // message, and "Clear" brings every post back.
    @Test
    fun filtersByCategoryAndPrice() {
        rule.openUnfilteredBuyingFeed()
        rule.assertSeededListingCard(recommended = false)

        rule.openFilters()
        rule.setFilterField(FeedTags.FILTER_CATEGORY, "lamp")
        rule.setFilterField(FeedTags.FILTER_MIN_PRICE, "20")
        rule.setFilterField(FeedTags.FILTER_MAX_PRICE, "40")
        rule.applyFilters()
        rule.waitForText("Filters (2)")
        rule.assertSeededListingCard(recommended = false)

        rule.openFilters()
        rule.setFilterField(FeedTags.FILTER_MIN_PRICE, "31")
        rule.applyFilters()
        rule.waitForTextGone(SEEDED_LISTING)

        rule.openFilters()
        rule.setFilterField(FeedTags.FILTER_CATEGORY, UNMATCHED_CATEGORY)
        rule.applyFilters()
        rule.waitForText(NOTHING_HERE)
        rule.onNodeWithTag(FeedTags.REFRESH).assertExists()

        rule.openFilters()
        rule.onNodeWithTag(FeedTags.FILTER_CLEAR).scrolled().performClick()
        rule.waitForText("Filters")
        rule.assertSeededListingCard(recommended = false)
    }

    // Step 3, the distance filter: posts within the chosen distance of an address picked from the suggestions.
    @Test
    fun filtersByDistanceFromAddress() {
        rule.openUnfilteredBuyingFeed()

        rule.openFilters()
        rule.setFilterField(FeedTags.FILTER_CATEGORY, "lamp")
        rule.pickFilterAddress(TEST_ADDRESS)
        rule.setFilterField(FeedTags.FILTER_RADIUS, "5")
        rule.applyFilters()

        rule.waitForText("Filters (2)")
        rule.assertSeededListingCard(recommended = false)
    }

    // 3a-3d: each invalid filter shows its message and disables "Apply" until it is fixed.
    @Test
    fun rejectsInvalidFilters() {
        rule.openUnfilteredBuyingFeed()
        rule.openFilters()

        rule.setFilterField(FeedTags.FILTER_MIN_PRICE, "-5")
        rule.assertInvalid("Enter a number of 0 or more")

        rule.setFilterField(FeedTags.FILTER_MIN_PRICE, "50")
        rule.setFilterField(FeedTags.FILTER_MAX_PRICE, "10")
        rule.assertInvalid("Min must not be more than max")

        rule.setFilterField(FeedTags.FILTER_MIN_PRICE, "")
        rule.setFilterField(FeedTags.FILTER_MAX_PRICE, "")
        rule.setFilterField(FeedTags.FILTER_RADIUS, "5")
        rule.assertInvalid("Pick an address to filter by distance")

        rule.setFilterField(FeedTags.FILTER_RADIUS, "150")
        rule.assertInvalid("Enter a distance from 0 to 100")

        rule.setFilterField(FeedTags.FILTER_RADIUS, "")
        rule.onNodeWithTag(FeedTags.FILTER_APPLY).scrolled().assertIsEnabled()
    }

    // 2a: the feed cannot be loaded when the user opens it; "Retry" loads it once back online.
    @Test
    fun showsErrorWhenFeedCannotLoad() {
        rule.openUnfilteredBuyingFeed()

        setAirplaneMode(true)
        rule.onNodeWithTag(FeedTags.MODE_SELLING).performClick()
        rule.onNodeWithTag(FeedTags.MODE_BUYING).performClick()

        rule.assertErrorThenRetry()
    }

    // 5b: the filtered feed cannot be loaded after "Apply"; "Retry" loads it once back online.
    @Test
    fun showsErrorWhenFilteredFeedCannotLoad() {
        rule.openUnfilteredBuyingFeed()
        rule.openFilters()
        rule.setFilterField(FeedTags.FILTER_CATEGORY, "lamp")

        setAirplaneMode(true)
        rule.applyFilters()

        rule.assertErrorThenRetry()
    }
}

private fun MainRule.assertInvalid(message: String) {
    waitForText(message)
    onNodeWithTag(FeedTags.FILTER_APPLY).scrolled().assertIsNotEnabled()
}

private fun MainRule.assertErrorThenRetry() {
    waitForText(FEED_ERROR)
    onNodeWithTag(FeedTags.RETRY).assertExists()

    setAirplaneMode(false)
    waitUntilOnline()
    onNodeWithTag(FeedTags.RETRY).performClick()
    assertSeededListingCard(recommended = false)
}
