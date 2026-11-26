package com.example.cpen321application.messaging.model

import com.example.cpen321application.users.model.SessionManager
import com.example.cpen321application.posts.model.objects
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URLEncoder
import org.json.JSONObject

class MessagesApi(private val sessions: SessionManager) {
    suspend fun conversations(): List<Conversation> =
        JSONObject(request("GET", "/api/conversations")).getJSONArray("conversations").objects().map(::parseConversation)

    // Newest first; `before` is the nextCursor of the previous page.
    suspend fun messages(conversationId: String, before: String?): MessagesPage {
        val query = before?.let { "?before=${URLEncoder.encode(it, "UTF-8")}" }.orEmpty()
        val json = JSONObject(request("GET", "/api/conversations/$conversationId/messages$query"))
        val nextCursor = if (json.isNull("nextCursor")) null else json.getString("nextCursor")
        return MessagesPage(json.getJSONArray("messages").objects().map(::parseMessage), nextCursor)
    }

    // The id of the user's conversation about the post, which is only created if there isn't one yet.
    suspend fun open(target: OfferTarget): String {
        val body = JSONObject().put("postId", target.postId).put("postKind", target.postKind)
        target.myPostId?.let { body.put("myPostId", it) }
        return JSONObject(proposalRequest("/api/conversations", body)).getString("id")
    }

    suspend fun send(conversationId: String, text: String): ChatMessage {
        val body = JSONObject().put("text", text)
        return parseMessage(JSONObject(request("POST", "/api/conversations/$conversationId/messages", body)))
    }

    suspend fun propose(conversationId: String, price: Double, note: String): Proposal {
        val body = JSONObject().put("price", price).put("note", note.trim())
        return parseProposal(JSONObject(proposalRequest("/api/conversations/$conversationId/proposal", body)))
    }

    // The response also has the new deal, which the Deals tab loads itself.
    suspend fun accept(conversationId: String): Proposal =
        parseProposal(JSONObject(proposalRequest("/api/conversations/$conversationId/proposal/accept")).getJSONObject("proposal"))

    suspend fun decline(conversationId: String): Proposal =
        parseProposal(JSONObject(proposalRequest("/api/conversations/$conversationId/proposal/decline")))

    // Like request, but a refusal (4xx) is thrown as a ProposalRejectedException with the server's message.
    private suspend fun proposalRequest(path: String, body: JSONObject? = null): String {
        val result = sessions.authorizedRequest("POST", path, body)
        if (result.code in HttpURLConnection.HTTP_BAD_REQUEST until HttpURLConnection.HTTP_INTERNAL_ERROR) {
            throw ProposalRejectedException(result.errorMessage)
        }
        if (!result.isSuccess) {
            throw IOException("HTTP ${result.code}: ${result.errorMessage}")
        }
        return result.body
    }

    // The body of a successful call; an error status is thrown as an IOException.
    private suspend fun request(method: String, path: String, body: JSONObject? = null): String {
        val result = sessions.authorizedRequest(method, path, body)
        if (!result.isSuccess) {
            throw IOException("HTTP ${result.code}: ${result.errorMessage}")
        }
        return result.body
    }
}

private fun parseConversation(json: JSONObject): Conversation {
    val user = json.getJSONObject("otherUser")
    return Conversation(
        id = json.getString("id"),
        otherUserId = user.getString("id"),
        otherUserName = "${user.optString("firstName")} ${user.optString("lastName")}".trim(),
        listing = json.optPost("listing"),
        request = json.optPost("request"),
        lastMessage = if (json.isNull("lastMessage")) null else json.getJSONObject("lastMessage").getString("text"),
        proposal = if (json.isNull("proposal")) null else parseProposal(json.getJSONObject("proposal"))
    )
}

private fun JSONObject.optPost(key: String): ConversationPost? {
    if (isNull(key)) return null
    val post = getJSONObject(key)
    return ConversationPost(post.getString("id"), post.getString("name"), post.getString("status") == "closed")
}

internal fun parseProposal(json: JSONObject): Proposal = Proposal(
    proposerId = json.getString("proposerId"),
    price = json.getDouble("price"),
    note = json.getString("note"),
    status = ProposalStatus.valueOf(json.getString("status").uppercase())
)

internal fun parseMessage(json: JSONObject): ChatMessage =
    ChatMessage(id = json.getString("id"), senderId = json.getString("senderId"), text = json.getString("text"))
