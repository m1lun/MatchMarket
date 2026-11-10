package com.example.cpen321application.post

import android.content.res.Resources
import com.example.cpen321application.R
import com.example.cpen321application.auth.SessionExpiredException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.MultipartBody
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONArray
import org.json.JSONObject

class ApiException(message: String) : Exception(message)

/** An image picked by the user, read into memory. */
class PhotoData(val mimeType: String, val bytes: ByteArray)

private const val PHOTO_FILE_NAME = "photo"
// The date part ("2026-10-20") of an ISO timestamp.
private const val DATE_CHARS = 10

internal fun JSONArray.objects(): List<JSONObject> = (0 until length()).map { getJSONObject(it) }

internal fun JSONArray.strings(): List<String> = (0 until length()).map { getString(it) }

class PostApi(
    baseUrl: String,
    private val auth: RequestAuth,
    private val resources: Resources,
    private val client: OkHttpClient = OkHttpClient(),
) {
    private val base = baseUrl.trimEnd('/')
    private val json = "application/json".toMediaType()

    private fun JSONObject.asBody() = toString().toRequestBody(json)

    private suspend fun call(path: String, build: Request.Builder.() -> Unit = {}): String =
        withContext(Dispatchers.IO) {
            val builder = Request.Builder().url("$base$path")
            try {
                auth.headers().forEach { (name, value) -> builder.header(name, value) }
                builder.apply(build)
                client.newCall(builder.build()).execute().use { response ->
                    val body = response.body?.string().orEmpty()
                    if (!response.isSuccessful) throw ApiException(errorMessage(body, response.code))
                    body
                }
            } catch (_: SessionExpiredException) {
                throw ApiException(resources.getString(R.string.error_session_expired))
            } catch (_: java.io.IOException) {
                throw ApiException(resources.getString(R.string.error_unreachable))
            }
        }

    private fun errorMessage(body: String, code: Int): String = try {
        val obj = JSONObject(body)
        val details = obj.optJSONArray("details")
        if (details != null && details.length() > 0) {
            details.strings().joinToString("\n")
        } else {
            obj.optString("error", resources.getString(R.string.error_request_failed, code.toString()))
        }
    } catch (_: org.json.JSONException) {
        resources.getString(R.string.error_request_failed, code.toString())
    }

    suspend fun listPosts(mode: Mode): List<PostSummary> {
        return JSONArray(call("/${mode.path}")).objects().map { summarise(mode, it) }
    }

    private fun formatValue(row: JSONObject): String {
        val value = row.get("value")
        return when (row.getString("type")) {
            TYPE_DIMENSIONS -> {
                val d = row.getJSONObject("value")
                resources.getString(R.string.value_dimensions, d.get("width"), d.get("height"), d.get("depth"))
            }
            TYPE_BOOL -> resources.getString(if (row.getBoolean("value")) R.string.value_yes else R.string.value_no)
            TYPE_NUMBER -> when (row.getString("key")) {
                "price" -> resources.getString(R.string.value_price, value)
                "radiuskm" -> resources.getString(R.string.value_radius, value)
                else -> value.toString()
            }
            else -> value.toString().titleCase()
        }
    }

    private fun detailOf(mode: Mode, post: JSONObject): PostDetail {
        val rowsKey = if (mode == Mode.BUYING) "requestFields" else "listingFields"
        val detailRows = post.getJSONArray(rowsKey).objects().map { row ->
            DetailRow(
                label = row.getString("label"),
                value = formatValue(row),
                hard = if (mode == Mode.BUYING) row.getBoolean("hard") else null,
                importance = if (row.has("importance")) row.getInt("importance") else null,
            )
        }
        return PostDetail(
            name = post.getString("name"),
            category = post.getString("category").titleCase(),
            address = post.getString("address"),
            description = post.optString("description"),
            price = if (mode == Mode.SELLING) resources.getString(R.string.value_price, post.get("price")) else null,
            condition = if (mode == Mode.SELLING) post.getString("condition").titleCase() else null,
            photoIds = post.optJSONArray("photoIds")?.strings().orEmpty(),
            rows = detailRows,
            createdAt = post.optString("createdAt").take(DATE_CHARS),
        )
    }

    fun summarise(mode: Mode, post: JSONObject): PostSummary {
        val detail = detailOf(mode, post)
        return if (mode == Mode.BUYING) {
            val rows = post.getJSONArray("requestFields").objects()
            val hard = rows.count { it.getBoolean("hard") }
            val title = rows.lastOrNull { it.getString("key") == "price" }
                ?.let { resources.getString(R.string.summary_request_title, detail.name, it.get("value")) }
                ?: detail.name
            val soft = rows.size - hard
            val hardSoft = resources.getString(
                R.string.summary_hard_soft,
                resources.getQuantityString(R.plurals.summary_must_haves, hard, hard),
                resources.getQuantityString(R.plurals.summary_nice_to_haves, soft, soft),
            )
            PostSummary(
                post.getString("id"),
                title,
                resources.getString(R.string.summary_category, detail.category, hardSoft),
                post.getString("status"),
                detail,
                post,
            )
        } else {
            PostSummary(
                post.getString("id"),
                resources.getString(R.string.summary_listing_title, detail.name, post.get("price")),
                resources.getString(R.string.summary_category, detail.category, post.getString("condition").titleCase()),
                post.getString("status"),
                detail,
                post,
            )
        }
    }

    suspend fun createPost(mode: Mode, body: JSONObject) {
        call("/${mode.path}") { post(body.asBody()) }
    }

    suspend fun updatePost(mode: Mode, id: String, body: JSONObject) {
        call("/${mode.path}/$id") { patch(body.asBody()) }
    }

    suspend fun setStatus(mode: Mode, id: String, status: String) {
        updatePost(mode, id, JSONObject().put("status", status))
    }

    suspend fun deletePost(mode: Mode, id: String) {
        call("/${mode.path}/$id") { delete() }
    }

    suspend fun options(field: String): List<OptionItem> {
        val encoded = java.net.URLEncoder.encode(field, "UTF-8")
        return JSONArray(call("/options?field=$encoded")).objects().map {
            OptionItem(it.getString("key"), it.getString("label"))
        }
    }

    suspend fun fields(): List<FieldDef> {
        return JSONArray(call("/custom-fields")).objects().map {
            FieldDef(it.getString("key"), it.getString("label"), it.getString("type"))
        }
    }

    suspend fun uploadPhotos(photos: List<PhotoData>): List<String> {
        val form = MultipartBody.Builder().setType(MultipartBody.FORM)
        photos.forEach {
            form.addFormDataPart(
                "photos",
                PHOTO_FILE_NAME,
                it.bytes.toRequestBody(it.mimeType.toMediaType()),
            )
        }
        val body = form.build()
        return JSONObject(call("/photos") { post(body) }).getJSONArray("ids").strings()
    }
}
