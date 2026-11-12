package com.example.cpen321application.post

import android.content.Context
import coil3.ImageLoader
import coil3.network.okhttp.OkHttpNetworkFetcherFactory
import com.example.cpen321application.BuildConfig
import com.example.cpen321application.auth.SessionExpiredException
import com.example.cpen321application.auth.SessionManager
import kotlinx.coroutines.runBlocking
import okhttp3.HttpUrl
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.Interceptor
import okhttp3.OkHttpClient
import okhttp3.Response

fun photoImageLoader(context: Context): ImageLoader {
    val client = OkHttpClient.Builder()
        .addInterceptor(BackendTokenInterceptor(SessionManager.get(context), BuildConfig.API_BASE_URL.toHttpUrl()))
        .build()
    return ImageLoader.Builder(context)
        .components { add(OkHttpNetworkFetcherFactory(callFactory = { client })) }
        .build()
}

private class BackendTokenInterceptor(
    private val sessions: SessionManager,
    private val backend: HttpUrl,
) : Interceptor {
    override fun intercept(chain: Interceptor.Chain): Response {
        val request = chain.request()
        val url = request.url
        val toBackend = url.scheme == backend.scheme && url.host == backend.host && url.port == backend.port
        val token = if (toBackend) runBlocking { currentToken() } else null
        val withToken = token?.let { request.newBuilder().header("Authorization", "Bearer $it").build() }
        return chain.proceed(withToken ?: request)
    }

    private suspend fun currentToken(): String? = try {
        sessions.sessionToken()
    } catch (_: SessionExpiredException) {
        null
    }
}
