package com.example.cpen321application.e2e

import androidx.compose.ui.test.assertIsEnabled
import androidx.compose.ui.test.assertIsNotEnabled
import androidx.compose.ui.test.hasScrollAction
import androidx.compose.ui.test.hasTestTag
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollToNode
import androidx.compose.ui.test.performTextInput
import com.example.cpen321application.messages.MessagesTags
import com.example.cpen321application.support.PARTNER_NAME
import com.example.cpen321application.support.SEEDED_LISTING
import com.example.cpen321application.support.SeededConversation
import com.example.cpen321application.support.assertMessageBox
import com.example.cpen321application.support.clearSeededConversations
import com.example.cpen321application.support.mainRule
import com.example.cpen321application.support.openConversation
import com.example.cpen321application.support.openMessages
import com.example.cpen321application.support.partnerSends
import com.example.cpen321application.support.savedMessages
import com.example.cpen321application.support.seedConversation
import com.example.cpen321application.support.setAirplaneMode
import com.example.cpen321application.support.waitForEmptyMessageBox
import com.example.cpen321application.support.waitForTag
import com.example.cpen321application.support.waitForTagGone
import com.example.cpen321application.support.waitForText
import com.example.cpen321application.support.waitUntilOnline
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Before
import org.junit.Rule
import org.junit.Test

// Use Case 4: Send a Message. Each test starts with a seeded conversation about the E2E Seller's listing, holding one
// message from them. Steps 1–2 and 2a are also the View conversations use case.
class SendMessageTest {
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

    // Steps 1–6
    @Test
    fun sendsMessage() {
        rule.openMessages()
        rule.waitForTag(MessagesTags.CONVERSATION_PREFIX + seeded.conversationId)
        rule.waitForText(PARTNER_NAME)
        rule.waitForText("Listing: $SEEDED_LISTING")
        rule.waitForText(FIRST_MESSAGE)

        rule.onNodeWithTag(MessagesTags.CONVERSATION_PREFIX + seeded.conversationId).performClick()
        rule.waitForTag(MessagesTags.INPUT)
        rule.waitForText(FIRST_MESSAGE)

        rule.onNodeWithTag(MessagesTags.INPUT).performTextInput(MY_MESSAGE)
        rule.onNodeWithTag(MessagesTags.SEND).performClick()

        // The typed text is in the box until the send succeeds, so the box is checked first.
        rule.waitForEmptyMessageBox()
        rule.waitForText(MY_MESSAGE)
        assertEquals(listOf(FIRST_MESSAGE, MY_MESSAGE), savedMessages(seeded.conversationId))
    }

    // Step 4: 30 messages at a time, with "Load earlier messages" for older ones.
    @Test
    fun loadsEarlierMessages() {
        seeded = seedConversation(messages = 40)
        rule.openConversation(seeded.conversationId)
        rule.waitForText("Message 40")

        val messages = rule.onNode(hasScrollAction())
        messages.performScrollToNode(hasTestTag(MessagesTags.LOAD_EARLIER))
        rule.onNodeWithTag(MessagesTags.LOAD_EARLIER).performClick()

        rule.waitForTagGone(MessagesTags.LOAD_EARLIER)
        messages.performScrollToNode(hasText(FIRST_MESSAGE))
        rule.waitForText(FIRST_MESSAGE)
    }

    // 5a, 5a1
    @Test
    fun sendDisabledForBlankMessage() {
        rule.openConversation(seeded.conversationId)

        rule.onNodeWithTag(MessagesTags.SEND).assertIsNotEnabled()
        rule.onNodeWithTag(MessagesTags.INPUT).performTextInput("   ")
        rule.onNodeWithTag(MessagesTags.SEND).assertIsNotEnabled()

        rule.onNodeWithTag(MessagesTags.INPUT).performTextInput("hi")
        rule.onNodeWithTag(MessagesTags.SEND).assertIsEnabled()
    }

    // 2a, 2a1
    @Test
    fun showsErrorWhenConversationsCannotLoad() {
        setAirplaneMode(true)
        rule.openMessages()

        rule.waitForText("Could not reach the server", substring = true)
        rule.onNodeWithTag(MessagesTags.RETRY).assertExists()

        setAirplaneMode(false)
        waitUntilOnline()
        rule.onNodeWithTag(MessagesTags.RETRY).performClick()
        rule.waitForTag(MessagesTags.CONVERSATION_PREFIX + seeded.conversationId)
    }

    // 4a, 4a1
    @Test
    fun showsErrorWhenMessagesCannotLoad() {
        rule.openMessages()
        rule.waitForTag(MessagesTags.CONVERSATION_PREFIX + seeded.conversationId)

        setAirplaneMode(true)
        rule.onNodeWithTag(MessagesTags.CONVERSATION_PREFIX + seeded.conversationId).performClick()

        rule.waitForText("Could not reach the server", substring = true)
        setAirplaneMode(false)
        waitUntilOnline()
        rule.onNodeWithTag(MessagesTags.RETRY).performClick()
        rule.waitForText(FIRST_MESSAGE)
    }

    // 6a, 6a1
    @Test
    fun keepsMessageWhenSendFails() {
        rule.openConversation(seeded.conversationId)
        rule.onNodeWithTag(MessagesTags.INPUT).performTextInput(MY_MESSAGE)

        setAirplaneMode(true)
        rule.onNodeWithTag(MessagesTags.SEND).performClick()

        rule.waitForText("Could not send the message. Try again.")
        rule.assertMessageBox(MY_MESSAGE)
        setAirplaneMode(false)
        assertEquals(listOf(FIRST_MESSAGE), savedMessages(seeded.conversationId))
    }

    // Step 7, seen from the receiving side: the E2E Seller's message appears in the open chat without refreshing.
    @Test
    fun showsOtherUsersMessageLive() {
        rule.openConversation(seeded.conversationId)
        rule.waitForText(FIRST_MESSAGE)
        // The live stream connects alongside the first load; this lets it finish before the other user sends.
        Thread.sleep(LIVE_CONNECT_MS)

        partnerSends(seeded.conversationId, LIVE_MESSAGE)

        rule.waitForText(LIVE_MESSAGE)
    }

    // 7a, 7a1: the connection drops and the other user sends as it comes back; the chat shows the message once the
    // app has reconnected and reloaded.
    @Test
    fun catchesUpAfterReconnecting() {
        rule.openConversation(seeded.conversationId)
        rule.waitForText(FIRST_MESSAGE)

        setAirplaneMode(true)
        setAirplaneMode(false)
        waitUntilOnline()
        partnerSends(seeded.conversationId, OFFLINE_MESSAGE)

        // A stream that went silent while the emulator switched networks is only replaced after the app's 60-second
        // read timeout, and the reload that follows brings the message in.
        rule.waitForText(OFFLINE_MESSAGE, timeoutMs = RECONNECT_WAIT_MS)
    }

    private companion object {
        const val FIRST_MESSAGE = "Message 1"
        const val MY_MESSAGE = "Is it still available?"
        const val LIVE_MESSAGE = "Yes, still available"
        const val OFFLINE_MESSAGE = "Sent while you were offline"
        const val LIVE_CONNECT_MS = 2_000L
        const val RECONNECT_WAIT_MS = 90_000L
    }
}
