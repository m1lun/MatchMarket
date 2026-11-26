package com.example.cpen321application.users.view

import android.content.Context
import android.content.Intent
import android.os.Bundle
import android.provider.Settings
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.credentials.CredentialManager
import androidx.credentials.GetCredentialRequest
import androidx.credentials.exceptions.GetCredentialCancellationException
import androidx.credentials.exceptions.GetCredentialException
import androidx.credentials.exceptions.NoCredentialException
import com.example.cpen321application.BuildConfig
import com.example.cpen321application.MainActivity
import com.example.cpen321application.R
import com.example.cpen321application.shared.theme.CPEN321ApplicationTheme
import com.example.cpen321application.users.model.AuthSession
import com.example.cpen321application.users.model.SessionManager
import com.google.android.libraries.identity.googleid.GetSignInWithGoogleOption
import com.google.android.libraries.identity.googleid.GoogleIdTokenCredential
import com.google.android.libraries.identity.googleid.GoogleIdTokenParsingException
import java.io.IOException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.launch
import org.json.JSONException

private const val TAG = "LoginActivity"

class LoginActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        setContent {
            CPEN321ApplicationTheme {
                Scaffold(modifier = Modifier.fillMaxSize()) { innerPadding ->
                    LoginScreen(
                        sessions = SessionManager.get(this),
                        googleClientId = BuildConfig.GOOGLE_CLIENT_ID,
                        modifier = Modifier.padding(innerPadding)
                    )
                }
            }
        }
    }
}

// What the sign-in screen shows while no one is signed in.
private data class SignInUiState(
    val isLoading: Boolean = false,
    val errorMessage: String? = null,
    val needsAccount: Boolean = false
)

// The outcome of one tap on "Sign in with Google".
private sealed interface SignInResult {
    data class Success(val session: AuthSession) : SignInResult
    data object Cancelled : SignInResult
    data object NoAccount : SignInResult
    data class Failure(val message: String) : SignInResult
}

@Composable
fun LoginScreen(sessions: SessionManager, googleClientId: String, modifier: Modifier = Modifier) {
    // A returning user's stored session is renewed first, so they skip the
    // Google prompt until their refresh token runs out or is revoked.
    var restoring by remember { mutableStateOf(sessions.session != null) }
    var signedIn by remember { mutableStateOf<AuthSession?>(null) }
    var uiState by remember { mutableStateOf(SignInUiState()) }

    val context = LocalContext.current
    val activity = context as? ComponentActivity
    val scope = rememberCoroutineScope()

    LaunchedEffect(Unit) {
        if (restoring) {
            signedIn = sessions.restore()
            restoring = false
        }
    }

    val user = signedIn
    when {
        restoring -> Box(modifier = modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
            CircularProgressIndicator()
        }
        user == null -> SignInScreen(
            state = uiState,
            onSignIn = {
                scope.launchSignIn(context, sessions, googleClientId, onState = { uiState = it }) {
                    signedIn = it
                }
            },
            onAddAccount = { context.startActivity(addGoogleAccountIntent()) },
            onBack = { activity?.finish() },
            modifier = modifier
        )
        else -> {
            LaunchedEffect(user) {
                context.startActivity(Intent(context, MainActivity::class.java))
                activity?.finish()
            }
            Box(modifier = modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                CircularProgressIndicator()
            }
        }
    }
}

// Runs when "Sign in with Google" is tapped: reports progress through
// onState, and hands over the session once the backend has accepted the user.
private fun CoroutineScope.launchSignIn(
    context: Context,
    sessions: SessionManager,
    googleClientId: String,
    onState: (SignInUiState) -> Unit,
    onSignedIn: (AuthSession) -> Unit
) {
    if (googleClientId.isBlank()) {
        onState(SignInUiState(errorMessage = context.getString(R.string.login_client_id_missing)))
        return
    }
    onState(SignInUiState(isLoading = true))
    launch {
        val result = signInWithGoogle(context, sessions, googleClientId)
        if (result is SignInResult.Success) {
            onSignedIn(result.session)
        }
        onState(
            when (result) {
                is SignInResult.Success, SignInResult.Cancelled -> SignInUiState()
                SignInResult.NoAccount -> SignInUiState(needsAccount = true)
                is SignInResult.Failure -> SignInUiState(errorMessage = result.message)
            }
        )
    }
}

