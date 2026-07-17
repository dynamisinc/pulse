# Implementation: Participant shell

> Bridge between planning and orchestration. The participant shell is a **Phase-1 foundation** — the
> E2 social app (and every later channel) mounts into it, so it lands early on the participant side.

## Per-story tech notes

| Story | Approach | Key files it owns | Exports (that others import) |
|-------|----------|-------------------|------------------------------|
| 01 compliance-chrome | Fixed top/bottom banners outside the app frame; reads `chromeConfig` | `features/participant-shell/components/ComplianceChrome.tsx` | `<ComplianceChrome>` |
| 02 alert-bar-host | Ticker default + band/emergency; `role="status"` live-region; consumes `alerts[]` | `.../components/AlertBar/*` | `<AlertBar>`, alert-state types |
| 03 channel-nav | Desktop strip + mobile tab bar; config-driven visibility | `.../components/ChannelNav.tsx` | `<ChannelNav>` |
| 04 channel-mount-contract | Content-region container + `{variant, scenarioNow}` props + CSS reset boundary; single scenario-time source | `.../ShellLayout.tsx`, `.../mountContract.ts` | **`ShellMountProps` / `useShellContext()`** — the seam every channel imports |
| 05 overlay-layer | z-ordered overlay host; renders `overlayState` (pause/endex/broadcast + register); break-fiction alien treatment | `.../components/OverlayLayer/*` | `<OverlayLayer>`, `OverlayState` type |
| 06 variants | `variant` flag plumbed through the mount contract; read-only removes affordances | (flag in `mountContract.ts`) | `variant` on `ShellMountProps` |
| 07 brand-theming | Per-exercise brand-token provider in the participant route subtree | `.../BrandThemeProvider.tsx` | `<BrandThemeProvider>`, brand tokens |

> Code dir is `src/frontend/src/features/participant-shell/` (hyphenated) — it matches the feature
> slug and the Wave-0 wall-clock lint ban in `src/frontend/eslint.config.js`
> (`src/features/participant-shell/**`), so the COR-053 guard covers the shell code with no eslint
> change (WAVE0-REVIEW precedent 11). The `.../` in the table above is relative to this dir.

Backend .NET not present yet — shell state (`{chromeConfig, alerts[], overlayState, variant,
scenarioNow}`) is the **contract seam**: React Query + mock behind the axios client now; SignalR push
+ a real endpoint later.

## Reuse map
- **Brand-theme provider for participant skins** — this feature *creates* it (story 07); channels
  consume it. **Never** COBRA / `@/theme/styledComponents` on this path (D0 §2 — staff-only).
- Exercise-context / query-scoping layer (E1) — shell state is exercise-scoped (`<path when it exists>`).
- Exercise clock (E1, COR-050) — the scenario-time source `scenarioNow` (story 04) reads from it.
- SignalR feed/notification hook — pushes `alerts[]` / `overlayState` / `scenarioNow` (`<path when it exists>`).
- FontAwesome (icons) via `@fortawesome/react-fontawesome`; React Query hooks pattern.
- exercise-configuration compliance-chrome **config** (COR-030/066) — story 01 consumes it.

## Wave Plan (DAG-ready)

| Story | Files it owns | Depends-on | Can-run-with | Wave | Effort |
|-------|---------------|------------|--------------|------|--------|
| 04 channel-mount-contract | ShellLayout, mountContract | E1 clock (scenarioNow) | 01 | 1 | M |
| 01 compliance-chrome | ComplianceChrome | chrome config | 04 | 1 | S |
| 07 brand-theming | BrandThemeProvider | 04 | 02,03,05,06 | 2 | S |
| 02 alert-bar-host | AlertBar/* | 04, 01 | 03,05,06,07 | 2 | M |
| 03 channel-nav | ChannelNav | 04 | 02,05,06,07 | 2 | S |
| 05 overlay-layer | OverlayLayer/* | 04, 01; world-steering triggers | 02,03,06,07 | 2 | M |
| 06 variants | (flag in mountContract) | 04 | 02,03,05,07 | 2 | S |

Wave 1 = the mount contract (the seam) + compliance chrome. Wave 2 = the surrounding layers, all
disjoint component files, fan out freely. Story 05's *rendering* is Wave 2 here; its *triggers* are
world-steering #26/#27 (a cross-feature serial edge — the shell can render mock overlay state before
those land).
