package com.example.cpen321application.components.messaging.view

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.example.cpen321application.R
import com.example.cpen321application.components.deals.view.money
import com.example.cpen321application.components.messaging.model.Conversation
import com.example.cpen321application.components.messaging.model.ProposalStatus
import com.example.cpen321application.components.messaging.viewmodel.InboxState
import com.example.cpen321application.components.messaging.viewmodel.MessagesViewModel

object MessagesTags {
    const val REFRESH = "messages_refresh"
    const val RETRY = "messages_retry"
    const val CONVERSATION_PREFIX = "messages_conversation_"
    const val BACK = "chat_back"
    const val LOAD_EARLIER = "chat_load_earlier"
    const val INPUT = "chat_input"
    const val SEND = "chat_send"
}

@Composable
fun MessagesTab(viewModel: MessagesViewModel, onSignedOut: () -> Unit, innerPadding: PaddingValues) {
    LaunchedEffect(viewModel.signedOut) {
        if (viewModel.signedOut) onSignedOut()
    }
    val chat = viewModel.chat
    if (chat != null) {
        ChatScreen(chat, viewModel, innerPadding)
        return
    }
    LaunchedEffect(Unit) { viewModel.refreshInbox() }
    Column(modifier = Modifier.fillMaxSize().padding(innerPadding)) {
        InboxHeader(viewModel::refreshInbox)
        InboxContent(viewModel.inbox, viewModel::refreshInbox, viewModel::openChat)
    }
}

@Composable
private fun InboxHeader(onRefresh: () -> Unit) {
    Box(modifier = Modifier.fillMaxWidth().padding(start = 16.dp, top = 16.dp, end = 8.dp)) {
        Text(
            text = stringResource(R.string.messages_title),
            style = MaterialTheme.typography.headlineMedium,
            fontWeight = FontWeight.SemiBold,
            modifier = Modifier.align(Alignment.CenterStart),
        )
        IconButton(onClick = onRefresh, modifier = Modifier.align(Alignment.CenterEnd).testTag(MessagesTags.REFRESH)) {
            Icon(Icons.Filled.Refresh, contentDescription = stringResource(R.string.btn_refresh))
        }
    }
}

@Composable
private fun InboxContent(inbox: InboxState, onRetry: () -> Unit, onOpen: (Conversation) -> Unit) {
    val nothingShown = inbox.conversations.isEmpty()
    when {
        nothingShown && inbox.isLoading -> Box(modifier = Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
            CircularProgressIndicator()
        }
        nothingShown && inbox.loadFailed -> CenteredMessage(stringResource(R.string.error_unreachable)) {
            OutlinedButton(onClick = onRetry, modifier = Modifier.testTag(MessagesTags.RETRY)) {
                Text(text = stringResource(R.string.btn_retry))
            }
        }
        nothingShown -> CenteredMessage(stringResource(R.string.messages_empty))
        else -> LazyColumn(
            contentPadding = PaddingValues(all = 16.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
            modifier = Modifier.fillMaxSize(),
        ) {
            items(inbox.conversations, key = { it.id }) { ConversationCard(it, onOpen) }
        }
    }
}

@Composable
private fun ConversationCard(conversation: Conversation, onOpen: (Conversation) -> Unit) {
    Card(
        modifier = Modifier
            .fillMaxWidth()
            .testTag(MessagesTags.CONVERSATION_PREFIX + conversation.id)
            .clickable { onOpen(conversation) },
        shape = RoundedCornerShape(16.dp),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceContainerLow),
    ) {
        Column(modifier = Modifier.padding(all = 12.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Text(text = displayName(conversation), style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
            PostLines(conversation)
            val pending = conversation.proposal?.takeIf { it.status == ProposalStatus.PENDING }
            pending?.let {
                val title = if (it.proposerId == conversation.otherUserId) R.string.proposal_theirs else R.string.proposal_yours
                Text(text = stringResource(title, money(it.price)), style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.SemiBold)
            }
            // A pending proposal's note stands in for a first message, until there is one.
            val preview = conversation.lastMessage ?: pending?.note?.takeIf { it.isNotBlank() }
            if (preview != null || pending == null) {
                Text(
                    text = preview ?: stringResource(R.string.messages_no_messages),
                    style = MaterialTheme.typography.bodyMedium,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
            }
        }
    }
}

@Composable
internal fun PostLines(conversation: Conversation) {
    conversation.listing?.let { PostLine(stringResource(R.string.messages_listing, it.name), it.isClosed) }
    conversation.request?.let { PostLine(stringResource(R.string.messages_request, it.name), it.isClosed) }
}

@Composable
private fun PostLine(text: String, isClosed: Boolean) {
    val closed = if (isClosed) " " + stringResource(R.string.messages_post_closed) else ""
    Text(text = text + closed, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
}

@Composable
internal fun displayName(conversation: Conversation): String =
    conversation.otherUserName.ifBlank { stringResource(R.string.messages_unknown_user) }

@Composable
internal fun CenteredMessage(text: String, action: @Composable () -> Unit = {}) {
    Column(
        modifier = Modifier.fillMaxSize().padding(all = 32.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp, Alignment.CenterVertically),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Text(text = text, style = MaterialTheme.typography.bodyLarge)
        action()
    }
}
