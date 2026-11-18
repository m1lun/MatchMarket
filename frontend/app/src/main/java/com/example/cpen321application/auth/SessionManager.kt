package com.example.cpen321application.auth

import android.content.Context
import android.util.Log
import com.example.cpen321application.BuildConfig
import java.io.IOException
import java.net.HttpURLConnection
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import okhttp3.RequestBody
import org.json.JSONObject

private const val TAG = "SessionManager"

// Holds the signed-in session for the whole app and renews it when it runs
// out. Feature code makes backend calls through [authorizedRequest], which
// attaches the session token and, on a 401, refreshes once and retries.
class SessionManager(
    private val store: SessionStorage,
    private val http: BackendClient,
    private val api: AuthApi = AuthApi(http)
) {
    private val refreshLock = Mutex()

    @Volatile
    private var current: AuthSession? = store.load()

    // The last known session, or null when signed out.
    val session: AuthSession?
        get() = current

    // Starts a session from a Google ID token the backend has not seen yet.
    suspend fun signIn(idToken: String): AuthSession {
        val session = withContext(Dispatchers.IO) { api.signIn(idToken) }
        remember(session)
        return session
    }

    // On app start: trades the stored refresh token for a fresh session.
    // Null when there is none or the backend has revoked it. Keeps the stored
    // session if the backend is unreachable, so going offline does not sign
    // the user out.
    suspend fun restore(): AuthSession? {
        val stored = current ?: return null
        return try {
            refresh(stored)
        } catch (_: SessionExpiredException) {
            null
        } catch (e: IOException) {
            Log.w(TAG, "Could not reach the backend to renew the session", e)
            stored
        }
    }

    // Sends a request with the session token, renewing the session first if it
    // has run out, or once on a 401. Throws SessionExpiredException when the
    // user has to sign in again, IOException when the backend is unreachable.
    suspend fun authorizedRequest(method: String, path: String, body: JSONObject? = null): HttpResult =
        send(method, path, body?.toJsonBody())

    // The same for a body that is not JSON, such as a multipart photo upload.
    suspend fun authorizedRequest(method: String, path: String, body: RequestBody): HttpResult =
        send(method, path, body)

    private suspend fun send(method: String, path: String, body: RequestBody?): HttpResult {
        val session = freshSession()
        val result = withContext(Dispatchers.IO) { http.send(method, path, body, session.sessionToken) }
        if (result.code != HttpURLConnection.HTTP_UNAUTHORIZED) {
            return result
        }
        val renewed = refresh(session)
        return withContext(Dispatchers.IO) { http.send(method, path, body, renewed.sessionToken) }
    }

    // The current session token, renewed first if it has run out. Throws
    // SessionExpiredException when the user has to sign in again.
    suspend fun sessionToken(): String = freshSession().sessionToken

    private suspend fun freshSession(): AuthSession {
        val known = current ?: throw SessionExpiredException("Not signed in")
        return if (known.isExpired()) refresh(known) else known
    }

    // Forgets the session here and revokes it on the backend. Signing out
    // locally always succeeds; if the backend is unreachable, the refresh
    // token simply expires there on its own.
    suspend fun signOut() {
        val session = current ?: return
        forget()
        try {
            withContext(Dispatchers.IO) { api.logout(session.refreshToken) }
        } catch (e: IOException) {
            Log.w(TAG, "Could not revoke the session on the backend", e)
        }
    }

    // Serialised so that requests which hit a 401 together trade the refresh
    // token only once: the backend treats a second use as theft and revokes
    // the whole sign-in.
    private suspend fun refresh(stale: AuthSession): AuthSession = refreshLock.withLock {
        val latest = current ?: throw SessionExpiredException("Signed out")
        if (latest.refreshToken != stale.refreshToken) latest else renew(latest)
    }

    private suspend fun renew(session: AuthSession): AuthSession {
        try {
            val renewed = withContext(Dispatchers.IO) { api.refresh(session.refreshToken) }
            remember(renewed)
            return renewed
        } catch (e: SessionExpiredException) {
            forget()
            throw e
        }
    }

    private fun remember(session: AuthSession) {
        current = session
        store.save(session)
    }

    private fun forget() {
        current = null
        store.clear()
    }

    companion object {
        @Volatile
        private var instance: SessionManager? = null

        // The app-wide instance, talking to BuildConfig.API_BASE_URL.
        fun get(context: Context): SessionManager = instance ?: synchronized(this) {
            instance ?: SessionManager(
                SessionStore(context.applicationContext),
                BackendHttp(BuildConfig.API_BASE_URL)
            ).also { instance = it }
        }
    }
}
