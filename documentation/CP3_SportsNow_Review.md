# CP3 Peer Review: SportsNow

| | |
|---|---|
| **Peer group reviewed** | SportsNow (`pawanpaddaeng/SportsNow_Project`) |
| **Reviewing group** | MatchMarket |
| **Commit reviewed** | _[commit SHA of the `main` snapshot you downloaded; the zip has no `.git` folder]_ |
| **Artifacts reviewed** | `SportsNow_Project-main` source (backend, frontend, docs, scripts), `CP2_SportsNow.apk` |
| **Date** | Nov 13, 2026 |
| **Scope** | Scored against the CP2 scope: one end-to-end feature and all interfaces of one component. Work not due until CP3 or M3 is listed as a recommendation, not a fault. |

## Score Summary

| **Section** | **Item** | **Score** |
|---|---|---|
| Manual code review | Code is maintainable, efficient, handles error cases well | **8/10** |
| Manual test review | Tests are complete for one end-to-end feature and all interfaces of one component, errors and edge cases are thoroughly tested, correct assertions are used | **5/10** |
| Manual test review | Test code is maintainable and well-structured | **8/10** |
| Manual test review | Test implementation matches the requirements and design | **4/10** |
| Manual test review | Non-functional requirements are tested well | **0/10**\* |
| Manual test review | Tests achieve high coverage and cases of < 100% coverage are well-justified | **2/10** |
| Manual test review | All back-end tests can be run automatically | **2/10** |
| Automated code review | Codacy runs with the required setup | **7/10** |
| Automated code review | All remaining Codacy issues are well-justified | **9/10** |

\* NFR tests aren't part of the CP2 scope (they are due with the complete Testing.md at CP3). The 0 records that no NFR test exists yet. It is not a CP2 failure (see [2.4](#24-non-functional-requirements-010-not-yet-due)).

**Major fault:** Leaving a game after it starts erases it from the player's score, which breaks the code's own stated goal and the Leave Game use case (*"before it starts"*). The organiser can't mark them as a no-show or rate them, but the game still counts as played (see [Section 4](#4-major-fault)). **Severity: Medium-High.**

---

## 1. Manual Code Review: 8/10

### Strengths
- **Clear structure.** The backend is split by domain (`user`, `game`, `friend`, `chat`, `review`, `core`), and each domain has `db/`, `routes/` and `validation/` folders. The frontend mirrors this with `dto/`, `model/`, `repository/`, `navigation/state` and `ui/screens`. Files are short (the largest are `game/db/games.ts` at 636 lines and `game/routes/gameRoutes.ts` at 355 lines) and so are the functions.
- **Well documented.** Almost every function has a comment saying what it does and why. For example, `lockGame` (`backend/src/game/db/games.ts:278`) explains why the row is locked, and the SQL init scripts explain every column.
- **Few magic numbers.** Constants are named and explained, e.g. `MAX_DISCOVER_DISTANCE_M`, `MAX_DISCOVER_GAMES`, `GAMES_IN_SCORE`, `HEARTBEAT_MS`, `PUSH_PREVIEW_LENGTH`, `RECONNECT_DELAY_MS` and `CURRENT_FIX_TIMEOUT_MS`.
- **Strong error handling and concurrency.** Results are typed as `{ ok: false; problem }` unions, and tables like `COMPLETE_GAME_ERRORS` map each problem to an HTTP status. `asyncRoute` and `handleRouteErrors` give every route the same `500 server_error`. Approvals, edits, leaves and friend requests run inside `SELECT … FOR UPDATE` transactions, so two approvals at once can't push a game over `max_players`. All SQL is parameterised.
- **Careful security details.** JWTs are pinned to HS256, tokens issued before an account was created are rejected (`checkToken`, `middleware.ts:35`), the sign-up email must match the Google token, and the public profile never returns email or birth year.

### Issues found

