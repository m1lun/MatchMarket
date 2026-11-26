package com.example.cpen321application.posts.view

import androidx.compose.foundation.background
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Card
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.MaterialTheme
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
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import com.example.cpen321application.R
import com.example.cpen321application.posts.model.FieldDef
import com.example.cpen321application.posts.model.KIND_BUILTIN
import com.example.cpen321application.posts.model.MAX_IMPORTANCE
import com.example.cpen321application.posts.model.MIN_IMPORTANCE
import com.example.cpen321application.posts.model.OptionItem
import com.example.cpen321application.posts.model.RowState
import com.example.cpen321application.posts.model.TYPE_BOOL
import com.example.cpen321application.posts.model.TYPE_DIMENSIONS
import com.example.cpen321application.posts.model.TYPE_NUMBER
import com.example.cpen321application.posts.model.TYPE_TEXT
import com.example.cpen321application.posts.viewmodel.PostViewModel

private val DOT_SIZE = 12.dp
private val DOT_TARGET = 32.dp

@Composable
internal fun FieldRows(viewModel: PostViewModel, seller: Boolean) {
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
internal fun AddFieldDialog(
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
