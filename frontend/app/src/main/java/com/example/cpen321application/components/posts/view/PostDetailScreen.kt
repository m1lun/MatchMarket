package com.example.cpen321application.components.posts.view

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.pager.HorizontalPager
import androidx.compose.foundation.pager.rememberPagerState
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.Edit
import androidx.compose.material.icons.filled.LocationOn
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.FilledTonalButton
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.IconButtonDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
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
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.example.cpen321application.R
import com.example.cpen321application.components.posts.model.DEFAULT_IMPORTANCE
import com.example.cpen321application.components.posts.model.DetailRow
import com.example.cpen321application.components.posts.model.MAX_IMPORTANCE
import com.example.cpen321application.components.posts.model.Mode
import com.example.cpen321application.components.posts.model.PostDetail
import com.example.cpen321application.components.posts.model.PostSummary
import com.example.cpen321application.components.posts.model.STATUS_OPEN
import com.example.cpen321application.components.posts.viewmodel.PostViewModel
import com.example.cpen321application.shared.view.LocationMap
import com.example.cpen321application.shared.view.RemoteImage

object PostDetailTags {
    const val MESSAGE = "post_detail_message"
    const val MAP = "post_detail_map"
}

/**
 * readOnly shows another user's post (opened from the Feed) without the owner's actions.
 * onMessage, if set, offers to start a conversation about an open post.
 * exactLocation shows the address and a pin; otherwise only the approximate area is shown,
 * until the viewer has a deal for the post.
 */
@Composable
fun PostDetailScreen(
    post: PostSummary,
    mode: Mode,
    viewModel: PostViewModel,
    padding: PaddingValues,
    readOnly: Boolean = false,
    onBack: () -> Unit = { viewModel.selected = null },
    onMessage: (() -> Unit)? = null,
    exactLocation: Boolean = !readOnly,
) {
    var confirmDelete by remember { mutableStateOf(false) }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .padding(padding)
            .verticalScroll(rememberScrollState()),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        DetailHeader(post, mode, onBack = onBack)
        PhotoPager(post.detail.photoIds)
        Column(
            modifier = Modifier.padding(horizontal = 16.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            DetailSummary(post.detail, exactLocation)
            DetailRows(post.detail, mode)
            if (post.detail.createdAt.isNotBlank()) {
                Text(
                    stringResource(R.string.detail_posted, post.detail.createdAt),
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            if (onMessage != null && post.status == STATUS_OPEN) {
                Button(
                    onClick = onMessage,
                    modifier = Modifier.fillMaxWidth().height(48.dp).testTag(PostDetailTags.MESSAGE),
                ) {
                    Text(stringResource(R.string.message_post))
                }
            }
            if (!readOnly && post.status == STATUS_OPEN) {
                Button(
                    onClick = { viewModel.showRecommendations(post) },
                    modifier = Modifier.fillMaxWidth().height(48.dp),
                ) {
                    Text(stringResource(R.string.detail_see_recommendations))
                }
            }
            if (!readOnly) DetailActions(post, viewModel, onDelete = { confirmDelete = true })
        }
    }

    if (confirmDelete) {
        DeletePostDialog(
            stringResource(R.string.posts_delete_message),
            onConfirm = {
                confirmDelete = false
                viewModel.delete(post)
            },
            onDismiss = { confirmDelete = false },
        )
    }
}

@Composable
private fun DetailHeader(post: PostSummary, mode: Mode, onBack: () -> Unit) {
    Row(
        modifier = Modifier.padding(start = 4.dp, end = 16.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        IconButton(onClick = onBack) {
            Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = stringResource(R.string.cd_back))
        }
        Text(
            stringResource(if (mode == Mode.BUYING) R.string.detail_request else R.string.detail_listing),
            style = MaterialTheme.typography.titleLarge,
            modifier = Modifier.weight(1f),
        )
        StatusChip(post.status)
    }
}

@Composable
private fun PhotoPager(photoIds: List<String>) {
    if (photoIds.isEmpty()) return
    val pager = rememberPagerState { photoIds.size }
    HorizontalPager(state = pager, modifier = Modifier.fillMaxWidth().height(260.dp)) { page ->
        RemoteImage(photoIds[page], Modifier.fillMaxSize())
    }
    if (photoIds.size > 1) {
        Text(
            stringResource(R.string.detail_photo_position, pager.currentPage + 1, photoIds.size),
            style = MaterialTheme.typography.labelMedium,
            modifier = Modifier.padding(horizontal = 16.dp),
        )
    }
}

@Composable
private fun DetailSummary(detail: PostDetail, exactLocation: Boolean) {
    Text(
        detail.name,
        style = MaterialTheme.typography.headlineLarge,
        fontWeight = FontWeight.Bold,
    )
    Text(
        detail.category,
        style = MaterialTheme.typography.titleMedium,
        color = MaterialTheme.colorScheme.onSurfaceVariant,
    )
    detail.price?.let {
        Text(
            it,
            style = MaterialTheme.typography.titleLarge,
            fontWeight = FontWeight.SemiBold,
            color = MaterialTheme.colorScheme.primary,
        )
    }
    detail.condition?.let {
        Text(
            stringResource(R.string.detail_condition, it),
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
    }
    AddressBadge(if (exactLocation) detail.address else stringResource(R.string.detail_approximate_area))
    detail.location?.let {
        LocationMap(
            it.latitude,
            it.longitude,
            approximate = !exactLocation,
            modifier = Modifier
                .fillMaxWidth()
                .height(180.dp)
                .clip(RoundedCornerShape(12.dp))
                .testTag(PostDetailTags.MAP),
        )
    }
    if (detail.description.isNotBlank()) {
        Text(detail.description, style = MaterialTheme.typography.bodyLarge)
    }
}

@Composable
private fun AddressBadge(address: String) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(12.dp))
            .background(MaterialTheme.colorScheme.surfaceContainerLow)
            .padding(12.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(
            Icons.Filled.LocationOn,
            contentDescription = null,
            tint = MaterialTheme.colorScheme.primary,
            modifier = Modifier.size(20.dp),
        )
        Spacer(Modifier.width(8.dp))
        Text(
            address,
            style = MaterialTheme.typography.bodyMedium,
            maxLines = 2,
            overflow = TextOverflow.Ellipsis,
        )
    }
}

@Composable
private fun DetailRows(detail: PostDetail, mode: Mode) {
    if (detail.rows.isEmpty()) return
    Text(
        stringResource(if (mode == Mode.BUYING) R.string.fields_requirements else R.string.fields_attributes)
            .uppercase(),
        style = MaterialTheme.typography.labelLarge,
        color = MaterialTheme.colorScheme.onSurfaceVariant,
        letterSpacing = 1.sp,
        modifier = Modifier.padding(top = 8.dp),
    )
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        detail.rows.forEach { DetailLine(it) }
    }
}

