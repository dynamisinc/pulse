# Build Plan — live wave checklist

> **The single source a fresh session opens to find "what's next."** Ordered waves for the Phase-1
> frontend build: foundation seams → participant shell → social (E2), with the staff shell in parallel.
> *How* to run a wave (branches, worktrees, Workflow fan-out, gates, kickoff prompt) is in
> [`ORCHESTRATION_MECHANICS.md`](ORCHESTRATION_MECHANICS.md). *Why* this order is in the approved plan.
>
> **Legend:** ⬜ not started · 🔧 in progress · ✅ merged to `main`. Update a box when a wave's feature
> PR merges (or per-story as you go). All participant surfaces: per-brand skin, **no COBRA**,
> scenario-time only, mobile-first, WCAG AA. Staff: COBRA, desktop-first.

---

## Step 1 — Prerequisite (do first) ⬜

**Land the shell backlog on `main`.** Open a docs-only PR merging `d7-application-shells` → `main`
(brings `docs/features/participant-shell/` + `staff-shell/` and the `D7-application-shells` design dir;
verified no `src/` changes). Merge it. Everything below branches off the resulting `main`.

> Note: PR #182 merged `d7-application-shells` into the **`e8-adaptive-content-engine`** branch, **not
> `main`** — so the shell docs are still absent from `main`. This PR is what lands them there. (When e8
> later merges to `main`, git recognises the shared commits — no conflict.)

```bash
gh pr create -R dynamisinc/pulse --base main --head d7-application-shells \
  --title "Land D7 application-shell backlog (docs)" --body "Docs-only: participant-shell + staff-shell features + D7 design."
```

---

## Wave 0 — Foundation seams ✅  · umbrella `feature/foundation-seams`

Load-bearing; build before any consumer. All mock-behind-the-axios-client (no backend). The playbook
mandates these first — a schema mistake here becomes a cross-phase migration.

| Story source | Builds | Notes |
|---|---|---|
| `exercise-isolation` (E1) | Exercise-context / query-scoping provider | The isolation guarantee is the always-Critical review item |
| `exercise-clock` (E1, COR-053) | Scenario-time source: `scenarioNow` + `formatScenarioTime` | Consumed by the shell mount contract and every PostCard |
| XC-004 telemetry (schema-first) | Telemetry emitter v0 + event schema | Posts write provenance through it from day one |

> **Delivered** (both code-review gates clean, 89 tests): `core/exerciseContext.tsx` (mock provider,
> fail-closed) via story `exercise-isolation/10`; `core/clock/{scenarioTime,exerciseClock}.ts`
> (`scenarioNow` + `formatScenarioTime`, COR-053) via `exercise-clock/04`; `core/telemetry/*` (locked
> XC-004 v0 envelope + mock sink) via `telemetry/01`. The three seams are code-decoupled at v0 —
> consumers wire the edges. Merged via the `feature/foundation-seams` PR.

---

## Participant shell ⬜  · umbrella `feature/participant-shell`  · **build first**

Wave plan: `docs/features/participant-shell/implementation.md`.

### Wave 1 ✅
- `04-channel-mount-contract` — `ShellLayout.tsx`, `mountContract.ts` → **`ShellMountProps` / `useShellContext()`**, the seam every channel imports. Depends on Wave 0 `scenarioNow`.
- `01-compliance-chrome` — two fixed green banners (COR-031/066, NFR-008 guard).

> **Delivered** (both code-review gates clean, 174 tests suite-wide): `mountContract.ts` /
> `ShellLayout.tsx` (`ShellMountProps` / `useShellContext()` — the mount props, inset-var contract, and
> `SHELL_Z` z-order/stacking-context boundary) via story `04-channel-mount-contract`; `chromeConfig.ts` /
> `components/ComplianceChrome.tsx` (config-driven two fixed banners, chrome-off-is-legal, NFR-008
> watermark-fallback signal) via story `01-compliance-chrome`. Merged onto the `feature/participant-shell`
> umbrella.

### App route-tree split ✅ (integration task, after Wave 1)
Refactor `src/frontend/src/App.tsx`: move the root `<ThemeProvider theme={cobraTheme}>` out of the app
root; mount a **participant subtree** (`<BrandThemeProvider>` → `<ShellLayout>`) and a **staff subtree**
(`<StaffShellFrame>` applies COBRA). `QueryClientProvider`/router stay at root. Makes COBRA physically
unreachable from participant paths (the thumbnail-test guarantee).

> **Delivered:** `cobraTheme` moved off the app root into `StaffShellFrame`'s own `StaffThemeBoundary`,
> and a COBRA-free `/shell` participant route was added mounting `<BrandThemeProvider>` →
> `<ShellLayout>`. COBRA is now physically unreachable from participant paths.

