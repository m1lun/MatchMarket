package com.example.cpen321application.components.posts.view

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.MoreVert
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.SegmentedButton
import androidx.compose.material3.SegmentedButtonDefaults
import androidx.compose.material3.SingleChoiceSegmentedButtonRow
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.example.cpen321application.R
import com.example.cpen321application.components.posts.model.Mode
import com.example.cpen321application.components.posts.model.PostSummary
import com.example.cpen321application.components.posts.model.STATUS_OPEN
import com.example.cpen321application.components.posts.viewmodel.PostViewModel
import com.example.cpen321application.shared.view.RemoteImage

@Composable
fun PostScreen(viewModel: PostViewModel, padding: PaddingValues) {
    var pendingDelete by remember { mutableStateOf<PostSummary?>(null) }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .padding(padding)
            .padding(horizontal = 16.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        PostScreenHeader(viewModel)
        if (viewModel.posts.isEmpty() && !viewModel.loading) EmptyPosts()
        LazyColumn(
            modifier = Modifier.weight(1f),
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            items(viewModel.posts, key = { it.id }) { post ->
                PostCard(
                    post,
                    onClick = { viewModel.selected = post },
                    onEdit = { viewModel.startEditing(post) },
                    onToggleStatus = { viewModel.toggleStatus(post) },
                    onDelete = { pendingDelete = post },
                )
            }
        }
        NewPostButton(viewModel)
    }

    pendingDelete?.let { post ->
        DeletePostDialog(
            post.title,
            onConfirm = {
                viewModel.delete(post)
                pendingDelete = null
            },
            onDismiss = { pendingDelete = null },
        )
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun PostScreenHeader(viewModel: PostViewModel) {
    Text(
        stringResource(R.string.posts_title),
        style = MaterialTheme.typography.headlineMedium,
        fontWeight = FontWeight.SemiBold,
        modifier = Modifier.padding(top = 16.dp),
    )
    SingleChoiceSegmentedButtonRow(modifier = Modifier.fillMaxWidth()) {
        Mode.entries.forEachIndexed { index, mode ->
            SegmentedButton(
                selected = viewModel.mode == mode,
                onClick = { viewModel.selectMode(mode) },
                shape = SegmentedButtonDefaults.itemShape(index, Mode.entries.size),
            ) { Text(stringResource(mode.tabLabel)) }
        }
    }
    val heading = if (viewModel.mode == Mode.BUYING) R.string.posts_my_requests else R.string.posts_my_listings
    Text(
        stringResource(heading, viewModel.posts.size),
        style = MaterialTheme.typography.titleMedium,
        color = MaterialTheme.colorScheme.onSurfaceVariant,
    )
}

@Composable
private fun ColumnScope.EmptyPosts() {
    Box(Modifier.weight(1f).fillMaxWidth(), contentAlignment = Alignment.Center) {
        Text(
            stringResource(R.string.posts_empty),
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            textAlign = TextAlign.Center,
        )
    }
}

@Composable
private fun NewPostButton(viewModel: PostViewModel) {
    Button(
        onClick = viewModel::startEditing,
        modifier = Modifier
            .fillMaxWidth()
            .padding(bottom = 16.dp),
    ) {
        Icon(Icons.Filled.Add, contentDescription = null, modifier = Modifier.size(20.dp))
        Spacer(Modifier.width(8.dp))
        Text(stringResource(viewModel.mode.newLabel))
    }
}

/** Asks before deleting a post; [message] is shown under the title. */
@Composable
internal fun DeletePostDialog(message: String, onConfirm: () -> Unit, onDismiss: () -> Unit) {
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(stringResource(R.string.posts_delete_title)) },
        text = { Text(message) },
        confirmButton = { TextButton(onClick = onConfirm) { Text(stringResource(R.string.action_delete)) } },
        dismissButton = { TextButton(onClick = onDismiss) { Text(stringResource(R.string.action_cancel)) } },
    )
}

@Composable
private fun PostCard(
    post: PostSummary,
    onClick: () -> Unit,
    onEdit: () -> Unit,
    onToggleStatus: () -> Unit,
    onDelete: () -> Unit,
) {
    Card(
        onClick = onClick,
        modifier = Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(16.dp),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceContainerLow),
        elevation = CardDefaults.cardElevation(defaultElevation = 2.dp),
    ) {
        Row(
            modifier = Modifier.padding(12.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            post.detail.photoIds.firstOrNull()?.let {
                RemoteImage(id = it, modifier = Modifier.size(72.dp).clip(RoundedCornerShape(12.dp)))
            }
            Column(modifier = Modifier.weight(1f)) {
                Text(
                    post.title,
                    style = MaterialTheme.typography.titleMedium,
                    fontWeight = FontWeight.SemiBold,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
                Text(
                    post.subtitle,
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                Spacer(Modifier.height(8.dp))
                StatusChip(post.status)
            }
            PostCardMenu(post, onEdit, onToggleStatus, onDelete)
        }
    }
}

@Composable
private fun PostCardMenu(
    post: PostSummary,
    onEdit: () -> Unit,
    onToggleStatus: () -> Unit,
    onDelete: () -> Unit,
) {
    var menu by remember { mutableStateOf(false) }
    val choose = { action: () -> Unit ->
        menu = false
        action()
    }
    Box {
        IconButton(onClick = { menu = true }) {
            Icon(Icons.Filled.MoreVert, contentDescription = stringResource(R.string.cd_more_options))
        }
        DropdownMenu(expanded = menu, onDismissRequest = { menu = false }) {
            DropdownMenuItem(text = { Text(stringResource(R.string.action_edit)) }, onClick = { choose(onEdit) })
            DropdownMenuItem(
                text = {
                    val action = if (post.status == STATUS_OPEN) R.string.action_close else R.string.action_reopen
                    Text(stringResource(action))
                },
                onClick = { choose(onToggleStatus) },
            )
            DropdownMenuItem(text = { Text(stringResource(R.string.action_delete)) }, onClick = { choose(onDelete) })
        }
    }
}
