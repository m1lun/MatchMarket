package com.example.cpen321application.post

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material3.Button
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ExposedDropdownMenuBox
import androidx.compose.material3.ExposedDropdownMenuDefaults
import androidx.compose.material3.MenuAnchorType
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import com.example.cpen321application.R

@Composable
fun PostEditorScreen(viewModel: PostViewModel, padding: PaddingValues) {
    val seller = viewModel.mode == Mode.SELLING
    var showAddField by remember { mutableStateOf(false) }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .padding(padding)
            .verticalScroll(rememberScrollState())
            .padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        EditorHeader(viewModel, seller)
        OutlinedTextField(
            value = viewModel.name,
            onValueChange = { viewModel.name = it.take(MAX_NAME_LENGTH) },
            label = { Text(stringResource(R.string.editor_name)) },
            singleLine = true,
            modifier = Modifier.fillMaxWidth(),
        )
        SuggestField(
            label = stringResource(R.string.editor_category),
            value = viewModel.category,
            onValueChange = { viewModel.category = it },
            options = viewModel.categories,
        )
        if (seller) SellerFields(viewModel)
        AddressField(viewModel)
        OutlinedTextField(
            value = viewModel.description,
            onValueChange = { viewModel.description = it },
            label = { Text(stringResource(R.string.editor_description)) },
            minLines = 2,
            modifier = Modifier.fillMaxWidth(),
        )
        PhotoRow(viewModel, seller)
        FieldRows(viewModel, seller)
        OutlinedButton(onClick = { showAddField = true }) { Text(stringResource(R.string.editor_add_field)) }
        SubmitButton(viewModel, seller)
    }

    if (showAddField) {
        AddFieldDialog(
            saved = viewModel.savedFields,
            onAdd = { label, type ->
                val error = viewModel.addCustomRow(label, type)
                if (error == null) showAddField = false else viewModel.message = error
            },
            onDismiss = { showAddField = false },
        )
    }
}

@Composable
private fun EditorHeader(viewModel: PostViewModel, seller: Boolean) {
    Row(verticalAlignment = Alignment.CenterVertically) {
        IconButton(onClick = viewModel::stopEditing) {
            Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = stringResource(R.string.cd_back))
        }
        val title = when {
            viewModel.editingId == null -> viewModel.mode.newLabel
            seller -> R.string.editor_edit_listing
            else -> R.string.editor_edit_request
        }
        Text(
            stringResource(title),
            style = MaterialTheme.typography.titleLarge,
        )
    }
}

@Composable
private fun SellerFields(viewModel: PostViewModel) {
    OutlinedTextField(
        value = viewModel.price,
        onValueChange = { viewModel.price = it },
        label = { Text(stringResource(R.string.editor_price)) },
        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal),
        singleLine = true,
        modifier = Modifier.fillMaxWidth(),
    )
    Text(stringResource(R.string.editor_condition), style = MaterialTheme.typography.labelLarge)
    ConditionDropdown(selected = viewModel.condition, onSelect = { viewModel.condition = it })
}

// anyLabel adds a first choice that clears the condition, for fields that are optional.
@Composable
internal fun ConditionDropdown(selected: String, onSelect: (String) -> Unit, anyLabel: String? = null) {
    val options = listOfNotNull(anyLabel?.let { "" to it }) + CONDITIONS.map { it to it.titleCase() }
    ChoiceDropdown(selected = selected, options = options, onSelect = onSelect)
}

// A read-only field with a dropdown arrow showing the selected option's label, or buttonText if given;
// tapping it opens the list of options.
@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun ChoiceDropdown(
    selected: String,
    options: List<Pair<String, String>>,
    onSelect: (String) -> Unit,
    modifier: Modifier = Modifier,
    buttonText: String? = null,
) {
    var open by remember { mutableStateOf(false) }
    ExposedDropdownMenuBox(expanded = open, onExpandedChange = { open = it }, modifier = modifier) {
        OutlinedTextField(
            value = buttonText ?: options.firstOrNull { it.first == selected }?.second.orEmpty(),
            onValueChange = {},
            readOnly = true,
            trailingIcon = { ExposedDropdownMenuDefaults.TrailingIcon(expanded = open) },
            modifier = Modifier.fillMaxWidth().menuAnchor(MenuAnchorType.PrimaryNotEditable),
        )
        ExposedDropdownMenu(expanded = open, onDismissRequest = { open = false }) {
            options.forEach { (value, label) ->
                DropdownMenuItem(
                    text = { Text(label) },
                    onClick = {
                        onSelect(value)
                        open = false
                    },
                )
            }
        }
    }
}

@Composable
private fun SubmitButton(viewModel: PostViewModel, seller: Boolean) {
    Button(
        onClick = viewModel::submit,
        enabled = !viewModel.saving,
        modifier = Modifier.fillMaxWidth(),
    ) {
        if (viewModel.saving) {
            CircularProgressIndicator(modifier = Modifier.padding(2.dp))
        } else {
            val label = when {
                viewModel.editingId != null -> R.string.editor_save
                seller -> R.string.editor_create_listing
                else -> R.string.editor_create_request
            }
            Text(stringResource(label))
        }
    }
}
