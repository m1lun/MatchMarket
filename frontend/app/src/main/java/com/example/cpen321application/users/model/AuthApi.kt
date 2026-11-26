package com.example.cpen321application.users.model

import com.example.cpen321application.shared.network.BackendClient
import com.example.cpen321application.shared.network.HttpResult
import com.example.cpen321application.shared.network.SessionExpiredException
import com.example.cpen321application.shared.network.toJsonBody
import java.io.IOException
import java.net.HttpURLConnection
import java.util.concurrent.TimeUnit
import org.json.JSONObject

// The signed-in user and the backend's tokens for them.
data class AuthSession(
    val firstName: String,
    val lastName: String,
    val email: String,
    // Sent as `Authorization: Bearer` on every request. Lasts about 15 minutes.
    val sessionToken: String,
    // Wall-clock time (ms) the session token stops working.
    val sessionExpiresAtMs: Long,
    // Trades for a new pair at /api/auth/refresh. Lasts about 30 days.
    val refreshToken: String
) {
    // Full name, or the email when the account has no name on it.
    val displayName: String
        get() = "$firstName $lastName".trim().ifEmpty { email }

    fun isExpired(nowMs: Long = System.currentTimeMillis()): Boolean = nowMs >= sessionExpiresAtMs
}

// The backend's /api/auth routes. Blocks, so call it from Dispatchers.IO.
class AuthApi(private val http: BackendClient) {
    // Has the backend verify a Google ID token and start a session.
    fun signIn(idToken: String): AuthSession =
        readSession(http.send("POST", "/api/auth/google", JSONObject().put("idToken", idToken).toJsonBody()))

    // Trades a refresh token for a new session. Google is not involved.
    fun refresh(refreshToken: String): AuthSession {
        val result = http.send("POST", "/api/auth/refresh", JSONObject().put("refreshToken", refreshToken).toJsonBody())
        if (result.code == HttpURLConnection.HTTP_UNAUTHORIZED) {
            throw SessionExpiredException(result.errorMessage)
        }
        return readSession(result)
    }

    // Revokes the refresh token on the backend.
    fun logout(refreshToken: String) {
        val result = http.send("POST", "/api/auth/logout", JSONObject().put("refreshToken", refreshToken).toJsonBody())
        if (!result.isSuccess) {
            throw IOException("HTTP ${result.code}: ${result.errorMessage}")
        }
    }

    private fun readSession(result: HttpResult): AuthSession {
        if (!result.isSuccess) {
            throw IOException("HTTP ${result.code}: ${result.errorMessage}")
        }
        val json = JSONObject(result.body)
        // Expire a little early so a request never leaves with a token that
        // runs out on the way.
        val lifetimeMs = TimeUnit.SECONDS.toMillis(json.getLong("sessionExpiresIn") - EXPIRY_MARGIN_SECONDS)
        return AuthSession(
            firstName = json.optString("firstName"),
            lastName = json.optString("lastName"),
            email = json.optString("email"),
            sessionToken = json.getString("sessionToken"),
            sessionExpiresAtMs = System.currentTimeMillis() + lifetimeMs,
            refreshToken = json.getString("refreshToken")
        )
    }

    private companion object {
        const val EXPIRY_MARGIN_SECONDS = 30L
    }
}
