# **Code Review**

Repository:  [m1lun/MatchMarket](https://github.com/m1lun/MatchMarket)  
Inspected main commit: the commit on main that this document was submitted from; its hash is given in the submitted PDF.  
Evidence checked: 19 November 2026, Vancouver time.

## 1. Change History

| Date | Sections | Rationale |
| :---- | :---- | :---- |
| 2026-10-19 | 1 to 3 | Prepared the CP1 status report from GitHub PR and Codacy evidence. |
| 2026-10-19 | 1 to 3 | Integrated GitHub Code\_Review.md template fields and review rubric; removed duplicated draft text; refreshed PR merge status while retaining the original review evidence. |
| 2026-10-20 | 2 and 3 | Updated PR and review evidence through PR \#56; corrected the PR \#41 label; distinguished historical tests from current main; recorded outstanding evidence and documentation gaps. |
| 2026-11-02 | 2 and 3 | Completed Section 2 for CP2 from the Codacy results on main, replacing the pull-request-level evidence; updated Section 3 for the CP2 code exchange and added internal reviews since CP1. |
| 2026-11-18 | 2.5, 3 | Completed Section 3 for CP3: the review we performed of SportsNow, the review we received from SportsNow with its scores, and the action taken on each finding. Added the pull requests since CP2 that responded to Codacy findings. |
| 2026-11-18 | 3.3 | Updated the actions for the review findings on Use Case 1 and the Requirements_and_Design links, and recorded the code restructuring planned for M3. |
| 2026-11-19 | 3.3 | Use Case 3 no longer describes the ranking algorithm. |
| 2026-11-19 | 2 | Updated Section 2 for CP3 from the Codacy results on main at commit `1c8c835`: 0 issues, after PR #236 fixed the two dependency alerts. Updated the inspected commit. |
| 2026-11-19 | 3.4 | Named the reviewers by first name, added author and reviewer columns, and reworded each review so it is clear what was asked and what happened. Removed PR #31, which was the author reviewing their own PR. |
| 2026-11-25 | 3.3 | Recorded the M3 code restructuring: the back end (PR #242) and the app (MVVM) are organised by component, then by layer, and the README documents the structure. The `DealsModel`/`DealModels` and screens-in-`ui` findings are fixed. |
| 2026-11-26 | 3.3 | Replaced "this pull request" with the pull request numbers, named the app's "Edit" button as it appears, limited the photos row to what we tested, and marked the `assertTrue(size == 1)` finding fixed. |

## 2. Automated Code Review Results

Codacy reports 0 issues on main. ESLint, detekt and Trivy are the only enabled tools, and ESLint and detekt use the repository's .eslintrc.json and detekt.yml, which have not changed since M1. The code has no inline comments that suppress issues.

### 2.1 Commit Hash Where Codacy Ran

[1c8c835466defede4e51e26d018a35f9e444b9c0](https://github.com/m1lun/MatchMarket/commit/1c8c835466defede4e51e26d018a35f9e444b9c0), analysed on 19 November 2026.

### 2.2 Unfixed Issues per Codacy Category

Codacy reports 0 unfixed issues in total, so no category has any issues.

### 2.3 Unfixed Issues per Codacy Code Pattern

Codacy reports 0 unfixed issues in total, so no code pattern has any issues.

### 2.4 Justifications for Unfixed Issues

None. There are no unfixed issues to justify.

### 2.5 Recorded Responses to Automated Findings

These pull requests document changes made in response to automated analysis findings.

PR \#51:

* **TypeScript**: Addressed two no-unsafe-argument findings related to uploaded files by introducing a local UploadedFile type.
* **Dependencies**: Updated proxy-addr from 2.0.7 to 2.0.8 and qs from 6.15.3 to 6.16.1 in response to dependency alerts.
* **Kotlin**: Simplified PostViewModel by removing the updateRow and removeRow wrappers to address the detekt function-count limit.

Since CP1:

* **Kotlin**: [PR \#160](https://github.com/m1lun/MatchMarket/pull/160) removed the labeled return from sendOffer.
* **TypeScript**: [PR \#158](https://github.com/m1lun/MatchMarket/pull/158) gave the stored categories list a type.
* **TypeScript**: [PR \#107](https://github.com/m1lun/MatchMarket/pull/107) named a caught error so that Codacy sees it as handled.

Since CP2:

* **TypeScript**: [PR \#184](https://github.com/m1lun/MatchMarket/pull/184) typed the MongoDB results that Codacy flagged in the E2E seed code.
* **TypeScript**: [PR \#187](https://github.com/m1lun/MatchMarket/pull/187) resolved the Codacy issues in the accept retry code (untyped driver results, a dynamic object key and an unhandled async error).
* **TypeScript**: [PR \#200](https://github.com/m1lun/MatchMarket/pull/200) awaited and typed the stored address test helper.
* **Dependencies**: [PR \#236](https://github.com/m1lun/MatchMarket/pull/236) updated `multer` from 2.4.0 to 2.5.0 and `body-parser` from 2.3.0 to 2.4.0, which fixed the two high-severity Trivy alerts on `backend/package-lock.json` (CVE-2026-113872 and CVE-2026-111181).

## 3. Manual Code Review Results

Our group exchanged code with SportsNow at CP2. Each group reviewed the other's code, tests, Testing.md and Code_Review.md, scored them on the course's 0–10 scale, and reported one major fault.

### 3.1 Review Performed by Our Group

| | |
| :---- | :---- |
| **Group reviewed** | SportsNow |
| **Commit reviewed** | [`eccf7d9343f9ef4d088c1da59cb5ecf89106b622`](https://github.com/pawanpaddaeng/SportsNow_Project/commit/eccf7d9343f9ef4d088c1da59cb5ecf89106b622) |
| **Date** | 13 November 2026 |
| **Report** | [`CP3_SportsNow_Review.md`](CP3_SportsNow_Review.md), submitted as `CP3_SportsNow_Review.pdf` |

Main findings:

* **Code (8/10):** clear structure by domain, named constants and careful error handling. Issues: signing out does not unregister the device's FCM token, so the signed-out phone keeps receiving that user's message previews; user search reads every user and compares names in Node; the reputation score treats missing ratings as 5 stars; Discover can wait 10 s for a location fix although NFR 1 promises 5 s; and §4.1 of their design does not list three built routes.
* **Tests:** all 13 Game routes have unmocked tests and 12 have mocked tests, but the end-to-end test planned for CP2 had not been written, no GitHub Actions workflow ran the back-end tests, and Testing.md had not been updated for CP2. No NFR tests existed yet (due at CP3).
* **Codacy (7/10 and 8/10):** 0 issues, but one inline `@Suppress("DEPRECATION")` breaks the course rule against suppressions.
* **Major fault (Medium-High):** a player can leave a game after it starts. When the organiser completes the game, attendance is only recorded for players still in it, so the player who left cannot be marked as a no-show or rated, and the game has no effect on their score, although it still counts as played on their profile. We reproduced it on their CP2 APK, with screenshots in the report.

### 3.2 Review Received by Our Group

| | |
| :---- | :---- |
| **Reviewing group** | SportsNow |
| **Commit reviewed** | [`1fba57f837b2ea16f32ac258ef019d8f29002898`](https://github.com/m1lun/MatchMarket/commit/1fba57f837b2ea16f32ac258ef019d8f29002898) |
| **Report** | `CP3_MatchMarket_Review.pdf` |

Main findings:

* **Documentation:** links in Requirements_and_Design.md did not work; "Create deal" read like a user action; Use Case 1 mixes the request and listing flows; Use Case 3 describes the ranking algorithm; the sequence diagrams showed only one failure each, the UC2 diagram checked for an existing rating only after the rating was written and had an activation box with no arrow into it, and database writes had no reply; and the address field required typing the address from memory.
* **Code:** accepting a proposal closed both posts by rewriting the whole post document; the code structure was not explained, so files were hard to find; front-end files had no top-level explanation, `DealsModel.kt` and `DealModels.kt` were easy to confuse, and screens sat beside models and API calls instead of in `ui`; the back end had many very small files and no agreed place for new code.
* **Tests:** the Deals component and the Create Post end-to-end test were the strongest parts. Deductions: a mocked rating test expected a half-finished write; end-to-end tests waited with a fixed `Thread.sleep(2_000)`; `assertTrue(size == 1)` hides the actual count; Testing.md listed an older commit, test counts and coverage screenshots, and only the Deals routes; Use Cases 2–5 had no end-to-end tests and Messaging had no back-end tests; NFR 1 had no test; and coverage gaps were justified only for Deals.
* **Major fault:** on a physical device using the deployed back end, no photos load anywhere in the app.

| Type | Criterion | Performed (SportsNow) | Received (from SportsNow) |
| :---- | :---- | :---- | :---- |
| Manual code review | Maintainable code, clear names, appropriate method size, efficiency and error handling | 8/10 | 8.5/10 |
| Manual test review | API / core-feature coverage; edge cases; correct assertions | 5/10 | 9/10 |
| Manual test review | Well-structured, maintainable test code | 8/10 | 8/10 |
| Manual test review | Tests match requirements and design | 5/10 | 8/10 |
| Manual test review | Non-functional requirements are properly tested | 0/10 (not yet due) | 5/10 |
| Manual test review | Coverage targets and justifications for uncovered code | 5/10 | 6/10 |
| Manual test review | Backend tests can be run automatically | 5/10 | 10/10 |
| Automated code review | Codacy configured according to project requirements | 7/10 | 10/10 |
| Automated code review | Remaining Codacy issues appropriately justified | 8/10 | 10/10 |

### 3.3 Actions Taken in Response to the Review

| Finding from SportsNow | Action | Status |
| :---- | :---- | :---- |
| "Create deal" reads like a user action | Removed it as a use case: recording the deal is now a step of "Respond to a proposal" ([PR \#196](https://github.com/m1lun/MatchMarket/pull/196)). | Fixed |
| Sequence diagrams show only one failure each | Every sequence diagram now shows each failure of its formal use case: Send a Message in [PR \#212](https://github.com/m1lun/MatchMarket/pull/212), the other four in [PR \#214](https://github.com/m1lun/MatchMarket/pull/214). | Fixed |
| UC2 checks for an existing rating only after the rating is written; activation box with no arrow | The Rate a Deal diagram now starts from the Deals tab, where an already-rated deal shows "Edit" instead of "Rate", and every activation box starts at an incoming arrow. | Fixed |
| Database writes with no reply | Every database write in the sequence diagrams now has a reply ([PR \#212](https://github.com/m1lun/MatchMarket/pull/212) and [\#214](https://github.com/m1lun/MatchMarket/pull/214)). | Fixed |
| The address must be typed from memory | The Profile tab now searches addresses as the user types and saves the picked suggestion ([PR \#198](https://github.com/m1lun/MatchMarket/pull/198)). | Fixed |
| Accepting a proposal rewrites both posts to close them | The posts are closed with a status-only update ([PR \#213](https://github.com/m1lun/MatchMarket/pull/213)). | Fixed |
| A mocked rating test expects a half-finished write | A rating and its reputation update are saved in one transaction, and the tests now check that a failure saves neither ([PR \#204](https://github.com/m1lun/MatchMarket/pull/204)). | Fixed |
| Fixed `Thread.sleep(2_000)` after airplane mode | The tests now wait until the server answers again instead of a fixed time ([PR \#208](https://github.com/m1lun/MatchMarket/pull/208)). | Fixed |
| Testing.md has an old commit, test counts and coverage screenshots | Refreshed the commit, test counts and coverage screenshots ([PR \#202](https://github.com/m1lun/MatchMarket/pull/202)). | Fixed |
| Testing.md's back-end table lists only Deals; Messaging has no back-end tests | Added interface tests, both mocked and unmocked, for the post, photo, option and custom field routes ([PR \#173](https://github.com/m1lun/MatchMarket/pull/173), [\#174](https://github.com/m1lun/MatchMarket/pull/174), [\#179](https://github.com/m1lun/MatchMarket/pull/179)), the Messaging routes ([PR \#186](https://github.com/m1lun/MatchMarket/pull/186), [\#187](https://github.com/m1lun/MatchMarket/pull/187), [\#191](https://github.com/m1lun/MatchMarket/pull/191), [\#197](https://github.com/m1lun/MatchMarket/pull/197)), the profile routes ([PR \#200](https://github.com/m1lun/MatchMarket/pull/200)) and the Matching feed ([PR \#209](https://github.com/m1lun/MatchMarket/pull/209)), each listed in Testing.md. | Fixed |
| Use Cases 2–5 have no end-to-end tests | Added end-to-end tests for the Deals use cases ([PR \#167](https://github.com/m1lun/MatchMarket/pull/167)) and the Messaging use cases ([PR \#185](https://github.com/m1lun/MatchMarket/pull/185)). | Fixed |
| NFR 1 has no test | Added the feed ranking latency test and its results ([PR \#209](https://github.com/m1lun/MatchMarket/pull/209)). | Fixed |
| Coverage gaps are justified only for Deals | Testing.md now justifies every file below 100% across the back end ([PR \#202](https://github.com/m1lun/MatchMarket/pull/202), [\#209](https://github.com/m1lun/MatchMarket/pull/209)). | Fixed |
| Major fault: no photos load on a physical device with the deployed back end | Could not reproduce: photos loaded on our physical device, a Samsung Galaxy S20 FE running Android 13. | Could not reproduce |
| Links in Requirements_and_Design.md do not work | Every link target exists and the links work on GitHub, so we could not reproduce it in the repository. The use case anchors now use `id` instead of the older `name`, which more Markdown viewers and PDF converters support. | Fixed |
| Use Case 1 mixes the request and listing flows | Kept as one use case, since both kinds of post share the same screens and steps. Its description now says that, and failure 5a1 lists which messages apply to requests and which to listings. | Fixed |
| Use Case 3 describes the ranking algorithm | Steps 3–5 now say what the system does for the user, and the scoring details moved to the Matching component in section 4.1 of Requirements_and_Design.md ([PR \#235](https://github.com/m1lun/MatchMarket/pull/235)). | Fixed |
| No explanation of the code structure; files have no top-level explanation | The code is now organised by component first (the five components in Requirements_and_Design.md section 4.1), with one folder per component and its architectural layers inside: routes, logic, store and models in the back end ([PR \#242](https://github.com/m1lun/MatchMarket/pull/242)), and model, view and view model (MVVM) in the app ([PR \#244](https://github.com/m1lun/MatchMarket/pull/244)). The structure is documented in the README's "Code structure" section. | Fixed |
| `DealsModel.kt` and `DealModels.kt` are easy to confuse | `DealsModel` is renamed `DealsStateHolder` and sits in `components/deals/viewmodel/`, while the data classes in `DealModels.kt` sit in `components/deals/model/` ([PR \#244](https://github.com/m1lun/MatchMarket/pull/244)). `FeedModel` is renamed `FeedStateHolder` for the same reason. | Fixed |
| Screens are not in the `ui` folder | Each component's screens are now in its `view/` folder, separate from its view models (`viewmodel/`) and back-end calls (`model/`) ([PR \#244](https://github.com/m1lun/MatchMarket/pull/244)). | Fixed |
| The back end has many very small files and no agreed structure | The back end now has an agreed structure: one folder per component under `backend/src/components/`, with `routes`, `logic`, `store` and `models` inside, and shared code in `backend/src/shared/` ([PR \#242](https://github.com/m1lun/MatchMarket/pull/242)). | Fixed |
| `assertTrue(size == 1)` hides the actual count | The five checks now use `assertEquals(1, size)`, so a failure shows the actual count. | Fixed |

### 3.4 Additional Internal Team Review

Team members reviewed each other's pull requests on GitHub. Names below are the team members' GitHub accounts: Milun (`m1lun`), Nishim (`Nishim12`), Bradley (`Bwong99`) and Terry (`darkcentaur`).

| PR | Author | Reviewer | Review | Outcome |
| :---- | :---- | :---- | :---- | :---- |
| [PR \#29](https://github.com/m1lun/MatchMarket/pull/29#issuecomment-6185268836) Google sign-in | Milun | Nishim, Bradley | Nishim asked for the backend to issue its own session and refresh tokens. Bradley later summarized what was added: issuing tokens, the refresh and logout endpoints, and protected routes. | Merged |
| [PR \#35](https://github.com/m1lun/MatchMarket/pull/35) Listings feed screen | Milun | Nishim | Asked for the comments to be cleaned up, then replied "Thanks for fixing the comments. LGTM!" | Merged |
| [PR \#46](https://github.com/m1lun/MatchMarket/pull/46#pullrequestreview-5579959981) Matching | Bradley | Milun | Comment review thanking Bradley for removing unit tests, ending "LGTM". | Merged |
| [PR \#53](https://github.com/m1lun/MatchMarket/pull/53#pullrequestreview-5593076708) Open a feed post | Bradley | Milun | Milun pushed a commit to the PR that made the post detail screen's read-only checks easier to read by flattening them (`f3f2e8f`), then commented "LGTM". | Merged |
| [PR \#54](https://github.com/m1lun/MatchMarket/pull/54#pullrequestreview-5593226561) Photo rule tests | Nishim | Milun | Milun approved the PR, noting that the tests are standalone and readable and that they clean up their data. | Merged |
| [PR \#107](https://github.com/m1lun/MatchMarket/pull/107) Users collection | Terry | Nishim | Nishim asked Terry to remove the unit tests that were not needed for CP2, to keep comments only on the important parts of the code, and to explain why the user model had both an address and a location. He then approved the PR. | Merged |
| [PR \#161](https://github.com/m1lun/MatchMarket/pull/161) Use-case docs | Milun | Nishim | Approved the documentation update. | Merged |

### Additional Internal Findings and Fixes

Internal testing also identified issues addressed through subsequent pull requests. [PR \#43](https://github.com/m1lun/MatchMarket/pull/43) documents a fix preventing negative values in built-in numeric and dimension fields, following a failure identified during Feature 1 end-to-end testing. [PR \#56](https://github.com/m1lun/MatchMarket/pull/56) improved the reliability of oversized-photo end-to-end tests by updating photo selection and test-file cleanup.

These changes were recorded as part of internal development and testing, independently of the formal peer-group review.
