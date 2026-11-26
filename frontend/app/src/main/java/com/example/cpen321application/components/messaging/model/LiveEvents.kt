package com.example.cpen321application.components.messaging.model

import android.util.Log
import com.example.cpen321application.BuildConfig
import com.example.cpen321application.shared.network.SessionExpiredException
import com.example.cpen321application.components.users.model.SessionManager
import com.example.cpen321application.shared.network.backendClient
import java.io.IOException
import java.io.Reader
import java.util.concurrent.TimeUnit
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.channels.awaitClose
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.callbackFlow
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import okhttp3.Call
import okhttp3.Request
import org.json.JSONException
import org.json.JSONObject

private const val TAG = "LiveEvents"
// Longer than the server's 25-second heartbeat, so a stream that has gone silent counts as dropped.
private const val READ_TIMEOUT_MS = 60_000L
private const val RECONNECT_DELAY_MS = 3_000L

// One server-sent event. CONNECTED is sent by the app itself each time the stream (re)opens.
data class LiveEvent(val type: String, val data: JSONObject) {
    companion object {
        const val CONNECTED = "connected"
        const val MESSAGE_CREATED = "message.created"
        const val PROPOSAL_UPDATED = "proposal.updated"
    }
}

// The signed-in user's live updates from GET /api/events, reconnecting after a drop until the collector stops.
// Ends with SessionExpiredException when the user has to sign in again.
fun liveEvents(sessions: SessionManager): Flow<LiveEvent> = callbackFlow {
    var call: Call? = null
    launch(Dispatchers.IO) {
        while (isActive) {
            try {
                val opened = eventsCall(sessions.sessionToken()).also { call = it }
                opened.execute().use { response ->
                    val body = response.body
                    if (!response.isSuccessful || body == null) {
                        throw IOException("HTTP ${response.code} from /api/events")
                    }
                    trySend(LiveEvent(LiveEvent.CONNECTED, JSONObject()))
                    readEvents(body.charStream()) { event -> trySend(event) }
                }
            } catch (e: SessionExpiredException) {
                close(e)
                break
            } catch (e: IOException) {
                Log.w(TAG, "Live updates dropped, reconnecting", e)
            }
            delay(RECONNECT_DELAY_MS)
        }
    }
    // Cancelling ends the blocking read above, which is how leaving the screen stops the stream.
    awaitClose { call?.cancel() }
}

private val streamClient = backendClient.newBuilder()
    .readTimeout(READ_TIMEOUT_MS, TimeUnit.MILLISECONDS)
    .build()

private fun eventsCall(token: String): Call = streamClient.newCall(
    Request.Builder()
        .url(BuildConfig.API_BASE_URL.trimEnd('/') + "/api/events")
        .header("Accept", "text/event-stream")
        .header("Authorization", "Bearer $token")
        .build()
)

// An event is an `event:` line and a `data:` line, ended by a blank line; lines starting with ':' are heartbeats.
private fun readEvents(stream: Reader, onEvent: (LiveEvent) -> Unit) {
    var type = ""
    var data = ""
    stream.buffered().useLines { lines ->
        for (line in lines) {
            when {
                line.startsWith("event:") -> type = line.removePrefix("event:").trim()
                line.startsWith("data:") -> data = line.removePrefix("data:").trim()
                line.isEmpty() && type.isNotEmpty() -> {
                    parse(type, data)?.let(onEvent)
                    type = ""
                    data = ""
                }
            }
        }
    }
}

private fun parse(type: String, data: String): LiveEvent? = try {
    LiveEvent(type, JSONObject(data))
} catch (e: JSONException) {
    Log.w(TAG, "Unreadable live event: $type", e)
    null
}
