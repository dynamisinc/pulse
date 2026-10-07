# Participant-first demo plan (target Mon 2026-10-19)

> **Status: PROPOSED 2026-10-07. Tom needs to confirm the [Day-0 decisions](#9-day-0-decisions-tom) first.**
> This plan replaces the engine-first demo in [`BUILD_PLAN.md` → Demo](../BUILD_PLAN.md#demo--target-2026-10-18-proposed-confirm-audience-date-and-storyline)
> because the audience changed. The prospect cares most about (1) a participant Twitter/X experience that
> looks finished, including **videos that play from a post**, and (2) controllers driving that feed.
> They care less about the AI engine for now.
> *How* each wave runs (worktrees, Workflow fan-out, gates) is in
> [`ORCHESTRATION_MECHANICS.md`](../ORCHESTRATION_MECHANICS.md). This doc covers *what* gets built and
> *when*, plus the few places this push departs from those mechanics.

---

## 1. Where we stand today (2026-10-07)

### Summary

The **engineering foundation is strong**:

- exercise isolation, identity and auth
- telemetry, CI and Azure infrastructure
- about 4,700 tests: frontend 2,268, `Pulse.Core` 403, `Pulse.WebApi` 2,018

The **AI engine is the most finished feature**. The **participant social app is a working skeleton**:
a real feed, text posts, follows and live updates all run against the API. It does **not** yet look
or behave like a finished X-class product.

Most of the social features a viewer expects either don't exist or only change local state:

- media
- replies
- persisted likes and reposts
- real counts
- navigation chrome
- avatars

**There is no video support anywhere in the stack.**

The controller side is rich for the engine (review cockpit, steering, freeze). It is thin for the
non-AI workflows this audience will ask about: posting media, watching the feed, and scripting content.

### Scorecard

| Area | State | Evidence |
|---|---|---|
| Participant feed (read, live pill, All/Following) | ✅ Live | `GET /api/feed`, SignalR `PostReceived` + polling fallback |
| Text posts (participant + controller-as-persona) | ✅ Live | `POST /api/posts` |
| Follow graph, Following feed, Who to follow | ✅ Live | persisted; feed filtered server-side |
| Profiles (banner, bio, counts, follow) | ⚠️ Built, hollow tabs | "Posts & replies" repeats Posts; Media is empty and Likes is hard-coded `[]` (`Profile.tsx:366-377`) |
| **Images in posts** | ❌ Placeholder only | `PostMedia` has no `url` (`types/post.ts`). PostCard draws a grey box with the alt text. The server accepts media but **does not store it** (`PostWriteEndpoints.cs:206-209`). There is no `<img>` anywhere in the app |
| **Video in posts** | ❌ Not started anywhere | The composer rejects it with "Inline video is coming soon" (`useComposePost.ts:141`). There is no `<video>`, no model field and no storage |
| **Replies / threads** | ❌ Not persisted | `Post` has no parent id. `/api/threads/{id}` always returns empty ancestors and replies. There is no reply composer |
| **Likes / reposts / counts** | ❌ Visual only | Optimistic local toggle plus telemetry; resets on refresh. Live counts are hard-coded `0,0,0` (`ParticipantPostDto.cs:68`) |
| App frame (nav rail, right rail) | ❌ Not built | A single 600px column pinned left with blank space to the right ([screenshot](baseline-2026-10-07/participant-feed-desktop.png)). The D1 design specifies `240 nav \| 600 main \| 344 sidebar` |
| URLs / back button | ❌ None | Thread, profile and hashtag views are local `useState` (`SocialChannel.tsx:163`). There are no deep links, and the browser's Back button leaves the app |
| Search, trending, notifications, DMs | ❌ Not built | All are Not Started stories |
| Avatars | ⚠️ Initials and silhouettes | The persona model has no image fields |
| Brand polish | ⚠️ Rough | Figtree is referenced but never loaded. The tab title "Pulse - Media Environment Simulator" breaks fiction. The social CSS reads `--pulse-ac`, which nothing sets, so brand colours never reach the feed. A dark-mode OS gives a half-dark page |
| Controller: post as persona | ⚠️ Text only | No media and no replies. Errors are swallowed (`useComposeAsPersona.ts:244`, `.catch(() => {})`), so the console shows success even when the post failed |
| Controller: watch the feed | ❌ Missing | The console's main area is nearly empty and carries dev copy ("surfaces dock here as they land"). You need a second participant tab to see the feed |
| Controller: scripted / scheduled content | ❌ Missing | Inject queue not started. PAUSE INJECTS is disabled ("No inject queue yet") |
| Controller: personas / participants admin | ❌ Script-only | 9 personas are hard-coded in `PersonaCastSeeder.cs`. Persona binding goes through `/api/ops/*` scripts only |
| Controller chrome | ⚠️ Mock bits | Fake presence avatars. "SimCell-1" vs "SIMCELL-1". ⌘K promises commands that don't exist. In UAT the persona context panel always shows "Voice notes unavailable / No recent posts" |
| Engine (review queue, steering, freeze, settings, usage) | ✅ Live on `Fake` | Verification debt #349–#354, #401, #402; live AI waits on §8 |
| UAT | ⚠️ Healthy, fragile | Fixed yesterday (#413). Every backend deploy or restart drops in-memory engine state, and the reset scripts handle it ([operating notes](../BUILD_PLAN.md#uat-operating-notes)) |
| CI on `main` | ❌ Red (flake) | Run 257 fails on `exerciseScopeRefreshComposition.test.tsx:195`. It is the same passive-`useEffect` mount-counter class that #412 fixed in two sibling tests |
| Two-worlds leak | ⚠️ Real defect | Staff-only `ReviewItemChanged` (unpublished engine drafts) goes to the same SignalR group participants join (`EngineReviewBroadcaster.cs:73`, `ExerciseRealtimeHub.cs:76`). It is visible in a participant's devtools. Fix: `social-api/05` |

### Screenshots (dev server, mock data, 2026-10-07)

| Participant feed, desktop | Media today (grey boxes) | Controller console |
|---|---|---|
| ![feed](baseline-2026-10-07/participant-feed-desktop.png) | ![media](baseline-2026-10-07/participant-feed-media-placeholders.png) | ![console](baseline-2026-10-07/controller-console.png) |

Also captured: [mobile feed](baseline-2026-10-07/participant-feed-mobile.png),
[profile](baseline-2026-10-07/participant-profile.png),
[post-as-persona](baseline-2026-10-07/controller-post-as-persona.png).

> Mock data shows realistic counts and media *placeholders*. **In UAT it is worse:** counts are 0·0·0, there
> are no media boxes at all, threads are empty, and after the 2026-10-06 clear the feed opens empty.

---

## 2. Strategy

1. **Re-aim the demo at the participant experience; keep the engine as a 2-minute teaser.** Stop
   spending on engine verification and live AI (§8). The exception is Freeze (#350/#351): it is a
   non-AI control beat, so verify it as part of rehearsal.
2. **Close the "is this real?" gaps, not breadth.** In order of how fast a viewer notices: images and
   video in posts, real avatars, non-zero counts that respond to clicks, replies that show up in
   threads, an X-style 3-column frame, then trending/search. Notifications and DMs stay out unless
   time is left.
3. **Controllers drive a scripted world.** Post-as-persona gains media and reply. A **Run sheet**
   (pre-authored posts fired with one click) gives the presenter a reliable script and shows the
   MSEL-style workflow this customer knows. A **Live world** column fills the empty console.
4. **Contract first, so backend and frontend build in parallel.** Freeze the Post v2 / Persona v2 wire
   contract ([§4](#4-the-contract-post-v2--persona-v2)) on Day 0. Frontend builders work against
   upgraded mocks while the backend lands. **Put every schema change in one migration**, so parallel
   builders never fight over the EF model snapshot.
5. **Prototype corners we accept:**
   - Media is URL-referenced, served as static files from the frontend (`/demo-media/*`), with no upload.
   - Participants can't attach media; the button is hidden for the demo.
   - Trending and search are computed client-side over the loaded feed.
   - Counts = a seeded baseline (the fictional crowd) + real reactions.
   - Personas come from a seeded demo pack, not an admin UI.

---

## 3. Demo storyline v2 (~20 min)

The seeded "Fairhaven water" world, rebuilt with a **demo content pack**:

- 30–40 opening posts, backdated over the previous ~6 scenario hours
- photos, 2–3 videos, replies, and engagement baselines

| # | Beat | What the prospect sees | Needs |
|---|---|---|---|
| 1 | **"It's X."** The PIO signs in, on a laptop or phone | A 3-column Pulse app: logo and nav rail, a feed of real avatars, photos and a news video (it plays inline and opens full-screen), "Trending in Fairhaven: #WaterIssues", verified marks next to the lookalike impersonator, threads with replies, profiles with Media tabs | W1, W2 |
| 2 | **Controller drops breaking news** | In the console the Live world column shows the same feed. From the **Run sheet**: *Fire* "Newsline 7 — LIVE from the water plant (video)". On the participant screen "▲ 1 new post" appears and the video plays | C1–C3 |
| 3 | **Misinformation** | Run sheet: the impersonator @FairhavenWaterUpd posts a "brown tap water" photo; citizen personas pile on with replies. The counts climb | C3, B2/B3 |
| 4 | **The PIO responds** | The PIO posts the official statement (with `#WaterIssues`). The controller replies **as a citizen persona** with a follow-up question, live, and the PIO sees it in the thread | C1, F4 |
| 5 | **Moderation** *(if C5 lands)* | The controller takes down the impersonator post; it disappears from the participant feed live | B6, C5 |
| 6 | **Freeze the world** | The controller freezes, the participant gets the holding page, and Resume continues from the same scenario minute | already built (verify #350/#351) |
| 7 | **Teaser: "the world can also react on its own"** | The engine review queue: approve one AI draft and it appears in the feed. Two minutes, no deep dive | already built |

---

## 4. The contract (Post v2 / Persona v2)

> **Frozen on Day 0.** B1 builds the server half and F0 the client half (types + mocks), in parallel. Any
> change after the freeze goes through the orchestrator, never a builder.

```ts
// Participant-visible post (feed, thread, SignalR PostReceived) — additive to today's shape
interface PostMedia {
  kind: 'image' | 'video'
  url: string            // allow-listed: /demo-media/...  (Azure Blob origin later)
  alt: string            // required (NFR-001)
  posterUrl?: string     // video only
  width?: number         // intrinsic size → aspect ratio, so the feed doesn't jump
  height?: number
  durationSec?: number   // video only → "0:42" badge
  captionsUrl?: string   // optional WebVTT
}
interface ParticipantPostView {
  id: string; authorPersonaId: string; text: string; scenarioTime: string
  media?: PostMedia[]                                 // ≤4 images OR exactly 1 video
  inReplyTo?: { postId: string; authorHandle: string } // NEW
  counts: { reply: number; repost: number; like: number } // baseline + real
  viewer?: { liked: boolean; reposted: boolean }      // NEW — for the caller's persona
  linkPreview?: PostLinkPreview                       // unchanged
}
// Persona (GET /api/personas, suggestions): + avatarUrl?: string; bannerUrl?: string
```

**Server (single migration, story B1):**

- `Post` gains:
  - `MediaJson` (nvarchar(max), nullable)
  - `ParentPostId` (uniqueidentifier, nullable, self-FK, indexed)
  - `BaselineLikeCount`, `BaselineRepostCount`, `BaselineReplyCount` (int, default 0)
- `Persona` gains `AvatarUrl` and `BannerUrl` (both nullable).
- A new `PostReaction` table: `Id, ExerciseId, PostId, PersonaId, Kind (like|repost), CreatedScenarioTime`, unique on
  `(PostId, PersonaId, Kind)`, **`IExerciseScoped`**.
- **Remember #413:** any hand-written SQL that names a column added in the same migration must be
  `EXEC(N'…')`-wrapped, and `IdempotentMigrationScriptTests` must pass.

**Endpoints:**

| Endpoint | Change | Story |
|---|---|---|
| `POST /api/posts` | Gains `media[]` (validated: allow-listed URL pattern `^/demo-media/[a-z0-9/_-]+\.(jpe?g\|png\|webp\|gif\|mp4\|webm)$`, ≤4 images or 1 video, alt required) and `parentPostId` (must resolve in the same exercise) | B1, B2 |
| `GET /api/feed` | Top-level posts only (`ParentPostId is null`); counts = baseline + real; `viewer` state; newest 200 (it has no `Take` today) | B1, B3 |
| `GET /api/threads/{id}` | Real ancestors (root → parent) and replies (oldest first) | B2 |
| `PUT`/`DELETE /api/posts/{id}/reactions/{like\|repost}` | Idempotent; returns the new counts | B3 |
| `DELETE /api/staff/posts/{id}` | Controller-only soft delete (`DeletedAt`, which already exists) + SignalR `PostRemoved` | B6 |
| `POST /api/ops/seed-demo-pack` | Secret-gated and idempotent; loads `demo-pack.json` (avatars, opening posts, replies, baselines) | B4 |

**Always-Critical review classes for this push:**

- an isolation break, e.g. a reaction, or a reply parent, that resolves outside the exercise
- an un-allow-listed media URL, which is an unsanitized surface
- COBRA on a participant path

---

## 5. Scope: Must / Should / Could / Cut

Each story gets an ID here. Its "home" is the existing backlog story it slices, so the story-agent writes it as a
**demo slice** of that story, or under a new `docs/features/demo-polish/` where none exists.
Effort: S ≤ ½ day of agent time, M ≈ 1 day, L ≈ 2 days.

### Wave 0 — prep (Wed 10/7 – Thu 10/8)

| ID | Stack | What | Home | Effort |
|---|---|---|---|---|
| P1 | fe | **Fix the CI flake.** In `exerciseScopeRefreshComposition.test.tsx`, count `badgeMounts` in `useLayoutEffect` (the same fix #412 applied to two sibling tests) | — | S |
| P2 | docs | **story-agent writes every story below** plus `docs/features/demo-polish/implementation.md` (the Wave Plan, with owned files as in §6) and freezes the contract (§4) | — | M |
| P3 | 🧑 | **Decisions** ([below](#9-day-0-decisions-tom)) and **media procurement** starts | — | — |

### Wave 1 — the contract lands (Thu 10/8 – Sat 10/10)

| ID | Pri | Stack | What | Home | Effort |
|---|---|---|---|---|---|
| B1 | **Must** | be | Post v2 / Persona v2 schema (the one migration), media write path + allow-list, DTO, SignalR and personas payloads, feed `Take(200)` | posts/01 (video AC), persona-management/05 | L |
| F0 | **Must** | fe | **PostCard decomposition**: split into `PostHeader` / `PostBody` / `PostMediaSlot` / `PostActions`, so Wave 2 builders own disjoint files. Contract v2 types. **Mocks v2**: media URLs, replies, avatars, viewer state. Placeholder assets in `public/demo-media/`. Add `/demo-media/*` to the SWA `navigationFallback.exclude`. Add `*.mp4 binary` / `*.webm binary` to `.gitattributes` | — | M |
| B5 | **Should** | be | **Role-scoped SignalR groups.** Staff-only `ReviewItemChanged` goes to a staff group, never to participant connections | social-api/05 | M |
| B2 | **Must** | be | Replies: `parentPostId` on write, a real thread read, a reply count, top-level-only feed. *Starts after B1 merges* | threads-replies/01–03 | M |
| B3 | **Must** | be | Like/repost endpoints, counts = baseline + real, `viewer` state. *Starts after B1 merges; parallel with B2* | reactions/01, amplification/02 (counts only) | M |
| B6 | Should | be | Controller takedown: soft delete + `PostRemoved` broadcast. *After B1* | world-steering/05 (slice) | S |

### Wave 2 — participant fan-out (Sat 10/10 – Tue 10/13)

| ID | Pri | Stack | What | Home | Effort |
|---|---|---|---|---|---|
| F1 | **Must** | fe | **App frame + navigation.** Nav rail (Pulse heartbeat logomark; Home / Explore / Profile; Post button opens the composer modal; account card + sign-out), right rail (search box slot, trending slot, Who to follow moved here). **Real URLs** (`/home`, `/explore`, `/hashtag/:tag`, `/:handle`, `/:handle/status/:id`) so Back works. Mobile: bottom tab bar | D1-013, participant-shell/03 | L |
| F2 | **Must** | fe | **Media.** `MediaGrid` (X-style 1/2/3/4 layouts), **inline `VideoPlayer`** (poster, `controls playsInline`, duration badge, keyboard operable, "EXERCISE" watermark slot per NFR-008), `MediaViewer` lightbox (images + full-screen video), real link-card images; realtime parser keeps media | posts/01 (video), posts/04 (card image) | L |
| F3 | **Must** | fe | **Engagement.** Like/repost persisted with an optimistic update and rollback, compact counts ("1.4K"), PostCard self-wires its actions (so profile and hashtag cards stop having dead buttons), hide quote and share | reactions/01, amplification/01 | M |
| F4 | **Must** | fe | **Threads + composer.** Flattened thread (ancestors above, replies below, per D1-006), reply composer ("Replying to @x"), live reply append, "Replying to" line on cards, **own post appears instantly** (not via the pill), **hide the participant image-attach button** (no upload this phase; today it silently drops the file) | threads-replies/02–03 | M |
| F5 | **Must** | fe | **Brand + profile finish.** Load Figtree; fiction-safe tab title and favicon; wire `--pulse-ac` to the brand tokens; force light mode for the demo; loading skeletons; `Avatar` renders `avatarUrl`; profile banner image; real profile tabs (Posts / Replies / Media / Likes) | D1 backlog, profiles-social-graph | M |
| F6 | Should | fe | **Explore.** Trending panel, computed client-side from the loaded feed window ("Trending in Fairhaven"). Explore page. Client-side search over posts + people (shows the impersonation pair side by side). Hashtag page polish | hashtags-trending/02 (lite), feeds-discovery/03 (lite) | M |
| F7 | Could | fe | Notifications, derived client-side (mentions, replies to me, likes on my posts from the stream), with a bell badge | notifications/01 (lite) | M |

### Wave 3 — controller (Mon 10/12 – Wed 10/14)

| ID | Pri | Stack | What | Home | Effort |
|---|---|---|---|---|---|
| B4 | **Must** | be | **Demo pack seeder** (`/api/ops/seed-demo-pack`) + `Reset-DemoState.ps1 -DemoPack`. Avatars/banners, opening posts backdated in scenario time, media, replies, baselines. **Must deploy before the freeze** | persona-management/04 (slice) | M |
| C1 | **Must** | fe | **Post as persona v2.** A media picker from the demo media library (`demo-media/manifest.json`), **reply as persona**, a preview, and **visible errors** (remove the swallowed `.catch`) | persona-operation, threads-replies/03 | M |
| C2 | **Must** | fe | **Live world column** in the console main area: the real feed in COBRA-dense staff styling (it must not read as a participant view). Filters: All / #tag / persona. Per post: *Reply as…*, *Take down* (if C5) | live-monitoring/01–02 (lite) | M |
| C3 | **Must** | fe | **Run sheet.** Loads the pack's scripted injects (persona, text, media, intended scenario minute); *Fire* / *Fire next* / *Skip*, with status and keyboard shortcuts. Uses the existing post endpoint, so it needs **no backend**. This is the presenter's script | inject-queue/02–03 (lite) | M |
| C4 | **Must** | fe | **Console cleanup.** Main-area layout with slots for C2 and C3; remove mock presence avatars and dev copy; unify the SimCell naming; fix the ⌘K placeholder; persona context panel shows the server bio and recent posts from the live feed; relabel or hide PAUSE INJECTS | console-shell | S |
| C5 | Should | fe | Takedown UI (needs B6) + participant feed removal on `PostRemoved`. *After F2 merges* (it shares `realtimeFeed.ts`) | world-steering/05 (slice) | S |
| C6 | Could | fe | Preview-as-participant shows the real social feed instead of the `PortalStub`; a StartEx/EndEx button (the endpoint exists, nothing calls it) | staffShell, exercise-lifecycle | S |

### Explicitly cut from this push (post-demo backlog)

- Live AI / §8 sign-off
- Engine verification debt, except Freeze
- Ambient chatter
- Real media upload (Azure Blob + SAS)
- DMs
- Full notifications
- PIO column mode
- The timed inject queue and scheduler
- Persona and participant admin UIs
- The "X reposted" fan-out
- Quote posts
- E3–E6 channels
- E10 evaluation

---

## 6. Wave plan — file ownership (orchestrator contract)

Builders own **disjoint** files. **Orchestrator-owned** (never a builder):

- `src/frontend/src/App.tsx` and the participant route table
- `src/Pulse.WebApi/Program.cs` (endpoint `Map…` calls)
- `staffRouteRegistry.tsx`
- the C2/C3 slot mounts in `ControllerConsole.tsx` (after C4)
- right-rail slot mounts (after F1 + F6)

| ID | Owns (primary) | Depends on | Runs with |
|---|---|---|---|
| B1 | `Data/Entities/{Post,Persona,PostReaction}.cs`, `Data/PulseDbContext.cs` (DbSet + scope filter), the one migration + snapshot, `PostWriteEndpoints.cs`, `PostSanitizer.cs`, `ParticipantPostDto.cs`, `PersonaEndpoints.cs` DTO | P2 | F0, B5 |
| F0 | `social/components/PostCard*.tsx` → `post/*` split, `social/types/post.ts`, `personas/types.ts`, `postService.ts` mocks, `public/demo-media/` (placeholder assets + `manifest.json`), `staticwebapp.config.json`, `.gitattributes` | P2 | B1, B5 |
| B5 | `Features/Realtime/*`, `EngineRuntime/EngineReviewBroadcaster.cs` | — | B1, F0 |
| B2 | `ThreadEndpoints.cs`, `PostReadService.cs` (thread + feed filter) | B1 | B3, B6 |
| B3 | new `Features/Social/Reactions/*`, counts projection | B1 | B2, B6 |
| B6 | new `Features/Social/Moderation/*` | B1 | B2, B3 |
| F1 | `SocialChannel.tsx/.module.css`, new `social/layout/*` (NavRail, RightRail, PulseLogo, MobileTabBar) | F0 | F2–F6 |
| F2 | new `social/components/media/*`, `post/PostMediaSlot.tsx`, `services/realtimeFeed.ts` | F0 | F1, F3–F6 |
| F3 | `post/PostActions.tsx`, `post/PostHeader.tsx`, `hooks/useReaction.ts`, `hooks/useAmplify.ts`, `services/amplify.ts` | F0 (B3 for live) | F1, F2, F4–F6 |
| F4 | `ThreadView.*`, `hooks/useThread.ts`, `hooks/useComposePost.ts`, `Composer.*`, new `ReplyComposer.*` | F0 (B2 for live) | F1–F3, F5, F6 |
| F5 | `index.html`, `public/favicon*`, `social/theme/*`, `Avatar.*`, `pages/Profile.*`, `pages/Feed.tsx` (loading state only) | F0 | F1–F4, F6 |
| F6 | new `social/explore/*`, `pages/HashtagFeed.*` | F0 | F1–F5 |
| B4 | new `Features/Ops/DemoPack/*`, `scripts/uat/Reset-DemoState.ps1`, `docs/demo/pack/opening-feed.json` (the script posts it as the request body) | B1–B3 | C1–C4 |
| C1 | `controller/components/PersonaComposer.*`, `controller/hooks/useComposeAsPersona.ts` (reads F0's `demo-media/manifest.json`) | B1, B2 | C2–C4 |
| C2 | new `controller/liveWorld/*` | F0 | C1, C3, C4 |
| C3 | new `controller/runSheet/*`, `public/demo-pack/run-sheet.json` | the media manifest + pack format (frozen in P2) | C1, C2, C4 |
| C4 | `controller/components/ControllerConsole.tsx`, `controller/components/PersonaContextPanel.tsx`, `controller/components/steering/PausePill.tsx` (label only), `controller/console/CommandPalette.tsx`, `staffShell/staffHeaderMocks.ts` | — | C1–C3 |
| C5 | `liveWorld` takedown action (after C2), `realtimeFeed.ts` `PostRemoved` handler (after F2) | B6, C2, F2 | — |

**Mocks are the seam.** F0's v2 mocks let every Wave-2 and Wave-3 frontend builder work on `npm run dev`
before B1–B3 deploy. Each builder then makes one live check against UAT once its backend dependency is live.

---

## 7. Calendar

Weekend days are agent build days with light human review. 🧑 marks a Tom touchpoint.

| Date | Day | Work | Gate / exit |
|---|---|---|---|
| **Wed 10/7** | D-12 | This assessment. 🧑 Read it; make the Day-0 decisions | Decisions recorded |
| **Thu 10/8** | D-11 | **Wave 0:** P1 (CI green), P2 (stories + Wave Plan + contract frozen). **Wave 1 starts:** B1 ∥ F0 ∥ B5. 🧑 Media procurement starts | `main` CI green; contract in `implementation.md` |
| **Fri 10/9** | D-10 | B1 merges → **backend deploy + reset**. B2 ∥ B3 ∥ B6 start. F0 merges | B1 live in UAT; F0 mocks on `main` |
| **Sat 10/10** | D-9 | B2/B3/B6 merge → backend deploy + reset. **Wave 2 fan-out:** F1–F6 (5–6 builders) | **Cut line 1:** if B1 isn't live, switch video to [Plan B](#plan-b-for-video) |
| **Sun 10/11** | D-8 | Wave 2 builds + Gate 1. 🧑 **Media assets due** (`docs/demo/pack/media-brief.md`) | Assets in `public/demo-media/` |
| **Mon 10/12** | D-7 | Wave 2 merges (Gate 2) → frontend deploy. **Wave 3 fan-out:** B4, C1–C4. Claude drafts the demo pack (opening feed + run sheet) | **Cut line 2:** if Wave 2 is behind, cut F6 search (keep trending) and F7 |
| **Tue 10/13** | D-6 | Wave 3 builds + Gate 1. C5 once F2 and C2 are in. 🧑 Review the demo pack text | Pack approved |
| **Wed 10/14** | D-5 | Wave 3 merges. **B4 deploy = the last backend deploy (backend freeze, EOD).** Reset with `-DemoPack` | **Cut line 3:** anything backend not merged is out |
| **Thu 10/15** | D-4 | 🧑 **UAT walk v2** (checklist rebuilt for the v2 storyline), on laptop + phone. Frontend-only fix PRs straight to `main` | Every row ✅/⚠️/❌ |
| **Fri 10/16** | D-3 | Fixes. 🧑 **Rehearsal 1**, timed, from a clean reset | One clean run |
| **Sat 10/17** | D-2 | Fixes only. **Frontend freeze EOD** | — |
| **Sun 10/18** | D-1 | 🧑 **Rehearsal 2** on the demo machine and network; final reset | Two clean runs |
| **Mon 10/19** | D-0 | **Demo.** Reset ≥ 1 h before (wait for the handover window) | — |

### Plan B for video

If B1 isn't live by Sat 10/10, video ships frontend-only as an **in-sim link card**: the post
text carries `newsline7.news/v/<slug>` and F2 resolves it from `demo-media/manifest.json` into an inline player
(a posts/04 slice). It is worse, because the URL is visible in the text, but it needs no server change.

---

## 8. How we run it (orchestrator pattern, adapted for 12 days)

This follows [`ORCHESTRATION_MECHANICS.md`](../ORCHESTRATION_MECHANICS.md) and changes four things:

1. **Short-lived wave umbrellas, not per-feature umbrellas.**
   - Each wave gets `feature/demo-w<N>-<track>`, cut from the latest `origin/main` and merged back
     **within 1–2 days** through one PR (Gate 0 CI + Copilot + Gate 2).
   - Builders branch `build/demo-polish/<ID>-<slug>` off the wave umbrella, one worktree each.
   - Why: the live plan warns against long umbrellas this close to a demo, and the #373 landedness
     miss is the reason. Short umbrellas keep the orchestrator's isolation and gates and still land daily.
   - After every merge, check landedness against `origin/main`, and grep `Program.cs` / `App.tsx`
     for the new wiring (the #310 → #317 lesson).
2. **A relaxed DoD for prototype-grade stories.** A story is done when:
   - its ACs are met
   - tests cover the risk classes (isolation, media allow-list/sanitization, scenario time)
   - CI is green
   - Gate 1 has **no Critical or High** findings

   Mediums and Lows become follow-up issues and don't block. "Verified in UAT" is satisfied in bulk by
   the 10/15 walk.
3. **Tier-2 (Tom) only where it matters.**
   - B1, because of the schema and the media allow-list
   - B3, because of the reaction isolation
   - B5, because of the realtime scoping

   Everything else ships on Tier 1 (the `code-review` agent + Copilot).
4. **Workflow size.**
   - One Workflow per wave track: ≤ 5 builders (build + test in one agent, in its own worktree) and
     ≤ 5 Gate-1 reviewers.
   - Wave 2 = F1–F6 (split F6 into a second small run if needed).
   - Wave 3 = C1–C4 + B4.

### Kickoff prompts (paste into a fresh session)

**Wave 1**
```
Build demo-polish Wave 1 per docs/demo/PARTICIPANT-FIRST-DEMO-PLAN.md §5–§6 and
docs/ORCHESTRATION_MECHANICS.md, with the §8 adaptations (short-lived wave umbrella).
Umbrella: feature/demo-w1-contract off latest origin/main.
Stories: B1 (backend-agent), F0 (frontend-agent), B5 (backend-agent) — parallel, own worktrees.
Contract: §4 is frozen; do not change it. One EF migration total (B1 owns it); EXEC-wrap hand SQL.
Run the Workflow fan-out (build+test → Gate-1 code-review). Merge clean branches serially; orchestrator
makes the Program.cs wiring edit. Gate 2, then the PR to main. Then B2 ∥ B3 ∥ B6 the same way.
After each backend merge: confirm the deploy, then remind Tom to run Reset-DemoState.ps1 (~8 min later).
```

**Wave 2**
```
Build demo-polish Wave 2 (participant) per docs/demo/PARTICIPANT-FIRST-DEMO-PLAN.md §5–§6.
Umbrella: feature/demo-w2-participant off latest origin/main (must include F0).
Stories: F1, F2, F3, F4, F5, F6 — frontend-agent each, own worktree, owned files per §6 only.
World: participant (per-brand skin, NO COBRA, scenario time only, mobile-first, WCAG AA).
Design reference: docs/design/D1-social-app/README.md (+ the .dc.html prototype) — match layout/IA.
Build against the v2 mocks (npm run dev); one live check each where B2/B3 are deployed.
Orchestrator wires routes (App.tsx) and the right-rail slots after merges. Gate 1 → serial merge → Gate 2 → PR.
```

**Wave 3**
```
Build demo-polish Wave 3 (controller) per docs/demo/PARTICIPANT-FIRST-DEMO-PLAN.md §5–§6.
Umbrella: feature/demo-w3-controller off latest origin/main.
Stories: B4 (backend-agent), C1, C2, C3, C4 (frontend-agent) — parallel, own worktrees; C5 after C2+F2.
World: staff (COBRA, desktop-first). The Live world column shows participant content inside staff chrome;
it must never be confusable with a participant view. C4 builds the main-area slots; orchestrator mounts C2/C3.
B4 is the LAST backend deploy before the 10/14 freeze.
```

---

## 9. Day-0 decisions (Tom)

1. **Demo date and audience.** This plan assumes **Mon 10/19** and a prospect focused on the participant
   experience. If the date moves, the cut lines move with it.
2. **Video sourcing.** Royalty-free stock (Pexels / Pixabay licences) or AI-generated (Beat).
   - Needed: 2–3 clips (H.264 MP4, 720p, ≤ 30 s, ≤ 15 MB each, plus a poster JPG), 8–10 photos
     (≤ 1600 px, ≤ 400 KB), avatars for the 9 personas (400×400) and 3–4 banners (1500×500).
   - No real logos, real people's likeness or real news brands.
3. **Media hosting.** Recommended: commit the assets to `src/frontend/public/demo-media/`, ≤ 50 MB in
   total. The SWA Free tier allows 250 MB, everything is same-origin, and it needs no infra deploy.
   The alternative is Azure Blob (`deployStorage=false` today, so it needs an infra deploy plus CORS);
   the URL-based contract makes that a drop-in after the demo.
4. **Engine in the demo.** Recommended: Paused during beats 1–6 so the feed stays scripted, then the
   beat-7 teaser on `Fake`. Live AI (§8) is not needed.
5. **Phone for the participant view?** Recommended, because it shows mobile-first. F1's bottom tab bar
   then becomes a Must.
6. **Scenario naming.** The cast uses "Fulton County Emergency Management", a real agency name, beside
   the fictional Fairhaven. For a customer demo, consider a fictional county. The demo pack can rename
   display names at seed time (B4) at no extra cost.

---

## 10. Risks

| Risk | Mitigation |
|---|---|
| The B1 migration fails in the deploy's idempotent script (#413's class) | EXEC-wrap hand-written SQL; `IdempotentMigrationScriptTests` must replay the new script; deploy B1 by Fri 10/9 so there's time to recover |
| Hot-file conflicts (`PostCard.tsx`, `SocialChannel.tsx`) | F0 decomposes PostCard first; §6 assigns ownership; the orchestrator owns the routes |
| Video playback in UAT: range requests, the SPA fallback, mobile autoplay rules | F0 adds `/demo-media/*` to the fallback exclude. **Smoke-test an MP4 in UAT on Fri 10/9** (seek works, iOS Safari plays inline with `playsInline`, no autoplay with sound) |
| Throughput: ~20 stories in 7 build days | Must/Should/Could plus three dated cut lines. Most of the work is frontend and parallel. Tom's review time is the real bottleneck, so Tier-2 is limited to B1/B3/B5 |
| UAT state is fragile (restarts drop the engine and clock) | The backend freeze on 10/14; `Reset-DemoState.ps1 -DemoPack` is idempotent; reset ≥ 1 h before the demo |
| A staff surface leaks into the fiction | B5 (SignalR scoping). Gate 1 treats any COBRA on participant paths, or staff data in participant payloads, as Critical |
| A demo-machine dark mode makes a half-dark page | F5 forces light; still set the demo machine to light mode |
| A builder exceeds scope ("while I'm here…") | Builders build strictly to ACs (the standing rule); the orchestrator rejects out-of-scope diffs at Gate 1 |
