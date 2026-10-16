# Implementation: Phones and tablets (Session B)

> Bridge between planning (`feature.md` + stories) and orchestration
> (`docs/FEATURE_ORCHESTRATION_PLAYBOOK.md`). **Frontend only, no migration, no backend change.**
> Branch family `feature/mobile-<slug>` (Brief C1 rule 3); merge `main` daily.

## Per-story tech notes

| Story | Approach | Key files | Exports (that others import) |
|-------|----------|-----------|------------------------------|
| 01 | Add `@playwright/test` as a devDependency of `src/frontend` (flag to Tom: `tools/guide-screenshots` deliberately has its own `playwright-core`). Config starts Vite with the mock seams (`USE_MOCK_DATA`, `core/config/mockData.ts`) on its own port, reuses the guide-shots role/alerts/overlay `localStorage` override plugin so staff roles are reachable (extract the plugin to a shared module or import `tools/guide-screenshots/serve.mjs`; do not fork it). Viewport matrix + layout assertion helpers. | `src/frontend/playwright.config.ts`, `src/frontend/e2e/fixtures/*`, `e2e/helpers/{viewports,layout,session}.ts`, `package.json` scripts | `VIEWPORTS`, `expectNoHorizontalScroll`, `expectTouchTargets`, `expectNoWallClock`, `loginAs(role)` |
| 02 | Audit and fix with CSS modules, not new components: `SocialChannel.module.css` breakpoints (840/1184/1280), `NavRail`/`RightRail` collapse, bottom tab bar (`ChannelNav`), `Feed`, `ThreadView`, `Composer`/`ReplyComposer`/`ComposeModal`, `Profile`, `ExplorePage`, `PinnedFeed`, `NewPostsPill`. `env(safe-area-inset-*)`. 44px hit areas via padding/`::before`, not by enlarging visuals. | `features/social/**/*.module.css`, `features/social/layout/*`, `features/social/pages/*`, `features/social/explore/*`, `features/social/pinned/*`, `components/{Composer,ReplyComposer,ThreadView,NewPostsPill,FollowButton}*`, `components/post/*` | Documented `--pulse-touch-min: 44px` custom property on the social root (`theme/social.module.css`) |
| 03 | Same treatment for `JoinPage`, `ParticipantSignInPage`, the pause/EndEx holding page (`OverlayLayer`), `ParticipantSignOutControl`. Keyboard-open (visual viewport) behavior on sign-in fields. | `features/login/pages/{JoinPage,ParticipantSignInPage}.*`, `features/participant-shell/components/OverlayLayer/*` (sign-out hit area is story 18) | none |
| 04 | `MediaViewer`, `MediaGrid`, `VideoPlayer`, `PostMediaSlot`, `ComposerMedia`, `ExerciseBands`: pinch/zoom, safe-area close button, landscape video, watermark slot stays visible. | `features/social/components/media/*`, `components/post/PostMediaSlot*`, `components/ComposerMedia*` | none |
| 05 | Verify-and-close: write the phone e2e for the already-merged fix, then fix whatever it finds in `AlertBar` at 360/768 plus the interplay with the bottom tab bar, `OverlayLayer` and Freeze. Not a rebuild. | `features/participant-shell/components/AlertBar/*`, `ShellLayout.tsx`, `e2e/alert-bar.phone.spec.ts` | none |
| 06 | Spec file `e2e/participant-critical-path.spec.ts` running at 360/390/768: join link -> feed -> new post -> reply, against the frontend mock seams. | `e2e/participant-critical-path.spec.ts` | none |
| 07 | Playwright + Chrome DevTools Protocol CPU throttle (4x) to approximate a mid-range phone; inject a 120 posts/min burst through the mock feed stream (`useFeedStream.ts` seam, `core/realtime`); measure long tasks, dropped frames, DOM growth; assert `NewPostsPill`/aggregation keep the page readable. Findings become issues; only fix what is a small frontend change. | `e2e/burst.phone.spec.ts`, `e2e/helpers/burst.ts`, possibly `features/social/hooks/useFeedStream.ts` / `NewPostsPill.tsx` (only if a defect is found: coordinate with 02) | `injectBurst(page, ratePerMin, minutes)` |
| 08 | Generalize `capture.mjs` (`isMobile: viewport === MOBILE` is an identity check) to a viewport list; add 360 and 768 variants for the participant shots; update `docs/guide/participant-guide.md` and the printable one-pager; recapture the 6 existing participant shots. | `tools/guide-screenshots/capture.mjs`, `docs/guide/participant-guide.md`, `docs/guide/img/*` | `TABLET`, `PHONE_SMALL` viewport constants for story 16 |
| 09 | `features/pwa/manifest/`: pure `buildManifest(brand, origin)` from `useBrandConfig()` tokens; `ManifestHead` sets `<link rel="manifest" href="blob:...">`, `apple-touch-icon`, `apple-mobile-web-app-title`, `theme-color` and revokes the blob on change. Icons: brand logo if same-origin/CORS-safe, else a generated PNG (canvas) of the brand's initial on `colors.primary`. **Never** the Pulse favicon or "Pulse"/"Dynamis" text once an exercise brand resolves. Static `index.html` head stays brand-neutral. | `features/pwa/manifest/*`, `features/pwa/PwaRoot.tsx` (created here), `features/pwa/index.ts` | `<PwaRoot />` (mounted once in `App.tsx`, orchestrator) |
| 10 | Hand-written minimal worker (`public/sw.js`, no new dependency) precaching the hashed `/assets/*` app shell + `index.html`; network-only for everything else (`/api`, `/hubs`, media, `/join`, `/staff`); versioned cache name, old caches deleted on activate; update flow (skipWaiting on user accept). Registration only in production builds, only from the participant subtree, never on staff routes. | `public/sw.js`, `features/pwa/serviceWorker/*` | `<ServiceWorkerRegistrar />` (one line added to `PwaRoot.tsx`) |
| 11 | `beforeinstallprompt` capture (Android/Chrome) with an in-fiction branded banner; iOS has no event, so show a "Share -> Add to Home Screen" sheet after a visit threshold; hidden in standalone display-mode; dismissal persisted per exercise. | `features/pwa/install/*` | `<InstallPrompt />` (one line added to `PwaRoot.tsx`) |
| 12 | Add a tablet breakpoint band to `ControllerConsole.tsx` (today: two-column LIVE WORLD / RUN SHEET only at >=1280px via `SLOT_SPLIT_MIN_WIDTH_PX`, permanent 336px `ReviewQueue` column via `REVIEW_QUEUE_WIDTH_PX`). Below the desktop band, collapse into a pane switcher (tabs: Live world, Run sheet, Review queue with a never-color-only count badge). | `features/controller/components/ControllerConsole.tsx` (811 lines: single owner), new `features/controller/console/ConsolePaneTabs.tsx`, `consoleLayout.ts` | `useConsoleLayout()` |
| 13 | `StaffShellFrame` grid is `minmax(0,1fr) STAFF_TOOLSTRIP_WIDTH_PX`; verify header, exercise switcher, toolstrip and flyouts (persona dock, ENGINE, USAGE) at 768/820/1024/1180 wide. | `features/staffShell/{StaffShellFrame.tsx,staffShellTokens.ts}`, `components/{StaffHeader,Toolstrip}.tsx` | tablet tokens in `staffShellTokens.ts` |
| 14 | Inventory every keyboard shortcut (Cmd/Ctrl+K palette in `ControllerConsole.tsx`, the shortcut strip, `CommandPalette.tsx`, composer/queue keys); ensure a visible touch control for each, and that iPad hardware-keyboard chords (Cmd+K) work and do not collide with Safari. Coarse-pointer hit areas >=44px. | `features/controller/console/CommandPalette.tsx`, `components/{PersonaComposer,PersonaPicker}.tsx`, `components/steering/EscalationDial.tsx`, `engine/components/ReviewQueue.tsx`; **shortcut-strip edits go through story 12's file** | none |
| 15 | Keep the existing deliberate steps and make them touch-safe: popovers (`TakedownAction` confirm panel, `PausePill` Freeze confirm step) stay on-screen at 768-wide portrait, no hover/right-click dependence, targets >=44px, destructive confirm not adjacent to Cancel without spacing, no auto-focus on the destructive button. | `features/controller/liveWorld/TakedownAction.tsx`, `components/steering/PausePill.tsx`, `lifecycle/{EndExerciseDialog,ExerciseLifecycleControl}.tsx` | none |
| 17 | Suppress the dateline while only the default wall-mirroring clock is installed (detect via `core/clock`); 44px strip links. | `participant-shell/components/ChannelNav.tsx` | none |
| 18 | Coarse-pointer hit-area extension (padding / `::before`) on the post action row, composer buttons, Back, Sign out, Followers link. | `social/components/post/PostActions.*`, `Composer*`, `ReplyComposer*`, `layout/DetailHeader.*`, `pages/Profile.*`, `ParticipantSignOutControl.*` | none |
| 16 | Playwright specs at 1024x768 / 768x1024 / 1180x820 / 820x1180 with controller and evaluator roles (guards still hold); add controller tablet shots to `capture.mjs`; update `docs/guide/controller-guide.md`. | `e2e/controller-tablet.spec.ts`, `tools/guide-screenshots/capture.mjs` (after 08), `docs/guide/controller-guide.md`, `docs/guide/img/*` | none |

