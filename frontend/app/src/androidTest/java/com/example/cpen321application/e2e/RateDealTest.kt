package com.example.cpen321application.e2e

import androidx.compose.ui.test.assertIsEnabled
import androidx.compose.ui.test.assertIsNotEnabled
import androidx.compose.ui.test.onAllNodesWithTag
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performTextInput
import com.example.cpen321application.deals.DealsTags
import com.example.cpen321application.deals.RateTags
import com.example.cpen321application.support.clearSeededDeals
import com.example.cpen321application.support.mainRule
import com.example.cpen321application.support.myStars
import com.example.cpen321application.support.openDeals
import com.example.cpen321application.support.pickStars
import com.example.cpen321application.support.rateThroughApi
import com.example.cpen321application.support.reopenDeals
import com.example.cpen321application.support.seedDeal
import com.example.cpen321application.support.setAirplaneMode
import com.example.cpen321application.support.tapRateOnSeededDeal
import com.example.cpen321application.support.waitForRateButton
import com.example.cpen321application.support.waitForText
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Rule
import org.junit.Test

// Use Case 2: Rate a Deal. Each test starts with a new seeded deal.
class RateDealTest {
    @get:Rule
    val rule = mainRule()

    private lateinit var dealId: String

    @Before
    fun seed() {
        dealId = seedDeal()
    }

    @After
    fun cleanUp() {
        setAirplaneMode(false)
        clearSeededDeals()
    }

    // Steps 1–7
    @Test
    fun ratesDeal() {
        rule.openDeals()
        rule.waitForRateButton()

        rule.tapRateOnSeededDeal()
        for (star in 1..5) rule.onNodeWithTag("${RateTags.STAR_PREFIX}$star").assertExists()
        rule.onNodeWithTag(RateTags.COMMENT).assertExists()

        rule.pickStars(4)
        rule.onNodeWithTag(RateTags.COMMENT).performTextInput("Smooth deal")
        rule.onNodeWithTag(RateTags.SUBMIT).performClick()

        rule.waitForText("Smooth deal", substring = true)
        rule.waitForText("★★★★☆")
        rule.waitForText("★ 4.0 (1)", substring = true)
        assertEquals(4, myStars(dealId))
    }

    // 2a, 2a1
    @Test
    fun showsErrorWhenDealsCannotLoad() {
        setAirplaneMode(true)
        rule.openDeals()

        rule.waitForText("Could not reach the server", substring = true)
        rule.onNodeWithTag(DealsTags.RETRY).assertExists()

        setAirplaneMode(false)
        rule.onNodeWithTag(DealsTags.RETRY).performClick()
        rule.waitForRateButton()
    }

    // 5a, 5a1
    @Test
    fun submitDisabledWithoutStars() {
        rule.openDeals()
        rule.tapRateOnSeededDeal()

        rule.onNodeWithTag(RateTags.SUBMIT).assertIsNotEnabled()
        rule.onNodeWithTag(RateTags.COMMENT).performTextInput("No stars yet")
        rule.onNodeWithTag(RateTags.SUBMIT).assertIsNotEnabled()

        rule.pickStars(3)
        rule.onNodeWithTag(RateTags.SUBMIT).assertIsEnabled()
    }

    // 6a, 6a1
    @Test
    fun rejectsSecondRatingFromAnotherDevice() {
        rule.openDeals()
        rule.tapRateOnSeededDeal()
        rule.pickStars(5)

        // Rated first from another device.
        rateThroughApi(dealId, stars = 2)
        rule.onNodeWithTag(RateTags.SUBMIT).performClick()

        rule.waitForText("You already rated this deal")
        assertEquals(2, myStars(dealId))
        rule.onNodeWithTag(RateTags.CANCEL).performClick()
        rule.reopenDeals()
        rule.waitForText("★★☆☆☆")
    }

    // 6b, 6b1
    @Test
    fun keepsRatingUnsavedWhenServerIsUnreachable() {
        rule.openDeals()
        rule.tapRateOnSeededDeal()
        rule.pickStars(3)

        setAirplaneMode(true)
        rule.onNodeWithTag(RateTags.SUBMIT).performClick()

        rule.waitForText("Could not reach the server", substring = true)
        setAirplaneMode(false)
        assertNull(myStars(dealId))
        rule.onNodeWithTag(RateTags.CANCEL).performClick()
        rule.reopenDeals()
        rule.waitForRateButton()
        assertTrue(rule.onAllNodesWithTag(DealsTags.RATE).fetchSemanticsNodes().isNotEmpty())
    }
}