@Composable
private fun DetailActions(post: PostSummary, viewModel: PostViewModel, onDelete: () -> Unit) {
    val open = post.status == STATUS_OPEN
    Row(
        horizontalArrangement = Arrangement.spacedBy(8.dp),
        verticalAlignment = Alignment.CenterVertically,
        modifier = Modifier.fillMaxWidth().padding(top = 12.dp, bottom = 24.dp),
    ) {
        Button(onClick = { viewModel.startEditing(post) }, modifier = Modifier.weight(1f).height(48.dp)) {
            Icon(Icons.Filled.Edit, contentDescription = null, modifier = Modifier.size(18.dp))
            Spacer(Modifier.width(8.dp))
            Text(stringResource(R.string.action_edit))
        }
        FilledTonalButton(onClick = { viewModel.toggleStatus(post) }, modifier = Modifier.weight(1f).height(48.dp)) {
            Icon(
                if (open) Icons.Filled.Close else Icons.Filled.Check,
                contentDescription = null,
                modifier = Modifier.size(18.dp),
            )
            Spacer(Modifier.width(8.dp))
            Text(stringResource(if (open) R.string.action_close else R.string.action_reopen))
        }
        IconButton(
            onClick = onDelete,
            colors = IconButtonDefaults.iconButtonColors(
                containerColor = MaterialTheme.colorScheme.errorContainer,
                contentColor = MaterialTheme.colorScheme.onErrorContainer,
            ),
        ) {
            Icon(Icons.Filled.Delete, contentDescription = stringResource(R.string.action_delete))
        }
    }
}

@Composable
private fun DetailLine(row: DetailRow) {
    Card(
        modifier = Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(16.dp),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceContainerLow),
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 16.dp, vertical = 14.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Column(modifier = Modifier.weight(1f)) {
                Text(
                    row.label,
                    style = MaterialTheme.typography.labelMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                Text(
                    row.value,
                    style = MaterialTheme.typography.titleMedium,
                    fontWeight = FontWeight.SemiBold,
                )
            }
            row.hard?.let { hard ->
                Spacer(Modifier.width(12.dp))
                if (hard) {
                    Text(
                        stringResource(R.string.field_must_have),
                        style = MaterialTheme.typography.labelMedium,
                        fontWeight = FontWeight.SemiBold,
                        color = MaterialTheme.colorScheme.onPrimary,
                        modifier = Modifier
                            .clip(RoundedCornerShape(50))
                            .background(MaterialTheme.colorScheme.primary)
                            .padding(horizontal = 10.dp, vertical = 4.dp),
                    )
                } else {
                    ImportanceDots(row.importance ?: DEFAULT_IMPORTANCE)
                }
            }
        }
    }
}

@Composable
private fun ImportanceDots(level: Int) {
    Column(horizontalAlignment = Alignment.End) {
        Text(
            stringResource(R.string.field_nice_to_have),
            style = MaterialTheme.typography.labelSmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        Spacer(Modifier.height(4.dp))
        Row(horizontalArrangement = Arrangement.spacedBy(4.dp)) {
            repeat(MAX_IMPORTANCE) { i ->
                Box(
                    Modifier
                        .size(8.dp)
                        .clip(CircleShape)
                        .background(
                            if (i < level) MaterialTheme.colorScheme.primary
                            else MaterialTheme.colorScheme.outlineVariant,
                        ),
                )
            }
        }
    }
}

@Composable
internal fun StatusChip(status: String) {
    val open = status == STATUS_OPEN
    val container = if (open) MaterialTheme.colorScheme.primaryContainer else MaterialTheme.colorScheme.surfaceVariant
    val content = if (open) MaterialTheme.colorScheme.onPrimaryContainer else MaterialTheme.colorScheme.onSurfaceVariant
    Row(
        modifier = Modifier
            .clip(RoundedCornerShape(50))
            .background(container)
            .padding(horizontal = 12.dp, vertical = 6.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box(Modifier.size(8.dp).clip(CircleShape).background(content))
        Spacer(Modifier.width(6.dp))
        Text(status.replaceFirstChar { it.uppercase() }, style = MaterialTheme.typography.labelLarge, color = content)
    }
}
