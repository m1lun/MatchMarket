package com.example.cpen321application.e2e

import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onFirst
import androidx.compose.ui.test.performClick
import com.example.cpen321application.support.back
import com.example.cpen321application.support.clearSeededDeals
import com.example.cpen321application.support.mainRule
import com.example.cpen321application.support.openDeals
import com.example.cpen321application.support.seedDeal
import com.example.cpen321application.support.waitForRateButton
import com.example.cpen321application.support.waitForText
import org.junit.After
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Rule
import org.junit.Test

// Use case 13: View deals (Requirements_and_Design.md, Section 3.4; no formal specification). Each test
// starts from the main screen with one new deal, seeded through the back-end's E2E route: the signed-in
// user sold the closed request "E2E desk" to "E2E Buyer" for $45.
class ViewDealsTest {
    @get:Rule
    val rule = mainRule()

    @Before
    fun seed() {
        seedDeal()
    }

    @After
    fun cleanUp() {
        clearSeededDeals()
    }

    // The deal is listed with its agreed price, the user's role, the other user's score and its request.
    @Test
    fun showsDeal() {
        rule.openDeals()
        rule.waitForRateButton()

        rule.waitForText("$45.00")
        rule.waitForText("You sold to", substring = true)
        rule.waitForText("New", substring = true)
        rule.waitForText("Request")
    }

    // Tapping the deal's request opens it read-only, even though it is closed, and Back returns to the deals.
    @Test
    fun opensRequestOfDeal() {
        rule.openDeals()
        rule.waitForRateButton()

        rule.onAllNodesWithText("Request").onFirst().performClick()

        rule.waitForText("E2E desk")
        rule.waitForText("Closed")
        assertTrue(rule.onAllNodesWithText("Delete").fetchSemanticsNodes().isEmpty())
        assertTrue(rule.onAllNodesWithText("Reopen").fetchSemanticsNodes().isEmpty())

        rule.back()
        rule.waitForRateButton()
    }
}
