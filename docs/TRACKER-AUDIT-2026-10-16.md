# Pulse tracker audit · 2026-10-16 snapshot

> Companion to [`NEXT-WAVE-SESSION-BRIEF.md`](NEXT-WAVE-SESSION-BRIEF.md) (Wave 0, tracker truth). This is a **point-in-time snapshot**. Re-verify each row before you act on it, because issues may have moved since. Nothing on GitHub was changed when it was produced.


Audited 2026-10-16 against `main` @ 3753b7c (= origin/main). It assumes PRs #551, #552, #553, #557 and #558 merge today. Read-only: no issue or PR was changed.

**How the evidence was gathered:** `git log origin/main --grep "#NNN"`, the `**Status:**` line of each story file under `docs/features/`, and code checks in `src/Pulse.WebApi` and `src/frontend` for the security items. Where a story file and the label disagree, the tracker convention is that the **markdown wins** (docs/GITHUB_TRACKER.md). Several `feature.md` story tables are stale (world-steering 07-09, identity-auth-roles 11-14, staff-shell); the story files themselves are current.

## Security and correctness verdicts

| # | Verdict | Evidence |
|---|---|---|
| #359 | FIXED, close | FIXED. Default-deny `FallbackPolicy` (`SessionAuthorizationExtensions.cs:74`), server-side attribution (`PostAttributionResolver`), telemetry scope authority, and anonymous-access sweep: stories identity-auth-roles 11-14 all Complete (PRs #388/#392/#394, 2efd777a) |
| #375 | OPEN (P0) | STILL OPEN. `/hubs/exercise` is not in `ExerciseLifecycleGatedRoutes` (`ExerciseLifecycleGatingMiddleware.cs:31` names it a risk). `ReactionLoopHost` has no lifecycle check. `ScenarioContentFires` has no consumers. White noise does stop (`WhiteNoiseService.cs:170`) |
| #377 | OPEN (P0) | STILL OPEN. Settings, chrome, practice-mode and lifecycle PUT/POST use only `EngineCockpitStaffAuthorizationFilter` (`ExerciseSettingsEndpoints.cs:57`, `ChromeSettingsEndpoints.cs:58`, `PracticeModeEndpoints.cs:57`, `LifecycleEndpoints.cs:58`). Engine, injects, pins, moderation, persona-admin, noise and pause tier already use `EngineCockpitControllerRoleFilter` |
| #481 | OPEN (P0) | STILL OPEN. `LifecycleEndpoints.cs:57-58` is staff-filter only, so an evaluator can POST StartEx/EndEx. Subset of #377 |
| #379 | OPEN (P1) | STILL OPEN. No pause/freeze check in `Social/PostIngestService.cs` or `PostWriteEndpoints.cs`; `ParticipantWritesAccepted` is read only by DTOs. PR #558 says "POST /api/posts itself has no server-side Freeze refusal" |
| #376 | OPEN (P1) | STILL OPEN. `ExerciseScopeDto.cs:67` `ExerciseName = exercise.Name`; also printed cards (`LinkCardService.cs:271`) and emails. DF-22 rename makes this more visible |
| #480 | OPEN (P1) | No `UseForwardedHeaders`; every limiter partitions on `RemoteIpAddress` (Program.cs:388-396 note). Needed before a 100-person StartEx |
| #490 | OPEN (P1) | `services.AddDataProtection()` with no PersistKeysTo/ProtectKeysWith (`EasyLoginFoundationExtensions.cs:68`); no Key Vault in `infrastructure/` |
| #390 | OPEN (P2) | STILL OPEN. Nothing in `Features/ExerciseConfiguration` pushes over SignalR; overlay heals only on refetch or reconnect (`overlayState.ts:359`) |
| #389 | OPEN (P2) | STILL OPEN. `PostAttributionResolver` refusals emit no telemetry (`:322` "no telemetry is emitted") |
| #485 | OPEN (P2, partial) | STILL OPEN. no-store covers join, word, roster, cards, email, export, participant-access. Missing on `/api/auth/login`, `/api/auth/refresh`, `/api/auth/shared`, `/api/auth/staff/login` |
| #393 | OPEN (P3, hygiene) | STILL OPEN but low. `StaffAuthEndpoints.cs:147-150` validates the body before identity; anonymous callers are already refused by FallbackPolicy. Hygiene only |

## A. Close now (work is on main) (78)