## Reuse map

- COBRA theme + `@/theme/styledComponents` (**staff stories 12-16 only**): `src/frontend/src/theme/`. Never in 02-11.
- Participant skin: `features/participant-shell/BrandThemeProvider.tsx`, `brandTokens.ts` (`useBrandConfig`, `useBrandTokens`,
  `--pulse-brand-*` vars), `features/social/theme/{SocialBrandScope.tsx,tokens.ts,social.module.css}`. No default MUI look.
- Shell: `participant-shell/ShellLayout.tsx` (reserves `--pulse-alert-height`), `components/ChannelNav.tsx` (mobile bottom tab bar),
  `ComplianceChrome.tsx`, `components/AlertBar/*` (+ `AlertsHistory`, `alertsRoute.ts`), `components/OverlayLayer/*`.
- Shared axios client: `core/services/api.ts`; mock switch `core/config/mockData.ts` (`USE_MOCK_DATA`); env: `core/utils/validateEnv.ts`.
- Scenario time: `core/time` and `core/clock` (COR-053). Telemetry: `core/telemetry` (XC-004). Realtime feed: `core/realtime` and
  `social/hooks/useFeedStream.ts`. Exercise scoping: `core/exerciseContext` (`useExerciseContext`). A11y helpers: `core/a11y`.
