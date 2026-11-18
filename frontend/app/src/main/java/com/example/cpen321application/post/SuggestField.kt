package com.example.cpen321application.post

import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.rememberScrollState
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.SuggestionChip
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import com.example.cpen321application.R

private const val MAX_SUGGESTIONS = 8

@Composable
internal fun SuggestField(
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
