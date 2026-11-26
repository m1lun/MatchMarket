package com.example.cpen321application.e2e

import androidx.compose.ui.test.onAllNodesWithTag
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import com.example.cpen321application.components.messaging.view.MessagesTags
import com.example.cpen321application.support.PARTNER_NAME
import com.example.cpen321application.support.MainRule
import com.example.cpen321application.support.SeededConversation
import com.example.cpen321application.support.clearSeededConversations
import com.example.cpen321application.support.dealFor
import com.example.cpen321application.support.mainRule
import com.example.cpen321application.support.openDeals
import com.example.cpen321application.support.openMessages
import com.example.cpen321application.support.partnerAccepts
import com.example.cpen321application.support.partnerSends
import com.example.cpen321application.support.proposeThroughApi
import com.example.cpen321application.support.seedConversation
import com.example.cpen321application.support.waitForTag
import com.example.cpen321application.support.waitForText
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Before
import org.junit.Rule
import org.junit.Test

// Live updates outside the open chat. Each test starts on My Posts, with a seeded conversation about the E2E Seller's
// listing that holds one message from them, and the app's live updates stream connected.
class LiveUpdatesTest {
    @get:Rule
    val rule = mainRule()

    private lateinit var seeded: SeededConversation

    @Before
    fun seed() {
        seeded = seedConversation(messages = 1)
    }

    @After
    fun cleanUp() {
        clearSeededConversations()
    }

    // A message on another tab: a banner, and a dot on the Messages tab and on the conversation, which go away
    // once the conversation is opened.
    @Test
    fun marksNewMessageUnreadOnAnotherTab() {
        waitForLiveConnection()

        partnerSends(seeded.conversationId, NEW_MESSAGE)

        rule.waitForText("$PARTNER_NAME: $NEW_MESSAGE")
        rule.waitForDot(MessagesTags.UNREAD_TAB)
        rule.openMessages()
        rule.waitForDot(MessagesTags.UNREAD_PREFIX + seeded.conversationId)
        rule.waitForText(NEW_MESSAGE)

        rule.onNodeWithTag(MessagesTags.CONVERSATION_PREFIX + seeded.conversationId).performClick()
        rule.waitForTag(MessagesTags.INPUT)
        rule.waitForDotGone(MessagesTags.UNREAD_TAB)
        rule.onNodeWithTag(MessagesTags.BACK).performClick()
        rule.waitForDotGone(MessagesTags.UNREAD_PREFIX + seeded.conversationId)
    }

    // "View" on the banner goes straight to the conversation, with the new message in it.
    @Test
    fun bannerOpensConversation() {
        waitForLiveConnection()

        partnerSends(seeded.conversationId, NEW_MESSAGE)

        rule.waitForText(VIEW)
        rule.onNodeWithText(VIEW).performClick()
        rule.waitForTag(MessagesTags.INPUT)
        rule.waitForText(NEW_MESSAGE)
        rule.waitForDotGone(MessagesTags.UNREAD_TAB)
    }

    // With the inbox on screen, the conversation's last message changes without refreshing.
    @Test
    fun updatesInboxLive() {
        rule.openMessages()
        rule.waitForText(FIRST_MESSAGE)
        waitForLiveConnection()

        partnerSends(seeded.conversationId, NEW_MESSAGE)

        rule.waitForText(NEW_MESSAGE)
        rule.waitForDot(MessagesTags.UNREAD_PREFIX + seeded.conversationId)
    }

    // The other user accepts the user's proposal while the Deals tab is open: a banner, and the deal appears
    // without refreshing.
    @Test
    fun showsDealWhenProposalIsAccepted() {
        proposeThroughApi(seeded.conversationId, PRICE)
        rule.openDeals()
        waitForLiveConnection()

        partnerAccepts(seeded.conversationId)

        rule.waitForText("You bought from $PARTNER_NAME", substring = true)
        rule.waitForText("$PARTNER_NAME accepted your proposal of $25.00")
        assertEquals(PRICE, dealFor(seeded.listingId)?.agreedPrice ?: 0.0, 0.0)
    }

    // The stream connects when the app starts, alongside its first loads; this lets it finish before the other user
    // acts.
    private fun waitForLiveConnection() {
        Thread.sleep(LIVE_CONNECT_MS)
    }

    // Unread dots sit inside the clickable tab and conversation card, which merge their contents into one node.
    private fun MainRule.waitForDot(tag: String) {
        waitUntil(WAIT_MS) { onAllNodesWithTag(tag, useUnmergedTree = true).fetchSemanticsNodes().isNotEmpty() }
    }

    private fun MainRule.waitForDotGone(tag: String) {
        waitUntil(WAIT_MS) { onAllNodesWithTag(tag, useUnmergedTree = true).fetchSemanticsNodes().isEmpty() }
    }

    private companion object {
        const val FIRST_MESSAGE = "Message 1"
        const val NEW_MESSAGE = "Still interested?"
        const val VIEW = "View"
        const val PRICE = 25.0
        const val LIVE_CONNECT_MS = 2_000L
        const val WAIT_MS = 15_000L
    }
}
