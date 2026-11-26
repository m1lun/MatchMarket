package com.example.cpen321application.components.messaging.viewmodel

import android.app.Application
import android.util.Log
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import com.example.cpen321application.R
import com.example.cpen321application.components.messaging.model.ChatMessage
import com.example.cpen321application.components.messaging.model.Conversation
import com.example.cpen321application.components.messaging.model.LiveEvent
import com.example.cpen321application.components.messaging.model.MessagesApi
import com.example.cpen321application.components.messaging.model.OfferTarget
import com.example.cpen321application.components.messaging.model.Proposal
import com.example.cpen321application.components.messaging.model.ProposalRejectedException
import com.example.cpen321application.components.messaging.model.liveEvents
import com.example.cpen321application.components.messaging.model.parseMessage
import com.example.cpen321application.components.messaging.model.parseProposal
import com.example.cpen321application.shared.network.SessionExpiredException
import com.example.cpen321application.components.users.model.SessionManager
import java.io.IOException
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.catch
import kotlinx.coroutines.launch
import org.json.JSONException

private const val TAG = "MessagesViewModel"

data class InboxState(
    val conversations: List<Conversation> = emptyList(),
    val isLoading: Boolean = false,
    val loadFailed: Boolean = false
)

// Messages are newest first, as the backend pages them; the screen shows them bottom-up.
data class ChatState(
    val conversation: Conversation,
    val messages: List<ChatMessage> = emptyList(),
    val nextCursor: String? = null,
    val isLoading: Boolean = false,
    val loadFailed: Boolean = false,
    val isSending: Boolean = false,
    val sendFailed: Boolean = false,
    val isProposing: Boolean = false,
    val proposalError: String? = null
)

data class OfferState(val isSending: Boolean = false, val error: String? = null)

class MessagesViewModel(app: Application) : AndroidViewModel(app) {
    private val sessions = SessionManager.get(app)
    private val api = MessagesApi(sessions)
    private var chatJob: Job? = null
    private var liveJob: Job? = null

    var inbox by mutableStateOf(InboxState())
        private set
    var chat by mutableStateOf<ChatState?>(null)
        private set
    var signedOut by mutableStateOf(false)
        private set

    val live = LiveInbox()

    // The post the open post screen can send an offer on: null when it wasn't opened from the feed.
    var offerTarget by mutableStateOf<OfferTarget?>(null)
    var offer by mutableStateOf(OfferState())
        private set

    fun refreshInbox() {
        viewModelScope.launch { loadInbox() }
    }

    private suspend fun loadInbox() {
        inbox = inbox.copy(isLoading = true, loadFailed = false)
        val conversations = call("load conversations") { api.conversations() }
        inbox = if (conversations == null) {
            inbox.copy(isLoading = false, loadFailed = true)
        } else {
            InboxState(conversations)
        }
    }

    fun openChat(conversation: Conversation) {
        chat = ChatState(conversation)
        refreshChat()
    }

    fun closeChat() {
        chatJob?.cancel()
        chat = null
    }

    // One stream while the app is on screen. Each connection, including the first, reloads what it may have missed.
    fun startLiveUpdates() {
        if (liveJob?.isActive == true) return
        liveJob = viewModelScope.launch {
            liveEvents(sessions)
                .catch { if (it is SessionExpiredException) signedOut = true else throw it }
                .collect { event ->
                    if (event.type == LiveEvent.CONNECTED) {
                        refreshInbox()
                        if (chat != null) refreshChat()
                    } else {
                        applyLiveEvent(event)
                    }
                }
        }
    }

    fun stopLiveUpdates() {
        liveJob?.cancel()
    }

    // The other user's new message or proposal change: it updates the open chat and the inbox, and tells LiveInbox.
    // A conversation the inbox doesn't have yet, such as one the other user just started, reloads the inbox first.
    private fun applyLiveEvent(event: LiveEvent) {
        try {
            val id = event.data.getString("conversationId")
            val message = if (event.type == LiveEvent.MESSAGE_CREATED) parseMessage(event.data) else null
            val proposal = when (event.type) {
                LiveEvent.PROPOSAL_UPDATED -> parseProposal(event.data.getJSONObject("proposal"))
                else -> null
            }
            if (message == null && proposal == null) return
            updateChat(id) {
                when {
                    message == null -> it.copy(conversation = it.conversation.copy(proposal = proposal))
                    it.messages.any { m -> m.id == message.id } -> it
                    else -> it.copy(messages = listOf(message) + it.messages)
                }
            }
            val updated = inbox.conversations.bumped(id) {
                it.copy(lastMessage = message?.text ?: it.lastMessage, proposal = proposal ?: it.proposal)
            }
            if (updated != null) {
                inbox = inbox.copy(conversations = updated)
                live.arrived(LiveNotice(updated.first(), message?.text, proposal))
                return
            }
            viewModelScope.launch {
                loadInbox()
                val conversation = inbox.conversations.firstOrNull { it.id == id } ?: return@launch
                live.arrived(LiveNotice(conversation, message?.text, proposal))
            }
        } catch (e: JSONException) {
            Log.w(TAG, "Unexpected live event: ${event.type}", e)
        }
    }

