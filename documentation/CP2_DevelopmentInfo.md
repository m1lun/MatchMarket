# **CP2 Development Information**

## 1. Repository and submission version

| Repository | https\://github.com/m1lun/MatchMarket  |
| :---- | :---- |
| Submission branch | main |
| Submission commit SHA | 149f16a96f8931a37c0b1c8f2affbebcb3c4cc6d |

The submitted PDF has the final commit SHA. The copy of this file in the repository shows the commit before it, because committing creates a new SHA, so a file cannot contain the SHA of its own commit.

## 2. Backend server

| Configured public IP | 34.168.1.92  |
| :---- | :---- |
| Configured backend URL | https\://34.168.1.92:3000  |
| Domain name | (optional) |
| Health endpoint | GET https\://34.168.1.92:3000/health returns {"status":"ok"} |

## 3. Project scope requirement

| Requirement | Use case | How it is implemented |
| :---- | :---- | :---- |
| Team written computational code | Use Case 3: View Recommendations for a Post | Team-written matching in backend/src/matching/. Hard requirements filter the candidate posts, and soft preferences rank the rest, weighted by their importance, so the best fit comes first. |
| External API | Use Case 3: View Recommendations for a Post | The backend calls the OpenRouteService matrix API for the travel time to each match on the first page of recommendations, with a 2-second timeout. If the call fails, the recommendations are still returned and the app shows "Travel time unavailable". |
| App response to external events | Use Case 4: Send a Message | When one user sends a message or proposes, accepts or declines a price, the other user's open conversation updates without refreshing. The backend pushes these changes through Server-Sent Events on GET /api/events. |

## 4. Configuration and setup

Frontend: Android Studio, Java 17 and Android SDK Platform 35\. Verify the submitted APK on the required Pixel 9 emulator with Android Baklava API 36\.

