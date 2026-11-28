package com.example.cpen321application.components.posts.model

import android.content.res.Resources
import androidx.annotation.StringRes
import com.example.cpen321application.R
import org.json.JSONObject

enum class Mode(val path: String, @StringRes val tabLabel: Int, @StringRes val newLabel: Int) {
    BUYING("requests", R.string.mode_buying, R.string.mode_new_request),
    SELLING("listings", R.string.mode_selling, R.string.mode_new_listing),
}

enum class AppTab(@StringRes val label: Int) {
    FEED(R.string.tab_feed),
    POSTS(R.string.tab_posts),
    DEALS(R.string.tab_deals),
    MESSAGES(R.string.tab_messages),
    PROFILE(R.string.tab_profile),
}

val CONDITIONS = listOf("new", "like new", "good", "fair", "poor")

const val MAX_PHOTOS = 10
const val MAX_PHOTO_BYTES = 5 * 1024 * 1024
const val MAX_CUSTOM_FIELDS = 10
const val MAX_NAME_LENGTH = 80

// The values the backend uses for a post's status and a field's kind and type.
const val STATUS_OPEN = "open"
const val STATUS_CLOSED = "closed"
const val KIND_BUILTIN = "builtin"
const val KIND_CUSTOM = "custom"
const val TYPE_TEXT = "text"
const val TYPE_NUMBER = "number"
const val TYPE_BOOL = "bool"
const val TYPE_DIMENSIONS = "dimensions"

// How much a soft request field matters, on the editor's slider.
const val MIN_IMPORTANCE = 1
const val MAX_IMPORTANCE = 5
const val DEFAULT_IMPORTANCE = 3

/** One line on the detail screen; hard/importance are set for request fields only. */
data class DetailRow(
    val label: String,
    val value: String,
    val hard: Boolean? = null,
    val importance: Int? = null,
)

data class PostDetail(
    val name: String,
    val category: String,
    val address: String,
    val description: String,
    val price: String?,
    val condition: String?,
    val photoIds: List<String>,
    val rows: List<DetailRow>,
    val createdAt: String,
    val location: PostLocation? = null,
)

/** Where a post is, as its owner picked it. */
data class PostLocation(
    val address: String,
    val latitude: Double,
    val longitude: Double,
)

data class PostSummary(
    val id: String,
    val title: String,
    val subtitle: String,
    val status: String,
    val detail: PostDetail,
    /** The post exactly as the backend returned it; used to prefill the editor. */
    val raw: JSONObject,
)

data class AddressSuggestion(
    val label: String,
    val longitude: Double,
    val latitude: Double,
)

data class OptionItem(val key: String, val label: String)

data class FieldDef(val key: String, val label: String, val type: String)

fun String.titleCase(): String =
    split(' ').joinToString(" ") { word -> word.replaceFirstChar { it.uppercase() } }

/** One field of a listing or a request in the editor. */
data class RowState(
    val key: String,
    val label: String,
    val kind: String, // KIND_BUILTIN or KIND_CUSTOM
    val type: String, // TYPE_TEXT, TYPE_NUMBER, TYPE_BOOL or TYPE_DIMENSIONS
    val value: String = "",
    val width: String = "",
    val height: String = "",
    val depth: String = "",
    val boolValue: Boolean = false,
    val hard: Boolean = false,
    val importance: Int = DEFAULT_IMPORTANCE,
    val required: Boolean = false,
) {
    val isCustom: Boolean get() = kind == KIND_CUSTOM

    /** Fields with saved options get suggestions from /options. */
    val optionField: String?
        get() = when {
            kind == KIND_BUILTIN && (key == "brand" || key == "colour") -> key
            isCustom && type == TYPE_TEXT -> key
            else -> null
        }

    val isEmpty: Boolean
        get() = when (type) {
            TYPE_BOOL -> false
            TYPE_DIMENSIONS -> width.isBlank() && height.isBlank() && depth.isBlank()
            else -> value.isBlank()
        }
}

/** Default fields shown when creating a post. */
fun defaultRows(mode: Mode, resources: Resources): List<RowState> = when (mode) {
    Mode.BUYING -> listOf(
        RowState("price", resources.getString(R.string.field_max_price), KIND_BUILTIN, TYPE_NUMBER, required = true),
        RowState("condition", resources.getString(R.string.field_min_condition), KIND_BUILTIN, TYPE_TEXT),
        RowState("dimensions", resources.getString(R.string.field_max_size), KIND_BUILTIN, TYPE_DIMENSIONS),
        RowState("radiuskm", resources.getString(R.string.field_radius), KIND_BUILTIN, TYPE_NUMBER),
        RowState("brand", resources.getString(R.string.field_brand), KIND_BUILTIN, TYPE_TEXT),
        RowState("colour", resources.getString(R.string.field_colour), KIND_BUILTIN, TYPE_TEXT),
    )
    Mode.SELLING -> listOf(
        RowState("brand", resources.getString(R.string.field_brand), KIND_BUILTIN, TYPE_TEXT),
        RowState("colour", resources.getString(R.string.field_colour), KIND_BUILTIN, TYPE_TEXT),
        RowState("dimensions", resources.getString(R.string.field_size), KIND_BUILTIN, TYPE_DIMENSIONS),
    )
}