- Icons: FontAwesome only. MUI 9: system props in `sx`.
- Staff chrome: `features/staffShell/` (`StaffShellFrame`, `Toolstrip`, `toolRegistry`), `features/controller/` as listed above. Role
  guards: `canControl` in the console and `allowedRoles` in `staff/staffRouteRegistry.tsx` (read-only for these stories).
- Screenshots: `tools/guide-screenshots` (`capture.mjs`, `serve.mjs` role/alerts/overlay override seam, own `playwright-core` pin 1.56.1).
- Guide: `docs/guide/{participant-guide,controller-guide,getting-started,troubleshooting}.md`.

## Wave Plan (DAG-ready)

| Story | Stack | Files it owns | Depends-on | Can-run-with | Wave | Effort |
|-------|-------|---------------|------------|--------------|------|--------|
| 01 | frontend | `src/frontend/playwright.config.ts`, `src/frontend/e2e/{fixtures,helpers}/*`, `src/frontend/package.json` (+lock) | none | none (foundation) | 0 | M |
| 02 | frontend | `features/social/{layout,pages,explore,pinned}/*`, `social/components/{Composer*,ReplyComposer*,ThreadView*,NewPostsPill*,FollowButton*,post/*}`, `social/theme/social.module.css`, `SocialChannel.module.css` | 01 | 03, 04, 05, 09, 12, 13 | 1 | L |
| 03 | frontend | `features/login/pages/{JoinPage,ParticipantSignInPage}.*`, `participant-shell/components/OverlayLayer/*` | 01 | 02, 04, 05, 09, 12, 13 | 1 | M |
| 04 | frontend | `features/social/components/media/*`, `components/ComposerMedia*` | 01 | 02, 03, 05, 09, 12, 13 | 1 | S |
| 05 | frontend | `participant-shell/components/AlertBar/*`, `participant-shell/ShellLayout.*`, `e2e/alert-bar.phone.spec.ts` | 01 | 02, 03, 04, 09, 12, 13 | 1 | S |
| 09 | frontend | `features/pwa/manifest/*`, `features/pwa/PwaRoot.tsx`, `features/pwa/index.ts` | none (participant-first, needs nothing from A) | 02-05, 12, 13 | 1 | M |
| 12 | frontend | `features/controller/components/ControllerConsole.tsx`, `features/controller/console/{ConsolePaneTabs,consoleLayout}.*` | 01 | 02-05, 09, 13 | 1 | L |
| 13 | frontend | `features/staffShell/{StaffShellFrame,staffShellTokens}.*`, `staffShell/components/{StaffHeader,Toolstrip}.*` | 01 | 02-05, 09, 12 | 1 | M |
| 17 | frontend | `participant-shell/components/ChannelNav.*`, `e2e/channel-nav.tablet.spec.ts` | 01 | 02-05, 09, 12, 13 | 1 | S |
| 18 | frontend | `social/components/post/PostActions.*`, `social/components/{Composer,ReplyComposer}.module.css`, `social/layout/DetailHeader.*`, `social/pages/Profile.*`, `participant-shell/components/ParticipantSignOutControl.*`, `e2e/participant-touch-targets.phone.spec.ts` | 01, 02 | 06, 07, 10, 11, 14, 15 | 2 | M |
| 06 | frontend | `e2e/participant-critical-path.spec.ts` | 01, 02, 03 | 07, 10, 11, 14, 15 | 2 | M |
| 07 | frontend | `e2e/burst.phone.spec.ts`, `e2e/helpers/burst.ts` (+ defect fixes coordinated with 02) | 01, 02 | 06, 10, 11, 14, 15 | 2 | M |
| 10 | frontend | `public/sw.js`, `features/pwa/serviceWorker/*`, one line in `PwaRoot.tsx` | 09 | 06, 07, 14, 15 | 2 | M |
| 11 | frontend | `features/pwa/install/*`, one line in `PwaRoot.tsx` | 09 | 06, 07, 14, 15 | 2 | M |
| 14 | frontend | `controller/console/CommandPalette.*`, `components/{PersonaComposer,PersonaPicker}.*`, `steering/EscalationDial.*`, `engine/components/ReviewQueue.*` | 12, 13 | 06, 07, 10, 11, 15 | 2 | M |
| 15 | frontend | `controller/liveWorld/TakedownAction.*`, `steering/PausePill.*`, `lifecycle/{EndExerciseDialog,ExerciseLifecycleControl}.*` | 12 (layout context), 13 | 06, 07, 10, 11, 14 | 2 | M |
| 08 | frontend (tools + docs) | `tools/guide-screenshots/capture.mjs`, `docs/guide/participant-guide.md`, `docs/guide/img/participant-*` | 02, 03, 04, 05 | 16 (different shot blocks; serialize the capture.mjs edit: 08 then 16) | 3 | S |
| 16 | frontend (tests + docs) | `e2e/controller-tablet.spec.ts`, `capture.mjs` controller shots, `docs/guide/controller-guide.md`, `docs/guide/img/*` (controller) | 08 (capture.mjs), 12-15 | none | 3 | M |