| # | Location | Issue | Suggestion |
|---|---|---|---|
| C1 | `frontend/.../navigation/state/AppState.kt:95` (`signOut`), `backend/src/core/notifications/deviceTokens.ts` | **Signing out doesn't unregister the device's FCM token.** The `device_tokens` row still points at the old user, so a phone that signed out keeps getting that user's notifications, including friend-message previews (`chatSocket.ts:60`, up to 100 characters of the message). This is a privacy problem on shared phones, and the Logout use case implies the device is no longer tied to the account. | Add `DELETE /api/register_notif` (or similar), call it before clearing the JWT, and call `FirebaseMessaging.deleteToken()`. |
| C2 | `backend/src/friend/db/friends.ts:68-91` (`searchUsers`) | **Search reads every user on every keystroke.** It runs `SELECT … FROM users WHERE user_id <> ?` with three `EXISTS` subqueries per row, then fuzzy-matches all names in Node. That is O(N) database rows and O(N) string comparisons per request, and the app searches as the user types. It is fine for a class demo but won't scale, and it is the slowest endpoint in the backend. | Pre-filter in SQL first (e.g. `LIKE CONCAT(LEFT(?,1),'%')` or a `FULLTEXT` index), cap the candidate set, then fuzzy-rank only those rows. Debounce on the client. |
| C3 | `backend/src/review/reputation.ts:35-50` | **The reputation algorithm hides bad behaviour.** (a) Anyone who doesn't rate counts as giving 5 stars, so a single 1-star rating in a 10-player game only lowers that game to (1 + 8×5)/9 = **4.56**, and the overall score to **4.91**. (b) New players start with five perfect games, so a brand-new account (5.00) outranks a reliable regular player (e.g. 4.8). (c) A no-show only lowers the score to **4.2** and disappears completely after 5 more games. Because the requirements say the score is the main signal organisers use to accept players, organisers can barely tell good players from bad ones. | Average only the ratings actually given, with a Bayesian prior (e.g. `(C·m + Σr)/(C + n)`). Show "new player" instead of 5.0. Keep no-shows in a longer window, or as their own count. |
| C4 | `frontend/app/src/main/AndroidManifest.xml:13` | `android:usesCleartextTraffic="true"` is set for all builds, including release. The production backend is HTTPS (Caddy), so plain HTTP is only needed for local testing. JWTs could be sent in clear text if `API_BASE_URL` is misconfigured. | Allow cleartext only for `10.0.2.2` through a `network_security_config.xml`, or only in the debug manifest. |
| C5 | `frontend/.../game/location/DeviceLocation.kt:20` vs. NFR 1 | `CURRENT_FIX_TIMEOUT_MS = 10_000`: when there's no recent location fix, Discover waits up to **10 s** for one before even calling the server, but NFR 1 promises the list in under **5 s**. | Cap the wait at about 3 s and fall back to the last known fix, or measure and justify the timeout. |
| C6 | `Requirements_and_Design.md` §4.1 | **The design and the code disagree.** `POST /api/games/{id}/complete`, `POST /api/games/{id}/leave`, `DELETE /api/users/me` and `GET /api/chats/{id}/messages` are built but not listed (or listed differently). §4.1 says `DELETE /players/{userId}` is *(planned)* and is how a player leaves, but it is built and only the organiser can use it. | Update §4.1 to match the code. |
| C7 | `backend/src/user/routes/authRoutes.ts:34,49` | `process.env.GOOGLE_CLIENT_ID` is read directly with `?? ''`, bypassing `core/config/env.ts`, which validates required variables at startup. If it is missing, the server starts and every login fails at runtime. | Add `googleClientId: requiredEnv('GOOGLE_CLIENT_ID')` to `env`. |
| C8 | `backend/src/game/routes/gameRoutes.ts:210-213` | `PUT /api/games/:id` reads the game (`getGameById`) outside the transaction and uses it as `before` to work out what changed. A concurrent edit between the two reads can produce a wrong "what changed" notification. Minor. | Return the old values from `updateGame`, which already holds the lock. |

---

## 2. Manual Test Review

### 2.1 Completeness: 5/10

At CP2 the course asks for **all interfaces of one component** and **one end-to-end feature**, with the described tests implemented. SportsNow met the first half and missed the second.

**All interfaces of the Game component: met (about 8/10 on its own).** There are 95 Jest tests. All 13 Game REST endpoints have an `Unmocked:` group, and 12 of 13 have a `Mocked:` group. Many edge cases are covered: full game, already answered, cancelled or started game, not the organiser, bad ids, asking again after being declined, and push recipients checked with `jest.spyOn`. The assertions check both the HTTP response and what is actually saved in the database (e.g. `getPlayerIds`, `getJoinRequestStatus`), which is good practice.

