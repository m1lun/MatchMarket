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

// Use case 13: View deals. Each test starts with a new seeded deal.
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

    // The card shows the price, role, score and request.
    @Test
    fun showsDeal() {
        rule.openDeals()
        rule.waitForRateButton()

        rule.waitForText("$45.00")
        rule.waitForText("You sold to", substring = true)
        rule.waitForText("New", substring = true)
        rule.waitForText("Request")
    }

    // The closed request opens read-only.
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
