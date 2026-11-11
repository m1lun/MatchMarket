package com.example.cpen321application.support

import android.content.ContentValues
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.net.Uri
import android.provider.MediaStore
import androidx.compose.ui.test.SemanticsNodeInteraction
import androidx.compose.ui.test.hasSetTextAction
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.junit4.AndroidComposeTestRule
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onAllNodesWithContentDescription
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onFirst
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import androidx.compose.ui.test.performTextClearance
import androidx.compose.ui.test.performTextInput
import androidx.compose.ui.test.performTextReplacement
import androidx.test.ext.junit.rules.ActivityScenarioRule
import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.uiautomator.By
import androidx.test.uiautomator.UiDevice
import androidx.test.uiautomator.Until
import com.example.cpen321application.BuildConfig
import com.example.cpen321application.MainActivity
import com.example.cpen321application.auth.SessionManager
import com.example.cpen321application.post.ApiException
import com.example.cpen321application.post.Mode
import com.example.cpen321application.post.PostApi
import com.example.cpen321application.post.PostSummary
import com.example.cpen321application.post.SessionRequestAuth
import kotlinx.coroutines.delay
import kotlinx.coroutines.runBlocking
import java.io.ByteArrayOutputStream
import java.util.Random
import org.junit.rules.ExternalResource

typealias MainRule = AndroidComposeTestRule<ActivityScenarioRule<MainActivity>, MainActivity>

const val TEST_CATEGORY = "e2e chair"
const val TEST_NAME = "Test item"
const val TEST_ADDRESS = "6335 Thunderbird Crescent, Vancouver"
private const val WAIT_MS = 15_000L
private const val SUGGESTION_WAIT_MS = 8_000L
private const val ADDRESS_ATTEMPTS = 3
private const val ONLINE_WAIT_MS = 60_000L
private const val RETRY_DELAY_MS = 1_000L
private const val PICKER_PHOTO = "Photo taken on"
private const val OPEN_ATTEMPTS = 3
private const val FORM_WAIT_MS = 5_000L

fun mainRule(): MainRule = createAndroidComposeRule<MainActivity>()

val device: UiDevice get() = UiDevice.getInstance(InstrumentationRegistry.getInstrumentation())

fun setAirplaneMode(on: Boolean) {
    device.executeShellCommand("cmd connectivity airplane-mode ${if (on) "enable" else "disable"}")
    Thread.sleep(2_000)
}

fun SemanticsNodeInteraction.scrolled(): SemanticsNodeInteraction {
    runCatching { performScrollTo() }
    return this
}

fun MainRule.waitForText(text: String, substring: Boolean = false, ignoreCase: Boolean = false, timeoutMs: Long = WAIT_MS) {
    waitUntil(timeoutMs) {
        onAllNodesWithText(text, substring = substring, ignoreCase = ignoreCase).fetchSemanticsNodes().isNotEmpty()
    }
}

fun MainRule.waitForTextGone(text: String, substring: Boolean = false, ignoreCase: Boolean = false) {
    waitUntil(WAIT_MS) {
        onAllNodesWithText(text, substring = substring, ignoreCase = ignoreCase).fetchSemanticsNodes().isEmpty()
    }
}

fun MainRule.click(text: String) {
    onNodeWithText(text).scrolled().performClick()
}

fun MainRule.field(label: String): SemanticsNodeInteraction =
    onNode(hasSetTextAction() and hasText(label)).scrolled()

fun MainRule.type(label: String, value: String) {
    field(label).performTextInput(value)
}

fun MainRule.back() {
    onNodeWithContentDescription("Back").scrolled().performClick()
}

fun MainRule.firstValueField(): SemanticsNodeInteraction =
    onAllNodes(hasSetTextAction() and hasText("Value")).onFirst().scrolled()

fun MainRule.valueField(index: Int): SemanticsNodeInteraction =
    onAllNodes(hasSetTextAction() and hasText("Value"))[index].scrolled()

fun MainRule.openMode(label: String) {
    if (onAllNodesWithText(label).fetchSemanticsNodes().isEmpty()) click("My Posts")
    click(label)
    waitForText("My ", substring = true)
}

fun MainRule.pickAddress(query: String) {
    field("Address *").performTextReplacement(query)
    var attempt = 1
    while (runCatching { waitForText("📍", substring = true, timeoutMs = SUGGESTION_WAIT_MS) }.isFailure) {
        check(attempt++ < ADDRESS_ATTEMPTS) { "No address suggestions for \"$query\"" }
        field("Address *").performTextReplacement(query.dropLast(1))
        field("Address *").performTextReplacement(query)
    }
    onAllNodesWithText("📍", substring = true).onFirst().performClick()
    waitForText("✓ Address confirmed")
}

fun MainRule.postCards(): List<*> =
    onAllNodesWithText(TEST_CATEGORY, substring = true, ignoreCase = true).fetchSemanticsNodes()

fun MainRule.openForm(form: PostForm) {
    openMode(form.mode)
    repeat(OPEN_ATTEMPTS) {
        click(form.newButton)
        if (runCatching { waitForText("Category *", timeoutMs = FORM_WAIT_MS) }.isSuccess) return
    }
    error("The \"${form.newButton}\" form did not open")
}

fun MainRule.enterPrice(form: PostForm, price: String) {
    if (form == PostForm.REQUEST) firstValueField().performTextInput(price) else type("Price *", price)
}

fun MainRule.replacePrice(form: PostForm, price: String) {
    val priceField = if (form == PostForm.REQUEST) firstValueField() else field("Price *")
    priceField.performTextReplacement(price)
}

