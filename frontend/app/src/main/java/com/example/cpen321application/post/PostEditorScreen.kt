package com.example.cpen321application.post

import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.annotation.StringRes
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material3.Button
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.Card
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ExposedDropdownMenuBox
import androidx.compose.material3.ExposedDropdownMenuDefaults
import androidx.compose.material3.MenuAnchorType
import androidx.compose.material3.FilterChip
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.SegmentedButton
import androidx.compose.material3.SegmentedButtonDefaults
import androidx.compose.material3.SingleChoiceSegmentedButtonRow
import androidx.compose.material3.SuggestionChip
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import com.example.cpen321application.R

private const val MAX_SUGGESTIONS = 8
// Characters of a new photo's file name shown on its remove button.
private const val PHOTO_NAME_CHARS = 8
private val DOT_SIZE = 12.dp
private val DOT_TARGET = 32.dp

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
private fun ConditionDropdown(selected: String, onSelect: (String) -> Unit, anyLabel: String? = null) {
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
private fun AddressField(viewModel: PostViewModel) {
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

@Composable
private fun PhotoRow(viewModel: PostViewModel, seller: Boolean) {
    val room = MAX_PHOTOS - viewModel.photos.size - viewModel.existingPhotoIds.size
    val pickOne = rememberLauncherForActivityResult(ActivityResultContracts.PickVisualMedia()) { uri ->
        uri?.let { viewModel.addPhotos(listOf(it)) }
    }
    // The picker itself stops the user at the photos still allowed; it needs a limit of at least 2.
    val pickManyContract = remember(room) { ActivityResultContracts.PickMultipleVisualMedia(maxOf(room, 2)) }
    val pickMany = rememberLauncherForActivityResult(pickManyContract) { viewModel.addPhotos(it) }
    val imagesOnly = PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly)
    Text(
        stringResource(
            if (seller) R.string.editor_photos_required else R.string.editor_photos,
            viewModel.photos.size + viewModel.existingPhotoIds.size,
            MAX_PHOTOS,
        ),
        style = MaterialTheme.typography.labelLarge,
    )
    Row(
        modifier = Modifier.horizontalScroll(rememberScrollState()),
        horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        OutlinedButton(
            onClick = { if (room == 1) pickOne.launch(imagesOnly) else pickMany.launch(imagesOnly) },
            enabled = room > 0,
        ) { Text(stringResource(R.string.editor_add_photo)) }
        viewModel.existingPhotoIds.forEachIndexed { index, _ ->
            OutlinedButton(onClick = { viewModel.existingPhotoIds.removeAt(index) }) {
                Text(stringResource(R.string.editor_saved_photo, index + 1))
            }
        }
        viewModel.photos.forEachIndexed { index, uri ->
            OutlinedButton(onClick = { viewModel.photos.removeAt(index) }) {
                val name = uri.lastPathSegment?.takeLast(PHOTO_NAME_CHARS)
                    ?: stringResource(R.string.editor_new_photo_fallback)
                Text(stringResource(R.string.editor_new_photo, name))
            }
        }
    }
}

@Composable
private fun FieldRows(viewModel: PostViewModel, seller: Boolean) {
    Text(
        stringResource(if (seller) R.string.fields_attributes else R.string.fields_requirements),
        style = MaterialTheme.typography.titleMedium,
    )
    viewModel.rows.forEachIndexed { index, row ->
        RowEditor(
            row = row,
            seller = seller,
            viewModel = viewModel,
            onChange = { viewModel.rows[index] = it },
            onRemove = if (row.isCustom) ({ viewModel.rows.removeAt(index) }) else null,
        )
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

@Composable
private fun RowEditor(
    row: RowState,
    seller: Boolean,
    viewModel: PostViewModel,
    onChange: (RowState) -> Unit,
    onRemove: (() -> Unit)?,
) {
    Card(modifier = Modifier.fillMaxWidth()) {
        Column(
            modifier = Modifier.padding(12.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                val title = when {
                    row.required -> stringResource(R.string.editor_field_required, row.label)
                    row.isCustom -> stringResource(R.string.editor_field_custom, row.label)
                    else -> row.label
                }
                Text(
                    title,
                    fontWeight = FontWeight.SemiBold,
                    modifier = Modifier.weight(1f),
                )
                if (onRemove != null) TextButton(onClick = onRemove) { Text(stringResource(R.string.action_remove)) }
            }
            RowValueInput(row, viewModel, onChange)
            // Hard/soft and importance only exist on request fields.
            if (!seller) RequestControls(row, onChange)
        }
    }
}

@Composable
private fun RowValueInput(row: RowState, viewModel: PostViewModel, onChange: (RowState) -> Unit) {
    when {
        row.type == TYPE_BOOL -> Switch(
            checked = row.boolValue,
            onCheckedChange = { onChange(row.copy(boolValue = it)) },
        )
        row.type == TYPE_DIMENSIONS -> DimensionInputs(row, onChange)
        row.key == "condition" && row.kind == KIND_BUILTIN ->
            ConditionDropdown(
                selected = row.value,
                onSelect = { onChange(row.copy(value = it)) },
                anyLabel = stringResource(R.string.editor_condition_any),
            )
        row.optionField != null -> OptionValueInput(row, viewModel, onChange)
        else -> OutlinedTextField(
            value = row.value,
            onValueChange = { onChange(row.copy(value = it)) },
            label = { Text(stringResource(R.string.editor_value)) },
            keyboardOptions = KeyboardOptions(
                keyboardType = if (row.type == TYPE_NUMBER) KeyboardType.Decimal else KeyboardType.Text,
            ),
            singleLine = true,
            modifier = Modifier.fillMaxWidth(),
        )
    }
}

@Composable
private fun DimensionInputs(row: RowState, onChange: (RowState) -> Unit) {
    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        listOf(
            R.string.editor_width to row.width,
            R.string.editor_height to row.height,
            R.string.editor_depth to row.depth,
        ).forEachIndexed { i, (name, v) ->
            OutlinedTextField(
                value = v,
                onValueChange = {
                    onChange(
                        when (i) {
                            0 -> row.copy(width = it)
                            1 -> row.copy(height = it)
                            else -> row.copy(depth = it)
                        },
                    )
                },
                label = { Text(stringResource(name)) },
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal),
                singleLine = true,
                modifier = Modifier.weight(1f),
            )
        }
    }
}

@Composable
private fun OptionValueInput(row: RowState, viewModel: PostViewModel, onChange: (RowState) -> Unit) {
    var options by remember(row.key) { mutableStateOf<List<OptionItem>>(emptyList()) }
    LaunchedEffect(row.key) { options = viewModel.suggestions(row.optionField!!) }
    SuggestField(
        label = stringResource(R.string.editor_value),
        value = row.value,
        onValueChange = { onChange(row.copy(value = it)) },
        options = options,
    )
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun RequestControls(row: RowState, onChange: (RowState) -> Unit) {
    Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
        SingleChoiceSegmentedButtonRow(modifier = Modifier.fillMaxWidth()) {
            listOf(true to R.string.field_must_have, false to R.string.field_nice_to_have).forEachIndexed { i, (hard, name) ->
                SegmentedButton(
                    selected = row.hard == hard,
                    onClick = { onChange(row.copy(hard = hard)) },
                    shape = SegmentedButtonDefaults.itemShape(i, 2),
                ) { Text(stringResource(name)) }
            }
        }
        // Only a nice-to-have has an importance.
        if (!row.hard) ImportancePicker(row.importance) { onChange(row.copy(importance = it)) }
    }
}

// Tap a dot to set the importance.
@Composable
private fun ImportancePicker(level: Int, onSelect: (Int) -> Unit) {
    Row(verticalAlignment = Alignment.CenterVertically) {
        Text(
            stringResource(R.string.editor_how_much),
            style = MaterialTheme.typography.labelLarge,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        for (value in MIN_IMPORTANCE..MAX_IMPORTANCE) {
            val description = stringResource(R.string.editor_importance_dot, value, MAX_IMPORTANCE)
            Box(
                contentAlignment = Alignment.Center,
                modifier = Modifier
                    .size(DOT_TARGET)
                    .selectable(selected = value == level, role = Role.RadioButton) { onSelect(value) }
                    .semantics { contentDescription = description },
            ) {
                Box(
                    Modifier
                        .size(DOT_SIZE)
                        .clip(CircleShape)
                        .background(
                            if (value <= level) MaterialTheme.colorScheme.primary
                            else MaterialTheme.colorScheme.outlineVariant,
                        ),
                )
            }
        }
    }
}

@Composable
private fun SuggestField(
    label: String,
    value: String,
    onValueChange: (String) -> Unit,
    options: List<OptionItem>,
) {
    Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
        OutlinedTextField(
            value = value,
            onValueChange = onValueChange,
            label = { Text(label) },
            singleLine = true,
            modifier = Modifier.fillMaxWidth(),
        )
        SuggestionRow(value, onValueChange, options)
        val exact = options.any { it.key == value.trim().lowercase() }
        if (value.isNotBlank() && !exact) {
            Text(stringResource(R.string.editor_new_value, value.trim()), style = MaterialTheme.typography.bodySmall)
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun SuggestionRow(value: String, onValueChange: (String) -> Unit, options: List<OptionItem>) {
    val matches = options
        .filter { value.isBlank() || it.key.contains(value.trim().lowercase()) }
        .filter { it.key != value.trim().lowercase() }
        .take(MAX_SUGGESTIONS)
    if (matches.isEmpty()) return
    Row(
        modifier = Modifier.horizontalScroll(rememberScrollState()),
        horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        matches.forEach {
            SuggestionChip(onClick = { onValueChange(it.label) }, label = { Text(it.label.titleCase()) })
        }
    }
}

@Composable
private fun AddFieldDialog(
    saved: List<FieldDef>,
    onAdd: (label: String, type: String) -> Unit,
    onDismiss: () -> Unit,
) {
    var label by remember { mutableStateOf("") }
    var type by remember { mutableStateOf(TYPE_TEXT) }
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(stringResource(R.string.editor_add_field_title)) },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                if (saved.isNotEmpty()) {
                    Text(stringResource(R.string.editor_saved_fields), style = MaterialTheme.typography.labelLarge)
                    Row(
                        modifier = Modifier.horizontalScroll(rememberScrollState()),
                        horizontalArrangement = Arrangement.spacedBy(8.dp),
                    ) {
                        saved.forEach {
                            SuggestionChip(onClick = { onAdd(it.label, it.type) }, label = { Text(it.label) })
                        }
                    }
                }
                Text(stringResource(R.string.editor_create_field), style = MaterialTheme.typography.labelLarge)
                OutlinedTextField(
                    value = label,
                    onValueChange = { label = it },
                    label = { Text(stringResource(R.string.editor_field_name)) },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth(),
                )
                Text(stringResource(R.string.editor_field_type), style = MaterialTheme.typography.labelLarge)
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.fillMaxWidth()) {
                    listOf(
                        TYPE_TEXT to R.string.editor_type_text,
                        TYPE_NUMBER to R.string.editor_type_number,
                        TYPE_BOOL to R.string.editor_type_bool,
                    ).forEach { (t, name) ->
                        FilterChip(
                            selected = type == t,
                            onClick = { type = t },
                            label = {
                                Text(
                                    stringResource(name),
                                    maxLines = 1,
                                    modifier = Modifier.fillMaxWidth(),
                                    textAlign = TextAlign.Center,
                                )
                            },
                            modifier = Modifier.weight(1f),
                        )
                    }
                }
            }
        },
        confirmButton = {
            TextButton(onClick = { onAdd(label, type) }, enabled = label.isNotBlank()) {
                Text(stringResource(R.string.action_add))
            }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text(stringResource(R.string.action_cancel)) } },
    )
}
