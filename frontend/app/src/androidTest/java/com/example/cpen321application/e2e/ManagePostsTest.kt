package com.example.cpen321application.e2e

import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onFirst
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import com.example.cpen321application.support.back
import com.example.cpen321application.support.clearField
import com.example.cpen321application.support.click
import com.example.cpen321application.support.createPost
import com.example.cpen321application.support.deleteTestPosts
import com.example.cpen321application.support.mainRule
import com.example.cpen321application.support.openFirstPostMenu
import com.example.cpen321application.support.openMode
import com.example.cpen321application.support.postCards
import com.example.cpen321application.support.replacePrice
import com.example.cpen321application.support.setAirplaneMode
import com.example.cpen321application.support.TEST_CATEGORY
import com.example.cpen321application.support.PostForm
import com.example.cpen321application.support.TestPhotos
import com.example.cpen321application.support.waitForText
import org.junit.After
import org.junit.Before
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.junit.runners.Parameterized

@RunWith(Parameterized::class)
class ManagePostsTest(private val form: PostForm) {
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
    fun editsPost() {
        rule.createPost(form)
        rule.openFirstPostMenu()
        rule.onNodeWithText("Edit").performClick()
        rule.waitForText(form.editTitle)
        rule.replacePrice(form, "175")
        rule.click("Save changes")

        rule.waitForText(form.listHeader, substring = true)
        rule.onAllNodesWithText(TEST_CATEGORY, substring = true, ignoreCase = true).onFirst().performClick()
        rule.waitForText("175", substring = true)
    }

    @Test
    fun rejectsInvalidEditAndKeepsPost() {
        rule.createPost(form)
        rule.openFirstPostMenu()
        rule.onNodeWithText("Edit").performClick()
        rule.waitForText(form.editTitle)
        rule.clearField("Category *")
        rule.click("Save changes")

        rule.waitForText("Choose a category")
        rule.back()
        rule.waitForText(form.listHeader, substring = true)
        assertTrue(rule.postCards().size == 1)
    }

    @Test
    fun closesAndReopensPost() {
        rule.createPost(form)

        rule.openFirstPostMenu()
        rule.onNodeWithText("Close").performClick()
        rule.waitForText("Closed")

        rule.openFirstPostMenu()
        rule.onNodeWithText("Reopen").performClick()
        rule.waitForText("Open")
    }

    @Test
    fun deletesPost() {
        rule.createPost(form)
        rule.openFirstPostMenu()
        rule.onNodeWithText("Delete").performClick()
        rule.onAllNodesWithText("Delete").onFirst().performClick()

        rule.waitUntil(15_000) { rule.postCards().isEmpty() }
    }

    @Test
    fun managesPostFromItsDetailScreen() {
        rule.createPost(form)
        rule.onAllNodesWithText(TEST_CATEGORY, substring = true, ignoreCase = true).onFirst().performClick()
        rule.click("Close")
        rule.waitForText("Closed")
        rule.click("Reopen")
        rule.waitForText("Open")
        rule.click("Edit")
        rule.waitForText(form.editTitle)
        rule.replacePrice(form, "175")
        rule.click("Save changes")
        rule.waitForText("175", substring = true)
        rule.onNodeWithContentDescription("Delete").performClick()
        rule.onAllNodesWithText("Delete").onFirst().performClick()

        rule.waitUntil(15_000) { rule.postCards().isEmpty() }
    }

    @Test
    fun keepsPostWhenServerIsUnreachable() {
        rule.createPost(form)
        setAirplaneMode(true)
        rule.openFirstPostMenu()
        rule.onNodeWithText("Close").performClick()

        rule.waitForText("Could not reach the server", substring = true)
        setAirplaneMode(false)
        rule.waitForText("Open")
    }

    @Test
    fun showsErrorWhenPostsCannotLoad() {
        val otherForm = PostForm.entries.first { it != form }
        rule.openMode(otherForm.mode)
        setAirplaneMode(true)
        rule.click(form.mode)

        rule.waitForText("Could not reach the server", substring = true)
    }

    @Test
    fun keepsPostWhenEditCannotBeSaved() {
        rule.createPost(form)
        rule.openFirstPostMenu()
        rule.onNodeWithText("Edit").performClick()
        rule.waitForText(form.editTitle)
        rule.replacePrice(form, "175")
        setAirplaneMode(true)
        rule.click("Save changes")

        rule.waitForText("Could not reach the server", substring = true)
        setAirplaneMode(false)
        rule.back()
        rule.waitForText(form.listHeader, substring = true)
        assertTrue(rule.onAllNodesWithText("175", substring = true).fetchSemanticsNodes().isEmpty())
    }

    @Test
    fun keepsPostClosedWhenReopenFails() {
        rule.createPost(form)
        rule.openFirstPostMenu()
        rule.onNodeWithText("Close").performClick()
        rule.waitForText("Closed")
        setAirplaneMode(true)
        rule.openFirstPostMenu()
        rule.onNodeWithText("Reopen").performClick()

        rule.waitForText("Could not reach the server", substring = true)
        setAirplaneMode(false)
        rule.waitForText("Closed")
    }

    @Test
    fun keepsPostWhenDeleteFails() {
        rule.createPost(form)
        setAirplaneMode(true)
        rule.openFirstPostMenu()
        rule.onNodeWithText("Delete").performClick()
        rule.onAllNodesWithText("Delete").onFirst().performClick()

        rule.waitForText("Could not reach the server", substring = true)
        setAirplaneMode(false)
        assertTrue(rule.postCards().size == 1)
    }
}
