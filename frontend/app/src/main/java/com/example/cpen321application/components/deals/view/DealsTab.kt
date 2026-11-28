package com.example.cpen321application.components.deals.view

import android.widget.Toast
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.derivedStateOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import com.example.cpen321application.R
import com.example.cpen321application.components.deals.viewmodel.DealsUiState
import com.example.cpen321application.components.deals.viewmodel.DealsViewModel
import com.example.cpen321application.components.posts.model.Mode
import org.json.JSONObject

private const val LOAD_AHEAD = 5
private const val SCRIM_ALPHA = 0.4f
private val PHOTO_SIZE = 56.dp
private val SPINNER_SIZE = 64.dp

object DealsTags {
    const val RETRY = "deals_retry"
    const val REFRESH = "deals_refresh"
    const val RATE = "deals_rate"
    const val EDIT = "deals_edit_rating"
    const val POST_PREFIX = "deals_post_"
    const val MAP = "deals_map"
}

@Composable
fun DealsTab(
    viewModel: DealsViewModel,
    onSignedOut: () -> Unit,
    innerPadding: PaddingValues,
    onOpenPost: (JSONObject, Mode) -> Unit
) {
    val state = viewModel.state
    val context = LocalContext.current
    // Every visit to the tab fetches the first page; the deals already loaded stay on screen meanwhile.
    LaunchedEffect(Unit) { viewModel.refresh() }
    DisposableEffect(Unit) { onDispose { viewModel.stop() } }
    LaunchedEffect(state.signedOut) {
        if (state.signedOut) onSignedOut()
    }
    LaunchedEffect(viewModel.opening.failed) {
        if (viewModel.opening.failed) {
            Toast.makeText(context, R.string.error_unreachable, Toast.LENGTH_SHORT).show()
            viewModel.clearOpenFailure()
        }
    }
    val actions = remember(viewModel, onOpenPost) {
        DealActions(
            onRate = viewModel::startRating,
            onOpenPost = { post, isRequest -> viewModel.openPost(post, isRequest, onOpenPost) },
            location = { viewModel.locations[it.id] },
            loadLocation = viewModel::loadLocation
        )
    }

    Box(modifier = Modifier.fillMaxSize()) {
        Column(modifier = Modifier.fillMaxSize().padding(innerPadding)) {
            Text(
                text = stringResource(R.string.deals_title),
                style = MaterialTheme.typography.headlineMedium,
                fontWeight = FontWeight.SemiBold,
                modifier = Modifier.padding(start = 16.dp, top = 16.dp, end = 16.dp),
            )
            DealsContent(state, viewModel::loadMore, viewModel::refresh, actions, Modifier.weight(1f))
        }
        if (viewModel.rating.isSubmitting || viewModel.opening.isOpening) BusyOverlay()
    }
    if (viewModel.rating.dealId != null) {
        RateDealDialog(viewModel.rating, viewModel::submitRating, viewModel::dismissRating)
    }
}

// Dims the tab and swallows taps while a rating or a post is on its way.
@Composable
private fun BusyOverlay() {
    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(MaterialTheme.colorScheme.scrim.copy(alpha = SCRIM_ALPHA))
            .pointerInput(Unit) {},
        contentAlignment = Alignment.Center
    ) {
        CircularProgressIndicator(modifier = Modifier.size(SPINNER_SIZE))
    }
}

@Composable
private fun DealsContent(
    state: DealsUiState,
    onLoadMore: () -> Unit,
    onRefresh: () -> Unit,
    actions: DealActions,
    modifier: Modifier = Modifier
) {
    val nothingShown = state.deals.isEmpty()
    when {
        nothingShown && state.loadFailed -> DealsMessage(
            text = stringResource(R.string.error_unreachable),
            buttonText = stringResource(R.string.btn_retry),
            buttonTag = DealsTags.RETRY,
            onClick = onRefresh,
            modifier = modifier
        )
        nothingShown && state.endReached -> DealsMessage(
            text = stringResource(R.string.deals_empty),
            buttonText = stringResource(R.string.btn_refresh),
            buttonTag = DealsTags.REFRESH,
            onClick = onRefresh,
            modifier = modifier
        )
        nothingShown -> Box(modifier = modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
            CircularProgressIndicator()
        }
        else -> DealsList(state, onLoadMore, onRefresh, actions, modifier)
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun DealsList(
    state: DealsUiState,
    onLoadMore: () -> Unit,
    onRefresh: () -> Unit,
    actions: DealActions,
    modifier: Modifier = Modifier
) {
    val listState = rememberLazyListState()
    val nearEnd by remember {
        derivedStateOf {
            val lastVisible = listState.layoutInfo.visibleItemsInfo.lastOrNull()?.index ?: 0
            lastVisible >= listState.layoutInfo.totalItemsCount - LOAD_AHEAD
        }
    }
    // Asks again each time more deals arrive, so a long scroll keeps loading pages.
    LaunchedEffect(nearEnd, state.deals.size) {
        if (nearEnd) onLoadMore()
    }
    // A refresh can put newer deals above the first one on screen; scroll up so they are seen.
    LaunchedEffect(state.deals.firstOrNull()?.id) { listState.scrollToItem(0) }

    PullToRefreshBox(isRefreshing = state.isRefreshing, onRefresh = onRefresh, modifier = modifier) {
        LazyColumn(
            state = listState,
            contentPadding = PaddingValues(all = 16.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
            modifier = Modifier.fillMaxSize()
        ) {
            items(state.deals, key = { it.id }) { deal -> DealCard(deal, actions) }
            item { DealsFooter(state, onRetry = onLoadMore) }
        }
    }
}

@Composable
private fun DealsFooter(state: DealsUiState, onRetry: () -> Unit) {
    Box(modifier = Modifier.fillMaxWidth(), contentAlignment = Alignment.Center) {
        if (state.isLoading && !state.isRefreshing) {
            CircularProgressIndicator()
        } else if (state.loadFailed) {
            OutlinedButton(onClick = onRetry, modifier = Modifier.testTag(DealsTags.RETRY)) {
                Text(text = stringResource(R.string.btn_retry))
            }
        }
    }
}

@Composable
private fun DealsMessage(
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
        Text(text = text, style = MaterialTheme.typography.bodyLarge, textAlign = TextAlign.Center)
        OutlinedButton(onClick = onClick, modifier = Modifier.testTag(buttonTag)) {
            Text(text = buttonText)
        }
    }
}
