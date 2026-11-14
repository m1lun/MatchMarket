package com.example.cpen321application.e2e

import androidx.compose.ui.test.assertIsEnabled
import androidx.compose.ui.test.assertIsNotEnabled
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performTextInput
import com.example.cpen321application.messages.ProposalTags
import com.example.cpen321application.support.SeededConversation
import com.example.cpen321application.support.clearSeededConversations
import com.example.cpen321application.support.enterProposalPrice
import com.example.cpen321application.support.mainRule
import com.example.cpen321application.support.openConversation
import com.example.cpen321application.support.openProposeDialog
import com.example.cpen321application.support.partnerDeclines
import com.example.cpen321application.support.savedProposal
import com.example.cpen321application.support.seedConversation
import com.example.cpen321application.support.setAirplaneMode
import com.example.cpen321application.support.waitForTag
import com.example.cpen321application.support.waitForTagGone
import com.example.cpen321application.support.waitForText
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Before
import org.junit.Rule
import org.junit.Test

// Use case 20: Send a proposal. Each test starts with a seeded conversation about the E2E Seller's listing, with no
// proposal yet.
class SendProposalTest {
    @get:Rule
    val rule = mainRule()

    private lateinit var seeded: SeededConversation

    @Before
    fun seed() {
        seeded = seedConversation(messages = 1)
    }

    @After
    fun cleanUp() {
        setAirplaneMode(false)
        clearSeededConversations()
    }

    // Success: the proposal is shown as waiting, and no other one can be made while it is pending.
    @Test
    fun proposesPrice() {
        rule.openConversation(seeded.conversationId)
        rule.openProposeDialog()

        rule.enterProposalPrice("25")
        rule.onNodeWithTag(ProposalTags.NOTE).performTextInput(NOTE)
        rule.onNodeWithTag(ProposalTags.SEND).performClick()

        rule.waitForText("You proposed $25.00")
        rule.waitForText(NOTE)
        rule.waitForText("Waiting for their answer")
        rule.waitForTagGone(ProposalTags.PROPOSE)
        val proposal = checkNotNull(savedProposal(seeded.conversationId)) { "No proposal was saved" }
        assertEquals(25.0, proposal.price, 0.0)
        assertEquals("pending", proposal.status)
        assertFalse(proposal.isFromPartner)
    }

    // Invalid price: Propose is disabled until the price is a number of at least 0.
    @Test
    fun proposeDisabledForInvalidPrice() {
        rule.openConversation(seeded.conversationId)
        rule.openProposeDialog()

        rule.onNodeWithTag(ProposalTags.SEND).assertIsNotEnabled()
        rule.enterProposalPrice("-1")
        rule.onNodeWithTag(ProposalTags.SEND).assertIsNotEnabled()
        rule.enterProposalPrice("0")
        rule.onNodeWithTag(ProposalTags.SEND).assertIsEnabled()
    }

    // Offline: an error is shown in the dialog, which stays open, and nothing is saved.
    @Test
    fun keepsProposalWhenServerIsUnreachable() {
        rule.openConversation(seeded.conversationId)
        rule.openProposeDialog()
        rule.enterProposalPrice("25")

        setAirplaneMode(true)
        rule.onNodeWithTag(ProposalTags.SEND).performClick()

        rule.waitForText("Could not reach the server", substring = true)
        rule.onNodeWithTag(ProposalTags.PRICE).assertExists()
        setAirplaneMode(false)
        assertNull(savedProposal(seeded.conversationId))
    }

    // The other user declines: "Declined" appears without refreshing, and a new price can be proposed.
    @Test
    fun showsDeclineLiveAndAllowsProposingAgain() {
        rule.openConversation(seeded.conversationId)
        rule.openProposeDialog()
        rule.enterProposalPrice("25")
        rule.onNodeWithTag(ProposalTags.SEND).performClick()
        rule.waitForText("Waiting for their answer")

        partnerDeclines(seeded.conversationId)

        rule.waitForText("Declined")
        rule.waitForTag(ProposalTags.PROPOSE)
        assertEquals("declined", savedProposal(seeded.conversationId)?.status)
    }

    private companion object {
        const val NOTE = "Pick up Friday?"
    }
}
