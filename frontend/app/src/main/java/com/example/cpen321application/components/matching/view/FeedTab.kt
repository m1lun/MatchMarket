package com.example.cpen321application.components.matching.view

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.InputChip
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.SegmentedButton
import androidx.compose.material3.SegmentedButtonDefaults
import androidx.compose.material3.SingleChoiceSegmentedButtonRow
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.example.cpen321application.R
import com.example.cpen321application.components.matching.model.FeedFilter
import com.example.cpen321application.components.matching.model.FeedItem
import com.example.cpen321application.components.matching.model.FeedQuery
import com.example.cpen321application.components.matching.viewmodel.FeedViewModel
import com.example.cpen321application.components.posts.model.Mode

@Composable
fun FeedTab(
    viewModel: FeedViewModel,
    onSignedOut: () -> Unit,
    innerPadding: PaddingValues,
    onOpen: (FeedItem) -> Unit,
) {
    val state = viewModel.state
    var editingFilter by remember { mutableStateOf(false) }
    LaunchedEffect(state.signedOut) {
        if (state.signedOut) onSignedOut()
    }

    Column(modifier = Modifier.fillMaxSize().padding(innerPadding)) {
        Column(
            modifier = Modifier.padding(start = 16.dp, top = 16.dp, end = 16.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Text(
                text = stringResource(R.string.feed_title),
                style = MaterialTheme.typography.headlineMedium,
                fontWeight = FontWeight.SemiBold,
            )
            ModeToggle(viewModel.query.mode, viewModel::selectMode)
            FilterBar(
                query = viewModel.query,
                onEdit = {
                    viewModel.loadFilterOptions()
                    editingFilter = true
                },
                onClearRecommendation = { viewModel.applyFilter(viewModel.query.filter, recommendedFor = null) },
            )
        }
        FeedScreen(
            state = state,
            onLoadMore = viewModel::loadMore,
            onRefresh = viewModel::refresh,
            onOpen = onOpen,
            modifier = Modifier.weight(1f),
        )
    }
    if (editingFilter) {
        FeedFilterSheet(viewModel, onDismiss = { editingFilter = false })
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun ModeToggle(selected: Mode, onSelect: (Mode) -> Unit) {
    SingleChoiceSegmentedButtonRow(modifier = Modifier.fillMaxWidth()) {
        Mode.entries.forEachIndexed { index, mode ->
            SegmentedButton(
                selected = selected == mode,
                onClick = { onSelect(mode) },
                shape = SegmentedButtonDefaults.itemShape(index, Mode.entries.size),
                modifier = Modifier.testTag(if (mode == Mode.BUYING) FeedTags.MODE_BUYING else FeedTags.MODE_SELLING),
            ) { Text(stringResource(mode.tabLabel)) }
        }
    }
}

@Composable
private fun FilterBar(query: FeedQuery, onEdit: () -> Unit, onClearRecommendation: () -> Unit) {
    val count = activeFilterCount(query.filter)
    OutlinedButton(onClick = onEdit, modifier = Modifier.testTag(FeedTags.FILTERS)) {
        val label = if (count == 0) {
            stringResource(R.string.feed_filters)
        } else {
            stringResource(R.string.feed_filters_active, count)
        }
        Text(label)
    }
    query.recommendedFor?.let { post ->
        InputChip(
            selected = true,
            onClick = onClearRecommendation,
            label = {
                Text(
                    stringResource(R.string.feed_recommended_for, post.title),
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
            },
            trailingIcon = { Text(stringResource(R.string.feed_clear_recommendation)) },
            modifier = Modifier.fillMaxWidth().testTag(FeedTags.CLEAR_RECOMMENDATION),
        )
    }
}

private fun activeFilterCount(filter: FeedFilter): Int =
    listOf(filter.category, filter.minPrice ?: filter.maxPrice, filter.radiusKm).count { it != null }
