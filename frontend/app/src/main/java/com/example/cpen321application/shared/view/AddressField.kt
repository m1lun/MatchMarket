package com.example.cpen321application.shared.view

import androidx.annotation.StringRes
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.size
import androidx.compose.material3.Card
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import com.example.cpen321application.R
import com.example.cpen321application.posts.viewmodel.MIN_ADDRESS_QUERY_LENGTH
import com.example.cpen321application.posts.viewmodel.PostViewModel

@Composable
internal fun AddressField(viewModel: PostViewModel) {
    OutlinedTextField(
        value = viewModel.address,
        onValueChange = viewModel::onAddressChange,
        label = { Text(stringResource(R.string.editor_address)) },
        singleLine = true,
        isError = viewModel.showAddressError,
        trailingIcon = if (viewModel.searchingAddress) {
            { AddressSpinner() }
        } else {
            null
        },
        supportingText = { Text(stringResource(addressHint(viewModel), MIN_ADDRESS_QUERY_LENGTH)) },
        modifier = Modifier.fillMaxWidth(),
    )
    if (viewModel.addressSuggestions.isNotEmpty()) {
        Card(modifier = Modifier.fillMaxWidth()) {
            Column {
                viewModel.addressSuggestions.forEach { suggestion ->
                    TextButton(
                        onClick = { viewModel.pickAddress(suggestion) },
                        modifier = Modifier.fillMaxWidth(),
                    ) {
                        Text(
                            stringResource(R.string.editor_address_suggestion, suggestion.label),
                            modifier = Modifier.fillMaxWidth(),
                            style = MaterialTheme.typography.bodyMedium,
                        )
                    }
                }
            }
        }
    }
}

@Composable
private fun AddressSpinner() {
    val description = stringResource(R.string.cd_searching_address)
    CircularProgressIndicator(
        modifier = Modifier
            .size(20.dp)
            .semantics { contentDescription = description },
        strokeWidth = 2.dp,
    )
}

@StringRes
private fun addressHint(viewModel: PostViewModel): Int = when {
    viewModel.showAddressError -> R.string.editor_address_error
    viewModel.addressConfirmed -> R.string.editor_address_confirmed
    viewModel.addressSuggestions.isNotEmpty() -> R.string.editor_address_pick
    else -> R.string.editor_address_hint
}
