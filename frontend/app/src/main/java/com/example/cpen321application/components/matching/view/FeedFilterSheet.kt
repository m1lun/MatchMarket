package com.example.cpen321application.components.matching.view

import androidx.annotation.StringRes
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.SuggestionChip
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.example.cpen321application.R
import com.example.cpen321application.components.matching.model.FeedFilter
import com.example.cpen321application.components.matching.model.OwnPost
import com.example.cpen321application.components.matching.model.Place
import com.example.cpen321application.components.matching.model.plain
import com.example.cpen321application.components.matching.viewmodel.FeedViewModel
import com.example.cpen321application.components.posts.model.Mode

private const val MAX_RADIUS_KM = 100.0
private const val MAX_CATEGORY_SUGGESTIONS = 8

private class FilterDraft(filter: FeedFilter, recommendedFor: OwnPost?) {
    var category by mutableStateOf(filter.category.orEmpty())
    var minPrice by mutableStateOf(filter.minPrice?.let(::plain).orEmpty())
    var maxPrice by mutableStateOf(filter.maxPrice?.let(::plain).orEmpty())
    var address by mutableStateOf(filter.near?.label.orEmpty())
    var place by mutableStateOf(filter.near)
    var radius by mutableStateOf(filter.radiusKm?.let(::plain).orEmpty())
    var recommendedFor by mutableStateOf(recommendedFor)

    // Typing after picking an address means the picked place no longer applies.
    val pickedPlace: Place?
        get() = place?.takeIf { it.label == address }

    @get:StringRes
    val minPriceError: Int?
        get() = priceError(minPrice)

    @get:StringRes
    val maxPriceError: Int?
        get() = priceError(maxPrice) ?: R.string.filter_min_above_max.takeIf { minAboveMax() }

    @get:StringRes
    val radiusError: Int?
        get() {
            val km = radius.toDoubleOrNull()
            return when {
                radius.isBlank() -> null
                km == null || km < 0 || km > MAX_RADIUS_KM -> R.string.filter_bad_radius
                pickedPlace == null && recommendedFor == null -> R.string.filter_needs_address
                else -> null
            }
        }

    val isValid: Boolean
        get() = minPriceError == null && maxPriceError == null && radiusError == null

    // A recommended post fixes the category, so the category filter is dropped.
    fun toFilter() = FeedFilter(
        category = category.trim().takeIf { it.isNotEmpty() && recommendedFor == null },
        minPrice = minPrice.toDoubleOrNull(),
        maxPrice = maxPrice.toDoubleOrNull(),
        near = pickedPlace,
        radiusKm = radius.toDoubleOrNull()
    )

    private fun minAboveMax(): Boolean {
        val min = minPrice.toDoubleOrNull()
        val max = maxPrice.toDoubleOrNull()
        return min != null && max != null && min > max
    }
}

