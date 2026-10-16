# Feature: Phones and tablets (Session B)

**Epic:** cross-cutting (E1 Platform shell, E2 Social, E7 Controller)  ·  **Phase:** 2 (post-demo wave, track 3)  ·  **Feature ref:** PDF-01 (post-demo-feedback)
**World:** both (B1/B2 participant, B3 staff)  ·  **Issue:** #524 (parent: feature #523)

## Summary
Participants play comfortably on phones and tablets as an installable, in-fiction PWA, and controllers can run the
console from an iPad. Frontend only: **no migration, no backend change.** Source: `docs/NEXT-WAVE-SESSION-BRIEF.md`
Part C3 (Session B), customer notes "Viewable on smart phone" / "Optimized for iPad and iPhone".

## Requirements covered
NFR-001 (WCAG 2.1 AA, severity never color-only, controller fully keyboard-operable), NFR-002 / SOC-071 (burst
legibility, 120 posts/min), COR-053 (scenario time), PRT-010/012 (alert bar), COR-018 (console), CTL-023 (tiered
pause / Freeze), CTL-024 (break-fiction), CTL-025 (takedown), COR-066/030 (per-exercise brand), XC-001/002 (isolation),
XC-004 (telemetry), D0 §4 non-negotiable 6 (participant mobile-first; staff desktop-first, **now plus tablet**).
Cross-cutting rules: Brief C1 (rule 1 no migration; rule 2 orchestrator-owned files only in a final wiring commit; rule 5
participant PWA first, controller tablet second, evaluator tablet last) and C5.

## Design references
`docs/design/D0-FOUNDATIONS.md` §2/§4, `D1-social-app.md` (mobile-first; Trending = Explore tab on mobile),
`D7-application-shells/` (mobile bottom tab bar 56px / 5 slots; alert bar ticker, D7-002), `docs/features/participant-shell/02-alert-bar-host.md`
(the 10/16 phone fix, PR #562). No `STORY-UPDATES.md` amendment applies to this feature. Tablet is **new scope, not yet
in D5/D7**: B3 stories must cite no design decision IDs and flag layout choices for design review (see open questions).

## Waves and stories
Status: all Not Started. B1 audit (2026-10-16) folded in: PR #562 alert bar verified; gaps G1 (story 05), G2 (17), G3 (02), G4 (18). Build 05 first. Issue column to be mirrored later.

| # | Story | Wave (brief) | Requirement(s) | Status | Issue |
|---|-------|--------------|----------------|--------|-------|
| 01 | [Browser e2e harness and viewport kit](01-e2e-harness-viewport-kit.md) | B1 | NFR-001, XC-001 | In Review | — |
| 02 | [Participant core screens on phones (feed, thread, composer, profile, Explore, Pinned)](02-participant-core-screens-phones.md) | B1 | NFR-001, NFR-002, COR-053, D0 §4.6 | Not Started | — |
| 03 | [Participant entry screens on phones (join, sign-in, holding page)](03-participant-entry-screens-phones.md) | B1 | NFR-001, D0 §4.6 | Not Started | — |
| 04 | [Media viewer and composer media on phones](04-media-viewer-phones.md) | B1 | NFR-001, NFR-008 | Not Started | — |
| 05 | [Alert bar on phones: verify and touch-target gaps](05-alert-bar-phones-verify.md) | B1 | PRT-010, PRT-012, NFR-001 | In Progress | — |
| 06 | [Participant critical-path e2e at 360/390/768](06-participant-critical-path-e2e.md) | B1 | XC-004, NFR-001 | In Review | — |
| 07 | [Burst legibility at 120 posts/min on a mid-range phone](07-burst-legibility-phone.md) | B1 | NFR-002, SOC-071 | Not Started | — |
| 08 | [Phone/tablet guide screenshots and participant guide](08-guide-screenshots-participant.md) | B1 | docs-as-done | Not Started | — |
| 09 | [PWA: per-exercise brand manifest](09-pwa-brand-manifest.md) | B2 | COR-066, COR-030, XC-002 | Not Started | — |
| 10 | [PWA: service worker (app shell only)](10-pwa-service-worker.md) | B2 | XC-001, NFR-004 | Not Started | — |
| 11 | [PWA: install prompts (Android and iOS)](11-pwa-install-prompts.md) | B2 | NFR-001, D0 §2 | Not Started | — |
| 12 | [Console layout at tablet sizes (panes/tabs)](12-console-tablet-layout.md) | B3 | COR-018, NFR-001 | Not Started | — |
| 13 | [Staff shell frame, toolstrip and flyouts at tablet sizes](13-staff-shell-tablet-frame.md) | B3 | COR-018, NFR-001 | Not Started | — |
| 14 | [Console keyboard shortcuts and touch alternatives](14-console-touch-and-keyboard.md) | B3 | NFR-001 | Not Started | — |
| 15 | [Takedown, Freeze and EndEx confirms stay deliberate on touch](15-deliberate-confirms-touch.md) | B3 | CTL-025, CTL-023, CTL-024 | Not Started | — |
| 16 | [Controller tablet e2e and guide screenshots](16-controller-tablet-e2e-guide.md) | B3 | NFR-001, docs-as-done | Not Started | — |
| 17 | [Channel nav dateline never shows wall-clock time](17-dateline-scenario-time-guard.md) | B1 (audit G2) | COR-053, COR-061/062 | In Review | — |
| 18 | [Participant touch targets at 44px](18-participant-touch-targets.md) | B1 (audit G4) | NFR-001 | Not Started | — |

### Deferred / follow-ups (not decomposed; do not build in this pass)

| Item | Why deferred | Where tracked |
|------|--------------|---------------|
| **B4 Evaluator on tablet** | After brief track 5 (evaluator on real data) **and** Session A's per-exercise role model (C1 rule 5). Today the evaluator dashboard is canned data; only prototype the layout. | brief C3 B4 |
| Offline cache, "missed while offline" | PDF-02 #525; builds on story 10's service worker, adds a data-cache and isolation/sign-out purge design. | post-demo-feedback PDF-02 |
| In-app camera capture | PDF-08 #531; builds on the PWA. | post-demo-feedback PDF-08 |
| Web push notifications | Not requested; would need a backend and consent design. | parked |

## Dependencies
Merged: PR #562 (alert bar phone fix, `/alerts` route). Session A's frozen-contract notices (`PostView`, session/role
types, `ExerciseScopeDto`): merge `main` before touching those types. Existing role guards (`canControl`,
`staffRouteRegistry` `allowedRoles`) are reused unchanged for B3.

