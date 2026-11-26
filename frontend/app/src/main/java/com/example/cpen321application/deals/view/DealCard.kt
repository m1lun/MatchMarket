package com.example.cpen321application.deals.view

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowRight
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.example.cpen321application.R
import com.example.cpen321application.deals.model.Deal
import com.example.cpen321application.deals.model.DealPost
import com.example.cpen321application.deals.model.DealRating
import com.example.cpen321application.deals.model.DealRole
import com.example.cpen321application.deals.model.MAX_STARS
import com.example.cpen321application.deals.model.OtherUser
import com.example.cpen321application.posts.model.titleCase
import com.example.cpen321application.shared.view.RemoteImage
import java.text.NumberFormat
import java.util.Locale

private const val COMMENT_LINES = 2
private val PHOTO_SIZE = 48.dp
private val WHO_WIDTH = 48.dp

// What a tap on a card can do: rate or edit the deal, or open one of its posts (a request when the flag is true).
class DealActions(val onRate: (dealId: String) -> Unit, val onOpenPost: (post: DealPost, isRequest: Boolean) -> Unit)

@Composable
fun DealCard(deal: Deal, actions: DealActions) {
    Card(
        modifier = Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(16.dp),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceContainerLow),
        elevation = CardDefaults.cardElevation(defaultElevation = 2.dp)
    ) {
        Column(modifier = Modifier.padding(all = 12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            DealHeader(deal)
            deal.listing?.let { PostRow(stringResource(R.string.deals_listing), it, showPrice = true) { actions.onOpenPost(it, false) } }
            deal.request?.let { PostRow(stringResource(R.string.deals_request), it, showPrice = false) { actions.onOpenPost(it, true) } }
            HorizontalDivider()
            YourRating(deal, actions.onRate)
            deal.theirRating?.let { RatingLine(stringResource(R.string.deals_them), it) }
        }
    }
}

@Composable
private fun DealHeader(deal: Deal) {
    // Without a name, the card says "the buyer" or "the seller" instead.
    val name = deal.otherUser.name
    val selling = deal.role == DealRole.SELLER
    val role = when {
        name.isBlank() -> stringResource(if (selling) R.string.deals_sold_to else R.string.deals_bought_from)
        selling -> stringResource(R.string.deals_sold_to_name, name)
        else -> stringResource(R.string.deals_bought_from_name, name)
    }
    Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(
                text = deal.title.ifBlank { stringResource(R.string.deals_untitled) },
                style = MaterialTheme.typography.titleLarge,
                modifier = Modifier.weight(1f)
            )
            Text(text = money(deal.agreedPrice), style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
        }
        Text(
            text = "$role · ${scoreText(deal.otherUser)} · ${deal.createdAt}",
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant
        )
    }
}

// Tapping the row opens the post, read-only.
@Composable
private fun PostRow(label: String, post: DealPost, showPrice: Boolean, onClick: () -> Unit) {
    Row(
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(12.dp))
            .clickable(onClick = onClick)
            .padding(vertical = 4.dp)
            .testTag("${DealsTags.POST_PREFIX}${post.id}")
    ) {
        post.photoId?.let {
            RemoteImage(id = it, modifier = Modifier.size(PHOTO_SIZE).clip(RoundedCornerShape(10.dp)))
        }
        Column(modifier = Modifier.weight(1f)) {
            Text(text = label, style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
            val price = post.price?.takeIf { showPrice }?.let { " · ${money(it)}" }.orEmpty()
            Text(text = post.category.titleCase() + price, style = MaterialTheme.typography.titleMedium)
        }
        Icon(Icons.AutoMirrored.Filled.KeyboardArrowRight, contentDescription = null, tint = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}

@Composable
private fun YourRating(deal: Deal, onRate: (String) -> Unit) {
    val mine = deal.myRating
    if (mine == null) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(text = stringResource(R.string.deals_you), style = MaterialTheme.typography.labelLarge, modifier = Modifier.weight(1f))
            OutlinedButton(onClick = { onRate(deal.id) }, modifier = Modifier.testTag(DealsTags.RATE)) {
                Text(text = stringResource(R.string.deals_rate))
            }
        }
    } else {
        RatingLine(stringResource(R.string.deals_you), mine) {
            TextButton(onClick = { onRate(deal.id) }, modifier = Modifier.testTag(DealsTags.EDIT)) {
                Text(text = stringResource(R.string.deals_edit_rating))
            }
        }
    }
}

// Who rated, the stars, then the comment as a short quote that opens up when tapped.
@Composable
private fun RatingLine(who: String, rating: DealRating, action: @Composable () -> Unit = {}) {
    var expanded by rememberSaveable { mutableStateOf(false) }
    Column {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(text = who, style = MaterialTheme.typography.labelLarge, modifier = Modifier.width(WHO_WIDTH))
            Text(text = starsText(rating.stars), style = MaterialTheme.typography.bodyMedium)
            Spacer(modifier = Modifier.weight(1f))
            action()
        }
        if (rating.comment.isNotBlank()) {
            Text(
                text = "“${rating.comment}”",
                style = MaterialTheme.typography.bodyMedium,
                fontStyle = FontStyle.Italic,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                maxLines = if (expanded) Int.MAX_VALUE else COMMENT_LINES,
                overflow = TextOverflow.Ellipsis,
                modifier = Modifier
                    .padding(start = WHO_WIDTH)
                    .clickable { expanded = !expanded }
            )
        }
    }
}

@Composable
private fun scoreText(user: OtherUser): String =
    user.score?.let { stringResource(R.string.deals_score, it, user.ratingCount) }
        ?: stringResource(R.string.deals_score_new)

private fun starsText(stars: Int): String = "★".repeat(stars) + "☆".repeat(MAX_STARS - stars)

internal fun money(amount: Double): String = NumberFormat.getCurrencyInstance(Locale.CANADA).format(amount)
