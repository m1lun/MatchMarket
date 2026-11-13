package com.example.cpen321application.e2e

import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.performClick
import com.example.cpen321application.messages.ProposalTags
import com.example.cpen321application.support.PARTNER_NAME
import com.example.cpen321application.support.SEEDED_LISTING
import com.example.cpen321application.support.SavedDeal
import com.example.cpen321application.support.SeededConversation
import com.example.cpen321application.support.acceptThroughApi
import com.example.cpen321application.support.clearSeededConversations
import com.example.cpen321application.support.dealFor
import com.example.cpen321application.support.listingStatus
import com.example.cpen321application.support.mainRule
import com.example.cpen321application.support.openConversation
import com.example.cpen321application.support.openDeals
import com.example.cpen321application.support.partnerProposes
import com.example.cpen321application.support.savedProposal
import com.example.cpen321application.support.seedConversation
import com.example.cpen321application.support.setAirplaneMode
import com.example.cpen321application.support.waitForText
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Before
import org.junit.Rule
import org.junit.Test

// Use case 21: Accept a proposal, which includes use case 16: Create deal. Each test starts with a seeded conversation
// in which the E2E Seller proposed $25 for their listing.
class AcceptProposalTest {
    @get:Rule
    val rule = mainRule()

    private lateinit var seeded: SeededConversation

    @Before
    fun seed() {
        seeded = seedConversation(messages = 1)
        partnerProposes(seeded.conversationId, PRICE, NOTE)
    }

    @After
    fun cleanUp() {
        setAirplaneMode(false)
        clearSeededConversations()
    }

    // Success: the deal is recorded at the proposed price, the listing closes, and the deal is in the Deals tab.
    @Test
    fun acceptsProposalAndCreatesDeal() {
        rule.openConversation(seeded.conversationId)
        rule.waitForText("They proposed $25.00")
        rule.waitForText(NOTE)

        rule.onNodeWithTag(ProposalTags.ACCEPT).performClick()

        rule.waitForText("Accepted: the deal is in your Deals tab")
        val expected = SavedDeal(role = "buyer", agreedPrice = PRICE, otherUser = PARTNER_NAME)
        assertEquals(expected, dealFor(seeded.listingId))
        assertEquals("closed", listingStatus(seeded.listingId))
        assertEquals("accepted", savedProposal(seeded.conversationId)?.status)

        rule.openDeals()
        rule.waitForText(SEEDED_LISTING)
        rule.waitForText("$25.00")
        rule.waitForText("You bought from $PARTNER_NAME", substring = true)
    }

    // Already answered on another device: the server's reason is shown and no second deal is recorded.
    @Test
    fun showsErrorWhenAlreadyAnsweredOnAnotherDevice() {
        rule.openConversation(seeded.conversationId)
        rule.waitForText("They proposed $25.00")

        acceptThroughApi(seeded.conversationId)
        rule.onNodeWithTag(ProposalTags.ACCEPT).performClick()

        rule.waitForText("There is no pending proposal")
        assertEquals(PRICE, dealFor(seeded.listingId)?.agreedPrice)
    }

    // Offline: an error is shown, the proposal stays pending, and no deal is recorded.
    @Test
    fun keepsProposalPendingWhenServerIsUnreachable() {
        rule.openConversation(seeded.conversationId)
        rule.waitForText("They proposed $25.00")

        setAirplaneMode(true)
        rule.onNodeWithTag(ProposalTags.ACCEPT).performClick()

        rule.waitForText("Could not reach the server", substring = true)
        setAirplaneMode(false)
        assertEquals("pending", savedProposal(seeded.conversationId)?.status)
        assertNull(dealFor(seeded.listingId))
    }

    private companion object {
        const val PRICE = 25.0
        const val NOTE = "Final price"
    }
}
