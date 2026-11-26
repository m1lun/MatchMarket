package com.example.cpen321application.users.view

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowRight
import androidx.compose.material.icons.filled.Edit
import androidx.compose.material.icons.filled.Person
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.painter.ColorPainter
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import coil3.compose.AsyncImage
import com.example.cpen321application.R
import com.example.cpen321application.posts.model.Mode
import com.example.cpen321application.users.model.Profile
import com.example.cpen321application.users.model.Reputation
import com.example.cpen321application.users.viewmodel.ProfileUiState
import com.example.cpen321application.users.viewmodel.ProfileViewModel
import java.time.format.DateTimeFormatter

private val PHOTO_SIZE = 96.dp
private val CARD_SHAPE = RoundedCornerShape(16.dp)
private val MONTH_YEAR = DateTimeFormatter.ofPattern("MMM yyyy")

@Composable
fun ProfileTab(
    viewModel: ProfileViewModel,
    onSignOut: () -> Unit,
    innerPadding: PaddingValues,
    onOpenPosts: (Mode) -> Unit,
) {
    val state = viewModel.state
    // Every visit to the tab reloads the profile, so a change made elsewhere shows up.
    LaunchedEffect(Unit) { viewModel.refresh() }
    LaunchedEffect(state.signedOut) {
        if (state.signedOut) onSignOut()
    }

    Column(modifier = Modifier.fillMaxSize().padding(innerPadding)) {
        Text(
            text = stringResource(R.string.profile_title),
            style = MaterialTheme.typography.headlineMedium,
            fontWeight = FontWeight.SemiBold,
            modifier = Modifier.padding(start = 16.dp, top = 16.dp, end = 16.dp),
        )
        Box(modifier = Modifier.weight(1f).fillMaxWidth(), contentAlignment = Alignment.Center) {
            when {
                state.profile != null -> ProfileDetails(state, state.profile, onOpenPosts, viewModel::openAddressEditor)
                state.loadFailed -> RetryMessage(viewModel::refresh)
                else -> CircularProgressIndicator()
            }
        }
        // Stays reachable when the profile cannot load, so the user is never stuck.
        OutlinedButton(onClick = onSignOut, modifier = Modifier.fillMaxWidth().padding(16.dp)) {
            Text(stringResource(R.string.profile_sign_out))
        }
    }
    viewModel.addressEditor?.let { ProfileAddressDialog(it, hasAddress = state.profile?.home != null, viewModel) }
}

@Composable
private fun ProfileDetails(
    state: ProfileUiState,
    profile: Profile,
    onOpenPosts: (Mode) -> Unit,
    onEditAddress: () -> Unit,
) {
    Column(
        modifier = Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        ProfilePhoto(profile.pictureUrl)
        Column(horizontalAlignment = Alignment.CenterHorizontally) {
            Text(profile.displayName, style = MaterialTheme.typography.titleLarge)
            Text(
                profile.email,
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            state.reputation?.let { RatingText(it) }
        }
        ProfileCard(modifier = Modifier.fillMaxWidth()) {
            DetailRow(
                stringResource(R.string.profile_address),
                profile.home?.label ?: stringResource(R.string.profile_address_not_set),
                onEdit = onEditAddress,
            )
            DetailRow(stringResource(R.string.profile_member_since), profile.memberSince.format(MONTH_YEAR))
        }
        Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            val listings = pluralStringResource(R.plurals.profile_listings, state.listingCount, state.listingCount)
            val requests = pluralStringResource(R.plurals.profile_requests, state.requestCount, state.requestCount)
            // Same order as the Buying / Selling switch in My Posts.
            PostsCard(Mode.BUYING, requests, onOpenPosts, Modifier.weight(1f))
            PostsCard(Mode.SELLING, listings, onOpenPosts, Modifier.weight(1f))
        }
    }
}

// Same look as the deal cards.
@Composable
private fun ProfileCard(modifier: Modifier = Modifier, content: @Composable () -> Unit) {
    Card(modifier = modifier, shape = CARD_SHAPE, colors = cardColors(), elevation = cardElevation()) {
        Column(modifier = Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) { content() }
    }
}

// Opens My Posts on the matching side: Selling for listings, Buying for requests.
@Composable
private fun PostsCard(mode: Mode, count: String, onOpenPosts: (Mode) -> Unit, modifier: Modifier) {
    Card(
        onClick = { onOpenPosts(mode) },
        modifier = modifier,
        shape = CARD_SHAPE,
        colors = cardColors(),
        elevation = cardElevation(),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.padding(start = 12.dp, top = 12.dp, end = 4.dp)) {
            Text(stringResource(mode.tabLabel), style = MaterialTheme.typography.titleMedium, modifier = Modifier.weight(1f))
            Icon(
                Icons.AutoMirrored.Filled.KeyboardArrowRight,
                contentDescription = null,
                tint = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
        Text(
            count,
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.padding(start = 12.dp, end = 12.dp, bottom = 12.dp),
        )
    }
}

@Composable
private fun cardColors() = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceContainerLow)

@Composable
private fun cardElevation() = CardDefaults.cardElevation(defaultElevation = 2.dp)

// Written the same way as a user's score on the deal cards: "★ 4.5 (3)", or "New" before any rating.
@Composable
private fun RatingText(reputation: Reputation) {
    val text = reputation.score?.let { stringResource(R.string.deals_score, it, reputation.ratingCount) }
        ?: stringResource(R.string.deals_score_new)
    Text(text, style = MaterialTheme.typography.titleMedium, modifier = Modifier.padding(top = 4.dp))
}

// The Google photo, or a person icon when the account has none or it fails to load.
@Composable
private fun ProfilePhoto(url: String?) {
    val modifier = Modifier.size(PHOTO_SIZE).clip(CircleShape)
    if (url == null) {
        Box(modifier = modifier.background(MaterialTheme.colorScheme.surfaceVariant), contentAlignment = Alignment.Center) {
            Icon(
                Icons.Filled.Person,
                contentDescription = null,
                tint = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.size(PHOTO_SIZE / 2),
            )
        }
    } else {
        AsyncImage(
            model = url,
            contentDescription = null,
            contentScale = ContentScale.Crop,
            placeholder = ColorPainter(MaterialTheme.colorScheme.surfaceVariant),
            error = ColorPainter(MaterialTheme.colorScheme.surfaceVariant),
            modifier = modifier,
        )
    }
}

@Composable
private fun DetailRow(label: String, value: String, onEdit: (() -> Unit)? = null) {
    val modifier = if (onEdit == null) Modifier else Modifier.clickable(onClick = onEdit)
    Row(
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
        modifier = modifier,
    ) {
        Text(
            label,
            style = MaterialTheme.typography.labelLarge,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.weight(1f),
        )
        Text(value, style = MaterialTheme.typography.bodyLarge, textAlign = TextAlign.End, modifier = Modifier.weight(2f))
        if (onEdit != null) {
            Icon(
                Icons.Filled.Edit,
                contentDescription = stringResource(R.string.profile_address_edit),
                tint = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    }
}

@Composable
private fun RetryMessage(onRetry: () -> Unit) {
    Column(
        modifier = Modifier.padding(32.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Text(
            stringResource(R.string.error_unreachable),
            style = MaterialTheme.typography.bodyLarge,
            textAlign = TextAlign.Center,
        )
        OutlinedButton(onClick = onRetry) { Text(stringResource(R.string.btn_retry)) }
    }
}
