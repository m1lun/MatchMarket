package com.example.cpen321application

import android.content.Intent
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.BackHandler
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.viewModels
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.List
import androidx.compose.material.icons.filled.Email
import androidx.compose.material.icons.filled.Home
import androidx.compose.material.icons.filled.Person
import androidx.compose.material.icons.filled.ShoppingCart
import androidx.compose.material3.Badge
import androidx.compose.material3.BadgedBox
import androidx.compose.material3.Icon
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarDuration
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.SnackbarResult
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.runtime.snapshotFlow
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.lifecycle.lifecycleScope
import coil3.SingletonImageLoader
import com.example.cpen321application.components.deals.view.DealsTab
import com.example.cpen321application.components.deals.viewmodel.DealsViewModel
import com.example.cpen321application.components.matching.model.FeedItem
import com.example.cpen321application.components.matching.model.OwnPost
import com.example.cpen321application.components.matching.model.ownPostOf
import com.example.cpen321application.components.matching.model.plain
import com.example.cpen321application.components.matching.view.FeedTab
import com.example.cpen321application.components.matching.viewmodel.FeedViewModel
import com.example.cpen321application.components.messaging.model.OfferTarget
import com.example.cpen321application.components.messaging.view.MessagesTab
import com.example.cpen321application.components.messaging.view.MessagesTags
import com.example.cpen321application.components.messaging.view.OfferDialog
import com.example.cpen321application.components.messaging.view.noticeText
import com.example.cpen321application.components.messaging.viewmodel.MessagesViewModel
import com.example.cpen321application.components.posts.model.AppTab
import com.example.cpen321application.components.posts.model.Mode
import com.example.cpen321application.components.posts.model.PostSummary
import com.example.cpen321application.components.posts.view.PostDetailScreen
import com.example.cpen321application.components.posts.view.PostEditorScreen
import com.example.cpen321application.components.posts.view.PostScreen
import com.example.cpen321application.components.posts.viewmodel.PostViewModel
import com.example.cpen321application.shared.network.photoImageLoader
import com.example.cpen321application.shared.theme.CPEN321ApplicationTheme
import com.example.cpen321application.components.users.model.SessionManager
import com.example.cpen321application.components.users.view.LoginActivity
import com.example.cpen321application.components.users.view.ProfileTab
import com.example.cpen321application.components.users.viewmodel.ProfileViewModel
import kotlinx.coroutines.flow.filterNotNull
import kotlinx.coroutines.launch

/**
 * Hosts the app's bottom menu once the user is signed in. "My Posts" is a
 * Buying / Selling toggle over the user's own requests and listings.
 */