Edge cases that are still missing for this component:
- **The planned sign-in failure tests don't exist.** Testing.md §2.1.1 promises no token, bad token, expired token and unknown user tests for *every* interface, but no test checks `invalid_token`, `expired_token` or `no_user`.
- **`POST /api/games` has 1 validation test instead of the 7 planned.** Missing: unknown sport, start in the past, end before start, `max_players: 101`, latitude out of range. Only "no title" exists, and it sits in the *mocked* folder (`tests/mock/game/createGame/invalidBody.test.ts`) although it needs no mock.
- `DELETE /api/games/{id}/players/{userId}`: 1 happy-path test and no mocked group (`tests/mock/game/removePlayer/` only has `.gitkeep`). Its six error cases (`organizer_self`, `player_not_found`, forbidden, started, cancelled, not found) are untested.
- `POST /api/games/{id}/complete`: no database-failure test, and no tests for `game_not_started` or `game_completed`.

**One end-to-end feature: not met (0/10 on its own).** `frontend/app/src/androidTest/.../e2e/` only has Android Studio's generated `ExampleInstrumentedTest.kt`. The Discover Game test is planned in detail in Testing.md §4.1, but `DiscoverGameTest.kt` doesn't exist. This is the main reason for the score: CP2 asks for the described tests to be *implemented*, not only planned.

_Not scored:_ the other components (User, Social, Message, Player Review) have few or no tests, but CP2 only asks for one component, so we haven't counted that against them.

### 2.2 Test code maintainability: 8/10
- Every test has the required `// Input / Expected status code / Expected behavior / Expected output / Mocked behavior` comments, and the steps are numbered (`// 1. … // 2. …`).
- Shared helpers (`tests/no-mock/helpers.ts`, `tests/sharedHelpers.ts`) keep tests short. `addUser` builds unique `google_id`s from the test file path so test files can run in parallel on one database, and `cleanUpAfterTests` deletes only the rows that test made. Well thought out.
- Deductions: one test per file gives **~95 files** with repeated `beforeEach` and import boilerplate, which is where Codacy's **14% duplication** comes from. Grouping each interface's cases into one file per `describe` group would be easier to read and matches the spec's example. The `invalidBody` test is in the wrong folder (see 2.1).

### 2.3 Tests vs. requirements and design: 4/10
- **`Testing.md` wasn't updated for CP2**, which the guidelines require (*"Update Testing.md"*). It is still the CP1 plan, and its change history only has the Oct 20 entry. These parts of the CP2 scope still say *"To be added at CP2"*:
  - §2.1.1 lists folders, not `file#Lline` links to each `describe` group
  - §2.1.2 commit hash and §2.1.3 step 3 (how to start the test database)
  - §2.2 GitHub Actions and §2.3–2.4 coverage screenshots
  - the E2E test log
- The E2E plan for **Use Case 2** (Discover Game) maps scenario steps to test steps well, but it isn't implemented (see 2.1).
- The Game backend tests match their plan closely (same names, inputs and statuses), apart from the missing cases in 2.1.
- _Not scored:_ §3 (NFR) is also unwritten, and only one use case has an E2E plan. Neither is required until CP3 / M3 (the final project needs E2E tests for three main features).

### 2.4 Non-functional requirements: 0/10 (not yet due)
- **This is not a CP2 failure.** The guidelines don't ask for NFR tests until the complete Testing.md at CP3. The score only records that none exist yet: `backend/tests/nfr/` and `frontend/.../androidTest/.../nfr/` only contain `.gitkeep`, and Testing.md §3 is empty.
- Suggestions for CP3: NFR 1 (Discover in under 5 s) could be timed in Jest against `GET /api/games/discover` with many seeded games, plus the location timeout in C5. NFR 2 (≤ 1% battery per 10 minutes) would need an instrumented test using `dumpsys batterystats` or `BatteryManager`.

### 2.5 Coverage: 2/10
We only judged the Game component, since that is the CP2 scope.
- **Coverage can't be verified.** Testing.md has no coverage screenshots for the mock, no-mock or combined runs, and no justification for anything under 100%. Codacy shows **0% coverage** and *278 files without coverage* (`codacy-overview-2.png`), so no report was uploaded.
- Credit: `jest.config.js` sets `collectCoverageFrom: ['src/**/*.ts']` correctly, and the script saves a separate report for each run. From the tests alone, `game/` coverage should be high, apart from the untested `removePlayer` and `completeGame` error paths in 2.1. The team only needs to run it and add the screenshots.
- _Not scored:_ `friend/`, `chat/` and the auth and user routes are close to 0% because no test calls them yet. That is outside the CP2 scope.

