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

## Wave 0 — Foundation seams ⬜  · umbrella `feature/foundation-seams`

Load-bearing; build before any consumer. All mock-behind-the-axios-client (no backend). The playbook
mandates these first — a schema mistake here becomes a cross-phase migration.

| Story source | Builds | Notes |
|---|---|---|
| `exercise-isolation` (E1) | Exercise-context / query-scoping provider | The isolation guarantee is the always-Critical review item |
| `exercise-clock` (E1, COR-053) | Scenario-time source: `scenarioNow` + `formatScenarioTime` | Consumed by the shell mount contract and every PostCard |
| XC-004 telemetry (schema-first) | Telemetry emitter v0 + event schema | Posts write provenance through it from day one |

> **First action:** have `story-agent` confirm these three have build-ready stories (`implementation.md`)
> under their feature folders; author/split if thin, before fanning out.

---

## Participant shell ⬜  · umbrella `feature/participant-shell`  · **build first**

Wave plan: `docs/features/participant-shell/implementation.md`.

### Wave 1 ⬜
- `04-channel-mount-contract` — `ShellLayout.tsx`, `mountContract.ts` → **`ShellMountProps` / `useShellContext()`**, the seam every channel imports. Depends on Wave 0 `scenarioNow`.
- `01-compliance-chrome` — two fixed green banners (COR-031/066, NFR-008 guard).

### App route-tree split ⬜ (integration task, after Wave 1)
Refactor `src/frontend/src/App.tsx`: move the root `<ThemeProvider theme={cobraTheme}>` out of the app
root; mount a **participant subtree** (`<BrandThemeProvider>` → `<ShellLayout>`) and a **staff subtree**
(`<StaffShellFrame>` applies COBRA). `QueryClientProvider`/router stay at root. Makes COBRA physically
unreachable from participant paths (the thumbnail-test guarantee).

### Wave 2 ⬜ (all disjoint — fan out)
- `07-brand-theming` — `BrandThemeProvider` (creates the participant skin provider)
- `02-alert-bar-host` — PRT-010 EAS analog, `role="status"`, severity never color-only
- `03-channel-nav` — desktop strip + mobile tab bar
- `05-overlay-layer` — pause/EndEx/break-fiction host (renders mock overlay state; triggers are world-steering, a later cross-feature edge)
- `06-variants` — full / read-only / preview flag through the mount contract

---

## Social (E2) ⬜  · umbrella `feature/social`  · after the participant shell hosts a surface

Seed E1 data first (mock): `identity-auth-roles` 01/03 (roles + sessions), `persona-management` 01/02
(persona templates + casts) — so PostCard has authors and the feed has content.

### Wave S1 — keystone ⬜
- `posts/02-post-rendering-identity` — **`<PostCard>` + `<VerifiedMark>`** (`features/social/components/PostCard.tsx`). *Build first* — reused by every surface.
- `posts/03-post-provenance` — provenance/telemetry on the post model (XC-004).

### Wave S2 — first surface ⬜ (the slice that proves social works)
- `feeds-discovery/01-all-posts-feed` — global chronological feed; the **pilot login landing surface**, mounts in the participant shell.
- `posts/01-post-composition` — the composer.
- `threads-replies/01-flattened-thread-view` + `02-reply-counts-and-open`.

### Wave S3+ ⬜ (fan out; all reuse PostCard)
- `profiles-social-graph/01-profile-page` → `02-follow-unfollow` → `feeds-discovery/02-following-feed`
- `reactions/01-like`, `amplification/01-repost-quote`, `hashtags-trending/01-hashtags`
- `feeds-discovery/03-search`, `04-realtime-new-posts-pill` (SignalR host + polling fallback), `notifications/01-notification-center`
- `persona-operation/*` (E7 staff inject surface — after the participant read/compose slice exists)
- Deferred/stretch: `feeds-discovery/05-for-you-feed`, `reactions/02-sentiment`, `direct-messages/*`

---

## Staff shell ⬜  · umbrella `feature/staff-shell`  · parallel, after participant mount contract

Wave plan: `docs/features/staff-shell/implementation.md`.

### Wave 1 ⬜
- `05-cadence-chrome-tokens` — `StaffShellFrame.tsx` (COBRA theme boundary; enforces the hard gate)
- `01-staff-header` — navy Cadence header, clocks, state pill, FOUO tag, preview button
- `02-toolstrip-dock` — `Toolstrip.tsx`, `toolRegistry.ts` → **`registerSurfaceTool()`** (the console/evaluator seam)

### Wave 2 ⬜
- `03-participant-admin-flyout` — login-triage flyout (shell-global tool)
- `04-preview-as-participant` — **depends on `participant-shell` mount contract** (the one cross-feature serial edge)

**On landing:** delete `src/frontend/src/features/evaluator/components/shell/StaffShellStub.tsx` (its own
comment says so) — coordinate with the evaluator session, which currently imports it.

---

## Cross-feature serial edges (don't parallelize across these)
- `participant-shell/04` (mount contract) **before** `staff-shell/04` (preview-as).
- `staff-shell/02` (`registerSurfaceTool()`) **before** `console-shell` docks its toolbox.
- `overlay-layer` renders mock state now; its real triggers come from `world-steering` (#26/#27), later.

## Housekeeping (follow-ups, not blocking)
- Merge infra PR #198; set `AZURE_STATIC_WEB_APPS_API_TOKEN` for `deploy-frontend.yml`.
- Delete stale merged branches `design/d3-news-outlets-stories`, `design/d4-press-weather-stories`.
