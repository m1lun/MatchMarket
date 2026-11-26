package com.example.cpen321application.shared.network

import java.io.IOException
import java.util.concurrent.TimeUnit
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject

private const val CONNECT_TIMEOUT_SECONDS = 5L
private const val MAX_ERROR_CHARS = 200
private val SUCCESS_CODES = 200..299
private val JSON_TYPE = "application/json".toMediaType()
private val METHODS_WITHOUT_BODY = setOf("GET", "HEAD", "DELETE")

// The app's only HTTP client. Every backend call and photo download shares its connection pool.
val backendClient: OkHttpClient = OkHttpClient.Builder()
    .connectTimeout(CONNECT_TIMEOUT_SECONDS, TimeUnit.SECONDS)
    .build()

fun JSONObject.toJsonBody(): RequestBody = toString().toRequestBody(JSON_TYPE)

// A finished HTTP exchange with the backend.
data class HttpResult(val code: Int, val body: String) {
    val isSuccess: Boolean
        get() = code in SUCCESS_CODES

    // The backend's `{ error }` message for a failed request, or the raw body.
    val errorMessage: String
        get() = runCatching { JSONObject(body).getString("error") }
            .getOrDefault(body.take(MAX_ERROR_CHARS))
            .ifBlank { "HTTP $code" }
}

// Requests to the backend. Blocks, so call it from Dispatchers.IO.
// Throws IOException only when the backend cannot be reached at all; HTTP
// error statuses come back as an HttpResult.
interface BackendClient {
    fun send(method: String, path: String, body: RequestBody? = null, bearerToken: String? = null): HttpResult
}

class BackendHttp(
    private val apiBaseUrl: String,
    private val client: OkHttpClient = backendClient,
) : BackendClient {
    override fun send(method: String, path: String, body: RequestBody?, bearerToken: String?): HttpResult {
        val request = Request.Builder()
            .url(apiBaseUrl.trimEnd('/') + path)
            .header("Accept", "application/json")
            .apply { if (bearerToken != null) header("Authorization", "Bearer $bearerToken") }
            // OkHttp refuses a POST, PUT or PATCH without a body, e.g. accepting a proposal.
            .method(method, body ?: if (method in METHODS_WITHOUT_BODY) null else ByteArray(0).toRequestBody())
            .build()
        client.newCall(request).execute().use { response ->
            return HttpResult(response.code, response.body?.string().orEmpty())
        }
    }
}

// The backend refused the refresh token, or there is no session: the user has
// to sign in with Google again.
class SessionExpiredException(message: String) : IOException(message)