### 2.6 Back-end tests run automatically: 2/10
- **There is no GitHub Actions workflow.** `.github/workflows/` only has `.gitkeep`. The project description says that tests not started from the CI file count as incomplete, and SportsNow's own Testing.md (§2.2 and its change history) planned the workflow for CP2.
- The unmocked tests need a running, initialised MySQL database, but neither `scripts/run-backend-interface-tests.sh` nor Testing.md (§2.1.3 step 3: *"We will add these steps at CP2"*) says how to start one or which environment variables to set. A TA following the docs can't run them.
- Credit: `run-backend-interface-tests.sh` correctly runs mock, then no-mock, then both together, each with its own coverage folder.

---

## 3. Automated Code Review

### 3.1 Codacy setup: 7/10
- ✅ Three tools are enabled, with detekt and ESLint using the configuration files in the repository (`codacy-issues.png`). The commit is recorded in Code_Review.md §2.1 (`7ba4248…`).
- ❌ **There is an inline suppression, which the rules forbid:** `frontend/app/src/main/java/com/example/cpen321application/game/location/Geocoding.kt:51` has `@Suppress("DEPRECATION")`. The spec says *"do not use inline code comments to suppress issues"*.
- ⚠️ §2.3 should show the **Issues page** (`/issues/current`), but the screenshot shows the *Code patterns* page instead. Trivy isn't visible in it, so we couldn't confirm it is enabled with all patterns.
- ⚠️ Codacy says *"main branch is not protected"*. This is not required, but worth fixing.

### 3.2 Remaining issues justified: 9/10
- Codacy reports **0 issues**, so there is nothing to justify. Small deduction: Code_Review.md §2.4 dismisses the high duplication (14%) as "from test files" with no evidence or citation, and the `@Suppress` above hides an issue that should have been fixed or justified.

---

## 4. Major Fault

### Leaving a game mid-game erases it from the player's score, so no-shows can't be recorded

**Severity: Medium-High.** It undermines the main purpose of the app. The project description says reputation exists so that *"organisers see each requester's score … so games are filled with reliable players"*, and a no-show is the most serious thing the score is meant to catch. It isn't High because it takes a deliberate action by the player, and it doesn't crash the app or leak data.

**This is a bug, not a design choice.** Letting players leave mid-game is deliberate, and so is counting that as having played. The problem is that the code breaks its own stated goal:
- `leaveGame` (`games.ts:480`): *"once the game started the request stays approved **as a record that they played**"*
- `completeGame` (`games.ts:424`): attendance is *"kept apart from game_players **so leaving the game doesn't erase it from a player's score**"*

That goal only holds when a player leaves **after** the game is completed. When they leave **mid-game**, before completion, they get no attendance row, so the game is erased from their score. It also contradicts the team's requirements: use case 11 says *"Leave Game: A player who has joined a game withdraws from it **before it starts**"*, and §4.1 says the same. As a result, the app disagrees with itself about a player who left mid-game:

| Part of the app | Counts them as having played? |
|---|---|
| `leaveGame` (*"a record that they played"*) | ✅ yes |
| Profile "games played" (`GAMES_PLAYED` counts approved requests) | ✅ yes |
| Reputation score, no-show checklist, ratings (all read `game_attendance`) | ❌ no |

The player's own tap decides attendance, not the organiser's checklist. A player who never came can tap **Leave Game** from home after the start time and avoid both the no-show penalty and any ratings.

**What happens in the code**
1. After a game's start time, players can still leave it. Both the backend (`backend/src/game/db/games.ts:457-498`, *"A player can leave at any time, even mid-game"*) and the app (`GameDetailsButtons.kt:70-75`, which shows **Leave Game** to players of an in-progress game) allow it.
2. When the organiser marks the game completed, `completeGame` (`games.ts:425-436`) only writes `game_attendance` rows for users **still in** `game_players`. A player who left gets **no row at all**: they don't appear in the organiser's no-show checklist (`CompleteGameDialog`), so they can't be marked as a no-show.
3. `getReputationScore` (`review/db/ratings.ts:107-131`) only reads `game_attendance`, so the game doesn't count against them, and no one can rate them (`createRating` → `player_not_found`).
4. Leaving after the start keeps the join request `approved` (`games.ts:480-488`). `GAMES_PLAYED` (`review/db/reputation.ts:15-22`) counts approved requests, so the skipped game **still counts towards their "games played"** on their public profile.