| # | Title | Evidence / notes | Suggested action |
|---|---|---|---|
| #7 | F: Engine review cockpit | All 3 stories (#34-#36) Complete per `engine-review-cockpit/feature.md`; kill switch delivered later by autonomy-safety/03 (#171, Complete) | Close (completed) |
| #51 | Per-exercise hostname (subdomain) | `exercise-isolation/08-per-exercise-hostname.md` Status: Complete; `HostExerciseResolver` on main | Close; remove status:todo |
| #67 | Per-exercise settings | Slices 01a+01b merged and wired (`Features/ExerciseConfiguration/ExerciseSettings*` on main). Only AC3 (channel route gating) unmet, by design; owned by #378 | Close; AC3 stays on #378 |
| #68 | Compliance chrome (configurable banners) | Story doc: built, wired, all 7 ACs met; code on main (`ExerciseConfiguration/Chrome/`) | Close |
| #69 | Exercise lifecycle state machine | All 9 ACs met; `ExerciseConfiguration/Lifecycle/` on main. Residual gaps live in #375/#379/#390/#481 | Close |
| #70 | Practice/sandbox flag | All 6 ACs met; `ExerciseConfiguration/PracticeMode/` on main | Close |
| #88 | F: Profiles & social graph | All children Complete: profiles-social-graph 01-08 (#109-#113, #369, #370) | Close after closing #110/#112/#113/#369/#370 |
| #93 | Post rendering & author identity (verified mark) | `posts/02-post-rendering-identity.md` Status: Complete | Close |
| #94 | Post provenance & telemetry | `posts/03-post-provenance.md` Status: Complete | Close |
| #110 | Follow / unfollow | `profiles-social-graph/02` Complete (mounted in `<Profile>`); feb66970 | Close |
| #112 | "Who to follow" suggested follows | `profiles-social-graph/04` Complete (read half; controller-adjustable half is #24) | Close |
| #113 | Audience magnitude & follower affordance | `profiles-social-graph/05` Complete except AC4 (an exercise-scope test) | Close (or fold AC4 test into #50) |
| #128 | F: Persona voice engine | persona-voice-engine stories 01-04 (#148-#151) all Complete | Close |
| #129 | F: Storyline model | storyline-model children #152-#156 are all closed | Close |
| #130 | F: Reaction loop | reaction-loop 01/02 Complete; 03/04 (#159/#160) Superseded by engine-runtime/01 (#285) | Close after #159/#160 |
| #131 | F: Silence escalation | silence-escalation children (#161, #162) closed / Complete | Close |
| #132 | F: Response reaction | response-reaction children (#163-#165) closed / Complete | Close |
| #135 | F: Autonomy & safety | autonomy-safety 01-04 Complete; 05-07 (#353/#354/#402) on main | Close after #353/#354/#402 |
| #173 | Engine event types (extend XC-004) | Taxonomy ratified on main (c949d888, #405); the only blocker named in the story (#403 provider_changed) merged as e9ea5238 | Close |
| #183 | Participant shell (D7) | `participant-shell/feature.md`: Complete, all 7 stories built, Gate-1 + Gate-2 | Close |
| #184 | Staff shell frame (D7) | staff-shell stories 01-05 Complete; `features/staffShell/` on main (feature.md's "PR open" note is stale) | Close |
| #209 | F1 Telemetry capture (XC-004 v0) | telemetry 01 (#210) and 02 (#274, story file Status: Complete) both done | Close |
| #238 | D7 follow-up: participant not-found leaks the COBRA staff 404 (WR-002) | No COBRA NotFound page remains in `src/frontend`; participant unknown routes go to `SocialRedirect` (`SocialRoutes.tsx:122`). Verify once in a browser | Close after a quick check |
| #266 | Backend host & persistence foundation (Phase B0) | backend-host stories 01-03 all Complete | Close |
| #300 | [ci] Backend deploy fails on serverless SQL auto-pause cold start | Fix in `.github/workflows/deploy-backend.yml:160-195` (wake attempt, poll for Online, authoritative apply); later backend deploys green | Close |
| #352 | Escalation dial live — real storyline, real target-chase, and the missing explanatory UX | Merged to main 2026-07-29 (PR #386, 4c542cfb). Only the UAT-verification DoD step is unrecorded | Close (owner confirms UAT) |
| #353 | Engine settings API (autonomy default + tier policy, runtime-settable) | Merged to main 2026-07-29 (bb9d9371, PR #386). UAT DoD unrecorded | Close (owner confirms UAT) |
| #354 | Engine settings panel (console admin surface) | Merged to main (01131c1f, PR #399). UAT DoD unrecorded | Close (owner confirms UAT) |
| #359 | Security: participant API surface enforces no session — reads public, POST /api/posts writable unauthenticated (CONFIRMED) | FIXED. Default-deny `FallbackPolicy` (`SessionAuthorizationExtensions.cs:74`), server-side attribution (`PostAttributionResolver`), telemetry scope authority, and anonymous-access sweep: stories identity-auth-roles 11-14 all Complete (PRs #388/#392/#394, 2efd777a) | Close |
| #369 | Persona presentation fields (backend) | `profiles-social-graph/06` Complete | Close |
| #370 | Follow graph (backend) | `profiles-social-graph/07` Complete | Close |
| #380 | AccountImport is built and exported but mounted nowhere | Mounted: `planner/pages/ExerciseSettingsPage.tsx:234` imports `AccountImport` (staff-navigation 03, ba3e5fe8 #411) | Close |
| #382 | Two nested landmarks on the planner staff surface (a11y) | `ExerciseSettingsPage.tsx:529` renders no `component="main"`; `StaffShellFrame` owns the one `<main>` | Close |
| #391 | Frontend suite: three files flake in full-parallel runs (partial collection, async-render race) | bdaac4c9 "root-cause the full-parallel-only suite failures (#391) (#410)" | Close |
| #401 | AI generation usage panel | Merged (6368af16, #406). Story doc: built + Gate-2 clean, UAT DoD outstanding | Close (owner confirms UAT) |
| #402 | Cut generation to the Fake provider (runtime egress safety lever) | Full stack merged (e9ea5238, #403); UAT provider is Fake (verified per engine-runtime/05) | Close |
| #419 | F: Demo polish — participant-first demo (ready 10/19, demo 10/20) | All 24 live children delivered (Waves 1/1b/2/3/4: #449, #459, #460, #463, #484); #438 already closed (Dropped) | Close after closing #420-#444 |
| #420 | I1 · Keyless Blob storage for media | Wave 1, 2435702c (#449) | Close |
| #421 | B1 · Schema — media, replies, reactions, avatars (one migration) | Wave 1, 2435702c (#449) | Close |
| #422 | F0 · Client seam — PostCard split, contract v2, mocks, upload client | Wave 1, 2435702c (#449) | Close |
| #423 | B5 · Role-scoped realtime groups | Wave 1, 2435702c (#449) | Close |
| #424 | BM · Media pipeline — upload, store, read SAS, staff library | Wave 1b, 36ee4e23 (#459) | Close |
| #425 | BP · Post v2 read and write | Wave 1b, 36ee4e23 (#459) | Close |
| #426 | B2 · Replies and real threads | Wave 1b, 36ee4e23 (#459) | Close |
| #427 | B3 · Reactions (like, repost) and the engagement reader | Wave 1b, 36ee4e23 (#459) | Close |
| #428 | B6 · Controller takedown (soft delete + PostRemoved) | Wave 1b, 36ee4e23 (#459) | Close |
| #429 | F1 · App frame and navigation | Wave 2, aec8a14a (#460) | Close |
| #430 | F2 · Media display — grid, inline video, viewer | Wave 2, aec8a14a (#460) | Close |
| #431 | F3 · Engagement — persisted likes and reposts | Wave 2, aec8a14a (#460) | Close |
| #432 | F4 · Threads and composer — replies, attach, instant own post | Wave 2, aec8a14a (#460) | Close |
| #433 | F5 · Brand and profile finish | Wave 2, aec8a14a (#460) | Close |
| #434 | F6 · Explore — trending, search, hashtag polish | Wave 2, aec8a14a (#460) | Close |
| #435 | F7 · Notifications, derived client-side (Could) | Wave 4, 4b63f95f (#484). Label says in-progress but doc says In Review and code is merged | Close |
| #436 | C1 · Post as persona v2 | Wave 3, 43b70131 (#463) | Close |
| #437 | C2 · Live world column | Wave 3, 43b70131 (#463) | Close |
| #439 | C4 · Console cleanup | Wave 1, 2435702c (#449) / aa31c974 | Close |
| #440 | PE · Persona profile edit (staff) | BE in Wave 1b (#459), FE in Wave 3 (#463) | Close |
| #441 | C5 · Takedown UI and live feed removal | Wave 3, 43b70131 (#463) | Close |
| #442 | C6 · Preview-as-participant shows the real feed, and StartEx/EndEx (Could) | Wave 4, 4b63f95f (#484). Label says in-progress; code merged | Close |
| #443 | S1 · Seed script (demo content through the public APIs) | Wave 3, 43b70131 (#463) | Close |
| #444 | S2 · Content pack authoring (human + Claude) | 0055994f "S2 Kestrel County demo pack + Kestrel MSEL ... (#444, #511) (#491)". Doc still says Not Started (stale) | Close; set doc to Complete |
| #453 | IQ-F · Scripted posts: console run sheet (demo slice) | a7544712 (#457), merged + deployed 10/13, UAT-verified; only the two-console sync check is left | Close (or keep until the two-login check, 5 min) |
| #466 | Foundation: schema, shared kernel, frozen contract | 9933bd95 (#486) | Close |
| #467 | Roster provisioning: CSV, add one, list, personas | 9933bd95 (#486) | Close |
| #468 | Personal links: join, revoke, reissue, disable | 9933bd95 (#486) | Close |
| #469 | Link cards and QR codes | 9933bd95 (#486) | Close |
| #470 | Day word: staff controls and word sign-in | 9933bd95 (#486) | Close |
| #471 | Day-long participant sessions | 9933bd95 (#486) | Close |
| #472 | Participant tokens survive a closed tab | 9933bd95 (#486) | Close |
| #473 | Join page: tap the link, you are in | 9933bd95 (#486) | Close |
| #474 | Sign-in page: Today's word | 9933bd95 (#486) | Close |
| #475 | Roster screen (staff) | 9933bd95 (#486) | Close |
| #476 | Today's word panel (staff) | 9933bd95 (#486) | Close |
| #477 | Printable card sheet (staff) | 9933bd95 (#486) | Close |
| #478 | Email the personal link (Azure Communication Services) | 59182f40 (#487) | Close |
| #479 | UAT tester provisioning script | 9933bd95 / 59182f40 (#486/#487) | Close |
| #544 | DF-26 · Demo pre-flight check (Test-DemoReady) and one-shot reset (Invoke-DemoReset) | Merged via #548 (953003ba, 65b08888) + #549 | Close |
| #546 | DF-28 · Correct the "drafts leak to participants" statements (governance brief, demo plan, #346) | Merged via #548 (d441552c) | Close |

