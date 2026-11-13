package com.example.cpen321application.e2e

import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.performClick
import com.example.cpen321application.messages.ProposalTags
import com.example.cpen321application.support.SeededConversation
import com.example.cpen321application.support.clearSeededConversations
import com.example.cpen321application.support.dealFor
import com.example.cpen321application.support.mainRule
import com.example.cpen321application.support.openConversation
import com.example.cpen321application.support.partnerProposes
import com.example.cpen321application.support.savedProposal
import com.example.cpen321application.support.seedConversation
import com.example.cpen321application.support.setAirplaneMode
import com.example.cpen321application.support.waitForTag
import com.example.cpen321application.support.waitForText
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Before
import org.junit.Rule
import org.junit.Test

// Use case 22: Decline a proposal. Each test starts with a seeded conversation in which the E2E Seller proposed $20
// for their listing.
class DeclineProposalTest {
    @get:Rule
    val rule = mainRule()

    private lateinit var seeded: SeededConversation

    @Before
    fun seed() {
        seeded = seedConversation(messages = 1)
        partnerProposes(seeded.conversationId, price = 20.0)
    }

    @After
    fun cleanUp() {
        setAirplaneMode(false)
        clearSeededConversations()
    }

    // Success: the proposal shows as declined, no deal is recorded, and either user can propose again.
    @Test
    fun declinesProposal() {
        rule.openConversation(seeded.conversationId)
        rule.waitForText("They proposed $20.00")

        rule.onNodeWithTag(ProposalTags.DECLINE).performClick()

        rule.waitForText("Declined")
        rule.waitForTag(ProposalTags.PROPOSE)
        assertEquals("declined", savedProposal(seeded.conversationId)?.status)
        assertNull(dealFor(seeded.listingId))
    }

    // Offline: an error is shown and the proposal stays pending.
    @Test
    fun keepsProposalPendingWhenServerIsUnreachable() {
        rule.openConversation(seeded.conversationId)
        rule.waitForText("They proposed $20.00")

        setAirplaneMode(true)
        rule.onNodeWithTag(ProposalTags.DECLINE).performClick()

        rule.waitForText("Could not reach the server", substring = true)
        setAirplaneMode(false)
        assertEquals("pending", savedProposal(seeded.conversationId)?.status)
    }
}
