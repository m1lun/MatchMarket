package com.example.cpen321application.components.messaging.view

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.consumeWindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.automirrored.filled.Send
import androidx.compose.material.icons.filled.ShoppingCart
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.example.cpen321application.R
import com.example.cpen321application.components.messaging.model.ChatMessage
import com.example.cpen321application.components.messaging.model.Conversation
import com.example.cpen321application.components.messaging.model.MAX_MESSAGE_LENGTH
import com.example.cpen321application.components.messaging.viewmodel.ChatState
import com.example.cpen321application.components.messaging.viewmodel.MessagesViewModel

private val BUBBLE_MAX_WIDTH = 280.dp

@Composable
fun ChatScreen(chat: ChatState, viewModel: MessagesViewModel, innerPadding: PaddingValues) {
    BackHandler(onBack = viewModel::closeChat)
    var proposing by rememberSaveable { mutableStateOf(false) }
    val onPropose = if (canPropose(chat.conversation)) ({ proposing = true }) else null
    // The bottom bar's padding already covers part of the keyboard, so it is consumed before imePadding.
    Column(modifier = Modifier.fillMaxSize().padding(innerPadding).consumeWindowInsets(innerPadding).imePadding()) {
        ChatHeader(chat.conversation, viewModel::closeChat, onPropose)
        HorizontalDivider()
        Box(modifier = Modifier.weight(1f)) {
            ChatMessages(chat, viewModel::refreshChat, viewModel::loadEarlier)
        }
        ProposalSection(chat, viewModel, showError = !proposing)
        if (chat.sendFailed) {
            Text(
                text = stringResource(R.string.messages_send_failed),
                color = MaterialTheme.colorScheme.error,
                modifier = Modifier.padding(horizontal = 16.dp),
            )
        }
        MessageInput(chat.isSending, viewModel::send)
    }
    if (proposing) {
        ProposeDialog(
            isBusy = chat.isProposing,
            error = chat.proposalError,
            onPropose = { price, note -> viewModel.propose(price, note) { proposing = false } },
            onDismiss = { proposing = false },
        )
    }
}

@Composable
// onPropose is null while a proposal is pending or accepted, which hides the deal button.
private fun ChatHeader(conversation: Conversation, onBack: () -> Unit, onPropose: (() -> Unit)?) {
    Row(modifier = Modifier.fillMaxWidth().padding(all = 8.dp), verticalAlignment = Alignment.CenterVertically) {
        IconButton(onClick = onBack, modifier = Modifier.testTag(MessagesTags.BACK)) {
            Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = stringResource(R.string.btn_back))
        }
        Column(modifier = Modifier.weight(1f)) {
            Text(text = displayName(conversation), style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
            PostLines(conversation)
        }
        onPropose?.let {
            IconButton(onClick = it, modifier = Modifier.testTag(ProposalTags.PROPOSE)) {
                Icon(Icons.Filled.ShoppingCart, contentDescription = stringResource(R.string.proposal_propose))
            }
        }
    }
}

@Composable
private fun ChatMessages(chat: ChatState, onRetry: () -> Unit, onLoadEarlier: () -> Unit) {
    val nothingShown = chat.messages.isEmpty()
    when {
        nothingShown && chat.isLoading -> Box(modifier = Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
            CircularProgressIndicator()
        }
        nothingShown && chat.loadFailed -> CenteredMessage(stringResource(R.string.error_unreachable)) {
            OutlinedButton(onClick = onRetry, modifier = Modifier.testTag(MessagesTags.RETRY)) {
                Text(text = stringResource(R.string.btn_retry))
            }
        }
        nothingShown -> CenteredMessage(stringResource(R.string.messages_no_messages))
        // reverseLayout puts the first item, the newest message, at the bottom.
        else -> LazyColumn(
            reverseLayout = true,
            contentPadding = PaddingValues(all = 16.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp),
            modifier = Modifier.fillMaxSize(),
        ) {
            items(chat.messages, key = { it.id }) { MessageBubble(it, isMine = it.senderId != chat.conversation.otherUserId) }
            if (chat.nextCursor != null) {
                item {
                    TextButton(onClick = onLoadEarlier, enabled = !chat.isLoading, modifier = Modifier.testTag(MessagesTags.LOAD_EARLIER)) {
                        Text(text = stringResource(R.string.messages_load_earlier))
                    }
                }
            }
        }
    }
}

@Composable
private fun MessageBubble(message: ChatMessage, isMine: Boolean) {
    val colors = MaterialTheme.colorScheme
    Box(modifier = Modifier.fillMaxWidth(), contentAlignment = if (isMine) Alignment.CenterEnd else Alignment.CenterStart) {
        Text(
            text = message.text,
            color = if (isMine) colors.onPrimary else colors.onSurface,
            modifier = Modifier
                .widthIn(max = BUBBLE_MAX_WIDTH)
                .background(if (isMine) colors.primary else colors.surfaceContainerHigh, RoundedCornerShape(16.dp))
                .padding(horizontal = 12.dp, vertical = 8.dp),
        )
    }
}

@Composable
private fun MessageInput(isSending: Boolean, onSend: (String, () -> Unit) -> Unit) {
    var text by rememberSaveable { mutableStateOf("") }
    val canSend = !isSending && text.isNotBlank()
    Row(modifier = Modifier.fillMaxWidth().padding(all = 8.dp), verticalAlignment = Alignment.CenterVertically) {
        OutlinedTextField(
            value = text,
            onValueChange = { text = it.take(MAX_MESSAGE_LENGTH) },
            placeholder = { Text(text = stringResource(R.string.messages_hint)) },
            maxLines = 4,
            modifier = Modifier.weight(1f).testTag(MessagesTags.INPUT),
        )
        IconButton(onClick = { onSend(text) { text = "" } }, enabled = canSend, modifier = Modifier.testTag(MessagesTags.SEND)) {
            Icon(Icons.AutoMirrored.Filled.Send, contentDescription = stringResource(R.string.messages_send))
        }
    }
}
