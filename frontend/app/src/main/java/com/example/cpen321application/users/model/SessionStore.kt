package com.example.cpen321application.users.model

import android.content.Context

// Where the signed-in session is kept between app launches.
interface SessionStorage {
    fun load(): AuthSession?
    fun save(session: AuthSession)
    fun clear()
}

// Keeps the session in this app's private storage, which other apps cannot
// read. The file is excluded from cloud backup and device transfer
// (res/xml/backup_rules.xml, data_extraction_rules.xml), so the refresh token
// never leaves the device.
class SessionStore(context: Context) : SessionStorage {
    private val prefs = context.getSharedPreferences(FILE_NAME, Context.MODE_PRIVATE)

    override fun load(): AuthSession? {
        val refreshToken = prefs.getString(KEY_REFRESH_TOKEN, null) ?: return null
        return AuthSession(
            firstName = prefs.getString(KEY_FIRST_NAME, null).orEmpty(),
            lastName = prefs.getString(KEY_LAST_NAME, null).orEmpty(),
            email = prefs.getString(KEY_EMAIL, null).orEmpty(),
            sessionToken = prefs.getString(KEY_SESSION_TOKEN, null).orEmpty(),
            sessionExpiresAtMs = prefs.getLong(KEY_SESSION_EXPIRES_AT, 0L),
            refreshToken = refreshToken
        )
    }

    override fun save(session: AuthSession) {
        prefs.edit()
            .putString(KEY_FIRST_NAME, session.firstName)
            .putString(KEY_LAST_NAME, session.lastName)
            .putString(KEY_EMAIL, session.email)
            .putString(KEY_SESSION_TOKEN, session.sessionToken)
            .putLong(KEY_SESSION_EXPIRES_AT, session.sessionExpiresAtMs)
            .putString(KEY_REFRESH_TOKEN, session.refreshToken)
            .apply()
    }

    override fun clear() {
        prefs.edit().clear().apply()
    }

    private companion object {
        // Also named in res/xml/backup_rules.xml and data_extraction_rules.xml.
        const val FILE_NAME = "auth_session"
        const val KEY_FIRST_NAME = "first_name"
        const val KEY_LAST_NAME = "last_name"
        const val KEY_EMAIL = "email"
        const val KEY_SESSION_TOKEN = "session_token"
        const val KEY_SESSION_EXPIRES_AT = "session_expires_at"
        const val KEY_REFRESH_TOKEN = "refresh_token"
    }
}