### Wave 2 ✅ (all disjoint — fan out)
- `07-brand-theming` — `BrandThemeProvider` (creates the participant skin provider)
- `02-alert-bar-host` — PRT-010 EAS analog, `role="status"`, severity never color-only
- `03-channel-nav` — desktop strip + mobile tab bar
- `05-overlay-layer` — pause/EndEx/break-fiction host (renders mock overlay state; triggers are world-steering, a later cross-feature edge)
- `06-variants` — full / read-only / preview flag through the mount contract

> **Delivered** (both code-review gates clean, 299 tests suite-wide): `07-brand-theming-hooks` —
> `BrandThemeProvider.tsx` / `brandTokens.ts`; `02-alert-bar-host` — `components/AlertBar/{AlertBar.tsx,
> alertTypes.ts,useAlerts.ts}`; `03-channel-nav` — `ChannelNav.tsx` / `channelNavConfig.ts`;
> `05-overlay-layer` — `components/OverlayLayer/*`; `06-variants` — `mountContract.ts`
> (`affordancesAvailable`) + `shellState.ts` (CR-W1 default flip to `readOnly`). All 5 stories merged
> onto the `feature/participant-shell` umbrella; the participant-shell feature is now Complete (7/7
> stories) and ready for the umbrella→`main` PR.

---

## Social (E2) ⬜  · umbrella `feature/social`  · after the participant shell hosts a surface

