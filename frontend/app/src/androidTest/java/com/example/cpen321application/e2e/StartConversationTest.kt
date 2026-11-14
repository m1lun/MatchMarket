package com.example.cpen321application.e2e

import androidx.compose.ui.test.assertIsEnabled
import androidx.compose.ui.test.assertIsNotEnabled
import androidx.compose.ui.test.assertTextContains
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performTextInput
import com.example.cpen321application.messages.ProposalTags
import com.example.cpen321application.post.PostDetailTags
import com.example.cpen321application.support.PARTNER_NAME
import com.example.cpen321application.support.SEEDED_LISTING
import com.example.cpen321application.support.clearSeededConversations
import com.example.cpen321application.support.conversationAbout
import com.example.cpen321application.support.enterProposalPrice
import com.example.cpen321application.support.mainRule
import com.example.cpen321application.support.openSeededListingFromFeed
import com.example.cpen321application.support.savedProposal
import com.example.cpen321application.support.seedListing
import com.example.cpen321application.support.setAirplaneMode
import com.example.cpen321application.support.waitForTag
import com.example.cpen321application.support.waitForText
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Before
import org.junit.Rule
import org.junit.Test

// Use case 14: Start a conversation. Each test starts with the E2E Seller's open listing "E2E lamp" at $30, and no
// conversation about it yet.
class StartConversationTest {
    @get:Rule
    val rule = mainRule()

    private lateinit var listingId: String

    @Before
    fun seed() {
        listingId = seedListing()
    }

    @After
    fun cleanUp() {
        setAirplaneMode(false)
        clearSeededConversations()
    }

    // Success: the first proposal is sent and the conversation opens with it.
    @Test
    fun startsConversationWithProposal() {
        rule.openSeededListingFromFeed()
        rule.onNodeWithTag(PostDetailTags.MESSAGE).performClick()

        rule.waitForTag(ProposalTags.PRICE)
        rule.onNodeWithTag(ProposalTags.PRICE).assertTextContains("30")
        rule.onNodeWithTag(ProposalTags.NOTE).performTextInput(NOTE)
        rule.onNodeWithTag(ProposalTags.SEND).performClick()

        rule.waitForText(PARTNER_NAME)
        rule.waitForText("Listing: $SEEDED_LISTING")
        rule.waitForText("You proposed $30.00")
        rule.waitForText(NOTE)
        rule.waitForText("Waiting for their answer")
        val conversationId = checkNotNull(conversationAbout(listingId)) { "No conversation was started" }
        val proposal = checkNotNull(savedProposal(conversationId)) { "No proposal was saved" }
        assertEquals(30.0, proposal.price, 0.0)
        assertEquals("pending", proposal.status)
        assertFalse(proposal.isFromPartner)
    }

    // Invalid price: Propose is disabled until the price is a number of at least 0.
    @Test
    fun proposeDisabledForInvalidPrice() {
        rule.openSeededListingFromFeed()
        rule.onNodeWithTag(PostDetailTags.MESSAGE).performClick()
        rule.waitForTag(ProposalTags.PRICE)

        rule.enterProposalPrice("abc")
        rule.onNodeWithTag(ProposalTags.SEND).assertIsNotEnabled()
        rule.enterProposalPrice("-5")
        rule.onNodeWithTag(ProposalTags.SEND).assertIsNotEnabled()
        rule.enterProposalPrice("25")
        rule.onNodeWithTag(ProposalTags.SEND).assertIsEnabled()

        rule.onNodeWithTag(ProposalTags.CANCEL).performClick()
        assertNull(conversationAbout(listingId))
    }

    // Offline: an error is shown, the dialog stays open, and no conversation is started.
    @Test
    fun keepsProposalWhenServerIsUnreachable() {
        rule.openSeededListingFromFeed()
        rule.onNodeWithTag(PostDetailTags.MESSAGE).performClick()
        rule.waitForTag(ProposalTags.PRICE)

        setAirplaneMode(true)
        rule.onNodeWithTag(ProposalTags.SEND).performClick()

        rule.waitForText("Could not reach the server", substring = true)
        rule.onNodeWithTag(ProposalTags.PRICE).assertTextContains("30")
        setAirplaneMode(false)
        assertNull(conversationAbout(listingId))
    }

    private companion object {
        const val NOTE = "Can I pick it up today?"
    }
}