## B. Close on merge (delivered by one of the 5 open PRs) (13)

| # | Title | Evidence / notes | Suggested action |
|---|---|---|---|
| #450 | demo-polish follow-ups: console persona list after exercise switch; staff secondaryText contrast (C4 Gate-1) | PR #553 body: DF-24 "closes #450 F-1"; DF-25 covers "#450 F-6" | Close on #553 merge |
| #496 | Demo feedback cut (demo 10/20) | All children except #514/#522 (Lows) are closed or close with #551/#553/#558 | Close after merges, once #514/#522 move to a post-demo hardening parent |
| #535 | DF-17 · Wave 4 foundation: one migration and the frozen contract | PR #558 (story 17) | Close on #558 merge |
| #536 | DF-18 · Pause tier, exercise clock and holding page survive a restart | PR #558 (story 18: restart-proof tier/clock/holding page) | Close on #558 merge |
| #537 | DF-19 · Edit own post: backend (15-min window, history, PostEdited push, export columns) | PR #558 (story 19) | Close on #558 merge |
| #538 | DF-20 · Edit own post: participant UI and staff view | PR #558 (story 20) | Close on #558 merge |
| #539 | DF-21 · "Pinned" marker on every card | PR #553 (story 21) | Close on #553 merge |
| #540 | DF-22 · Exercise Management: rename, archive, minimal duplicate | PR #553 (story 22; duplicate was cut, tracked in #554) | Close on #553 merge |
| #541 | DF-23 · Run sheet: mark an item fired without posting | PR #553 (story 23) | Close on #553 merge |
| #542 | DF-24 · Persona list refreshes when the controller switches exercise | PR #553 (story 24) | Close on #553 merge |
| #543 | DF-25 · COBRA muted-text token and a browser visual pass | PR #553 (story 25 part 1). The browser visual pass (part 2) is not in the PR | Close on merge if part 2 is dropped; otherwise retitle to the visual pass |
| #547 | PDF-03a · Load-test report on UAT (20/40/100 users, Sat 10/17) | PR #557 | Close on #557 merge |
| #550 | DF-29 · Printable exercise report (posts, metrics and charts, saved as PDF) | PR #551 (+ #552 adds post edits to the report) | Close on #551 merge |

