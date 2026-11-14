package com.example.cpen321application.support

import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.test.SemanticsMatcher
import androidx.compose.ui.test.hasClickAction
import androidx.compose.ui.test.hasTestTag
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.onAllNodesWithTag
import androidx.compose.ui.test.onFirst
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performTextReplacement
import androidx.compose.ui.text.AnnotatedString
import com.example.cpen321application.feed.FeedTags
import com.example.cpen321application.messages.MessagesTags
import com.example.cpen321application.messages.ProposalTags
import com.example.cpen321application.post.PostDetailTags
import org.json.JSONArray
import org.json.JSONObject

// Helpers for the backend's /api/e2e listing and conversation routes (needs ENABLE_E2E_ROUTES=true). The other user
// in every conversation is the seeded "E2E Seller", who acts through the real conversation routes.
const val PARTNER_NAME = "E2E Seller"
const val SEEDED_LISTING = "E2E lamp"
private const val CONVERSATIONS_PATH = "/api/e2e/conversations"
private const val PARTNER_PATH = "/api/e2e/partner/conversations"
private const val LOAD_WAIT_MS = 15_000L

data class SeededConversation(val listingId: String, val conversationId: String)

data class SavedProposal(val proposerId: String, val price: Double, val status: String) {
    val isFromPartner: Boolean get() = proposerId.startsWith("e2e-partner-")
}

data class SavedDeal(val role: String, val agreedPrice: Double, val otherUser: String)

// Seeds the partner's open listing, with no conversation yet, and returns its id.
fun seedListing(): String =
    JSONObject(send("POST", "/api/e2e/listings").orFail("Seeding a listing").body).getString("listingId")

// Seeds the partner's listing and the user's conversation about it, with that many messages from the partner.
fun seedConversation(messages: Int = 0): SeededConversation {
    val json = JSONObject(send("POST", "$CONVERSATIONS_PATH?messages=$messages").orFail("Seeding a conversation").body)
    return SeededConversation(json.getString("listingId"), json.getString("conversationId"))
}

fun clearSeededConversations() {
    send("DELETE", CONVERSATIONS_PATH).orFail("Removing the seeded conversations")
}

fun partnerSends(conversationId: String, text: String) {
    val body = JSONObject().put("text", text)
    send("POST", "$PARTNER_PATH/$conversationId/messages", body).orFail("The partner sending a message")
}

fun partnerProposes(conversationId: String, price: Double, note: String = "") {
    val body = JSONObject().put("price", price).put("note", note)
    send("POST", "$PARTNER_PATH/$conversationId/proposal", body).orFail("The partner proposing a price")
}

fun partnerDeclines(conversationId: String) {
    send("POST", "$PARTNER_PATH/$conversationId/proposal/decline").orFail("The partner declining the proposal")
}

// Accepts the partner's proposal as the signed-in user, as if from another device.
fun acceptThroughApi(conversationId: String) {
    send("POST", "/api/conversations/$conversationId/proposal/accept").orFail("Accepting the proposal through the API")
}

private fun JSONArray.objects(): List<JSONObject> = (0 until length()).map(::getJSONObject)

private fun getJson(path: String, action: String): JSONObject = JSONObject(send("GET", path).orFail(action).body)

private fun conversationsJson(): List<JSONObject> =
    getJson("/api/conversations", "Loading the conversations").getJSONArray("conversations").objects()

// The user's conversation about the listing, or null.
fun conversationAbout(listingId: String): String? =
    conversationsJson().firstOrNull { it.optJSONObject("listing")?.getString("id") == listingId }?.getString("id")

fun savedProposal(conversationId: String): SavedProposal? {
    val conversation = conversationsJson().first { it.getString("id") == conversationId }
    if (conversation.isNull("proposal")) return null
    val proposal = conversation.getJSONObject("proposal")
    return SavedProposal(proposal.getString("proposerId"), proposal.getDouble("price"), proposal.getString("status"))
}

// The texts of the conversation's messages, oldest first.
fun savedMessages(conversationId: String): List<String> {
    val json = getJson("/api/conversations/$conversationId/messages?limit=50", "Loading the messages")
    return json.getJSONArray("messages").objects().map { it.getString("text") }.reversed()
}

// The user's deal for the listing, or null.
fun dealFor(listingId: String): SavedDeal? {
    val deals = getJson("/api/deals?limit=50", "Loading the deals").getJSONArray("deals").objects()
    val deal = deals.firstOrNull { it.optJSONObject("listing")?.getString("id") == listingId } ?: return null
    val other = deal.getJSONObject("otherUser")
    val otherName = "${other.getString("firstName")} ${other.getString("lastName")}"
    return SavedDeal(deal.getString("role"), deal.getDouble("agreedPrice"), otherName)
}

fun listingStatus(listingId: String): String =
    getJson("/api/feed/listings/$listingId", "Loading the listing").getString("status")

fun MainRule.waitForTag(tag: String) {
    waitUntil(LOAD_WAIT_MS) { onAllNodesWithTag(tag).fetchSemanticsNodes().isNotEmpty() }
}

fun MainRule.waitForTagGone(tag: String) {
    waitUntil(LOAD_WAIT_MS) { onAllNodesWithTag(tag).fetchSemanticsNodes().isEmpty() }
}

fun MainRule.openMessages() {
    tab("Messages").performClick()
}

fun MainRule.openConversation(conversationId: String) {
    openMessages()
    val card = MessagesTags.CONVERSATION_PREFIX + conversationId
    waitForTag(card)
    onNodeWithTag(card).performClick()
    waitForTag(MessagesTags.INPUT)
}

// Opens the seeded listing from the feed. Switching modes reloads the feed, in case it loaded before the seed; the
// feed is newest first, so the first card with the name is the one just seeded.
fun MainRule.openSeededListingFromFeed() {
    tab("Feed").performClick()
    onNodeWithTag(FeedTags.MODE_SELLING).performClick()
    onNodeWithTag(FeedTags.MODE_BUYING).performClick()
    waitForText(SEEDED_LISTING)
    onAllNodes(hasText(SEEDED_LISTING, substring = true) and hasClickAction()).onFirst().performClick()
    waitForTag(PostDetailTags.MESSAGE)
}

private fun messageBoxWith(text: String): SemanticsMatcher {
    val typed = SemanticsMatcher.expectValue(SemanticsProperties.EditableText, AnnotatedString(text))
    return hasTestTag(MessagesTags.INPUT) and typed
}

fun MainRule.assertMessageBox(text: String) {
    onNode(messageBoxWith(text)).assertExists()
}

// The app clears the box only once the server has saved the message.
fun MainRule.waitForEmptyMessageBox() {
    waitUntil(LOAD_WAIT_MS) { onAllNodes(messageBoxWith("")).fetchSemanticsNodes().isNotEmpty() }
}

fun MainRule.openProposeDialog() {
    onNodeWithTag(ProposalTags.PROPOSE).performClick()
    waitForTag(ProposalTags.PRICE)
}

fun MainRule.enterProposalPrice(price: String) {
    onNodeWithTag(ProposalTags.PRICE).performTextReplacement(price)
}
