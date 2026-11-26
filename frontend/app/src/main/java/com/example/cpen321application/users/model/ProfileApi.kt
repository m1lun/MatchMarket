package com.example.cpen321application.users.model

import com.example.cpen321application.users.model.SessionManager
import com.example.cpen321application.matching.model.Place
import com.example.cpen321application.posts.model.AddressSuggestion
import com.example.cpen321application.posts.model.Mode
import java.io.IOException
import java.net.URLEncoder
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import org.json.JSONArray
import org.json.JSONObject

// The signed-in user's own profile, as GET /api/users/me returns it.
data class Profile(
    val id: String,
    val firstName: String,
    val lastName: String,
    val email: String,
    val pictureUrl: String?,
    // The home address and its coordinates, or null when the user has not set one.
    val home: Place?,
    // The day the account was made, in the user's time zone.
    val memberSince: LocalDate
) {
    // Full name, or the email when the Google account has no name on it.
    val displayName: String
        get() = "$firstName $lastName".trim().ifEmpty { email }
}

// The average stars others gave the user (null until someone rates them) and how many ratings that is.
data class Reputation(val score: Double?, val ratingCount: Int)

class ProfileApi(private val sessions: SessionManager) {
    suspend fun me(): Profile = parseProfile(JSONObject(send("GET", "/api/users/me")))

    // Saves the picked address as the user's home address, or removes it when place is null.
    suspend fun saveAddress(place: AddressSuggestion?): Profile {
        val location = place?.let { JSONObject().put("longitude", it.longitude).put("latitude", it.latitude) }
        val body = JSONObject()
            .put("address", place?.label ?: JSONObject.NULL)
            .put("location", location ?: JSONObject.NULL)
        return parseProfile(JSONObject(send("PATCH", "/api/users/me", body)))
    }

    suspend fun reputation(userId: String): Reputation {
        val json = JSONObject(send("GET", "/api/users/${URLEncoder.encode(userId, "UTF-8")}/reputation"))
        return Reputation(if (json.isNull("score")) null else json.getDouble("score"), json.getInt("ratingCount"))
    }

    // How many listings (selling) or requests (buying) the user has, open or closed.
    suspend fun countPosts(mode: Mode): Int = JSONArray(send("GET", "/api/${mode.path}")).length()

    // The body of a successful response; an error status is thrown as an IOException.
    private suspend fun send(method: String, path: String, body: JSONObject? = null): String {
        val result = sessions.authorizedRequest(method, path, body)
        if (!result.isSuccess) {
            throw IOException("HTTP ${result.code}: ${result.errorMessage}")
        }
        return result.body
    }
}

private fun parseProfile(user: JSONObject): Profile = Profile(
    id = user.getString("id"),
    firstName = user.getString("firstName"),
    lastName = user.getString("lastName"),
    email = user.getString("email"),
    pictureUrl = user.optText("pictureUrl"),
    home = homeOf(user),
    memberSince = Instant.parse(user.getString("createdAt")).atZone(ZoneId.systemDefault()).toLocalDate()
)

// The backend leaves address and location out of the response when the user has not set them.
// location is GeoJSON, so its coordinates are [longitude, latitude].
private fun homeOf(user: JSONObject): Place? {
    if (user.isNull("address") || user.isNull("location")) return null
    val coordinates = user.getJSONObject("location").getJSONArray("coordinates")
    return Place(user.getString("address"), lat = coordinates.getDouble(1), lng = coordinates.getDouble(0))
}

private fun JSONObject.optText(key: String): String? = if (isNull(key)) null else getString(key)
