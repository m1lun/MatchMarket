package com.example.cpen321application.support

import android.content.Context
import androidx.test.espresso.IdlingRegistry
import androidx.test.espresso.IdlingResource
import coil3.EventListener
import coil3.SingletonImageLoader
import coil3.annotation.DelicateCoilApi
import coil3.request.ErrorResult
import coil3.request.ImageRequest
import coil3.request.SuccessResult
import com.example.cpen321application.shared.network.photoImageLoader
import java.util.concurrent.atomic.AtomicInteger

object PhotoIdling : IdlingResource {
    private val inFlight = AtomicInteger(0)
    @Volatile private var callback: IdlingResource.ResourceCallback? = null
    private var installed = false

    val listener: EventListener = object : EventListener() {
        override fun onStart(request: ImageRequest) {
            inFlight.incrementAndGet()
        }

        override fun onSuccess(request: ImageRequest, result: SuccessResult) = finished()

        override fun onError(request: ImageRequest, result: ErrorResult) = finished()

        override fun onCancel(request: ImageRequest) = finished()
    }

    override fun getName(): String = "PhotoIdling"

    override fun isIdleNow(): Boolean = inFlight.get() == 0

    override fun registerIdleTransitionCallback(callback: IdlingResource.ResourceCallback?) {
        this.callback = callback
    }

    @OptIn(DelicateCoilApi::class)
    @Synchronized
    fun install(context: Context) {
        if (installed) return
        SingletonImageLoader.setUnsafe(photoImageLoader(context).newBuilder().eventListener(listener).build())
        IdlingRegistry.getInstance().register(this)
        installed = true
    }

    private fun finished() {
        if (inFlight.updateAndGet { (it - 1).coerceAtLeast(0) } == 0) callback?.onTransitionToIdle()
    }
}