Backend (only to run it yourself locally): Docker Compose 2.24+ with the supplied MongoDB 7 service. Direct execution instead requires [Node.js](http://Node.js) 22.x, npm 10+ and a running MongoDB instance.

| Configuration | Value |
| :---- | :---- |
| Google Web OAuth client ID | 84981459595-fiektced5pi2ihihr18g1bh49cckka69.apps.googleusercontent.com  |
| Release signing key SHA | SHA-1 43:42:F8:9F:45:6A:5B:D6:1C:84:AF:3E:22:0D:80:F4:C9:17:30:02 |
| Additional API keys or private setup details | ORS\_API\_KEY in backend/.env: an OpenRouteService API key, free at https\://account.heigit.org/signup. It is only needed to run your own backend, and without it travel times are unavailable. The key is not stored in the repository. |
| Android application ID | com.example.matchmarket |
| Backend port / database name | 3000/matchmarket |

### Option A: use the submitted APK with the deployed back end (recommended)

1. Install CP2\_MatchMarket.apk on the Pixel 9 / API 36 emulator.
2. Open the app and sign in with Google. It already points at https\://34.168.1.92:3000, and no other setup is needed.

### Option B: build and deploy it yourself

1. **Get the code.** Clone the repository and check out the submission commit from Section 1:

   ```bash
   git clone https://github.com/m1lun/MatchMarket.git
   cd MatchMarket
   git checkout <submission commit SHA>
   ```

2. **Configure the backend.** Create `backend/.env` from the example:

   ```bash
   cp backend/.env.example backend/.env
   ```

   Open `backend/.env` and set these values. The submitted PDF also lists the actual `.env` values, which are not stored in the repository.

   | Variable | Value |
   | :---- | :---- |
   | `GOOGLE_CLIENT_ID` | The Google Web OAuth client ID from the table above |
   | `MONGODB_URI` | Keep the default. Docker Compose replaces it with its own MongoDB service. |
   | `MONGODB_DB` | `matchmarket` |
   | `JWT_SECRET` | A new value of at least 32 characters, from `openssl rand -base64 48` |
   | `ORS_API_KEY` | An OpenRouteService API key, which enables travel times |

3. **Start the backend.** From the repository root, start the backend and MongoDB, then check that the backend responds:

   ```bash
   docker compose up --build -d
   curl http://localhost:3000/health
   ```

   The response should be `{"status":"ok"}`.

4. **Set up HTTPS (only for a public server).** Skip this step for a backend on your own machine. Otherwise, set `ENABLE_HTTPS=true` in `backend/.env` and put the certificate in `backend/certs/server.crt` and `backend/certs/server.key`. On a different server, also update the app's `server_cert.pem`, the `<domain>` in `network_security_config.xml` and `API_BASE_URL`. The HTTPS section of the README has the commands.

5. **Configure the frontend.** Create `frontend/local.properties` from the example:

   ```bash
   cp frontend/local.properties.example frontend/local.properties
   ```

   Open `frontend/local.properties` and set these values. Colons are written as `\:` because this is a Java properties file.

   | Property | Value |
   | :---- | :---- |
   | `sdk.dir` | The path to your Android SDK. On macOS this is usually `/Users/<username>/Library/Android/sdk`. Android Studio can write this for you. |
   | `API_BASE_URL` | `https\://34.168.1.92\:3000` for the deployed backend, or `http\://10.0.2.2\:3000` for a backend on your own machine, used from the emulator |
   | `GOOGLE_CLIENT_ID` | The same Google Web OAuth client ID as in `backend/.env`. If the two differ, the backend rejects every sign-in. |

   In Android Studio, select File > Open, choose the `frontend/` folder, and click Sync Now when prompted.

6. **Allow your build to use Google sign-in.** Google only accepts sign-in from an APK whose signing key is registered, and release builds use your own debug keystore unless you set `RELEASE_KEYSTORE`, `RELEASE_STORE_PASSWORD`, `RELEASE_KEY_ALIAS` and `RELEASE_KEY_PASSWORD` in `local.properties`. Print the key's SHA-1:

   ```bash
   keytool -list -v -keystore ~/.android/debug.keystore -alias androiddebugkey -storepass android | grep SHA1
   ```

   Then register it in Google Cloud Console, in the same project as the Web OAuth client:

   1. Open APIs & Services > Credentials.
   2. Select Create Credentials > OAuth client ID.
   3. Set Application type to Android, Package name to `com.example.matchmarket`, and SHA-1 certificate fingerprint to the value you printed.
   4. Click Create.

   You need access to the team's Google Cloud project for this. Without it, send your SHA-1 to the team to register, or use the submitted APK (Option A), which is already registered.

7. **Build and install the APK.** Start the Pixel 9 / API 36 emulator, then run these commands from `frontend/`. On Windows, use `.\gradlew.bat assembleRelease`.

   ```bash
   ./gradlew assembleRelease
   adb install -r app/build/outputs/apk/release/app-release.apk
   ```

   Open the app, sign in with Google and check that it reaches the backend.

## 5. Accounts and access

Google sign-in requires an eligible Google account on the device or emulator.

| TA account or sign-in instructions | Launch the application and select "Sign in with Google".  |
| :---- | :---- |
| Required credentials or allowlisting | None. TAs do not need to be added, and any Google account can sign in. |
| Sample data or extra access steps | No sample data is needed. The feed only shows other users' posts, so use two Google accounts: create a request with one and a listing in the same category with the other. This gives both accounts recommendations, messaging, deals and ratings to test. |

### What you can do in the app at CP2

1. **Manage posts**. In My Posts, switch between buying and selling and create a request or a listing. Set the category, address, price, condition, photos and hard or soft preferences, plus custom fields. You can edit, close, reopen and delete your posts.
2. **Browse the feed**. It shows other users' open listings or requests, newest first, filterable by category, price range, and address plus radius.
3. **See recommendations**. Open one of your own open posts and tap See recommendations. Matching posts from other users appear best fit first, with their distance in km and, on the first page, their travel time.
4. **Message other users**. Open another user's post and tap Message to send a proposed price and start a conversation. The Messages tab lists your conversations. New messages and proposals appear in an open conversation without refreshing.
5. **Make a deal**. Accept the other user's proposed price to record a deal and close both posts, or decline it so that either user can propose again.
6. **Rate deals**. In the Deals tab, see your deals with the agreed price and the other user's score, rate the other user from 1 to 5 stars with an optional comment, and edit your rating later.

## 6. Physical device

| Manufacture | Samsung |
| :---- | :---- |
| Model | S20FE |

## 7. Humblebrag

Live chat runs on Server-Sent Events with no extra library, and a chat reloads after a reconnect to recover anything it missed. Sessions use rotating refresh tokens: reusing an old token revokes every token from that sign-in.

## 8. Limitations

- Travel times are for walking only, and only on the first page of recommendations.
- Live updates only reach an open conversation. The Messages tab updates when it is opened, and there are no push notifications.
- A deal cannot be cancelled once a proposal is accepted. Ratings can be edited.
- Users cannot see their own score on the profile tab yet.
- Frontend end-to-end tests cover Feature 1 only.
- NFR 2 has an automated test, and the NFR 1 test has not been added yet.
- The app pins the server's certificate and IP address, so moving the backend needs a new APK.
- Address search uses Android's built-in Geocoder, which needs a network connection.
