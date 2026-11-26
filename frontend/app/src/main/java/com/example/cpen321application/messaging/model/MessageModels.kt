package com.example.cpen321application.messaging.model

const val MAX_MESSAGE_LENGTH = 1000
const val MAX_NOTE_LENGTH = 300

data class ConversationPost(val id: String, val name: String, val isClosed: Boolean)

data class Conversation(
    val id: String,
    val otherUserId: String,
    val otherUserName: String,
    val listing: ConversationPost?,
    val request: ConversationPost?,
    val lastMessage: String?,
    val proposal: Proposal?
)

enum class ProposalStatus { PENDING, ACCEPTED, DECLINED }

data class Proposal(val proposerId: String, val price: Double, val note: String, val status: ProposalStatus)

// A proposal change the server turned down, e.g. 409 when the post was sold meanwhile; its message is shown as is.
class ProposalRejectedException(message: String) : Exception(message)

// Someone else's post an offer can be sent on. myPostId is the user's post it was recommended for, if any;
// suggestedPrice fills in the offer's price.
data class OfferTarget(val postId: String, val postKind: String, val myPostId: String?, val suggestedPrice: String)

data class ChatMessage(val id: String, val senderId: String, val text: String)

data class MessagesPage(val messages: List<ChatMessage>, val nextCursor: String?)