## C. Relabel or retitle (keep open) (9)

| # | Title | Evidence / notes | Suggested action |
|---|---|---|---|
| #53 | Persona templates (create / edit / clone / archive) | Doc says In Progress but nothing is in flight (no template editor UI, no backend) | Align: set the doc to Not Started (or the label to in-progress) |
| #54 | Casts & one-action seeding with derived state | Same as #53 | Align doc and label |
| #58 | Role set | Doc says In Progress (types/guards exist; much server role-gating has since landed); label says todo | status:todo → status:in-progress; re-scope its remainder against #61/#377 |
| #101 | Repost & quote-post | Repost delivered (#427/#431). Quote is NOT delivered: the trigger is hidden (`PostActions.tsx:49-52`, QuoteComposer not mounted) | Retitle to "Quote-post"; status:in-progress → status:todo |
| #349 | Live provider UAT go-live — Azure OpenAI, Ambient tier, suggest-only | Built and merged (39c37ff5). AC6 blocked on the PROVIDER-GOVERNANCE §8 signature; no live model traffic yet | status:in-progress → status:blocked, with a reason comment |
| #448 | Post-demo: realtime connection outlives the session; Follow hard-delete (Wave 1 Gate-2 residuals) | M-1 (connection outlives the session) fixed by d0671b2f (#489). Remaining: `FollowService.cs:309` hard-deletes Follow rows (XC-010) | Retitle to the Follow soft-delete remainder (P2) |
| #456 | demo-polish follow-ups: image EXERCISE watermark, takedown vs issued media URLs, client request-body tidy (Wave 1b/2 Gate-2) | §1 image watermark done by DF-06 (#502); §4 seed rule done by S1. Remaining: §2 takedown vs issued SAS URLs, §3 client sends authorPersonaId/actingHumanId | Retitle/trim to §2-§3 (P2) |
| #461 | demo-polish follow-ups: controller console seams (Wave 3 Gate-1/Gate-2) | §1 (muted token, delete hover) and §3 (mark fired) close with PR #553 (DF-25, DF-23). Remaining: §2 media-id flags, §4 mock `useControllerIdentity` (`controllerIdentity.ts:121`), §5 seams | Trim after #553 merges (P2) |
| #465 | Easy participant login (demo 10/20) | All 14 delivered stories close (A). Open children: #480, #483, #485 (post-demo hardening) | Keep open for those three, or move them to a hardening parent and close |

## D. Superseded or duplicate (14)

| # | Title | Evidence / notes | Suggested action |
|---|---|---|---|
| #18 | Mid-exercise persona creation from the picker | Duplicate of #55 (same requirement, mirrored in persona-operation and persona-management) | Close as duplicate of #55, or link the two |
| #28 | Content takedown (≤2 clicks, tombstone, incident category) | Delivered by demo-polish B6 #428 (soft delete, PostRemoved, takedown categories) + C5 #441 (takedown UI) | Close as superseded by #428/#441 |
| #65 | Participant admin panel (login triage) | Login triage delivered by easy-login roster/links (#467/#468/#475) + staff-shell/03 participant-admin flyout (#194). Leftover: legacy password reset only | Close as superseded; note the leftover in #483 or a new small issue |
| #72 | Preview-as-participant | staff-shell/04 Preview as participant (#195, Complete) + C6 #442 (real feed) | Close as superseded |
| #77 | Native exercise clock (provider interface) | engine-runtime/03 scenario-clock service (#287, Complete) is the native COR-050 clock; DF-18 #536 adds persistence | Close as superseded by #287/#536 |
| #84 | F: Threads & replies | Only open child was #100 (superseded above); threads-replies 01/02 closed | Close after #100 |
| #96 | Soft delete & tombstones (thread-only) | B6 #428 soft delete + B2 #426 thread tombstones (b21e3e81 tombstone-leak sentinel) | Close as superseded |
| #100 | Persona/participant replies (both directions) | B2 #426 replies, F4 #432 participant replies, C1 #436 persona replies | Close as superseded |
| #102 | Amplification counts (queryable) | B3 #427 engagement reader (persisted like/repost counts) | Close as superseded (quote counts go with #101) |
| #117 | Notification center & badge (typed) | F7 #435 notifications (derived) + DF-14 #515 live badge | Close as superseded; typed server notifications stay with #118/#119 |
| #159 | Generate → review → publish wiring | Story doc: Superseded, built as engine-runtime/01 (#285) | Close (not planned) |
| #160 | Measure stage — telemetry + storyline update | Story doc: Superseded, built as engine-runtime/01 (#285) | Close (not planned) |
| #350 | Server-authoritative pause tier (Freeze reaches the real clock; Engine-paused unifies with the kill switch) | Code on main since 07-29 (PR #386). Restart-proofing is DF-18 #536 (PR #558); UAT proof is DF-27 #545 | Close when #545's UAT run is green |
| #351 | Freeze is participant-visible — overlay-state write path + SignalR push | Code on main since 07-29 (PR #386). Verified by DF-27 #545 | Close when #545's UAT run is green |