@StringRes
private fun priceError(text: String): Int? {
    if (text.isBlank()) return null
    val price = text.toDoubleOrNull()
    return if (price == null || price < 0) R.string.filter_bad_number else null
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun FeedFilterSheet(viewModel: FeedViewModel, onDismiss: () -> Unit) {
    val query = viewModel.query
    val draft = remember { FilterDraft(query.filter, query.recommendedFor) }
    ModalBottomSheet(onDismissRequest = onDismiss) {
        Column(
            modifier = Modifier
                .verticalScroll(rememberScrollState())
                .padding(start = 16.dp, end = 16.dp, bottom = 24.dp)
                .imePadding(),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Text(stringResource(R.string.filter_title), style = MaterialTheme.typography.titleLarge)
            RecommendedForField(draft, viewModel.ownPosts)
            if (draft.recommendedFor == null) CategoryField(draft, viewModel.categories)
            PriceFields(draft, query.mode)
            DistanceFields(draft, viewModel)
            SheetButtons(
                canApply = draft.isValid,
                onClear = {
                    viewModel.applyFilter(FeedFilter(), recommendedFor = null)
                    onDismiss()
                },
                onApply = {
                    viewModel.applyFilter(draft.toFilter(), draft.recommendedFor)
                    onDismiss()
                },
            )
        }
    }
}

@Composable
private fun RecommendedForField(draft: FilterDraft, ownPosts: List<OwnPost>) {
    var open by remember { mutableStateOf(false) }
    Text(stringResource(R.string.filter_recommended_for), style = MaterialTheme.typography.titleSmall)
    if (ownPosts.isEmpty() && draft.recommendedFor == null) {
        Text(stringResource(R.string.filter_no_open_posts), style = MaterialTheme.typography.bodySmall)
        return
    }
    Box {
        OutlinedButton(
            onClick = { open = true },
            modifier = Modifier.fillMaxWidth().testTag(FeedTags.FILTER_RECOMMENDED_FOR),
        ) {
            Text(
                draft.recommendedFor?.title ?: stringResource(R.string.filter_no_post),
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
        }
        DropdownMenu(expanded = open, onDismissRequest = { open = false }) {
            DropdownMenuItem(
                text = { Text(stringResource(R.string.filter_no_post)) },
                onClick = {
                    draft.recommendedFor = null
                    open = false
                },
            )
            ownPosts.forEach { post ->
                DropdownMenuItem(
                    text = { Text(post.title, maxLines = 1, overflow = TextOverflow.Ellipsis) },
                    onClick = {
                        draft.recommendedFor = post
                        open = false
                    },
                )
            }
        }
    }
}

@Composable
private fun CategoryField(draft: FilterDraft, categories: List<String>) {
    OutlinedTextField(
        value = draft.category,
        onValueChange = { draft.category = it },
        label = { Text(stringResource(R.string.filter_category)) },
        placeholder = { Text(stringResource(R.string.filter_any_category)) },
        singleLine = true,
        modifier = Modifier.fillMaxWidth().testTag(FeedTags.FILTER_CATEGORY),
    )
    val typed = draft.category.trim().lowercase()
    val suggestions = categories
        .filter { it.lowercase().contains(typed) && it.lowercase() != typed }
        .take(MAX_CATEGORY_SUGGESTIONS)
    if (suggestions.isEmpty()) return
    Row(
        modifier = Modifier.horizontalScroll(rememberScrollState()),
        horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        suggestions.forEach { category ->
            SuggestionChip(onClick = { draft.category = category }, label = { Text(category) })
        }
    }
}

@Composable
private fun PriceFields(draft: FilterDraft, mode: Mode) {
    val buying = mode == Mode.BUYING
    Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
        NumberField(
            value = draft.minPrice,
            onValueChange = { draft.minPrice = it },
            label = if (buying) R.string.filter_min_price else R.string.filter_min_budget,
            error = draft.minPriceError,
            modifier = Modifier.weight(1f).testTag(FeedTags.FILTER_MIN_PRICE),
        )
        NumberField(
            value = draft.maxPrice,
            onValueChange = { draft.maxPrice = it },
            label = if (buying) R.string.filter_max_price else R.string.filter_max_budget,
            error = draft.maxPriceError,
            modifier = Modifier.weight(1f).testTag(FeedTags.FILTER_MAX_PRICE),
        )
    }
}

@Composable
private fun DistanceFields(draft: FilterDraft, viewModel: FeedViewModel) {
    val hint = if (draft.recommendedFor == null) R.string.filter_address_hint else R.string.filter_address_from_post
    OutlinedTextField(
        value = draft.address,
        onValueChange = {
            draft.address = it
            viewModel.suggestAddresses(it)
        },
        label = { Text(stringResource(R.string.filter_address)) },
        supportingText = { Text(stringResource(hint)) },
        singleLine = true,
        modifier = Modifier.fillMaxWidth().testTag(FeedTags.FILTER_ADDRESS),
    )
    AddressSuggestions(draft, viewModel)
    NumberField(
        value = draft.radius,
        onValueChange = { draft.radius = it },
        label = R.string.filter_radius,
        error = draft.radiusError,
        modifier = Modifier.fillMaxWidth().testTag(FeedTags.FILTER_RADIUS),
    )
}

@Composable
private fun AddressSuggestions(draft: FilterDraft, viewModel: FeedViewModel) {
    if (viewModel.addressSuggestions.isEmpty()) return
    Card(modifier = Modifier.fillMaxWidth()) {
        viewModel.addressSuggestions.forEach { suggestion ->
            TextButton(
                onClick = {
                    draft.place = Place(suggestion.label, lat = suggestion.latitude, lng = suggestion.longitude)
                    draft.address = suggestion.label
                    viewModel.clearAddressSuggestions()
                },
                modifier = Modifier.fillMaxWidth(),
            ) {
                Text(suggestion.label, modifier = Modifier.fillMaxWidth())
            }
        }
    }
}

@Composable
private fun NumberField(
    value: String,
    onValueChange: (String) -> Unit,
    @StringRes label: Int,
    @StringRes error: Int?,
    modifier: Modifier = Modifier,
) {
    OutlinedTextField(
        value = value,
        onValueChange = onValueChange,
        label = { Text(stringResource(label)) },
        isError = error != null,
        supportingText = error?.let { { Text(stringResource(it)) } },
        singleLine = true,
        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal),
        modifier = modifier,
    )
}

@Composable
private fun SheetButtons(canApply: Boolean, onClear: () -> Unit, onApply: () -> Unit) {
    Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
        OutlinedButton(onClick = onClear, modifier = Modifier.weight(1f).testTag(FeedTags.FILTER_CLEAR)) {
            Text(stringResource(R.string.filter_clear))
        }
        Button(
            onClick = onApply,
            enabled = canApply,
            modifier = Modifier.weight(1f).testTag(FeedTags.FILTER_APPLY),
        ) {
            Text(stringResource(R.string.filter_apply))
        }
    }
}
