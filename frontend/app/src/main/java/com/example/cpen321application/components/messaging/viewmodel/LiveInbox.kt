package com.example.cpen321application.components.messaging.viewmodel

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import com.example.cpen321application.components.messaging.model.Conversation
import com.example.cpen321application.components.messaging.model.Proposal
import com.example.cpen321application.components.messaging.model.ProposalStatus

// The other user's news in a conversation: a message, or a change to its proposal.
data class LiveNotice(val conversation: Conversation, val message: String?, val proposal: Proposal?)

// What live updates show outside the open chat: which conversations have news the user hasn't seen, a banner while
// the Messages tab isn't on screen, and a count of deals made, so the Deals and My Posts tabs can reload.
// Unread news is only kept while the app runs.
class LiveInbox {
    var unread by mutableStateOf(emptySet<String>())
        private set
    var notice by mutableStateOf<LiveNotice?>(null)
        private set
    var dealsMade by mutableIntStateOf(0)
        private set

    private var messagesTabShown = false
    private var shownChatId: String? = null

    // chatId is the conversation open on the Messages tab, or null for the inbox.
    fun show(messagesTab: Boolean, chatId: String?) {
        messagesTabShown = messagesTab
        shownChatId = chatId
        if (messagesTab && chatId != null) unread = unread - chatId
    }

    fun arrived(news: LiveNotice) {
        if (news.proposal?.status == ProposalStatus.ACCEPTED) dealsMade++
        val id = news.conversation.id
        if (messagesTabShown && shownChatId == id) return
        unread = unread + id
        if (!messagesTabShown) notice = news
    }

    fun noticeShown() {
        notice = null
    }
}

// The conversations with one changed and moved to the top, since the server orders them by latest activity.
// Null when it isn't among them, so the inbox has to be reloaded to show it.
internal fun List<Conversation>.bumped(id: String, change: (Conversation) -> Conversation): List<Conversation>? {
    val found = firstOrNull { it.id == id } ?: return null
    return listOf(change(found)) + filterNot { it.id == id }
}
