package com.example.cpen321application.e2e

import androidx.compose.ui.test.assertIsNotEnabled
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performTextInput
import com.example.cpen321application.support.PostForm
import com.example.cpen321application.support.TEST_NAME
import com.example.cpen321application.support.TestPhotos
import com.example.cpen321application.support.click
import com.example.cpen321application.support.createPost
import com.example.cpen321application.support.deleteTestPosts
import com.example.cpen321application.support.fillForm
import com.example.cpen321application.support.mainRule
import com.example.cpen321application.support.openForm
import com.example.cpen321application.support.pickPhotoWithId
import com.example.cpen321application.support.pickPhotos
import com.example.cpen321application.support.postCards
import com.example.cpen321application.support.scrolled
import com.example.cpen321application.support.setAirplaneMode
import com.example.cpen321application.support.testPosts
import com.example.cpen321application.support.type
import com.example.cpen321application.support.valueField
import com.example.cpen321application.support.waitForText
import org.junit.After
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.junit.runners.Parameterized

@RunWith(Parameterized::class)
class CreatePostTest(private val form: PostForm) {
    companion object {
        @JvmStatic
        @Parameterized.Parameters(name = "{0}")
        fun forms() = PostForm.entries
    }

    @get:Rule
    val photos = TestPhotos()

    @get:Rule
    val rule = mainRule()

    @Before
    fun removeLeftovers() {
        deleteTestPosts()
    }

    @After
    fun cleanUp() {
        setAirplaneMode(false)
        deleteTestPosts()
    }

    @Test
    fun createsPostAndShowsItInMyPosts() {
        rule.createPost(form)

        assertTrue(rule.postCards().size == 1)
        rule.waitForText(TEST_NAME, substring = true)
    }

    @Test
    fun createsPostWithSeveralPhotos() {
        rule.openForm(form)
        rule.fillForm(form, photos = 3)
        rule.click(form.createButton)

        rule.waitForText(form.listHeader, substring = true)
        assertTrue(rule.postCards().size == 1)
    }

    @Test
    fun createsPostWithOptionalFields() {
        val request = form == PostForm.REQUEST
        rule.openForm(form)
        rule.fillForm(form)
        rule.type("Description", "Oak, barely used")
        if (request) {
            rule.click("Any")
            rule.click("Fair")
            rule.valueField(1).performTextInput("5")
            rule.onAllNodesWithText("Must have")[3].scrolled().performClick()
        } else {
            rule.click("Good")
            rule.click("Like New")
        }
        rule.type("W", "120")
        rule.type("H", "75")
        rule.type("D", "60")
        rule.valueField(if (request) 2 else 0).performTextInput("ikea")
        rule.valueField(if (request) 3 else 1).performTextInput("brown")
        rule.click("+ Add field")
        rule.type("Name", "Material")
        rule.click("Add")
        rule.valueField(if (request) 4 else 2).performTextInput("oak")
        rule.click(form.createButton)

        rule.waitForText(form.listHeader, substring = true)
        val post = testPosts().single().second.raw
        val fields = post.getJSONArray(if (request) "requestFields" else "listingFields")
        val saved = (0 until fields.length()).associate { fields.getJSONObject(it).let { f -> f.getString("key") to f } }
        assertTrue(post.getString("description") == "Oak, barely used")
        assertTrue(saved.keys.containsAll(listOf("dimensions", "brand", "colour", "material")))
        if (request) {
            assertTrue(saved.getValue("condition").getString("value") == "fair")
            assertTrue(saved.getValue("radiuskm").getBoolean("hard"))
        } else {
            assertTrue(post.getString("condition") == "like new")
        }
    }

    @Test
    fun rejectsMissingCategory() {
        rule.openForm(form)
        rule.click(form.createButton)

        rule.waitForText("Choose a category")
        rule.onNodeWithText(form.createButton).assertExists()
    }

    @Test
    fun rejectsMissingName() {
        rule.openForm(form)
        rule.fillForm(form, name = null)
        rule.click(form.createButton)

        rule.waitForText("Enter a name")
        assertTrue(testPosts().isEmpty())
    }

    @Test
    fun rejectsMissingPrice() {
        rule.openForm(form)
        rule.fillForm(form, price = null)
        rule.click(form.createButton)

        rule.waitForText(form.missingPriceError)
        assertTrue(testPosts().isEmpty())
    }

    @Test
    fun rejectsNegativePrice() {
        rule.openForm(form)
        rule.fillForm(form, price = "-5")
        rule.click(form.createButton)

        rule.waitForText(form.negativePriceError, substring = true)
        assertTrue(testPosts().isEmpty())
    }

    @Test
    fun photoIsRequiredOnlyOnListings() {
        rule.openForm(form)
        rule.fillForm(form, photos = 0)
        rule.click(form.createButton)

        if (form.photoRequired) {
            rule.waitForText("Add at least one photo")
            assertTrue(testPosts().isEmpty())
        } else {
            rule.waitForText(form.listHeader, substring = true)
            assertTrue(rule.postCards().size == 1)
        }
    }

    @Test
    fun rejectsAddressThatWasNotPicked() {
        rule.openForm(form)
        rule.fillForm(form, address = null)
        rule.type("Address *", "zzzzqqqqxxxx nowhere")
        rule.click(form.createButton)

        rule.waitForText("Choose your address from the suggestions list", substring = true)
        assertTrue(testPosts().isEmpty())
    }

    @Test
    fun showsErrorWhenServerIsUnreachable() {
        rule.openForm(form)
        rule.fillForm(form)
        setAirplaneMode(true)
        rule.click(form.createButton)

        rule.waitForText("Could not reach the server", substring = true)
        setAirplaneMode(false)
        rule.onNodeWithText(form.createButton).assertExists()
    }

    @Test
    fun rejectsPhotoOverFiveMegabytes() {
        val oversized = photos.replaceWithOversized()
        rule.openForm(form)
        rule.fillForm(form, photos = 0)
        rule.pickPhotoWithId(oversized)
        rule.click(form.createButton)

        rule.waitForText("Each photo must be at most 5 MB")
        assertTrue(testPosts().isEmpty())
    }

    @Test
    fun limitsPhotosToTen() {
        rule.openForm(form)
        rule.pickPhotos(6)
        rule.pickPhotos(6, total = 10)

        rule.onNodeWithText("+ Add").assertIsNotEnabled()
    }
}