Notes on disjointness: story 18 edits CSS modules/files that 02 also owns (PostActions, Composer, DetailHeader, Profile), so 18 is serial after 02; 02 does layout only, 18 does coarse-pointer hit areas. Story 17 solely owns `ChannelNav` (removed from 02/05). Build order inside wave 1: 05 first (audit-confirmed, smallest), 17, then the rest. `ControllerConsole.tsx` has a single owner (12); 14 and 15 reach it only via the files listed. `PwaRoot.tsx` is
created by 09 and receives one additive JSX line each from 10 and 11 (merge 09, then 10, then 11 serially; trivial conflict). Defect fixes found
by 06/07 that fall in another story's files are filed as follow-ups or sent back to that story's builder, not patched in-place.

### Integration seam (orchestrator-owned — never a wave story)

| Seam | File(s) | Rule |
|------|---------|------|
| Composition root | `src/frontend/src/App.tsx` | After wave 2, one final **wiring commit**: mount `<PwaRoot />` inside the participant subtree under `BrandThemeProvider` (stories 09-11). Additive, one line, after merging `main`. Flag the commit. No builder branch touches it. |
| Staff route registry | `src/frontend/src/features/staff/staffRouteRegistry.tsx` | **Not touched** by this feature (B3 reuses existing guards). If a pane route is ever needed, escalate; do not add it in a story. |
| Backend host | `Program.cs` | **Not touched** (no backend change). A per-exercise brand-metadata route would be, see story 09 and C1 rule 1. |
| Entry point | `src/frontend/index.html`, `src/frontend/src/main.tsx` | Only if story 10 needs registration at boot instead of from `PwaRoot`; treat as wiring-commit scope. |
| Static host config | `src/frontend/public/staticwebapp.config.json` | Story 10 may need `sw.js` served with `Cache-Control: no-cache` and the `navigationFallback.exclude` pattern checked (`webmanifest` is already excluded). Orchestrator-owned edit, flag it. |
| CI | `.github/workflows/ci.yml` | Adding the e2e job is a separate decision (open question); not owned by any story. |