Seed E1 data first (mock): `identity-auth-roles` 01/03 (roles + sessions), `persona-management` 01/02
(persona templates + casts) — so PostCard has authors and the feed has content. — ✅ mock seed
delivered on `feature/social` (data/model only; staff UIs deferred — see the four stories' "Seed
delivered" notes for exactly what landed vs. what remains).

### Wave S1 — keystone ✅
- `posts/02-post-rendering-identity` — **`<PostCard>` + `<VerifiedMark>`** (`features/social/components/PostCard.tsx`). *Build first* — reused by every surface. **Done.**
- `posts/03-post-provenance` — provenance/telemetry on the post model (XC-004). **Done.**

> **Delivered** (both code-review gates clean, 291 tests suite-wide): full ACs met for both stories on
> the `feature/social` umbrella — see `docs/features/posts/{02-post-rendering-identity,03-post-provenance}.md`
> for the Tests sections and file lists.

### Wave S2 — first surface ✅ (the slice that proves social works)
- ✅ `feeds-discovery/01-all-posts-feed` (#120) — global chronological feed; the **pilot landing surface**, mounted as the shell's default `social` channel at `/shell`.
- ✅ `posts/01-post-composition` (#92) — the inline composer: text + image-attach + depleting ring counter + sanitized/instrumented publish (inline video, location, and #/@ persistence deferred to the posts/03 model — see the story's Deferred note).
- ✅ `threads-replies/01-flattened-thread-view` (#98) + `02-reply-counts-and-open` (#99) — open a post into its flattened thread in-channel; reply-count + open affordance on `<PostCard>`.

> **Delivered & merged to `main`** (PR #252, merge `2e714aa`) — all four stories Gate-1 clean → merged
> into `feature/social`; the integrated umbrella was Gate-2 clean (opus/xhigh), green (build:check + lint
> + **588 tests**), and browser-smoked at `/shell`. `SocialChannel` composes composer + feed + in-channel
> thread nav; `App.tsx`'s participant route wraps `<SessionProvider>` and mounts it in place of
> `ParticipantChannelPlaceholder`.
>
> **Fixed in the PR #252 review round (Copilot + a self-review)** — findings that were listed here as
> deferred, now DONE: the thread-back feed remount — `<Feed>` + `<Composer>` now stay MOUNTED (hidden)
> while a thread is open, so
> the compose draft, scroll, resolved data, and the feed's emit-once view-telemetry guard all survive the
> round-trip (no refetch, no duplicate feed-view) — plus focus management on the view swap (NFR-001); and
> the thread-open `'view'` telemetry gained an emit-once ref guard (no StrictMode double-emit); and the
> `useThread` post validator now checks engagement counts (fail-closed vs. a malformed thread body).
>
> **Tracked forward-looking findings (deferred, non-blocking):**
> (S2-2) `resolveFeed`/`resolveThread` return the full `Post` over the (mock) transport, narrowed to the
> participant view **client-side** — project provenance out server-side when the real `/feed` + `/threads`
> endpoints land. (S2-3) read-only view events attribute `participantId`; prefer `sessionId` once `Session`
> carries one (COR-015). (L-1) hoist one `useScenarioTime` "now" at the feed vs per-`PostCard` for burst
> scale. (L-2) couple `injectId` to `origin === 'inject'` in `createPost` (posts/03). Feed virtualization +
> the real-time "new posts" pill remain `feeds-discovery/04`.

### Wave S3+ ⬜ (fan out; all reuse PostCard)
- ✅ `profiles-social-graph/01-profile-page` (#109) + `03-verification-and-impersonation` (#111) →
  `02-follow-unfollow` → `feeds-discovery/02-following-feed`
- ✅ `reactions/01-like` (#104), ✅ `hashtags-trending/01-hashtags` (#106), 🔧 `amplification/01-repost-quote` (#101, AC1 partial)
- `feeds-discovery/03-search`, ✅ `04-realtime-new-posts-pill` (SignalR host + polling fallback), `notifications/01-notification-center`
- `persona-operation/*` (E7 staff inject surface — after the participant read/compose slice exists)
- Deferred/stretch: `feeds-discovery/05-for-you-feed`, `reactions/02-sentiment`, `direct-messages/*`

> **Delivered — Wave S3.1 sub-wave** (Gate-2 clean, opus/xhigh — 0 Critical): `reactions/01-like`,
> `hashtags-trending/01-hashtags`, `profiles-social-graph/01-profile-page` +
> `03-verification-and-impersonation` are all **Complete** on `feature/social` — like/repost/quote
> wired into `<PostCard>`/`<Feed>`/`<ThreadView>`'s action row, hashtag-feed + profile navigation
> wired into `SocialChannel`. `build:check` + `lint` clean, **features/social: 31 files / 257 tests
> pass**. A WR-001/WR-002 a11y fix also landed (hashtag links no longer nested inside the card's
> open-button; render inert, not a focusable no-op, when `onHashtagOpen` isn't wired).
> `amplification/01-repost-quote` stays **In Progress**, not Complete: the compose flow, XC-004
> telemetry, sanitized quote commentary, and action-row controls are built and tested, but AC1's
> "appears in the audience's feed attributed 'X reposted'" is not demonstrated end-to-end — feed
> insertion + the repost/quote count bump are deferred to `amplification/02` (Gate-2 finding WR-004).
> Umbrella→`main` PR pending.
>
> **Gate-2 follow-ups (not blocking, tracked in the affected stories' Deferred notes):** WR-003
> (`ThreadView`/`Profile` don't thread the shell's read-only `variant` into their `<PostCard>`s, so an
> observer session sees present-but-inert action controls instead of D1-011's "controls absent");
> SUG-001 (`SocialChannel`'s focus management doesn't reposition on a detail-to-detail view swap, e.g.
> thread → hashtag); SUG-002 (`HashtagFeed` can't pivot tag-to-tag — no `onHashtagOpen` threaded to its
> own cards).

---

## Staff shell 🔧  · umbrella `feature/staff-shell`  · parallel, after participant mount contract — built, Gate-2 clean; umbrella→main PR open (awaiting merge)

Wave plan: `docs/features/staff-shell/implementation.md`.

### Wave 1 ✅
- ✅ built — `05-cadence-chrome-tokens` — `StaffShellFrame.tsx` (COBRA theme boundary; enforces the hard gate)
- ✅ built — `01-staff-header` — navy Cadence header, clocks, state pill, FOUO tag, preview button
- ✅ built — `02-toolstrip-dock` — `Toolstrip.tsx`, `toolRegistry.ts` → **`registerSurfaceTool()`** (the console/evaluator seam)

### Wave 2 ✅
- ✅ built — `03-participant-admin-flyout` — login-triage flyout (shell-global tool)
- ✅ built — `04-preview-as-participant` — **depends on `participant-shell` mount contract** (the one cross-feature serial edge)

**On landing:** delete `src/frontend/src/features/evaluator/components/shell/StaffShellStub.tsx` (its own
comment says so) — coordinate with the evaluator session, which currently imports it. **Done:**
`StaffShellStub.tsx` has been deleted and the evaluator dashboard is re-hosted under the real
`StaffShellFrame`.

---

## E7 Simcell Operator — Wave 1 ✅  · umbrella `feature/simcell-operator`

Cross-feature integration wave: the controller console's first end-to-end loop — pick a persona,
compose in-voice, publish, see it land in the participant feed. Five stories built in parallel
(`console-shell/01` as keystone, `persona-operation/01–03`, `feeds-discovery/07`) against an
input/callback contract, then wired at a serial integration step.

- ✅ `console-shell/01-toolstrip-flyouts` — console frame registers into the `staff-shell` toolstrip
  dock (D7-011); the ⌘K command palette shell + PERSONAS section; the persona-dock host flyout mount
  slot; the Phase-1 mock `useControllerIdentity()` (COR-018 attribution seam).
- ✅ `persona-operation/01-post-as-persona` — post-as-persona composer through the shipped
  `createPost` pipeline (POST-ONLY this wave — reply/repost/DM deferred pending a `Post`-model
  parent/thread extension).
- ✅ `persona-operation/02-fast-persona-switching` — searchable/pinnable persona picker,
  keyboard-first, ≤3s switch.
- ✅ `persona-operation/03-composer-persona-context` — persona voice notes, recents, audience band,
  "POSTING AS {category}" chip.
- ✅ `feeds-discovery/07-live-feed-store` — minimal live `postStore` read seam so a published post
  appears in the participant feed without a reload (partial SOC-083/D1-005 slice; the FULL buffered
  pill + SignalR transport stays `04-realtime-new-posts-pill.md`, #123).

**Serial integration step** (after the fan-out): `features/controller` barrel, the App.tsx `/console`
route (`ExerciseContextProvider > ToolstripProvider > StaffShellFrame`, mirroring `/evaluator`), the
persona-dock host wired to the picker → composer → context panel, and the composer's
`onPublished` wired to `postStore.appendPost`.

> **Delivered** — all five stories Gate-1 clean (0 Critical/0 Major), merged serially onto
> `feature/simcell-operator`; the integrated umbrella is Gate-2 clean (opus/xhigh — 0 Critical/0
> Major/3 Minor token-consistency notes/2 informational). `build:check` + `lint` clean, **684/684
> tests pass** (up from a 588 baseline). Browser-verified end-to-end from `/console`: ⌘K →
> PersonaPicker → select verified agency persona @FairhavenWater → dock (context panel + composer,
> dual-time, OPERATOR SIMCELL-1) → Post → the post appears in the participant `/shell` feed authored
> as @FairhavenWater with zero controller-origin leak in the participant DOM (the staff-only
> `SIMCELL · MANUAL` origin line shows console-side only). Umbrella→`main` PR pending.
>
> **Follow-ups (not this wave):** `console-shell/02–05` (NEEDS-YOU bar, static identity badge, Flag →
> AAR, trainee monitor), `persona-operation/04–05` (multi-controller presence, mid-exercise persona
> creation), and the FULL `feeds-discovery/04` (#123) buffered "▲ N new posts" pill + SignalR/polling
> transport.

---

## Engine Review Cockpit — Wave 1 ✅  · umbrella `feature/engine-review-cockpit`

The controller HITL review queue landing surface for E8 (ADP-040): the cockpit the adaptive engine
(Phase 2) will land drafted content into, built mock-first against the FROZEN backend Autonomy/Models
contracts (`Pulse.Core/Features/Autonomy/Models/*`, `AutoHoldPolicy`, `WorkloadDemandMeter`) so the
engine arrives to a ready surface. Three stories built serially onto the umbrella branch, each
Gate-1 clean, then integrated into `/console` at a serial step.

- ✅ `engine-review-cockpit/01-review-queue` — the keystone: a review-queue rail with per-item
  persona + storyline context, approve / edit / veto / re-roll, batch approve, and its own inline
  "N need review / N timers <60s" indicator as the single D5-014/2.1 source of truth (#34).
- ✅ `engine-review-cockpit/02-timed-draft-auto-hold` — an expired timed draft **auto-HOLDs**, never
  auto-sends, in the default configuration ("timer expired — held for you"); silence is never
  approval (D5-014/1.1, supersedes D5-005) (#35).
- ✅ `engine-review-cockpit/03-swamped-mode-toggle` — the **only** sanctioned path to timeout
  auto-send: a lead-controller-gated, per-exercise, off-by-default toggle with a persistent
  text+icon on-state banner; the engine never self-enables it (#36).

**Serial integration step** (after the fan-out): `ReviewQueue` docked as a permanent 336px column in
`ControllerConsole`'s work area, alongside the existing console chrome; the `EngineControlBar` control
strip — the ADP-042 kill switch (Live → Suggest-only → STOP, cycling) + a degrade indicator + the
CTL-034 demand meter ("N / 6") + the same inline "N need review / N timers <60s" indicator the docked
queue reports (D5-014/2.1 consistency); `DraftTimerDriver` wiring each seeded counting-down item to
`useDraftTimer`/`autoHoldPolicy` so expiry resolves Hold by default and `autoPublish` only under the
swamped + still-Delayed-auto path, with the clamp-suspends-swamped composition (STOP / Suggest-only /
degraded clamp all still hold) driven by the REAL `useEngineControl`; approve/edit routes through
`reviewActions` → `createPost(origin: 'engine')` → `postStore` → the live participant feed with
provenance stripped from the participant view; and the `EngineDraftEditComposer` (engine-origin edit
slot, sanitizes before publish, NFR-004).

> **Delivered** — all three stories Gate-1 clean (0 Critical), merged serially onto
> `feature/engine-review-cockpit`; the integrated umbrella is Gate-2 clean (opus/xhigh — 0 Critical).
> `build:check` + `lint` clean, **791/791 tests pass** (up from a 761 pre-integration baseline).
> The load-bearing safety property, proven at both the unit and the docked-integration layer:
> **auto-HOLD on timeout — inaction is never approval.** Timeout auto-send exists on exactly one
> path — lead-gated swamped mode — and even that path HOLDs the moment the kill-switch or a degrade
> clamp drops the effective autonomy below Delayed-auto; automation never escalates its own autonomy.
>
> **Follow-ups (not this wave):** the real backend engine API + reaction loop (a separate backend
> wave — no `Pulse.WebApi` yet; this wave is frontend-only against the frozen contracts + mock
> drafts); `AutonomyLevel.Auto` (reserved, not exposed this wave); the NEEDS-YOU bar
> (`console-shell/02` — this feature's inline indicator is the interim single source of truth it will
> read from once it lands); `world-steering`'s pause-suspends-timers wiring (no live storyline-target
> or tiered-pause integration yet); and two field-for-field completeness nits flagged at Gate-2 — port
> `AutonomyLevels.EnsureSelectable` from the backend model, and add a `currentScenarioMinute >= 0`
> guard — both deferred until a real level selector lands (mock timers don't yet exercise either
> edge).

---

## E7 World Steering — Wave 1 ✅  · umbrella `feature/world-steering`

The controller's world-bending primitives: the storyline escalation dial (a ready control for the
Phase 2 E8 engine to drive) and the tiered pause (the keystone safety-stop for the whole console),
both built mock-first against the FROZEN backend Storyline contract
(`Pulse.Core/Features/Storylines/Models/Storyline.cs`, `StorylinePhase.cs`,
`StorylineBriefProjection.cs`) and the shipped `@/core/clock` `IExerciseClock` seam, so the backend
flip is contract-only. Two stories built in parallel, each Gate-1 clean, then integrated at a
serial step.

- ✅ `world-steering/03-tiered-pause` — the **keystone primitive**: `usePauseState()` (tiers
  running/injects/engine/freeze) + `<PausePill>` (3-tier popover, guarded Freeze confirm,
  keyboard-operable, dot+text never color-only) + `pausableExerciseClock` (a feature-local
  `IExerciseClock` — Freeze installs it via the shipped `setExerciseClock()` and holds
  `scenarioNow()`; injects/engine never touch the clock; Resume loses no scenario time via an
  accumulated-frozen offset) (#26).
- ✅ `world-steering/02-escalation-dial` — `<EscalationDial>` (one track: actual FILL + target TICK,
  distinguishable without color; click/drag + arrow/Home/End keyboard to set target; "78 → 60"
  relationship text; uppercase phase label) + `useStorylineTarget()` (exposes the target for the
  deferred engine-follow loop) + `storylineMock.ts` (a TS mirror of the frozen `Storyline.cs`
  field-for-field) (#25).

**Serial integration step** (after the fan-out): the `/console` route's staff-shell header state
pill driven from `usePauseState()` (INJECTS PAUSED / ENGINE PAUSED / WORLD FROZEN, D7-010) via a
decoupled optional `stateOverride` prop on the shared `StaffHeader` (state-pill config extracted to
`statePillConfig.ts`); `<PausePill>` + `<EscalationDial>` docked into the `ControllerConsole` work
area; barrel exports added.

> **Delivered** — both stories Gate-1 clean (0 Critical/0 Major); the integrated umbrella is Gate-2
> clean (opus/xhigh — 0 Critical/0 Warnings; 2 non-blocking suggestions). `build:check` + `lint`
> clean, **880/882 tests pass** (the 2 failures are a pre-existing `ReviewQueue.test.tsx`
> parallel-load flake on an untouched file, 10/10 passing in isolation). The load-bearing safety
> property, proven live in the browser at `/console`: **the scenario clock stops only on Freeze** —
> held while wall-clock advanced, Pause-injects left it running, and the guarded confirm step was
> required before Freeze took effect. Cross-cutting: every steering action logs one
> `steering_action` telemetry event (XC-004, actor kind `'system'` + `actingHumanId` + role,
> channel `'system'`); exercise-scoped (COR-001); staff-only (XC-002); fully keyboard-operable, no
> color-only state (NFR-001); never skins the participant pause/freeze overlay — that stays
> `participant-shell`'s `OverlayLayer`, which this feature only triggers/exposes (two-worlds).
> Umbrella→`main` PR pending.
>
> **Follow-ups (not this wave):** `world-steering/01` (attention levers, dep: E2 SOC-041/053/072),
> `04` (Break Fiction, dep: SignalR broadcast host B1 + Director role B2 + Freeze from this wave),
> `05` (content takedown, dep: E2 soft-delete/tombstone), `06` (off-platform response marker, dep:
> E8 expectations + E10 sink); wiring `usePauseState()`'s consumers — `DraftTimerDriver`
> (engine-review-cockpit) and inject-queue's burst-suspend/jump-gating reading the tier to actually
> suspend, and `participant-shell`'s `OverlayLayer` reading the overlay-register selection to render
> the pause/EndEx page, and the SignalR broadcast host relaying tier changes — are all exposed as
> seams but not wired; and the real engine-follows-target reaction loop (`Storyline.Tick`'s
> `TickTowardTarget` path, `BACKEND_ROADMAP` B3) consumes `useStorylineTarget()`'s exposed value once
> the E8 engine lands in Phase 2. Two non-blocking Gate-2 suggestions: a keyboard nudge from an
> unset target currently snaps to actual±1 (`EscalationDial`); `resetPauseStateForTest` is a
> production-module export (nil blast radius, test-only usage).

---

## Controller features operational (post-UAT audit, 2026-07-25) 🔧  · 5 of 6 built + Gate-2 clean; #354 open

> **BUILD SESSION 2026-07-27 — STATE. Read this before resuming.**
>
> Five of six stories are **built, Gate-1 clean, merged to their umbrella, and Gate-2 clean**. None is
> `Complete`: every story's DoD requires *verified in UAT*, which needs a deploy and is Tom's step.
> **No umbrella→`main` PR has been opened** — deliberately left for Tom, since Track A is TIER-2.
>
> | Umbrella | Stories | Gate-2 | Backend | Frontend |
> |---|---|---|---|---|
> | `feature/engine-runtime-golive` | #349 | ✅ clean | 389 + 682 | n/a |
> | `feature/world-steering-wave2` | #350, #351, #352 | ✅ clean | 389 + 829 | 158 files / 1408 |
> | `feature/autonomy-safety-admin` | #353 | ✅ clean | 389 + 755 | n/a |
>
> All suites 0-skipped (real SQL via `PULSE_TEST_SQL_CONNECTION` → LocalDB), 0 build warnings.
>
> **⛔ #354 `autonomy-safety/06-engine-settings-panel` is NOT clean — do not merge it.** Branch
> `build/autonomy-safety/06-engine-settings-panel` (`bf864b6`) carries **2 open Criticals**. Three
> rewrites of its optimistic-update reconciliation produced **six** Criticals, all one root cause:
> *the model orders responses by issuance but applies them on landing, so a late response overwrites
> newer truth*. **Tom's decision: drop the optimistic model — disable the control while the POST is
> outstanding, then apply the authoritative `EngineSettingsDto` from the response** (all three
> endpoints return the full DTO, so no follow-up read). Delete the per-field sequence trackers, the
> confirmed-vs-optimistic split, and `withFieldFrom`/`withSharedFieldsFrom` — the goal is that the bug
> class becomes *unrepresentable*, not better-guarded. **Keep** the `modeSettledCount` fix (the
> kill-switch refetch must fire after the POST settles) and the queued-not-dropped invalidation. Also
> open on that branch: the persona-draft store is not cleared on explicit Esc/X despite the story doc
> claiming it is, and its test is tautological (`resetForTests()` then assert empty). The rewrite was
> **not started** — that worktree is clean. Record the AC3/AC4 deviation and rationale in the story.
>
> **The build stopped on an org monthly spend limit**, which killed the two in-flight builders. #351's
> register selector was finished by the orchestrator from the partial work on disk (one broken test
> mock fixed; gates re-run green) — see `26c4a61`.
>
> **Composition root is wired and mechanically guarded** (`85d12db`, `46a40e2`):
> `AddPauseTierSteering()`/`MapPauseTierSteering()`, `AddPauseParticipantOverlay()` (no `Map*`),
> `AddStorylineSteering()`/`MapStorylineSteering()`, plus `SteeringCompositionRootWiringTests` — boots
> the real `WebApplicationFactory<Program>`, asserts the five routes map exactly once, that the resolved
> `IPauseOverlayPublisher` is **not** #350's no-op, and that exactly **one** `IReactionLoopRegistry`
> exists. Verified to *bite*: commenting out either `Add*` fails it. #353 needed no `Program.cs` change
> (its routes ride the already-mapped `/api/engine` group) — verified, not assumed.
>
> **⚠ Merge-order note for `main`:** both `feature/world-steering-wave2` and
> `feature/autonomy-safety-admin` edit `ReactionLoopHost.cs`. The hunks are ~100 lines apart in
> different classes (a `ShouldStartClock` extraction vs. the tier-policy override at the
> `IntentComposer` call site), so a three-way merge should apply both. The residual is **semantic**:
> #353 adds a *required* ctor parameter to `ReactionLoopDriver`, so whichever merges second must rebuild
> and confirm `AddReactionLoopHost` registers `EngineTierPolicyRegistry`.
>
> **⚠ UAT preconditions, in order:**
> 1. **Confirm the deployed staff assignment's role is `controller`** *in the same deploy* that carries
>    #353. It closed #297 by gating every mutating `/api/engine` route on that role — so a `planner`/
>    `evaluator` assignment makes the whole cockpit read-only, including the kill switch, and will read
>    as a regression.
> 2. **The `Program.cs` wiring and the `USE_MOCK_DATA` → false flip must land together.**
>    `<EscalationDial />` and `<PausePill />` are already mounted, so flipping mock first shows the new
>    "no live storyline" / unavailable states.
> 3. Every App Service restart de-registers the loop — re-seed via `POST /api/ops/seed-engine-content`.
> 4. Track A's provisioning deploy (`deployAi = true`) is safe **pre**-signature and itself restarts the
>    App Service. Order is provision → verify in Azure → sign §8 → flip traffic, because §8 evidence (i)
>    is only confirmable after the deploy.
>
> **Tom's two decisions this session:** (a) the §2 governance attestations are explicit params the §8
> signer types, not values derived from `deployAi` — so `GenerationGovernance.Validate` stays an
> independent gate rather than a restatement of `deployAi`; all three booleans are `false` on disk and
> set together in one reviewed commit. (b) #353 emits server-side telemetry
> (`engine.autonomy_default_changed` / `engine.tier_policy_changed`), diverging from the legacy
> swamped-mode/kill-switch/restore trio, for an audit record that survives a process restart.
>
> **⛔ PR #386 IS BLOCKED — and the reason is architectural.** `main` advanced past this umbrella's base
> (exercise-configuration, profiles-social-graph, planner-settings-nav) and now serves
> `GET /api/overlay-state` through an **`IOverlayStateProjection`** seam implemented by `LifecycleProjection`
> — overlay state derived from the exercise lifecycle. Story 08 had *replaced* that handler with its own
> pause-driven read. Two complementary claimants, one slot.
>
> **Tom's ruling (2026-07-27): lifecycle wins — `endex` > `pre-start` > `pause` > `none`.** Lifecycle answers
> "is this exercise live at all"; pause is a control within a live exercise, and ENDEX must be terminal.
>
> **Implementation shape (NOT yet built):** the pause state becomes an `IOverlayStateProjection` contributor
> that composes the lifecycle projection — consult lifecycle, and only on `none` consult the pause store —
> registered via `services.Replace(...)` after both, per `main`'s contributor convention. **Story 08 then
> stops editing `ParticipantShellEndpoints.cs` altogether**, which deletes the one shared-file coordination
> point *and* the `RequestServices.GetService` workaround and its silent-degradation trade-off. The pause
> write path, push, register plumbing and client guards are all already built and Gate-2 clean — only the
> read-side composition changes. The other conflict (`Program.cs`) is trivial: both sides added usings and
> wiring lines.
>
> **PRs open:** #385 (autonomy, MERGEABLE, CI green) · #386 (world-steering, CONFLICTING — above) ·
> #387 (golive, MERGEABLE, CI green). Copilot reviewed all three; its findings are folded (see the
> `fold Copilot review` commits). Recommendation: **merge #385 and #387 now; #386 waits.**
>
> **Open follow-ups (none blocking):** SG-201 suppress overlay publishes whose participant-visible
> snapshot is unchanged (a timing side channel, no content exposure); `Storyline.TargetIntensity` is now
> written cross-thread as a non-atomic `int?` (first such mutation of `Storyline`); story 08's AC5/UAT
> script still need the selector reflected; `implementation.md`'s Wave-Plan footprints for rows 07/08 are
> stale (stories 07 and 08 grew beyond their declared files — all additive, verified per-commit).


The three controller capabilities Tom reported non-functional in UAT — tiered pause, the escalation
dial, and the AI inject engine. **All three were already marked `Status: Complete` with CLOSED
issues.** All three were real code that nothing ever consumed: `usePauseState` never called an API;
the escalation dial read an in-memory `storylineMock`; the live provider shipped behind
`Generation:Provider = Fake` and `deployAi = false` with an unsigned Tier-2 sign-off. The shared root
cause is that **"Complete" had come to mean unit-green, not working**, so every story below carries
*verified in UAT* in its definition of done — a real AI-authored post reaching a participant feed, a
Freeze that actually stops the loop, a dial move the engine actually follows.

Four **parallel tracks**; only 08 waits on 07. Composition-root wiring is an orchestrator-owned
serial step per the #310→#317 lesson (a fully-green slice merged with its `Program.cs` wiring never
executed, leaving the endpoint dead at 404).

- 🔧 **Track A — `engine-runtime/05-live-provider-uat-golive`** (#349, TIER-2, backend/infra) — built, Gate-2 clean, merged to `feature/engine-runtime-golive`. AC1–AC5(evidence)/AC7 met; **AC6 blocked on Tom's §8 signature** (no Azure contact was made: no `az login`, no deploy, not even a what-if).
  `deployAi = true` for UAT, give the App Service a `SystemAssigned` identity (it has **none** today)
  and wire `backendPrincipalId`, stage `Generation:*` from bicep outputs verbatim. Standing up the
  endpoint is **decoupled from routing traffic to it** via a separate toggle — only the latter is
  gated on the `PROVIDER-GOVERNANCE.md` §8 signature, which is Tom's, not a builder's. Independent of
  B/C/D; can start immediately. Provider Azure OpenAI in-tenant; **UAT only** (CI + prod stay `Fake`).
- 🔧 **Track B — `world-steering/07-pause-server-authoritative`** (#350) → **`08-pause-participant-overlay`** (#351) — both built, Gate-1 clean, merged, Gate-2 clean. 07 needed two fold passes (2 Criticals: Freeze silently no-op'd on an unstarted clock — the default state of a fresh process — and ENGINE PAUSED could outlive a failed kill-switch POST). 08 needed one (a re-GET with no ordering guard could rewind the stale-push cutoff; its test fake didn't emit `Connected`, so the suite couldn't see it). Freeze now starts the clock, freezes it, **verifies** via `IsFrozen`, and returns 409 recording *no* tier if it cannot.
  07: server-authoritative tier state + `POST /api/steering/pause-tier`; Freeze drives
  `ExerciseClockService.Freeze/Unfreeze` so the loop genuinely halts; ENGINE PAUSED routed to the
  existing autonomy kill-switch/restore path (**frontend-only**, so 07 never touches
  `EngineReviewEndpoints.cs` — keeps it file-disjoint from Track D); injects tier honestly disabled.
  08: overlay write path + SignalR push so participants see the holding page. 08 edits the *shared*
  `ParticipantShellEndpoints.cs` (`overlay-state` currently returns a constant) — coordination point.
- 🔧 **Track C — `world-steering/09-escalation-dial-live`** (#352) — built, Gate-1 clean after two fold passes, merged, Gate-2 clean. 2 Criticals: a rejected POST left the dial announcing the change, and `LIVE_LOADING_DEFAULTS` rendered a fabricated calm world (`intensity 0 / Dormant`) indistinguishable from real data once a restart cleared the registry. **Correction to this plan's earlier claim:** `TargetFollow.Modulate` is *not* unwired — `DecideStage` → `IntentComposer.Compose` already calls it, so a live target also shapes burst direction/count. Story 09 adds no call site, but the UAT expectation is wider than stated. Endpoint pair onto the live
  registry storyline; dial reads real intensity + phase; help/explanation UX folded in.
  `Storyline.Tick` **already** branches to `IntensityModel.TickTowardTarget`, so no engine/tick code
  is needed. `TargetFollow.Modulate` stays out of scope and unwired — do not assume it is covered.
- 🔧 **Track D — `autonomy-safety/05-engine-settings-api`** (#353, closes #297) — built, Gate-1 clean, merged, Gate-2 clean; Delayed-auto is now reachable and proven end-to-end (a burst counts down instead of queuing). ⛔ **`06-engine-settings-panel`** (#354) — **NOT clean, not merged**, 2 open Criticals; see the session note above for Tom's approved rewrite.
  05 exposes the built-but-unreachable `SetExerciseDefault`, which is **what makes delayed-auto exist
  at all** (`EngineAutonomyState.Create` pins every exercise at `Suggest`, and the 3 existing
  endpoints only apply/lift *clamps*), plus a runtime tier lever and a settings read; folds in and
  closes #297. 06 is the console "Engine" toolstrip flyout and **fixes the LIVE/SUGGEST-ONLY
  mislabel** — those two positions are behaviourally identical today.

> **Two dead seams found during the audit, both structurally identical to the three above.**
> `SetExerciseDefault`/`SetStorylineOverride` are never called from `Pulse.WebApi`. And
> `ITierPolicy.PickTier` is registered in DI with **zero call sites** — the real tier decision is a
> private `IntentComposer.TierFor(ReactionTriggerKind)` keyed on trigger kind, not purpose, so
> everything the loop generates today is **Standard** tier. Story 05 attaches its lever at
> `IntentComposer`'s actual call site (`ReactionLoopHost.cs:541`), not the dead seam; refactoring
> `IntentComposer` onto `ITierPolicy` is a separate cleanup.
>
> **Known sharp edge, not solved here:** engine state (loop registration, storylines, autonomy, the
> clock) lives in **process memory** — no `Storyline` entity exists. Wiring needs no EF migration,
> but every App Service restart de-registers the loop and needs a re-seed via
> `POST /api/ops/seed-engine-content`. Accepted for "rudimentary"; documented, not hidden.
>
> **Temporary shim to remove:** Ambient for the first live run is achieved by pointing
> `Generation:Tiers:Standard:Model` at the mini model, because no runtime tier lever exists yet.
> Track D's lever replaces it — tracked as an engine-runtime follow-up so it doesn't become permanent
> by silence.
>
> **Deliberately unfulfilled:** PAUSE INJECTS ships disabled. There is no inject queue in the product
> (`inject-queue` #4 is all five stories Not Started, no backend). Tom's call, made knowingly.

---

## Cross-feature serial edges (don't parallelize across these)
- `participant-shell/04` (mount contract) **before** `staff-shell/04` (preview-as).
- `staff-shell/02` (`registerSurfaceTool()`) **before** `console-shell` docks its toolbox.
- `overlay-layer` renders mock state now; its real triggers come from `world-steering` (#26/#27), later.

## Housekeeping (follow-ups, not blocking)
- Merge infra PR #198; set `AZURE_STATIC_WEB_APPS_API_TOKEN` for `deploy-frontend.yml`.
- Delete stale merged branches `design/d3-news-outlets-stories`, `design/d4-press-weather-stories`.
