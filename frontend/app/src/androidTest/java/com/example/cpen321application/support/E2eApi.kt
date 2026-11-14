package com.example.cpen321application.support

import androidx.compose.ui.test.hasClickAction
import androidx.compose.ui.test.hasText
import androidx.test.platform.app.InstrumentationRegistry
import com.example.cpen321application.auth.HttpResult
import com.example.cpen321application.auth.SessionManager
import kotlinx.coroutines.runBlocking
import org.json.JSONObject
import java.io.IOException

// Backend calls the E2E tests make as the signed-in user, outside the app's screens: seeding through the
// /api/e2e routes (needs ENABLE_E2E_ROUTES=true) and checking what the server saved.
private const val ONLINE_WAIT_MS = 60_000L
private const val RETRY_DELAY_MS = 1_000L

private val sessions by lazy { SessionManager.get(InstrumentationRegistry.getInstrumentation().targetContext) }

// Retries while the emulator comes back online.
internal fun send(method: String, path: String, body: JSONObject? = null): HttpResult {
    val deadline = System.currentTimeMillis() + ONLINE_WAIT_MS
    while (true) {
        try {
            return runBlocking { sessions.authorizedRequest(method, path, body) }
        } catch (e: IOException) {
            if (System.currentTimeMillis() > deadline) throw e
            Thread.sleep(RETRY_DELAY_MS)
        }
    }
}

// The emulator needs several seconds after airplane mode is turned off before it is back online.
fun waitUntilOnline() {
    send("GET", "/health").orFail("Reaching the backend")
}

internal fun HttpResult.orFail(action: String): HttpResult {
    check(isSuccess) {
        "$action failed with HTTP $code: $errorMessage. Is the backend running with ENABLE_E2E_ROUTES=true?"
    }
    return this
}

// A bottom-bar tab (the screen title isn't clickable).
internal fun MainRule.tab(label: String) = onNode(hasText(label) and hasClickAction())