**Steps to reproduce (two accounts, A and B)**
1. **A** creates a game starting in about 3 minutes (Home → Create Game).
2. **B** finds it in Discover, sends a join request, and **A** approves it.
3. Wait until the start time passes, so the game shows as *in progress*.
4. **B** opens Game Details → **Leave Game** → confirms *"You'll leave … while it's in progress"*.
5. **A** taps **Mark as Completed**. ➜ **B isn't in the "who showed up" list** and can't be marked as a no-show.
6. Open B's profile. ➜ B's **reputation score is unchanged (5.0)**. (In the code, B's games-played count also goes up by 1.)
7. For comparison, repeat with **B** staying in the game and **A** unticking them. B's score drops (to 4.2 for a new user).

**Expected:** A player who was approved and is still in the game at its start time should be recorded in `game_attendance` (and be able to be marked as a no-show) even if they leave afterwards, or leaving mid-game should count as a late cancellation, which the requirements promise to penalise.

**Suggested fix:** Write the attendance rows from approved join requests (`status = 'approved'`), not just from current `game_players`. Alternatively, block leaving a started game, or record a no-show or late cancellation in `leaveGame` when `hasStarted` is true.

**Reproduced on `CP2_SportsNow.apk`** (Pixel 9 emulator, API 36, against the team's deployed backend, Nov 13, 2026). The test game "NoShow Test 2" was set to start at 8:35 PM. Organiser A approved player B at 8:32 PM, and B left at 8:35 PM while the game was in progress. A marked the game completed at 8:39 PM.

| | |
|---|---|
| ![B sees Leave Game on an in-progress game](CP3_screenshots/1_B_leave_button_in_progress.png) | ![Leave prompt says "while it's in progress"](CP3_screenshots/2_B_leave_confirm_in_progress.png) |
| **1.** B's Game Details: the game is *In progress* and the app still offers **Leave Game**. | **2.** The app warns *"You'll leave NoShow Test 2 while it's in progress"* but lets B leave anyway, with no penalty. |
| ![Complete dialog has no no-show list](CP3_screenshots/3_A_complete_dialog_no_noshow_option.png) | ![B's rating still 5.0](CP3_screenshots/5_B_rating_still_5.png) |
| **3.** A's **Mark this game completed?** dialog has **no "who showed up" checklist**. B is gone, so A can't mark B as a no-show. | **4.** After the game is completed, B's rating is still **5.0/5**. Skipping an approved game had no effect. |

Extra screenshot: `CP3_screenshots/4_A_game_completed_1_player.png` (the completed game shows only 1/10 players, so B isn't recorded as a participant).

_Not shown in the app:_ the "games played" count from step 4 of "What happens in the code" is only visible in the player-profile popup, which we couldn't open from the search results. That part is based on the code (`review/db/reputation.ts:15-22`).

### Other faults found (secondary)
- **Push notifications go to a signed-out device** (C1). Sign in as A, sign out, then have a friend message A: the signed-out phone shows the message preview.
- **New or unrated accounts get the best possible score** (C3b). This makes it easy for repeat no-shows to make a new account and start at 5.0.

---

## 5. Summary of Recommendations (priority order)

**CP2 work that is still missing**
1. Write the Discover Game E2E test (already planned in detail in Testing.md §4.1).
2. Add a GitHub Actions workflow that starts MySQL (a `services: mysql` container plus the `mysql/init` scripts) and runs `run-backend-interface-tests.sh`.
3. Bring `Testing.md` up to CP2: line links, commit hash, how to set up the test database, coverage screenshots for the mock, no-mock and combined runs, and a justification for anything under 100%.
4. Add the missing Game edge-case tests: sign-in failures, create-game validation and remove-player errors. Remove `@Suppress("DEPRECATION")`.

**Fixes to the app**
5. Fix the leave-mid-game no-show loophole and unregister FCM tokens on sign out.
6. Update Requirements_and_Design §4.1 to match the built endpoints.

**For CP3 and M3 (not yet due)**
7. Write the two NFR tests (ideas in 2.4) and complete Testing.md §3.
8. Extend testing to the other components and add E2E tests for two more main features, as the final release requires.
