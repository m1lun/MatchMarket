package com.example.cpen321application.components.users.view

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import com.example.cpen321application.R
import com.example.cpen321application.components.posts.viewmodel.MIN_ADDRESS_QUERY_LENGTH
import com.example.cpen321application.components.users.viewmodel.AddressEditor
import com.example.cpen321application.components.users.viewmodel.ProfileViewModel

// Sets or removes the home address shown on the profile.
@Composable
fun ProfileAddressDialog(editor: AddressEditor, hasAddress: Boolean, viewModel: ProfileViewModel) {
    AlertDialog(
        onDismissRequest = { if (!editor.saving) viewModel.closeAddressEditor() },
        title = { Text(stringResource(R.string.profile_address_title)) },
        text = { AddressFields(editor, viewModel) },
        confirmButton = {
            TextButton(onClick = viewModel::saveAddress, enabled = editor.picked != null && !editor.saving) {
                Text(stringResource(R.string.profile_address_save))
            }
        },
        dismissButton = {
            Row {
                if (hasAddress) {
                    TextButton(onClick = viewModel::removeAddress, enabled = !editor.saving) {
                        Text(stringResource(R.string.profile_address_remove))
                    }
                }
                TextButton(onClick = viewModel::closeAddressEditor, enabled = !editor.saving) {
                    Text(stringResource(R.string.action_cancel))
                }
            }
        },
    )
}

@Composable
private fun AddressFields(editor: AddressEditor, viewModel: ProfileViewModel) {
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        OutlinedTextField(
            value = editor.text,
            onValueChange = viewModel::onAddressChange,
            label = { Text(stringResource(R.string.profile_address)) },
            supportingText = { Text(hintFor(editor)) },
            enabled = !editor.saving,
            singleLine = true,
            modifier = Modifier.fillMaxWidth(),
        )
        editor.suggestions.forEach { suggestion ->
            TextButton(onClick = { viewModel.pickAddress(suggestion) }, modifier = Modifier.fillMaxWidth()) {
                Text(stringResource(R.string.editor_address_suggestion, suggestion.label), modifier = Modifier.fillMaxWidth())
            }
        }
        if (editor.saveFailed) {
            Text(
                stringResource(R.string.profile_address_save_failed),
                color = MaterialTheme.colorScheme.error,
                style = MaterialTheme.typography.bodyMedium,
            )
        }
    }
}

@Composable
private fun hintFor(editor: AddressEditor): String = when {
    editor.picked != null -> stringResource(R.string.editor_address_confirmed)
    editor.suggestions.isNotEmpty() -> stringResource(R.string.editor_address_pick)
    else -> stringResource(R.string.editor_address_hint, MIN_ADDRESS_QUERY_LENGTH)
}
