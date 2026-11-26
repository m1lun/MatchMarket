package com.example.cpen321application.posts.view

import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import com.example.cpen321application.R
import com.example.cpen321application.posts.model.MAX_PHOTOS
import com.example.cpen321application.posts.viewmodel.PostViewModel

// Characters of a new photo's file name shown on its remove button.
private const val PHOTO_NAME_CHARS = 8

@Composable
internal fun PhotoRow(viewModel: PostViewModel, seller: Boolean) {
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