fun MainRule.fillForm(
    form: PostForm,
    price: String? = "150",
    photos: Int = if (form.photoRequired) 1 else 0,
    address: String? = TEST_ADDRESS,
    name: String? = TEST_NAME,
) {
    name?.let { type("Name *", it) }
    type("Category *", TEST_CATEGORY)
    address?.let { pickAddress(it) }
    price?.let { enterPrice(form, it) }
    if (photos > 0) pickPhotos(photos)
}

fun MainRule.createPost(form: PostForm) {
    openForm(form)
    fillForm(form)
    click(form.createButton)
    waitForText(form.listHeader, substring = true)
    // The header alone does not mean the list has loaded; wait for the new post itself.
    waitUntil(WAIT_MS) { postCards().size == 1 }
}

fun MainRule.pickPhotos(count: Int, total: Int? = count) {
    click("+ Add")
    device.wait(Until.hasObject(By.descStartsWith(PICKER_PHOTO)), WAIT_MS)
    repeat(count) { index ->
        device.wait(Until.findObjects(By.descStartsWith(PICKER_PHOTO)), WAIT_MS)[index].click()
    }
    device.wait(Until.findObject(By.text("Done")), WAIT_MS).click()
    if (total != null) waitForText("Photos $total/10", substring = true)
}

fun MainRule.pickPhoto() = pickPhotos(1)

fun MainRule.pickPhotoWithId(id: String) {
    pickPhotos(1)
    waitForText("${id.takeLast(8)} ✕")
}

fun MainRule.openFirstPostMenu() {
    onAllNodesWithContentDescription("More options").onFirst().performClick()
}

private val api by lazy {
    val context = InstrumentationRegistry.getInstrumentation().targetContext
    PostApi(
        BuildConfig.API_BASE_URL.trimEnd('/') + "/api",
        SessionRequestAuth(SessionManager.get(context)),
        context.resources,
    )
}

private suspend fun <T> whenOnline(block: suspend () -> T): T {
    val deadline = System.currentTimeMillis() + ONLINE_WAIT_MS
    while (true) {
        try {
            return block()
        } catch (e: ApiException) {
            if (System.currentTimeMillis() > deadline) throw e
            delay(RETRY_DELAY_MS)
        }
    }
}

fun testPosts(): List<Pair<Mode, PostSummary>> = runBlocking {
    whenOnline {
        Mode.entries.flatMap { mode ->
            api.listPosts(mode)
                .filter { it.detail.category.equals(TEST_CATEGORY, ignoreCase = true) }
                .map { mode to it }
        }
    }
}

fun deleteTestPosts() {
    runBlocking { testPosts().forEach { (mode, post) -> whenOnline { api.deletePost(mode, post.id) } } }
}

fun MainRule.clearField(label: String) {
    field(label).performTextClearance()
}

class TestPhotos : ExternalResource() {
    private val resolver = InstrumentationRegistry.getInstrumentation().targetContext.contentResolver

    override fun before() {
        deleteAll()
        repeat(SMALL_PHOTOS) { insert("e2e_photo_$it.jpg", smallJpeg(it)) }
    }

    override fun after() = deleteAll()

    private fun deleteAll() {
        device.executeShellCommand(
            "content delete --uri ${MediaStore.Images.Media.EXTERNAL_CONTENT_URI} --where relative_path='$FOLDER'",
        )
    }

    fun replaceWithOversized(): String {
        deleteAll()
        return insert("e2e_oversized.jpg", oversizedJpeg()).lastPathSegment.orEmpty()
    }

    private fun insert(name: String, bytes: ByteArray): Uri {
        val values = ContentValues().apply {
            put(MediaStore.Images.Media.DISPLAY_NAME, name)
            put(MediaStore.Images.Media.MIME_TYPE, "image/jpeg")
            put(MediaStore.Images.Media.RELATIVE_PATH, FOLDER)
            put(MediaStore.Images.Media.IS_PENDING, 1)
        }
        val uri = checkNotNull(resolver.insert(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, values))
        resolver.openOutputStream(uri)!!.use { it.write(bytes) }
        resolver.update(uri, ContentValues().apply { put(MediaStore.Images.Media.IS_PENDING, 0) }, null, null)
        return uri
    }

    private fun smallJpeg(seed: Int): ByteArray {
        val bitmap = Bitmap.createBitmap(640, 480, Bitmap.Config.ARGB_8888)
        val canvas = Canvas(bitmap)
        canvas.drawColor(Color.HSVToColor(floatArrayOf(seed * 29f % 360f, 0.5f, 0.9f)))
        val paint = Paint().apply { color = Color.HSVToColor(floatArrayOf((seed * 29f + 180f) % 360f, 0.8f, 0.6f)) }
        canvas.drawRect(120f, 160f, 520f, 400f, paint)
        return compress(bitmap, 90)
    }

    private fun oversizedJpeg(): ByteArray {
        val random = Random(1)
        var side = 2_400
        while (true) {
            val pixels = IntArray(side * side) { random.nextInt() or 0xFF000000.toInt() }
            val bytes = compress(Bitmap.createBitmap(pixels, side, side, Bitmap.Config.ARGB_8888), 100)
            if (bytes.size > OVERSIZED_BYTES) return bytes
            side += 600
        }
    }

    private fun compress(bitmap: Bitmap, quality: Int): ByteArray =
        ByteArrayOutputStream().also { bitmap.compress(Bitmap.CompressFormat.JPEG, quality, it) }.toByteArray()

    private companion object {
        const val FOLDER = "Pictures/e2e/"
        const val SMALL_PHOTOS = 12
        const val OVERSIZED_BYTES = 5 * 1024 * 1024 + 256 * 1024
    }
}