// Gets a Google ID token from the device, then has the backend verify it and
// start a session. The user only counts as signed in once the server has
// accepted the token.
private suspend fun signInWithGoogle(
    context: Context,
    sessions: SessionManager,
    googleClientId: String
): SignInResult {
    return try {
        // The "Sign in with Google" button flow. Unlike the account bottom
        // sheet, it lets the user add a Google account when none is on the
        // device yet.
        val request = GetCredentialRequest.Builder()
            .addCredentialOption(GetSignInWithGoogleOption.Builder(googleClientId).build())
            .build()
        val credential = CredentialManager.create(context).getCredential(context, request).credential
        if (credential.type != GoogleIdTokenCredential.TYPE_GOOGLE_ID_TOKEN_CREDENTIAL) {
            SignInResult.Failure(context.getString(R.string.login_unexpected_credential, credential.type))
        } else {
            val idToken = GoogleIdTokenCredential.createFrom(credential.data).idToken
            SignInResult.Success(sessions.signIn(idToken))
        }
    } catch (_: GetCredentialCancellationException) {
        SignInResult.Cancelled
    } catch (_: NoCredentialException) {
        // Fallback if the flow above still finds no account: offer Android's
        // add-account screen directly.
        SignInResult.NoAccount
    } catch (e: GetCredentialException) {
        android.util.Log.e(TAG, "Sign-in failed: ${e::class.simpleName} — ${e.message}")
        SignInResult.Failure(context.getString(R.string.login_credential_error, e::class.simpleName, e.message))
    } catch (e: GoogleIdTokenParsingException) {
        android.util.Log.e(TAG, "Could not read Google ID token", e)
        SignInResult.Failure(context.getString(R.string.login_bad_token, e.message))
    } catch (e: IOException) {
        android.util.Log.e(TAG, "Backend rejected sign-in", e)
        SignInResult.Failure(context.getString(R.string.login_backend_rejected, e.message))
    } catch (e: JSONException) {
        android.util.Log.e(TAG, "Bad sign-in response", e)
        SignInResult.Failure(context.getString(R.string.login_bad_response, e.message))
    }
}

@Composable
private fun SignInScreen(
    state: SignInUiState,
    onSignIn: () -> Unit,
    onAddAccount: () -> Unit,
    onBack: () -> Unit,
    modifier: Modifier = Modifier
) {
    Column(
        modifier = modifier
            .fillMaxSize()
            .padding(32.dp),
        verticalArrangement = Arrangement.Center,
        horizontalAlignment = Alignment.CenterHorizontally
    ) {
        Text(
            text = stringResource(R.string.login_welcome),
            fontSize = 32.sp,
            fontWeight = FontWeight.Bold,
            modifier = Modifier.padding(bottom = 8.dp)
        )
        Text(
            text = stringResource(R.string.login_subtitle),
            style = MaterialTheme.typography.bodyLarge,
            textAlign = TextAlign.Center,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.padding(bottom = 48.dp)
        )

        if (state.isLoading) {
            CircularProgressIndicator()
        } else {
            SignInButtons(onSignIn = onSignIn, onBack = onBack)
        }

        if (state.needsAccount) {
            AddAccountPrompt(onAddAccount = onAddAccount)
        }

        if (state.errorMessage != null) {
            Text(
                text = state.errorMessage,
                color = MaterialTheme.colorScheme.error,
                style = MaterialTheme.typography.bodySmall,
                textAlign = TextAlign.Center,
                modifier = Modifier.padding(top = 16.dp)
            )
        }
    }
}

@Composable
private fun SignInButtons(onSignIn: () -> Unit, onBack: () -> Unit) {
    OutlinedButton(
        onClick = onSignIn,
        modifier = Modifier
            .fillMaxWidth()
            .height(50.dp)
    ) {
        Text(
            text = stringResource(R.string.login_google),
            fontWeight = FontWeight.Medium,
            fontSize = 16.sp
        )
    }

    Spacer(modifier = Modifier.height(16.dp))

    OutlinedButton(
        onClick = onBack,
        modifier = Modifier
            .fillMaxWidth()
            .height(50.dp)
    ) {
        Text(
            text = stringResource(R.string.btn_back),
            fontWeight = FontWeight.Medium,
            fontSize = 16.sp
        )
    }
}

@Composable
private fun AddAccountPrompt(onAddAccount: () -> Unit) {
    Text(
        text = stringResource(R.string.login_no_account),
        style = MaterialTheme.typography.bodyMedium,
        textAlign = TextAlign.Center,
        modifier = Modifier.padding(top = 16.dp, bottom = 8.dp)
    )
    OutlinedButton(
        onClick = onAddAccount,
        modifier = Modifier.fillMaxWidth()
    ) {
        Text(text = stringResource(R.string.btn_add_account))
    }
}

// Opens Android's add-account screen, filtered to Google accounts.
private fun addGoogleAccountIntent(): Intent =
    Intent(Settings.ACTION_ADD_ACCOUNT)
        .putExtra(Settings.EXTRA_ACCOUNT_TYPES, arrayOf("com.google"))
