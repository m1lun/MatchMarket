package com.example.cpen321application.matching.view

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.derivedStateOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.example.cpen321application.R
import com.example.cpen321application.matching.model.FeedItem
import com.example.cpen321application.matching.model.Travel
import com.example.cpen321application.matching.viewmodel.FeedUiState
import com.example.cpen321application.shared.view.RemoteImage
import java.text.NumberFormat
import java.util.Locale

private const val LOAD_AHEAD = 5
private const val DESCRIPTION_LINES = 2
private val PHOTO_SIZE = 72.dp

object FeedTags {
    const val RETRY = "feed_retry"
    const val REFRESH = "feed_refresh"
    const val MODE_BUYING = "feed_mode_buying"
    const val MODE_SELLING = "feed_mode_selling"
    const val FILTERS = "feed_filters"
    const val CLEAR_RECOMMENDATION = "feed_clear_recommendation"
    const val FILTER_CATEGORY = "feed_filter_category"
    const val FILTER_MIN_PRICE = "feed_filter_min_price"
    const val FILTER_MAX_PRICE = "feed_filter_max_price"
    const val FILTER_ADDRESS = "feed_filter_address"
    const val FILTER_RADIUS = "feed_filter_radius"
    const val FILTER_RECOMMENDED_FOR = "feed_filter_recommended_for"
    const val FILTER_APPLY = "feed_filter_apply"
    const val FILTER_CLEAR = "feed_filter_clear"
}

@Composable
fun FeedScreen(
    state: FeedUiState,
    onLoadMore: () -> Unit,
    onRefresh: () -> Unit,
    onOpen: (FeedItem) -> Unit,
    modifier: Modifier = Modifier
) {
    val nothingShown = state.items.isEmpty()
    when {
        nothingShown && state.loadFailed -> FeedMessage(
            text = stringResource(R.string.feed_error),
            buttonText = stringResource(R.string.btn_retry),
            buttonTag = FeedTags.RETRY,
            onClick = onLoadMore,
            modifier = modifier
        )
        nothingShown && state.endReached -> FeedMessage(
            text = stringResource(R.string.feed_empty),
            buttonText = stringResource(R.string.btn_refresh),
            buttonTag = FeedTags.REFRESH,
            onClick = onRefresh,
            modifier = modifier
        )
        nothingShown -> Box(modifier = modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
            CircularProgressIndicator()
        }
        else -> FeedList(state = state, onLoadMore = onLoadMore, onOpen = onOpen, modifier = modifier)
    }
}

@Composable
private fun FeedList(
    state: FeedUiState,
    onLoadMore: () -> Unit,
    onOpen: (FeedItem) -> Unit,
    modifier: Modifier = Modifier
) {
    val listState = rememberLazyListState()
    val nearEnd by remember {
        derivedStateOf {
            val lastVisible = listState.layoutInfo.visibleItemsInfo.lastOrNull()?.index ?: 0
            lastVisible >= listState.layoutInfo.totalItemsCount - LOAD_AHEAD
        }
    }
    // Asks again each time more posts arrive, so a long scroll keeps loading pages.
    LaunchedEffect(nearEnd, state.items.size) {
        if (nearEnd) onLoadMore()
    }

    LazyColumn(
        state = listState,
        contentPadding = PaddingValues(all = 16.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
        modifier = modifier.fillMaxSize()
    ) {
        items(state.items, key = { it.id }) { item ->
            FeedCard(item, onClick = { onOpen(item) })
        }
        item {
            FeedFooter(state = state, onRetry = onLoadMore)
        }
    }
}

@Composable
private fun FeedFooter(state: FeedUiState, onRetry: () -> Unit) {
    Box(modifier = Modifier.fillMaxWidth(), contentAlignment = Alignment.Center) {
        if (state.isLoading) {
            CircularProgressIndicator()
        } else if (state.loadFailed) {
            OutlinedButton(onClick = onRetry, modifier = Modifier.testTag(FeedTags.RETRY)) {
                Text(text = stringResource(R.string.btn_retry))
            }
        }
    }
}

@Composable
private fun FeedCard(item: FeedItem, onClick: () -> Unit) {
    Card(
        onClick = onClick,
        modifier = Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(16.dp),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceContainerLow),
        elevation = CardDefaults.cardElevation(defaultElevation = 2.dp)
    ) {
        Row(
            modifier = Modifier.padding(all = 12.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(12.dp)
        ) {
            item.photoId?.let {
                RemoteImage(id = it, modifier = Modifier.size(PHOTO_SIZE).clip(RoundedCornerShape(12.dp)))
            }
            FeedCardText(item, modifier = Modifier.weight(1f))
        }
    }
}

@Composable
private fun FeedCardText(item: FeedItem, modifier: Modifier = Modifier) {
    Column(modifier = modifier, verticalArrangement = Arrangement.spacedBy(4.dp)) {
        Text(
            text = item.name,
            style = MaterialTheme.typography.titleMedium,
            fontWeight = FontWeight.SemiBold,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis
        )
        Text(text = priceText(item), style = MaterialTheme.typography.titleLarge)
        Text(
            text = item.category.replaceFirstChar { it.titlecase(Locale.getDefault()) },
            style = MaterialTheme.typography.titleMedium
        )
        detailsText(item)?.let {
            Text(
                text = it,
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )
        }
        if (item.description.isNotBlank()) {
            Text(
                text = item.description,
                style = MaterialTheme.typography.bodyMedium,
                maxLines = DESCRIPTION_LINES,
                overflow = TextOverflow.Ellipsis
            )
        }
    }
}

@Composable
private fun FeedMessage(
    text: String,
    buttonText: String,
    buttonTag: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier
) {
    Column(
        modifier = modifier
            .fillMaxSize()
            .padding(all = 32.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp, Alignment.CenterVertically),
        horizontalAlignment = Alignment.CenterHorizontally
    ) {
        Text(
            text = text,
            style = MaterialTheme.typography.bodyLarge,
            textAlign = TextAlign.Center
        )
        OutlinedButton(onClick = onClick, modifier = Modifier.testTag(buttonTag)) {
            Text(text = buttonText)
        }
    }
}

@Composable
private fun priceText(item: FeedItem): String {
    val price = item.price?.let { NumberFormat.getCurrencyInstance(Locale.CANADA).format(it) }
    return when {
        !item.isRequest -> price.orEmpty()
        price == null -> stringResource(R.string.feed_any_budget)
        else -> stringResource(R.string.feed_budget, price)
    }
}

@Composable
private fun detailsText(item: FeedItem): String? {
    val condition = item.condition?.let { stringResource(R.string.feed_condition, it) }
    val distance = item.distanceKm?.let { stringResource(R.string.feed_distance, it) }
    val travel = item.travel?.let { travelText(it) }
    return listOfNotNull(condition, distance, travel).joinToString(" · ").ifEmpty { null }
}

@Composable
private fun travelText(travel: Travel): String = when (travel) {
    is Travel.Minutes -> when (travel.mode) {
        "bike" -> stringResource(R.string.feed_travel_bike, travel.minutes)
        "drive" -> stringResource(R.string.feed_travel_drive, travel.minutes)
        else -> stringResource(R.string.feed_travel_walk, travel.minutes)
    }
    Travel.NoRoute -> stringResource(R.string.feed_no_route)
    Travel.Unavailable -> stringResource(R.string.feed_travel_unavailable)
}