    fun refreshChat() = loadMessages(before = null)

    fun clearOfferError() {
        offer = offer.copy(error = null)
    }

    // Starts the conversation with the offer and opens it, then onSent leaves the post. If the conversation
    // already has a pending offer, this one isn't sent: the chat opens with the server's reason and that offer.
    fun sendOffer(target: OfferTarget, price: Double, note: String, onSent: () -> Unit) {
        if (offer.isSending) return
        viewModelScope.launch {
            offer = OfferState(isSending = true)
            var rejection: String? = null
            var notSent: String? = null
            val conversation = call("send offer") {
                try {
                    val id = api.open(target)
                    try {
                        api.propose(id, price, note)
                    } catch (e: ProposalRejectedException) {
                        notSent = e.message
                    }
                    api.conversations().firstOrNull { it.id == id }
                } catch (e: ProposalRejectedException) {
                    rejection = e.message
                    null
                }
            }
            if (conversation == null) {
                offer = OfferState(error = rejection ?: getApplication<Application>().getString(R.string.error_unreachable))
            } else {
                offer = OfferState()
                openChat(conversation)
                updateChat(conversation.id) { it.copy(proposalError = notSent) }
                onSent()
            }
        }
    }

    fun loadEarlier() {
        chat?.nextCursor?.let { loadMessages(before = it) }
    }

    // onSent clears the text box, so a message that failed to send stays there to try again.
    fun send(text: String, onSent: () -> Unit) {
        val current = chat ?: return
        if (current.isSending) return
        val id = current.conversation.id
        viewModelScope.launch {
            updateChat(id) { it.copy(isSending = true, sendFailed = false) }
            val message = call("send message") { api.send(id, text.trim()) }
            updateChat(id) { it.copy(messages = listOfNotNull(message) + it.messages, isSending = false, sendFailed = message == null) }
            if (message != null) onSent()
        }
    }

    // onDone closes the propose dialog, so a proposal that failed stays there to try again.
    fun propose(price: Double, note: String, onDone: () -> Unit) =
        changeProposal("propose", { api.propose(it, price, note) }, onDone)

    fun acceptProposal() = changeProposal("accept proposal", api::accept)

    fun declineProposal() = changeProposal("decline proposal", api::decline)

    // Saves the server's new proposal on the chat. A refusal shows the server's reason, any other failure "unreachable".
    private fun changeProposal(what: String, action: suspend (String) -> Proposal, onDone: () -> Unit = {}) {
        val current = chat ?: return
        if (current.isProposing) return
        val id = current.conversation.id
        viewModelScope.launch {
            updateChat(id) { it.copy(isProposing = true, proposalError = null) }
            var rejection: String? = null
            val proposal = call(what) {
                try {
                    action(id)
                } catch (e: ProposalRejectedException) {
                    rejection = e.message
                    null
                }
            }
            val unreachable = getApplication<Application>().getString(R.string.error_unreachable)
            updateChat(id) {
                if (proposal == null) {
                    it.copy(isProposing = false, proposalError = rejection ?: unreachable)
                } else {
                    it.copy(conversation = it.conversation.copy(proposal = proposal), isProposing = false)
                }
            }
            if (proposal != null) onDone()
        }
    }

    // A refresh (before = null) replaces the messages; an earlier page is added after the oldest.
    private fun loadMessages(before: String?) {
        val id = chat?.conversation?.id ?: return
        chatJob?.cancel()
        chatJob = viewModelScope.launch {
            updateChat(id) { it.copy(isLoading = true, loadFailed = false) }
            val page = call("load messages") { api.messages(id, before) }
            updateChat(id) {
                when {
                    page == null -> it.copy(isLoading = false, loadFailed = true)
                    before == null -> it.copy(messages = page.messages, nextCursor = page.nextCursor, isLoading = false)
                    else -> it.copy(messages = it.messages + page.messages, nextCursor = page.nextCursor, isLoading = false)
                }
            }
        }
    }

    // Skips the update if the user has left this chat meanwhile.
    private fun updateChat(id: String, change: (ChatState) -> ChatState) {
        chat?.takeIf { it.conversation.id == id }?.let { chat = change(it) }
    }

    // Runs a backend call; null when it failed, which is logged, or when the session is gone.
    private suspend fun <T> call(what: String, block: suspend () -> T): T? = try {
        block()
    } catch (_: SessionExpiredException) {
        signedOut = true
        null
    } catch (e: IOException) {
        Log.w(TAG, "Could not $what", e)
        null
    } catch (e: JSONException) {
        Log.w(TAG, "Unexpected response: $what", e)
        null
    }
}
