package com.example.cpen321application.messaging.view

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.Card
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
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import com.example.cpen321application.R
import com.example.cpen321application.deals.view.money
import com.example.cpen321application.messaging.model.Conversation
import com.example.cpen321application.messaging.model.MAX_NOTE_LENGTH
import com.example.cpen321application.messaging.model.OfferTarget
import com.example.cpen321application.messaging.model.Proposal
import com.example.cpen321application.messaging.model.ProposalStatus
import com.example.cpen321application.messaging.viewmodel.ChatState
import com.example.cpen321application.messaging.viewmodel.MessagesViewModel

object ProposalTags {
    const val PROPOSE = "proposal_propose"
    const val PRICE = "proposal_price"
    const val NOTE = "proposal_note"
    const val SEND = "proposal_send"
    const val CANCEL = "proposal_cancel"
    const val ACCEPT = "proposal_accept"
    const val DECLINE = "proposal_decline"
}

// Proposing is possible until a proposal is pending or accepted.
fun canPropose(conversation: Conversation): Boolean =
    conversation.proposal == null || conversation.proposal.status == ProposalStatus.DECLINED

// The current proposal, if any. The error moves into the dialog while it is open.
@Composable
fun ProposalSection(chat: ChatState, viewModel: MessagesViewModel, showError: Boolean) {
    val proposal = chat.conversation.proposal
    Column(modifier = Modifier.padding(horizontal = 16.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
        proposal?.let {
            val isMine = it.proposerId != chat.conversation.otherUserId
            ProposalCard(it, isMine, chat.isProposing, viewModel::acceptProposal, viewModel::declineProposal)
        }
        if (showError) {
            chat.proposalError?.let { Text(text = it, color = MaterialTheme.colorScheme.error) }
        }
    }
}

@Composable
private fun ProposalCard(proposal: Proposal, isMine: Boolean, isBusy: Boolean, onAccept: () -> Unit, onDecline: () -> Unit) {
    Card(modifier = Modifier.fillMaxWidth()) {
        Column(modifier = Modifier.padding(all = 12.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
            val title = if (isMine) R.string.proposal_yours else R.string.proposal_theirs
            Text(text = stringResource(title, money(proposal.price)), fontWeight = FontWeight.SemiBold)
            if (proposal.note.isNotBlank()) Text(text = proposal.note, style = MaterialTheme.typography.bodyMedium)
            when {
                proposal.status == ProposalStatus.ACCEPTED -> Text(text = stringResource(R.string.proposal_accepted))
                proposal.status == ProposalStatus.DECLINED -> Text(text = stringResource(R.string.proposal_declined))
                isMine -> Text(text = stringResource(R.string.proposal_waiting))
                else -> AnswerButtons(isBusy, onAccept, onDecline)
            }
        }
    }
}

@Composable
private fun AnswerButtons(isBusy: Boolean, onAccept: () -> Unit, onDecline: () -> Unit) {
    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        Button(onClick = onAccept, enabled = !isBusy, modifier = Modifier.testTag(ProposalTags.ACCEPT)) {
            Text(text = stringResource(R.string.proposal_accept))
        }
        OutlinedButton(onClick = onDecline, enabled = !isBusy, modifier = Modifier.testTag(ProposalTags.DECLINE)) {
            Text(text = stringResource(R.string.proposal_decline))
        }
    }
}

// The first offer on a post, sent from the post screen; leaves for the chat once it is sent.
@Composable
fun OfferDialog(target: OfferTarget, viewModel: MessagesViewModel, onSent: () -> Unit, onDismiss: () -> Unit) {
    ProposeDialog(
        isBusy = viewModel.offer.isSending,
        error = viewModel.offer.error,
        initialPrice = target.suggestedPrice,
        onPropose = { price, note -> viewModel.sendOffer(target, price, note, onSent) },
        onDismiss = onDismiss,
    )
}

@Composable
internal fun ProposeDialog(
    isBusy: Boolean,
    error: String?,
    onPropose: (Double, String) -> Unit,
    onDismiss: () -> Unit,
    initialPrice: String = "",
) {
    var price by rememberSaveable { mutableStateOf(initialPrice) }
    var note by rememberSaveable { mutableStateOf("") }
    val parsedPrice = price.toDoubleOrNull()?.takeIf { it >= 0 }
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(text = stringResource(R.string.proposal_propose)) },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                OutlinedTextField(
                    value = price,
                    onValueChange = { price = it },
                    label = { Text(text = stringResource(R.string.proposal_price)) },
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal),
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth().testTag(ProposalTags.PRICE),
                )
                OutlinedTextField(
                    value = note,
                    onValueChange = { note = it.take(MAX_NOTE_LENGTH) },
                    label = { Text(text = stringResource(R.string.proposal_note)) },
                    modifier = Modifier.fillMaxWidth().testTag(ProposalTags.NOTE),
                )
                error?.let { Text(text = it, color = MaterialTheme.colorScheme.error) }
            }
        },
        confirmButton = {
            TextButton(
                onClick = { parsedPrice?.let { onPropose(it, note) } },
                enabled = parsedPrice != null && !isBusy,
                modifier = Modifier.testTag(ProposalTags.SEND),
            ) { Text(text = stringResource(R.string.proposal_send)) }
        },
        dismissButton = {
            TextButton(onClick = onDismiss, modifier = Modifier.testTag(ProposalTags.CANCEL)) {
                Text(text = stringResource(R.string.action_cancel))
            }
        },
    )
}
