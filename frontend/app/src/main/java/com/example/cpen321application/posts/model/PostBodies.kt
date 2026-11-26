package com.example.cpen321application.posts.model

import android.content.ContentResolver
import android.content.res.Resources
import android.net.Uri
import com.example.cpen321application.R
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONObject

private const val BYTES_PER_MB = 1024 * 1024

private fun String.toNumber(error: String): Double = trim().toDoubleOrNull() ?: throw ApiException(error)

internal fun rowToJson(row: RowState, seller: Boolean, resources: Resources): JSONObject {
    val json = JSONObject().put("kind", row.kind)
    if (row.isCustom) json.put("label", row.label).put("type", row.type) else json.put("key", row.key)
    when (row.type) {
        TYPE_NUMBER -> {
            val error = resources.getString(R.string.error_not_a_number, row.label)
            json.put("value", row.value.toNumber(error))
        }
        TYPE_BOOL -> json.put("value", row.boolValue)
        TYPE_DIMENSIONS -> {
            val error = resources.getString(R.string.error_dimensions, row.label)
            json.put(
                "value",
                JSONObject()
                    .put("width", row.width.toNumber(error))
                    .put("height", row.height.toNumber(error))
                    .put("depth", row.depth.toNumber(error)),
            )
        }
        else -> json.put("value", row.value.trim())
    }
    if (!seller) {
        json.put("hard", row.hard)
        if (!row.hard) json.put("importance", row.importance)
    }
    return json
}

internal suspend fun readPhotos(resolver: ContentResolver, photos: List<Uri>, resources: Resources): List<PhotoData> =
    withContext(Dispatchers.IO) {
        photos.map { uri ->
            val bytes = resolver.openInputStream(uri)?.use { it.readBytes() }
                ?: throw ApiException(resources.getString(R.string.error_photo_unreadable))
            if (bytes.size > MAX_PHOTO_BYTES) {
                val maxMegabytes = (MAX_PHOTO_BYTES / BYTES_PER_MB).toString()
                throw ApiException(resources.getString(R.string.error_photo_too_big, maxMegabytes))
            }
            val mime = resolver.getType(uri)
                ?: throw ApiException(resources.getString(R.string.error_photo_unusable))
            PhotoData(mime, bytes)
        }
    }