## E. Still open (152)

| # | Pri | Title | Evidence / notes | Suggested action |
|---|---|---|---|---|
| #375 | P0 | EndEx does not stop content reaching connected participants (/hubs/exercise un-gated) | STILL OPEN. `/hubs/exercise` is not in `ExerciseLifecycleGatedRoutes` (`ExerciseLifecycleGatingMiddleware.cs:31` names it a risk). `ReactionLoopHost` has no lifecycle check. `ScenarioContentFires` has no consumers. White noise does stop (`WhiteNoiseService.cs:170`) | Gate hub/broadcasts on lifecycle; stop the loop and the inject runner on completed |
| #377 | P0 | Staff writes are not role-scoped — an evaluator can rewrite the participant world | STILL OPEN. Settings, chrome, practice-mode and lifecycle PUT/POST use only `EngineCockpitStaffAuthorizationFilter` (`ExerciseSettingsEndpoints.cs:57`, `ChromeSettingsEndpoints.cs:58`, `PracticeModeEndpoints.cs:57`, `LifecycleEndpoints.cs:58`). Engine, injects, pins, moderation, persona-admin, noise and pause tier already use `EngineCockpitControllerRoleFilter` | Add a role filter (planner/controller) to the config writes |
| #481 | P0 | Lifecycle transition route admits any assigned staff (evaluator can POST EndEx) | STILL OPEN. `LifecycleEndpoints.cs:57-58` is staff-filter only, so an evaluator can POST StartEx/EndEx. Subset of #377 | Fix with #377; evaluator → 403 tests |
| #50 | P1 | Standing cross-exercise isolation test suite | Not started; would have caught #375/#377-type gaps | Build |
| #61 | P1 | Evaluator read-everything, write-nothing | Server half not done. DF-11 (#507) is UI only; enforcement is on #61/#377 | Umbrella for #377/#481 |
| #81 | P1 | EndEx | EndEx transition + overlay exist (#69/#442); the closing behaviour is #375/#390 | Re-scope to depend on #375 |
| #180 | P1 | Participant-visible exercise identity — requirements gap (D7 input) | Requirements decision blocking #376 | Decide |
| #345 | P1 | Feed pagination (backend) + real windowing (frontend) for burst legibility | `/api/feed` is a fixed `Take(FeedTake)` (`PostReadService.cs:172`), no cursor; no windowing library. NFR-002 burst legibility | Build |
| #376 | P1 | /api/exercise-context serves the INTERNAL exercise name to participants | STILL OPEN. `ExerciseScopeDto.cs:67` `ExerciseName = exercise.Name`; also printed cards (`LinkCardService.cs:271`) and emails. DF-22 rename makes this more visible | Decide in #180; serve WorldName |
| #379 | P1 | Participant writes are accepted during a lifecycle pause (merge obligation for world-steering CTL-023) | STILL OPEN. No pause/freeze check in `Social/PostIngestService.cs` or `PostWriteEndpoints.cs`; `ParticipantWritesAccepted` is read only by DTOs. PR #558 says "POST /api/posts itself has no server-side Freeze refusal" | Refuse participant creates when frozen or paused (mirror PATCH's 409 frozen) |
| #455 | P1 | Post-demo: idempotent post creation (Idempotency-Key / client-generated post id) | No Idempotency-Key or client post id anywhere; Retry can duplicate a PIO statement | Build |
| #480 | P1 | Login rate limits behind App Service: forwarded headers + per-room limits (post-demo) | No `UseForwardedHeaders`; every limiter partitions on `RemoteIpAddress` (Program.cs:388-396 note). Needed before a 100-person StartEx | Build (needs security review) |
| #490 | P1 | Post-demo: protect the easy-login DataProtection key ring with Key Vault | `services.AddDataProtection()` with no PersistKeysTo/ProtectKeysWith (`EasyLoginFoundationExtensions.cs:68`); no Key Vault in `infrastructure/` | Build |
| #545 | P1 | DF-27 · Freeze and resume verified on UAT (demo beat 6; closes #350/#351 if green) | Script merged (#548); the live UAT run is still pending. Closing it also closes #350/#351 | Run Test-FreezeResume on UAT after #558 deploys |
| #10 | P2 | NEEDS-YOU action bar — locate & highlight, never act | Not started | — |
| #11 | P2 | Static identity badge during conduct | Not started | — |
| #12 | P2 | Flag on any post → after-action record | Not started | — |
| #17 | P2 | Multi-controller presence & safe co-operation | Not started | — |
| #19 | P2 | Conduct timeline with item status | Lite slice delivered by inject-queue 06/07 (#452/#453): list + status, no timeline rail | Re-scope to the remainder |
| #20 | P2 | Fire / hold / skip / edit-then-fire (single + batch) | Lite: single-item fire/hold/skip/edit delivered (#452/#453), plus mark-fired (#541). No batch, no dual-time | Re-scope |
| #21 | P2 | Standalone native scheduler ("hold for conduct") | Not started | — |
| #22 | P2 | Timed bursts — a bundle fires as a paced sequence | Lite bursts delivered (fixed ~90 s window, #452) | Re-scope |
| #23 | P2 | Scenario-time-jump batch disposition (pause-first) | Not started | — |
| #24 | P2 | Attention levers (suggested-follows, flag-as-alert, trend boost) | Not started (deferred) | — |
| #27 | P2 | Break Fiction — Director-gated safety broadcast | Not started (deferred) | — |
| #30 | P2 | Monitoring board — live participant activity | Not started | — |
| #45 | P2 | Scoped surfaces & non-guessable media URLs | Story Not Started; media part delivered (BM #424: per-exercise blob prefix, short read SAS) | Re-scope to the remainder |
| #46 | P2 | Same persona template, independent instances per exercise | Not started | — |
| #49 | P2 | Archived exercises fully separable | Not started (archive action arrives in DF-22 #540) | — |
| #52 | P2 | Network readiness (self-test, allowlist, GFE guidance) | Not started | — |
| #55 | P2 | Mid-exercise persona creation (≤60s) | Not started (keep; #18 duplicates it) | — |
| #56 | P2 | Pre-exercise backdated post history | Not started | — |
| #57 | P2 | Bundled avatar library + upload | Not started; avatar upload exists via PE #440, the bundled library does not | Re-scope |
| #66 | P2 | Organization-account operation (post-as-org, attribution) | Not started | — |
| #71 | P2 | Build workspace (author the world staff-only) | Not started | — |
| #73 | P2 | Go-live readiness dashboard | Not started | — |
| #74 | P2 | Gated go-live — Staged, then StartEx→Live | Partly delivered: lifecycle (#69) + C6 StartEx (#442). Readiness gate not built | Re-scope |
| #75 | P2 | Content lock at go-live | Not started | — |
| #76 | P2 | Exercise duplication | Not started; the DF-22 minimal duplicate was cut (#554) | — |
| #78 | P2 | Discrete Director time-jumps | `ExerciseClockService.Jump` exists; no endpoint or UI | Build |
| #97 | P2 | Post as organization (grant-gated chip) | Not started | — |
| #103 | P2 | Amplification chain reconstruction | Not started | — |
| #105 | P2 | Sentiment reaction set (per-exercise) | Only like/repost exist | — |
| #107 | P2 | Organic trending + controller boost-weight | F6 (#434) shipped a client-side live trending baseline; no organic server trending or boost weight | Re-scope |
| #108 | P2 | Trending recompute (scoped, ≤60s) | No server trending recompute | — |
| #114 | P2 | 1:1 direct messages | Not started | — |
| #118 | P2 | Aggregation under load (training lever) | Not started | — |
| #119 | P2 | Platform-alert notifications (RIP-Alerts) | Not started | — |
| #122 | P2 | Full-text search (+ People / impersonation) | F6 (#434) shipped search over loaded posts; no server full-text search or People search | Re-scope |
| #166 | P2 | Engine repost / quote / react to spread | Not started | — |
| #167 | P2 | Spread velocity + organic trend push | Not started | — |
| #168 | P2 | Ambient background posting | Not started; DF-05 white noise (#501) is a no-AI stand-in | — |
| #174 | P2 | Tuning & observability surface | Not started | — |
| #177 | P2 | Latency/cost SLO measurement | Not started | — |
| #223 | P2 | AAR export package | Not started; DF-02 xlsx export (#498) and DF-29 report (#550) cover part of it | Re-scope |
| #296 | P2 | Engine publish: ingest-side draftId idempotency (WR-001) | `EnginePublishService.cs:168` still names ingest-side draftId idempotency a follow-up | Build |
| #322 | P2 | UAT: make the API same-origin with the SPA so the exercise host can be pulse-uat.cobrasoftware.com | Same-origin API (SWA Standard + forwarded headers). Shares the forwarded-headers work with #480 | Build with #480 |
| #371 | P2 | Reach model: definition workshop, exercise-scoped config + admin surface | Reach model workshop and config (not started) | — |
| #378 | P2 | Channel-enablement route gating is unowned (exercise-configuration story 01 AC3) | Channel-enablement route gating unowned (#67 AC3) | Assign an owner |
| #389 | P2 | A refused attribution attempt leaves no audit record (POST /api/posts) | STILL OPEN. `PostAttributionResolver` refusals emit no telemetry (`:322` "no telemetry is emitted") | Add the forged-origin audit event |
| #390 | P2 | Overlay: a participant frozen before EndEx stays on the holding page after EndEx (lifecycle overlay is pull-only) | STILL OPEN. Nothing in `Features/ExerciseConfiguration` pushes over SignalR; overlay heals only on refetch or reconnect (`overlayState.ts:359`) | Fix with #375 |
| #396 | P2 | persona-operation #329 follow-ups: server single-count telemetry + real in-flight/error UX | persona-operation follow-ups (server single-count telemetry, in-flight UX) | Build |
| #445 | P2 | Post-demo: harden media Blob storage (I1 Gate-1 residuals) | Infra hardening (functionapp listKeys, least privilege, CORS, OAuth default) | Build before any functions/both environment |
| #446 | P2 | Post-demo: realtime staff-group hardening (B5 Gate-1 residuals) | Hub staff-group membership is checked only at connect (M-2); duplicated session checks (L-3) | Build |
| #462 | P2 | demo-polish follow-ups: post-demo hardening (sanitizer callers, HTML outputs, PostRemoved replay) | Sanitizer caps on staff callers, HTML-encode rule for non-React outputs (now relevant to DF-29's report), PostRemoved replay | Build; add the encode AC to #555 |
| #483 | P2 | Roster: sign-in names for non-Latin and one-letter names (post-demo) | Roster sign-in names for non-Latin and one-letter names | Build |
| #485 | P2 | Cache-Control: no-store on every auth route that returns tokens (post-demo) | STILL OPEN. no-store covers join, word, roster, cards, email, export, participant-access. Missing on `/api/auth/login`, `/api/auth/refresh`, `/api/auth/shared`, `/api/auth/staff/login` | Apply NoStoreEndpointFilter to the 4 routes |
| #524 | P2 | PDF-01 · Phones and tablets: participant app on iPhone, iPad and Android | Post-demo customer ask | — |
| #525 | P2 | PDF-02 · Offline: cached feed and media, "missed while offline" marker | Post-demo customer ask | — |
| #526 | P2 | PDF-03 · Load test at 2-5× peak, restart resilience, backup site and switchover | Parent of #547 (PDF-03a); restart resilience partly comes from DF-18 | Keep |
| #527 | P2 | PDF-04 · Facebook-style second channel (same injects, per-channel override) | Post-demo customer ask | — |
| #528 | P2 | PDF-05 · NewsNow: fictional news site for newscasts and articles | Post-demo customer ask | — |
| #529 | P2 | PDF-06 · Cadence ↔ Pulse integration: inject push, fire, conduct data back | Post-demo customer ask | — |
| #530 | P2 | PDF-07 · Implementer sheets: per-inject conduct sheet in the export, per-controller sheet | Post-demo customer ask | — |
| #531 | P2 | PDF-08 · In-app camera capture (participants and controllers), auto-marked | Post-demo customer ask | — |
| #532 | P2 | PDF-09 · Server-side EXERCISE burn-in for uploaded photos and video | Post-demo customer ask | — |
| #555 | P2 | Word (.docx) export of the exercise report, with white-labeling | Word export of the exercise report | Build |
| #556 | P2 | Controller notes in the exercise report | Controller notes in the exercise report | Build |
| #1 | P3 | E7 — Controller Command Surface | Epic; open children | Keep |
| #2 | P3 | F: Console shell (toolstrip, flyouts, action bar) | Feature; #10-#13 open | Keep |
| #3 | P3 | F: Persona operation | Feature; #17, #18, #396 open | Keep |
| #4 | P3 | F: Inject queue & conduct timeline | Feature; #19-#23 open | Keep |
| #5 | P3 | F: World steering | Feature; #24, #27, #29, #350-#352 open | Keep |
| #6 | P3 | F: Live monitoring | Feature; #30-#33 open | Keep |
| #8 | P3 | F: Rumor tracker | Stub feature (later phase) | Keep |
| #13 | P3 | Trainee monitor flyout (adaptive-loop signal) | Not started | — |
| #29 | P3 | Off-platform response marker | Not started (deferred) | — |
| #31 | P3 | Watchlist columns (TweetDeck-style) | Not started | — |
| #32 | P3 | Expected-action tracking (fired-vs-responded) | Not started | — |
| #33 | P3 | Queue-pressure meter (demand, not performance) | Not started | — |
| #37 | P3 | E1 — Platform Core & Exercise Isolation | Epic; open children | Keep |
| #38 | P3 | F: Exercise isolation | Feature; #45-#52 open | Keep |
| #39 | P3 | F: Identity, auth & roles | Feature; #58, #61, #65, #66, #389 open | Keep |
| #40 | P3 | F: Persona management & cast libraries | Feature; #53-#57 open | Keep |
| #42 | P3 | F: Exercise build & go-live | Feature; #71-#76 open | Keep |
| #43 | P3 | F: Exercise clock & scenario-time model | Feature; #78, #79, #81 open | Keep |
| #79 | P3 | Suspension & module advancement (TTX) | Not started | — |
| #82 | P3 | E2 — Social Network | Epic; open children | Keep |
| #83 | P3 | F: Posts | Feature; #95, #97 open | Keep |
| #85 | P3 | F: Amplification (reposts & quotes) | Feature; #101 (quote), #103 open | Keep |
| #86 | P3 | F: Reactions | Feature; #105 open | Keep |
| #87 | P3 | F: Hashtags & trending | Feature; #107, #108 open | Keep |
| #89 | P3 | F: Direct messages | Feature; #114-#116 open | Keep |
| #90 | P3 | F: Notifications | Feature; #118, #119 open | Keep |
| #91 | P3 | F: Feeds & discovery | Feature; #122, #124, #125, #345 open | Keep |
| #95 | P3 | Link previews for in-sim URLs | Not started | — |
| #115 | P3 | DM use cases (tips / coordination / vectors) | Not started | — |
| #116 | P3 | DM observability (evaluators/controllers) | Not started | — |
| #124 | P3 | Engagement-weighted "For You" mode (stretch) | Stretch | — |
| #125 | P3 | PIO multi-column mode (grant-gated) | Not started | — |
| #126 | P3 | E8 — Adaptive Content Engine | Epic; open children | Keep |
| #133 | P3 | F: Amplification engine | Feature; #166, #167 open | Keep |
| #134 | P3 | F: Ambient chatter | Feature; #168 open | Keep |
| #136 | P3 | F: Engine telemetry & tuning | Feature; #174 open | Keep |
| #137 | P3 | F: Engine eval harness | Feature; #177, #178 open | Keep |
| #138 | P3 | F: Rumor model | Stub (v1.1) | Keep |
| #139 | P3 | F: Contradiction reaction | Stub (v1.1) | Keep |
| #140 | P3 | F: Auto mode | Stub (v1.1) | Keep |
| #141 | P3 | F: Expected-action binding | Stub (phase 4) | Keep |
| #178 | P3 | Scenario reaction-correctness tests | Blocked (needs the full loop) | Label status:blocked |
| #199 | P3 | D6 follow-up: Misinformation spread-tree visualization (EVL-013, metrics-v2) | Design follow-up | — |
| #200 | P3 | D6 follow-up: Replay channel coverage — Wire/Weather playback (EVL-003) | Design follow-up | — |
| #201 | P3 | D6 follow-up: Annotation attach-to-selection (drag post into popover, EVL-020) | Design follow-up | — |
| #202 | P3 | D6 follow-up: Retention / off-box export policy surface (EVL-032) | Design follow-up | — |
| #218 | P3 | E10 — Evaluation & AAR | Epic; open children | Keep |
| #219 | P3 | F10.1 Evaluation timeline & replay foundation | Feature; phase 4 | Keep |
| #220 | P3 | F10.2 Response, coverage, reach & sentiment metrics | Feature; phase 4 | Keep |
| #221 | P3 | F10.3 Live evaluator tools: storyline board & annotation capture | Feature; phase 4 | Keep |
| #222 | P3 | F10.4 AAR export package | Feature; #223, #224, #555, #556 open | Keep |
| #224 | P3 | Retention & export policy | Not started | — |
| #225 | P3 | Response latency with evidence-level chip | Not started (phase 4) | — |
| #226 | P3 | Coverage — missed opportunities, provisional until confirmed | Not started (phase 4) | — |
| #227 | P3 | Reach & sentiment trajectory with controller-dial overlay | Not started (phase 4) | — |
| #228 | P3 | Pre-E8 graceful degradation | Not started (phase 4) | — |
| #229 | P3 | Misinformation spread tree | Not started (phase 4) | — |
| #230 | P3 | Read-only staff access to the evaluator dashboard | Not started (phase 4) | — |
| #231 | P3 | Timeline explorer (filters, per-human attribution, deep-link) | Not started (phase 4) | — |
| #232 | P3 | Replay player (honest fidelity) | Not started (phase 4) | — |
| #233 | P3 | Hotwash mode switch (participant-visible replay) | Not started (phase 4) | — |
| #234 | P3 | Live storyline board | Not started (phase 4) | — |
| #235 | P3 | Live annotation capture (≤10 seconds) | Not started (phase 4) | — |
| #236 | P3 | Annotation push to Cadence | Not started (phase 4) | — |
| #298 | P3 | Engine-runtime test hardening (flakes + coverage) | Partly addressed by bdaac4c9 (#391 root-cause); converter negative test and read-only fidelity items remain | Trim |
| #334 | P3 | chore: migrate .NET test projects to xUnit v3 | Test projects still on xunit 2.9.3 | Chore |
| #393 | P3 | POST /api/staff/active-exercise validates its body before establishing identity | STILL OPEN but low. `StaffAuthEndpoints.cs:147-150` validates the body before identity; anonymous callers are already refused by FallbackPolicy. Hygiene only | Fix and drop the sweep exception |
| #451 | P3 | demo-polish follow-ups: thread reply cap, mock tombstone divergence, client sanitizer parity (B2 / BP Gate-1) | B2/BP Gate-1 lows | Batch with other lows |
| #514 | P3 | Post-demo: demo-feedback backend Gate-1 Lows (01-05) | Demo-feedback backend Lows (01-05) | Batch |
| #521 | P3 | Post-demo: demo-feedback Wave 3 Gate-1 Lows and follow-ups (11, 12b, 13, 14, 15) | Wave 3 Lows | Batch |
| #522 | P3 | Demo-feedback follow-ups from the #518 / #510 / Clear-DemoContent Gate-1 reviews (Lows, post-demo) | Lows from #518/#510 | Batch |
| #523 | P3 | Post-demo customer feedback (deferred from the 10/20 demo cut) | Feature; PDF-01..10 open | Keep |
| #533 | P3 | PDF-10 · GIFs: curated exercise GIF library (optional search later) | Post-demo customer ask | — |
| #554 | P3 | Post-demo: demo-feedback Wave 4 polish Gate-1 Lows and the cut duplicate (21-25) | Wave 4 polish Lows + the cut duplicate | Batch (duplicate overlaps #76) |