## Design notes
- **Two worlds.** Stories 02-11 are participant world (per-brand skin, never COBRA, never default MUI look, scenario
  time only). Stories 12-16 are staff world (COBRA via `@/theme/styledComponents`, dense-on-purpose, desktop-first now
  plus tablet; never confusable with a participant view). The install banner and manifest are participant-world and
  must not read as an enterprise app or leak "Pulse by Dynamis" into a branded exercise.
- **jsdom cannot measure layout.** Overflow, 44px targets and wrapping are verified in a real browser (story 01 kit),
  not Vitest. Vitest keeps covering logic and structure.
- **Orchestrator-owned files** (`App.tsx`, `staff/staffRouteRegistry.tsx`, backend `Program.cs`): not touched by any
  story. Stories 09-11 each list the single additive line they need in `App.tsx`/`main.tsx`; the orchestrator applies
  them in one final wiring commit (Brief C1 rule 2). No story needs `Program.cs` or `staffRouteRegistry.tsx`.
- **Docs-as-done.** Each story names the `docs/guide/` page it updates (story template user-guide line).
- **Backend route for the manifest:** not needed in the chosen design (story 09 builds the manifest client-side from
  `useBrandConfig()`); if review overturns that, it is a C1 rule 1 coordination item, see story 09.

## Decisions (Tom, 10/16 interview)
| # | Topic | Decision |
|---|---|---|
| MT-D1 | E2E home and CI | Playwright stays in `src/frontend` (`@playwright/test`). **Nightly / manual only**: not in PR CI. A scheduled workflow is an orchestrator-owned `.github/workflows` change. |
| MT-D2 | Phone navigation | **Bottom tab bar on phones** (Home, Explore, Notifications, Profile, plus compose) replaces the left icon rail at phone widths. Built in story 02. The rail stays at tablet and desktop widths. |
| MT-D3 | Tablet console design | **Short design brief first.** A 1–2 page tablet amendment to D5 (which columns become tabs or panes, where the kill switch lives) goes to Tom for sign-off before stories 12 and 13 are built. |
| MT-D4 | Pre-sign-in PWA identity | **Not installable until signed in.** Join and sign-in pages have no manifest; the install prompt appears only after the exercise brand resolves. |
| MT-D5 | Install-prompt telemetry | **No** XC-004 events for PWA install or dismiss. |
| MT-D6 | Burst thresholds (story 07) | **Accepted:** no long task over 200 ms; p95 frame of 50 ms or less at 4x CPU throttle. |
| MT-D7 | Real-device checks | **Tom, per PR.** Each mobile PR carries a short iPhone/iPad checklist and the UAT URL. |
| MT-D8 | `/notifications` redirect in mock | Unknown. Investigate in story 02 and fix it, or document it if it is behind a flag. |

Still open: story 09 uses the brand logo as the app icon. If fetching the logo cross-origin forces a backend route, that needs C1 rule 1 coordination.
