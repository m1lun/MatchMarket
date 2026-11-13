# CPEN321_26W1_ProjectName

_Keep this README up to date with the steps required to build and run the frontend and backend (including any scripts, config files, and environment variables). TAs ill follow these instructions._

## Requirements

Install the following before the frontend or backend setup steps:

- [git](https://git-scm.com/install/)


--- 

## Frontend Setup

### Requirements

- [Android Studio](https://developer.android.com/studio) (latest version)
- [Java 17](https://adoptium.net/temurin/releases/?version=17)
- [Android SDK](https://developer.android.com/studio#command-tools) with API level 36+ (Android 16)

### Setup

1. **Open project**: Open the `frontend/` directory in Android Studio
2. **Sync Gradle**: Android Studio will automatically prompt you to sync the project. Click "Sync Now". You can also manually run `cd frontend && ./gradlew build` to trigger the sync and download the necessary dependencies.
3. **Configure Android SDK**: Ensure you have Android SDK 36 installed.
4. **Set up emulator/device**:
   - Create a new AVD (Android Virtual Device) by selecting Pixel 9 as the device and Android Baklava (API level 36) as the system image.
   - Alternatively, connect a physical Android device running Android 16 (API level 36).
5. **Setup app config**: Copy the example file, then fill in local values:
   ```bash
   cp frontend/local.properties.example frontend/local.properties
   ```
   Set at least:
   - `sdk.dir`: path to your Android SDK. Android Studio usually writes this the first time you open `frontend/`. On Mac it is often `sdk.dir=/Users/<username>/Library/Android/sdk`.
   - `API_BASE_URL`: backend URL baked into the APK. The example file points at the deployed backend, `https\://34.168.1.92\:3000` (colons are escaped in properties files). To run against a backend on your own machine, use `http://10.0.2.2:3000` for the emulator (`10.0.2.2` is the host machine). For a physical device on the same Wi-Fi, use `http://<your-lan-ip>:3000` and add that IP as a `<domain>` in the local-development block of `frontend/app/src/main/res/xml/network_security_config.xml` (plain HTTP is blocked for every other host).
   - `GOOGLE_CLIENT_ID`: the **Web** OAuth client ID from Google Cloud Console. Must be the same value as `GOOGLE_CLIENT_ID` in `backend/.env`.
6. **Google sign-in**: the SHA-1 of the key that signs the APK must be registered on an **Android** OAuth client (package `com.example.matchmarket`) in the same Google Cloud project as the Web client. Both debug and release builds are signed with `~/.android/debug.keystore` by default; print its SHA-1 with:
   ```bash
   keytool -list -v -keystore ~/.android/debug.keystore -alias androiddebugkey -storepass android | grep SHA1
   ```
   The emulator also needs a Google account (Settings → Passwords & accounts); the app offers to open that screen if there is none.


### Build and Run

- **Debug build**: Click the green play button in the toolbar, to compile the code, package a debug APK, and install it on the connected device or running emulator. Alternatively, from the project root, run `./scripts/run-frontend.sh`.
- **Release build**: Go to Build -> Generate Signed App Bundle or APK -> APK. Follow the on-screen instructions to create a key, and select the "release" build variant. You will then have to manually install the generated APK on your device or the running emulator.


### Backend Configuration

Ensure the backend server is running and update the base URL in the app configuration if needed.

---
## Backend Setup

You can run the backend in one of two ways:
* Locally via Node.js 
* Via Docker Compose

Both ways use the same `backend/.env` file (see below).

### Environment configuration

From the project root:

```bash
cp backend/.env.example backend/.env
```

Set at least:
- `GOOGLE_CLIENT_ID` (required): the **Web** OAuth client ID. The backend verifies every Google ID token against it and will not start without it. Must match `GOOGLE_CLIENT_ID` in `frontend/local.properties`.
- `JWT_SECRET` (required): signs the backend's session tokens; at least 32 characters, and the server will not start without it. Generate one per server with `openssl rand -base64 48` and never commit it: anyone holding it can sign in as any user.
- `MONGODB_URI` (required): where sessions (and listings) are stored. The default in `.env.example` assumes MongoDB on `localhost:27017`; Docker Compose overrides it with its own `mongo` service. The server waits for MongoDB before it starts listening.
- `PORT` (optional): defaults to `3000` if unset.
- `ENABLE_HTTPS` (optional): `true` serves HTTPS using `backend/certs/server.crt` and `backend/certs/server.key` (see [HTTPS](#https)). Leave unset for local HTTP.
- `ORS_API_KEY` (optional): an [OpenRouteService](https://account.heigit.org/signup) API key, used for travel times on the first page of recommendations. Without it, the feed works but shows "Travel time unavailable".

### API

Google is asked only once, at sign-in. The backend then issues its own tokens (`backend/src/sessions.ts`):

- **Session token**: a JWT signed with `JWT_SECRET`, valid for 15 minutes. Sent as `Authorization: Bearer <session token>` on every data request.
- **Refresh token**: 256 random bits, valid for 30 days. Only its SHA-256 hash is stored, in the `sessions` collection; MongoDB deletes it once expired. Each refresh replaces it with a new one, and presenting an already-used refresh token revokes every token from that sign-in (it means two parties hold it).

Data routes go behind the `requireAuth` middleware, which answers `401` without a valid session token. Read the user in a handler with `currentUser(res)`:

```ts
app.get('/api/listings/mine', requireAuth, (req, res) => {
  const { id, email } = currentUser(res); // id is the Google account id
});
```

On the app side, call `SessionManager.get(context).authorizedRequest(...)` (`frontend/.../auth/SessionManager.kt`). It attaches the session token, refreshes it when it expires or the backend answers `401`, and throws `SessionExpiredException` when the user has to sign in again.

- `POST /api/auth/google`: body `{ "idToken": "..." }`. Verifies the token with Google and starts a session: `{ "firstName", "lastName", "email", "sessionToken", "sessionExpiresIn", "refreshToken" }`. `400` with no token, `401` if it fails verification.
- `POST /api/auth/refresh`: body `{ "refreshToken": "..." }`. Same response as sign-in, with new tokens; the old refresh token stops working. Google is not called. `401` means the user has to sign in again.
- `POST /api/auth/logout`: body `{ "refreshToken": "..." }`. Revokes every token from that sign-in. `204`, even if it was already gone.
- `GET /health`: open, used by the run script and health checks.

Listings (what sellers offer) and requests (what buyers want) share the same routes, under `/api/listings` and `/api/requests`. All of them need the session token, and a post can only be read, edited or deleted by its owner (`403` for anyone else, `404` if it does not exist). A bad body is a `400` with `{ "error", "details": [...] }`.

- `POST /api/listings`, `POST /api/requests`: create a post. `201` with the saved post.
- `GET /api/listings`, `GET /api/requests`: your own posts, newest first.
- `GET /api/listings/:id`, `GET /api/requests/:id`: one post.
- `PATCH /api/listings/:id`, `PATCH /api/requests/:id`: change any fields, or `{ "status": "closed" }` to close a post.
- `DELETE /api/listings/:id`, `DELETE /api/requests/:id`: `204`.
- `GET /api/options?field=brand`, `POST /api/options` with `{ "field", "label" }`: the saved options for category, brand, colour and custom text fields. Saving a post adds any new category, brand or colour (and new custom field values) to these lists, so the app does not have to add them first. Categories are saved in the singular, so `desks` is saved as `desk`, except words that only look plural, such as `glass` and `electronics`.
- `GET /api/custom-fields`, `POST /api/custom-fields` with `{ "label", "type" }`, `DELETE /api/custom-fields/:key`: your saved custom fields (`text`, `number` or `bool`).

The feed shows other users' posts. It needs the session token too.

- `GET /api/feed/listings?limit=20&before=<id>`: open listings from everyone except you, newest first: `{ "listings": [...], "nextCursor" }`.
- `GET /api/feed/requests?limit=20&before=<id>`: the same for requests: `{ "requests": [...], "nextCursor" }`.
- `GET /api/feed?postId=<id>&limit=20&cursor=<nextCursor>`: recommendations for one of your open posts, best fit first: listings for a request, requests for a listing. `{ "matches": [{ "post", "score", "distanceKm", "travelMinutes" }], "nextCursor" }`. Pass `nextCursor` back as `cursor`. `404` if the post doesn't exist, `403` if it isn't yours, `409` if it's closed.

All three take `limit` from 1 to 50 (default 20). For the two browse routes, pass the `nextCursor` you got back as `before` to get the next page, along with the same filters; it is `null` on the last page. All three take these optional filters, which can be combined:
- `category`: one category, ignoring case, spacing and simple plurals.
- `minPrice`, `maxPrice`: an inclusive range on a listing's price or a request's budget (its `price` field). A request with no budget is left out when either is sent.
- `lat`, `lng`, `radiusKm`: within `radiusKm` (up to 100) of a point. Send all three or none.

A bad value, a misspelt parameter or `minPrice` above `maxPrice` is a `400` with `{ "error", "details": [...] }`.

Conversations are between a post's owner and one user who messaged them about it. They have the same `listingId`, `requestId`, `sellerId` and `buyerId` as a deal, so a deal can be made from one. They need the session token, and only the two participants can read or write one (`403` for anyone else, `404` if it does not exist).

- `POST /api/conversations`: body `{ "postId", "postKind": "listing" | "request", "myPostId"? }`. Opens your conversation with the owner of the post you tapped. `myPostId` is your own post of the other kind that it was recommended for; leave it out when coming from the plain feed. `201` with the new conversation, or `200` with the one you already have with that person about that post, unchanged. `404` if a post doesn't exist, `400` if the tapped post is your own, `403` if `myPostId` isn't yours, `409` if either post is closed.
- `GET /api/conversations`: your conversations, newest activity first: `{ "conversations": [{ "id", "postKind", "listing", "request", "otherUser", "lastMessage", "createdAt", "updatedAt" }] }`. `postKind` says which post was tapped. `listing` and `request` are `{ "id", "name", "status", "photoId" }`, or `null` if the conversation has none or it was deleted; `lastMessage` is `null` until someone writes.
- `GET /api/conversations/:id/messages?limit=30&before=<nextCursor>`: messages, newest first: `{ "messages": [{ "id", "conversationId", "senderId", "text", "createdAt" }], "nextCursor" }`. `limit` is 1 to 50 (default 30); `nextCursor` is `null` on the last page.
- `POST /api/conversations/:id/messages`: body `{ "text" }`, 1 to 1000 characters after trimming. `201` with the saved message.

Either participant can propose a price. Accepting a proposal makes the deal: it gets the conversation's `listingId`, `requestId`, `sellerId` and `buyerId`, the proposed price as `agreedPrice`, and closes those posts. A conversation's current proposal is in `GET /api/conversations` as `proposal` (`{ "proposerId", "price", "note", "status": "pending" | "accepted" | "declined", "createdAt" }`, or `null`).

- `POST /api/conversations/:id/proposal`: body `{ "price", "note"? }`, price at least 0, note up to 300 characters. `201` with the proposal. `409` while one is pending or once one was accepted.
- `POST /api/conversations/:id/proposal/accept`: only the other participant. `201` with `{ "deal", "proposal" }`. `409` if there is no pending proposal, or a post is closed, deleted or already has a deal; `403` if it's your own proposal.
- `POST /api/conversations/:id/proposal/decline`: only the other participant. `200` with the declined proposal; either side can then propose again. `409` if there is no pending proposal, `403` if it's your own.

Live updates use Server-Sent Events, so they need no extra library.

- `GET /api/events`: needs the session token like any other route, and the response stays open. The server writes `event: <type>` and `data: <JSON>` lines whenever something changes for you, plus a `: ping` comment every 25 seconds so idle connections are not dropped. Events: `message.created` (the new message, when the other participant sends one) and `proposal.updated` (`{ "conversationId", "proposal" }`, when the other participant proposes, accepts or declines). On reconnecting, reload what is on screen, since events sent while disconnected are not replayed.

The end-to-end tests seed their own data through test-only routes. They exist only when `ENABLE_E2E_ROUTES=true` (`404` otherwise), need the session token, and only touch made-up users tied to the caller: an "E2E Buyer" for deals and an "E2E Seller" partner for conversations, never another real user.

- `POST /api/e2e/deals`: replaces your seeded deal, in which you sold the E2E Buyer's request "E2E desk" for $45. `201` with `{ "dealId" }`. `DELETE /api/e2e/deals` removes it: `204`.
- `POST /api/e2e/listings`: replaces the E2E Seller's open listing "E2E lamp" ($30), for starting a conversation from the feed. `201` with `{ "listingId" }`.
- `POST /api/e2e/conversations?messages=<0-40>`: the same listing plus your conversation about it, with that many messages from the E2E Seller ("Message 1" is the oldest). `201` with `{ "listingId", "conversationId" }`; `400` for any other `messages` value.
- `DELETE /api/e2e/conversations`: removes the E2E Seller's listings and conversations, and any deal and rating made from them. `204`.
- `/api/e2e/partner/conversations/...`: the conversation and proposal routes above, run as the E2E Seller (for example `POST /api/e2e/partner/conversations/:id/messages`), so a test can reply, propose, accept or decline the way a second phone would, live updates included.


### Option 1: Run locally

**Requirements:** 
- [Node.js](https://nodejs.org/en/download/) 22+
- [npm](https://docs.npmjs.com/downloading-and-installing-node-js-and-npm) 10+

**Setup:** 
1. Install dependencies:

   ```bash
   cd backend
   npm install
   ```

2. **Development** (TypeScript with auto-reload):

   ```bash
   npm run dev
   ```

3. **Production build** (optional):

   ```bash
   npm run build
   npm start
   ```

### Option 2: Run with Docker Compose

**Requirements:** 
- [Docker](https://docs.docker.com/desktop/setup/install) and [Docker Compose](https://docs.docker.com/desktop/setup/install) v2.24+
- [curl](https://curl.se/download.html)

**Setup**
1. **Start** (from the project root):

   ```bash
   ./scripts/run-backend.sh
   ```

   Or run Compose directly:

   ```bash
   docker compose up --build -d
   ```

2. **Stop**:

   ```bash
   docker compose down
   ```

### HTTPS

M1 requires the app to reach the backend over HTTPS. The deployed backend runs on a Google Cloud VM at `https://34.168.1.92:3000` (static IP) with `ENABLE_HTTPS=true` and a self-signed certificate in `/opt/cpen321/backend/certs/`. The app pins that certificate (`frontend/app/src/main/res/raw/server_cert.pem`, trusted for that IP only by `res/xml/network_security_config.xml`), and the deploy workflow checks `/health` against it.

`backend/certs/` is gitignored and excluded from the Docker image (Compose mounts it read-only), so the private key is never committed. Deploys run `git reset --hard`, which leaves the untracked `certs/` and `.env` in place. To generate a self-signed certificate for a server at `<PUBLIC_IP>` (for example when the certificate expires or the IP changes):

```bash
mkdir -p backend/certs
openssl req -x509 -newkey rsa:2048 -nodes \
  -keyout backend/certs/server.key -out backend/certs/server.crt \
  -days 365 -subj "/CN=<PUBLIC_IP>" \
  -addext "subjectAltName=IP:<PUBLIC_IP>"
```

The IP must be in `subjectAltName` or Android rejects the certificate. Then set `ENABLE_HTTPS=true` in `backend/.env`, and in the app:

1. Copy `backend/certs/server.crt` to `frontend/app/src/main/res/raw/server_cert.pem` (the public certificate only, never the key).
2. In `frontend/app/src/main/res/xml/network_security_config.xml`, put `<PUBLIC_IP>` in the deployed-backend `<domain>`.
3. Set `API_BASE_URL=https\://<PUBLIC_IP>\:3000` in `frontend/local.properties.example` and your own `frontend/local.properties`.

`scripts/run-backend.sh` reads `ENABLE_HTTPS` from `backend/.env` and probes `https://localhost:<PORT>/health` when it is on.

## Testing

Run these from the project root.

| What | Command |
| --- | --- |
| Backend interface tests (mock, no-mock, and combined, with coverage) | `./scripts/run-backend-interface-tests.sh` |
| Backend non-functional requirement tests | `./scripts/run-backend-nfr-tests.sh` |
| Frontend end-to-end tests (needs an emulator or device with the app signed in) | `./scripts/run-frontend-e2e-tests.sh` |
| Frontend non-functional requirement tests | `./scripts/run-frontend-nfr-tests.sh` |

Backend tests use Jest. Frontend tests use the Jetpack Compose testing APIs and UI Automator.

The end-to-end tests create their data through the test-only `/api/e2e` routes, so set `ENABLE_E2E_ROUTES=true` in `backend/.env` before running them. See [documentation/Testing.md](documentation/Testing.md) for the end-to-end tests: how to run them and how they map to the use cases.

## Continuous integration

GitHub Actions runs on every push to `main` and on pull requests:

- `.github/workflows/backend-tests.yml` runs the typecheck and the backend test scripts.
- `.github/workflows/frontend-build.yml` builds the debug APK.

## Code review (Codacy)

Codacy is configured in its web UI, not in this repository:

1. Sign in at https://www.codacy.com with GitHub and add this repository.
2. On the "Code patterns" page, keep only detekt (Kotlin), ESLint (TypeScript), and Trivy (Kotlin and TypeScript) enabled.
3. Point Codacy at the existing `detekt.yml` and `.eslintrc.json` in the repository root, and enable all Trivy patterns. Do not edit those two files.