class MainActivity : ComponentActivity() {
    private val viewModel: PostViewModel by viewModels()
    private val feedViewModel: FeedViewModel by viewModels()
    private val dealsViewModel: DealsViewModel by viewModels()
    private val messagesViewModel: MessagesViewModel by viewModels()
    private val profileViewModel: ProfileViewModel by viewModels()
    private var signingOut = false

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val sessions = SessionManager.get(this)
        if (sessions.session == null) {
            startActivity(Intent(this, LoginActivity::class.java))
            finish()
            return
        }
        SingletonImageLoader.setSafe { photoImageLoader(applicationContext) }
        enableEdgeToEdge()
        setContent {
            CPEN321ApplicationTheme {
                val snackbar = remember { SnackbarHostState() }
                LaunchedEffect(viewModel.message) {
                    viewModel.message?.let {
                        snackbar.showSnackbar(it)
                        viewModel.message = null
                    }
                }
                val fullScreen = viewModel.editing || viewModel.selected != null || viewModel.openPost != null
                BackHandler(enabled = fullScreen) {
                    when {
                        viewModel.openPost != null -> viewModel.closeOpenPost()
                        viewModel.editing -> viewModel.stopEditing()
                        else -> viewModel.selected = null
                    }
                }
                LiveUpdates(snackbar)
                LaunchedEffect(viewModel.recommendationsFor) {
                    viewModel.recommendationsFor?.let {
                        feedViewModel.recommendFor(ownPostOf(it.raw), viewModel.mode)
                        viewModel.recommendationsFor = null
                    }
                }
                Scaffold(
                    modifier = Modifier.fillMaxSize(),
                    snackbarHost = { SnackbarHost(snackbar) },
                    bottomBar = {
                        if (!fullScreen) AppNavigationBar(viewModel, messagesViewModel.live.unread.isNotEmpty())
                    },
                ) { innerPadding -> Content(innerPadding) }
            }
        }
    }

    override fun onStart() {
        super.onStart()
        if (!isFinishing) messagesViewModel.startLiveUpdates()
    }

    override fun onStop() {
        super.onStop()
        messagesViewModel.stopLiveUpdates()
    }

    override fun onResume() {
        super.onResume()
        if (!isFinishing && viewModel.tab == AppTab.DEALS) dealsViewModel.refreshIfStale()
    }

    // Several screens react to an expired session, so only the first one signs out.
    private fun signOut() {
        if (signingOut) return
        signingOut = true
        lifecycleScope.launch {
            SessionManager.get(this@MainActivity).signOut()
            startActivity(
                Intent(this@MainActivity, LoginActivity::class.java)
                    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TASK)
            )
            finish()
        }
    }

    // Live news outside the open chat: a banner that opens the conversation, and reloading the deals and the
    // user's posts when one of the user's proposals is accepted.
    @Composable
    private fun LiveUpdates(snackbar: SnackbarHostState) {
        val live = messagesViewModel.live
        val resources = LocalContext.current.resources
        val openLabel = stringResource(R.string.notice_open)
        LaunchedEffect(viewModel.tab, messagesViewModel.chat?.conversation?.id) {
            live.show(viewModel.tab == AppTab.MESSAGES, messagesViewModel.chat?.conversation?.id)
        }
        LaunchedEffect(messagesViewModel.signedOut) {
            if (messagesViewModel.signedOut) signOut()
        }
        // Keyed on Unit, not the notice: clearing the notice must not cancel the banner showing it.
        LaunchedEffect(Unit) {
            snapshotFlow { live.notice }.filterNotNull().collect { notice ->
                live.noticeShown()
                // A snackbar with an action stays until it's tapped unless it has a duration.
                val result = snackbar.showSnackbar(
                    noticeText(notice, resources),
                    actionLabel = openLabel,
                    duration = SnackbarDuration.Long,
                )
                if (result == SnackbarResult.ActionPerformed) {
                    viewModel.tab = AppTab.MESSAGES
                    messagesViewModel.openChat(notice.conversation)
                }
            }
        }
        LaunchedEffect(live.dealsMade) {
            if (live.dealsMade == 0) return@LaunchedEffect
            viewModel.refresh()
            if (viewModel.tab == AppTab.DEALS) dealsViewModel.refresh()
        }
    }

    @Composable
    private fun Content(innerPadding: PaddingValues) {
        val selected = viewModel.selected
        val openPost = viewModel.openPost
        when {
            openPost != null -> OpenPost(openPost, innerPadding)
            viewModel.editing -> PostEditorScreen(viewModel, innerPadding)
            selected != null -> PostDetailScreen(selected, viewModel.mode, viewModel, innerPadding)
            viewModel.tab == AppTab.FEED -> FeedTab(feedViewModel, ::signOut, innerPadding) {
                messagesViewModel.offerTarget = offerTargetOf(it, feedViewModel.query.recommendedFor)
                viewModel.open(it.raw, if (it.isRequest) Mode.BUYING else Mode.SELLING)
            }
            viewModel.tab == AppTab.POSTS -> PostScreen(viewModel, innerPadding)
            viewModel.tab == AppTab.DEALS -> DealsTab(dealsViewModel, ::signOut, innerPadding) { raw, mode ->
                messagesViewModel.offerTarget = null
                viewModel.open(raw, mode)
            }
            viewModel.tab == AppTab.MESSAGES -> MessagesTab(messagesViewModel, ::signOut, innerPadding)
            else -> ProfileTab(profileViewModel, ::signOut, innerPadding) {
                viewModel.selectMode(it)
                viewModel.tab = AppTab.POSTS
            }
        }
    }

    // Another user's post. One opened from the feed can start a conversation, with an offer as its first step.
    @Composable
    private fun OpenPost(post: PostSummary, innerPadding: PaddingValues) {
        val target = messagesViewModel.offerTarget
        var offering by rememberSaveable { mutableStateOf(false) }
        LaunchedEffect(messagesViewModel.signedOut) {
            if (messagesViewModel.signedOut) signOut()
        }
        PostDetailScreen(
            post,
            viewModel.openPostMode,
            viewModel,
            innerPadding,
            readOnly = true,
            onBack = viewModel::closeOpenPost,
            onMessage = target?.let {
                {
                    messagesViewModel.clearOfferError()
                    offering = true
                }
            },
        )
        if (offering && target != null) {
            OfferDialog(
                target,
                messagesViewModel,
                onSent = {
                    offering = false
                    viewModel.closeOpenPost()
                    viewModel.tab = AppTab.MESSAGES
                },
                onDismiss = { offering = false },
            )
        }
    }
}

private fun offerTargetOf(item: FeedItem, recommendedFor: OwnPost?) = OfferTarget(
    postId = item.id,
    postKind = if (item.isRequest) "request" else "listing",
    myPostId = recommendedFor?.id,
    suggestedPrice = item.price?.let(::plain).orEmpty(),
)

// unreadMessages puts a dot on the Messages tab.
@Composable
private fun AppNavigationBar(viewModel: PostViewModel, unreadMessages: Boolean) {
    NavigationBar {
        AppTab.entries.forEach { tab ->
            val label = stringResource(tab.label)
            NavigationBarItem(
                selected = viewModel.tab == tab,
                onClick = { viewModel.tab = tab },
                icon = {
                    BadgedBox(badge = {
                        if (tab == AppTab.MESSAGES && unreadMessages) {
                            Badge(modifier = Modifier.testTag(MessagesTags.UNREAD_TAB))
                        }
                    }) {
                        Icon(tab.icon(), contentDescription = label)
                    }
                },
                label = { Text(label) },
            )
        }
    }
}

private fun AppTab.icon(): ImageVector = when (this) {
    AppTab.FEED -> Icons.Filled.Home
    AppTab.POSTS -> Icons.AutoMirrored.Filled.List
    AppTab.DEALS -> Icons.Filled.ShoppingCart
    AppTab.MESSAGES -> Icons.Filled.Email
    AppTab.PROFILE -> Icons.Filled.Person
}
