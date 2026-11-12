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
import androidx.compose.material3.Icon
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.lifecycle.lifecycleScope
import coil3.SingletonImageLoader
import kotlinx.coroutines.launch
import androidx.compose.ui.graphics.vector.ImageVector
import com.example.cpen321application.auth.SessionManager
import com.example.cpen321application.deals.DealsTab
import com.example.cpen321application.deals.DealsViewModel
import com.example.cpen321application.feed.FeedItem
import com.example.cpen321application.feed.FeedTab
import com.example.cpen321application.feed.FeedViewModel
import com.example.cpen321application.feed.OwnPost
import com.example.cpen321application.feed.ownPostOf
import com.example.cpen321application.feed.plain
import com.example.cpen321application.messages.MessagesTab
import com.example.cpen321application.messages.MessagesViewModel
import com.example.cpen321application.messages.OfferDialog
import com.example.cpen321application.messages.OfferTarget
import com.example.cpen321application.post.AppTab
import com.example.cpen321application.post.Mode
import com.example.cpen321application.post.PostDetailScreen
import com.example.cpen321application.post.PostEditorScreen
import com.example.cpen321application.post.PostScreen
import com.example.cpen321application.post.PostSummary
import com.example.cpen321application.post.PostViewModel
import com.example.cpen321application.post.photoImageLoader
import com.example.cpen321application.profile.ProfileTab
import com.example.cpen321application.profile.ProfileViewModel
import com.example.cpen321application.ui.theme.CPEN321ApplicationTheme

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
                LaunchedEffect(viewModel.recommendationsFor) {
                    viewModel.recommendationsFor?.let {
                        feedViewModel.recommendFor(ownPostOf(it.raw), viewModel.mode)
                        viewModel.recommendationsFor = null
                    }
                }
                Scaffold(
                    modifier = Modifier.fillMaxSize(),
                    snackbarHost = { SnackbarHost(snackbar) },
                    bottomBar = { if (!fullScreen) AppNavigationBar(viewModel) },
                ) { innerPadding -> Content(innerPadding) }
            }
        }
    }

    override fun onResume() {
        super.onResume()
        if (!isFinishing && viewModel.tab == AppTab.DEALS) dealsViewModel.refreshIfStale()
    }

    private fun signOut() {
        lifecycleScope.launch {
            SessionManager.get(this@MainActivity).signOut()
            startActivity(
                Intent(this@MainActivity, LoginActivity::class.java)
                    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TASK)
            )
            finish()
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

@Composable
private fun AppNavigationBar(viewModel: PostViewModel) {
    NavigationBar {
        AppTab.entries.forEach { tab ->
            val label = stringResource(tab.label)
            NavigationBarItem(
                selected = viewModel.tab == tab,
                onClick = { viewModel.tab = tab },
                icon = { Icon(tab.icon(), contentDescription = label) },
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