## Label hygiene (applies across categories)

- **No `phase:`, `feature:` or `status:` labels** on issues that stay open: #322, #371, #375, #376, #377, #378, #379, #390, #393, #490 (and #369/#370/#380, which close anyway). #480, #481, #483 and #485 have no `phase:` label. #481 also has no `feature:` label (suggest `feature:identity-auth-roles`). #296, #298, #514, #521, #522 and #554 have no `status:`. #178 should be `status:blocked`.
- **Stale `feature.md` tables to refresh with the closes:** demo-polish (all In Review → Complete), easy-login (all In Review → Complete), world-steering (07-09 still say Not Started), identity-auth-roles (11-14 say Not Started), exercise-configuration (02-04 "awaiting the umbrella merge"), staff-shell ("PR open"), demo-feedback (17-25 Not Started, 26-28 In Review).
- **Sub-issue data:** GitHub lists #550 as closed under #496 while `list_issues` returns it open. Re-check it after #551 merges.

## Counts

| Category | Count |
|---|---|
| A. Close now (work is on main) | 78 |
| B. Close on merge (delivered by one of the 5 open PRs) | 13 |
| C. Relabel or retitle (keep open) | 9 |
| D. Superseded or duplicate | 14 |
| E. Still open | 152 |
| **Total** | **266** |

Priorities within E: P0 = 3, P1 = 11, P2 = 64, P3 = 74 (P3 includes 36 epic/feature parents that stay open because they have open children).

If A, B and D are actioned, about 105 issues close and about 161 stay open.
