package com.example.cpen321application.e2e

import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performTextReplacement
import com.example.cpen321application.deals.RateTags
import com.example.cpen321application.support.SavedRating
import com.example.cpen321application.support.clearSeededDeals
import com.example.cpen321application.support.mainRule
import com.example.cpen321application.support.myRating
import com.example.cpen321application.support.openDeals
import com.example.cpen321application.support.pickStars
import com.example.cpen321application.support.rateThroughApi
import com.example.cpen321application.support.reopenDeals
import com.example.cpen321application.support.seedDeal
import com.example.cpen321application.support.setAirplaneMode
import com.example.cpen321application.support.tapEditOnSeededDeal
import com.example.cpen321application.support.waitForText
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Before
import org.junit.Rule
import org.junit.Test

// Use case 15: Edit a rating. Each test starts with a seeded deal rated 4 stars.
class EditRatingTest {
    @get:Rule
    val rule = mainRule()

    private lateinit var dealId: String

    @Before
    fun seed() {
        dealId = seedDeal()
        rateThroughApi(dealId, stars = 4, comment = ORIGINAL_COMMENT)
    }

    @After
    fun cleanUp() {
        setAirplaneMode(false)
        clearSeededDeals()
    }

    // Success: the new rating and score are shown.
    @Test
    fun editsRating() {
        rule.openDeals()
        rule.tapEditOnSeededDeal()

        rule.waitForText("Edit your rating")
        rule.waitForText(ORIGINAL_COMMENT)
        rule.pickStars(2)
        rule.onNodeWithTag(RateTags.COMMENT).performTextReplacement(NEW_COMMENT)
        rule.onNodeWithTag(RateTags.SUBMIT).performClick()

        rule.waitForText(NEW_COMMENT, substring = true)
        rule.waitForText("★★☆☆☆")
        rule.waitForText("★ 2.0 (1)", substring = true)
        assertEquals(SavedRating(2, NEW_COMMENT), myRating(dealId))
    }

    // Offline: an error is shown and the rating is unchanged.
    @Test
    fun keepsRatingWhenEditCannotBeSaved() {
        rule.openDeals()
        rule.tapEditOnSeededDeal()
        rule.pickStars(1)

        setAirplaneMode(true)
        rule.onNodeWithTag(RateTags.SUBMIT).performClick()

        rule.waitForText("Could not reach the server", substring = true)
        setAirplaneMode(false)
        assertEquals(SavedRating(4, ORIGINAL_COMMENT), myRating(dealId))
        rule.onNodeWithTag(RateTags.CANCEL).performClick()
        rule.reopenDeals()
        rule.waitForText("★★★★☆")
    }

    private companion object {
        const val ORIGINAL_COMMENT = "Smooth deal"
        const val NEW_COMMENT = "Late pickup"
    }
}
