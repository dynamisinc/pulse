# Story: Engine settings panel (console admin surface)

**Feature:** Autonomy & safety  ·  **Epic:** E8  ·  **Phase:** 2 (v1)  ·  **Status:** Not Started
**Requirements:** ADP §2.3 (v1 subset)  ·  **Design decisions:** none  ·  **Issue:** #354

## Context
Story 05 builds the runtime lever; this story is where a controller actually touches it. Today
there is **no admin surface at all** for the engine — the user went looking for "flip autonomy
posture, change model tier" and found nothing, and the audit found something worse underneath: the
`EngineControlBar`'s always-visible **LIVE** position (`src/frontend/src/features/controller/engine/
console/EngineControlBar.tsx`) claims Delayed-auto autonomy (`useEngineControl.ts`'s
`deriveEffective`: `mode === 'live'` → `runningAutonomy(AutonomyLevel.DelayedAuto)`) while the real
backend exercise default has been permanently Suggest (story 05's fix). **LIVE and SUGGEST-ONLY have
been behaviourally identical** — this story fixes the mislabel at its root by making the control bar
consume the real setting instead of an aspirational local mock.

Uses the **existing** consult-on-demand toolstrip pattern exactly as it already stands —
`useRegisterSurfaceTool()` (`@/features/staffShell/toolRegistry`, D7-011) plus a flyout keyed on
`useToolstrip().isActive(id)`, the same shape `ControllerConsole.tsx` already uses for its
"PERSONAS" tool (registration + `⌘K` toggle + `isActive(PERSONAS_TOOL_ID)`-gated flyout, all in one
file today). This story adds a sibling "ENGINE" tool registration to that same file and its own
flyout component — it does **not** invent a second toolstrip, a modal, or a new route.

## Acceptance Criteria
- [ ] Given the controller console, when it mounts, then an **"ENGINE"** surface tool is registered
      via `useRegisterSurfaceTool()` (icon + label + tooltip, no badge needed) alongside the existing
      "PERSONAS" registration in `ControllerConsole.tsx`; activating it (dock click) opens the
      settings flyout, keyed on `useToolstrip().isActive(ENGINE_SETTINGS_TOOL_ID)` — the same
      one-flyout-at-a-time contract every other toolstrip consumer already honors.
- [ ] Given the flyout is open, when it renders, then it shows the exercise's current autonomy
      default (Suggest / Delayed-auto), the current tier-policy mode (Standard / Ambient /
      auto-by-purpose), and the active provider + tier→model mapping **read-only** (story 05's
      `GET /api/engine/settings`, or the `USE_MOCK_DATA` static mock equivalent).
- [ ] Given the flyout, when the controller flips Suggest ↔ Delayed-auto, then it posts the change
      (story 05's endpoint) with an optimistic update that **reverts on rejection** — the same
      pattern `useEngineControl.setMode`'s live path already uses for the kill switch — so the panel
      never claims an autonomy posture the backend didn't actually apply.
- [ ] Given the flyout, when the controller picks a tier-policy mode, then it posts the choice the
      same way; the read-only provider/model display never becomes an editable field anywhere in
      this panel (preserves the governed-config boundary story 05 holds server-side).
- [ ] Given `EngineControlBar`'s existing kill-switch cycle (Live / Suggest-only / Stop), when the
      resolved exercise autonomy default is Suggest (today's reality, until an operator uses this
      panel), then the "Live" position's label states the TRUE effective level honestly (e.g.
      "ENGINE · LIVE (SUGGEST)" vs. "ENGINE · LIVE (DELAYED-AUTO)") instead of unconditionally
      implying Delayed-auto — the control bar now derives its label from the real setting (via this
      story's settings hook) rather than the local mock-only assumption baked into
      `deriveEffective`. Fixes the mislabel named in the audit.
- [ ] **Accessibility (NFR-001):** the flyout's autonomy/tier state is conveyed by text, never color
      alone; every control (toggle, tier picker) is keyboard-operable (tab order, Enter/Space
      activate, `Escape` closes the flyout) — matching the toolstrip's existing flyout convention.
- [ ] **Isolation + staff-only (COR-001/XC-002):** the panel reads/writes are exercise-scoped via the
      existing `useExerciseContext()` exactly like `useEngineControl`/`useSwampedMode`; it is reachable
      only from the staff console, never a participant surface; `USE_MOCK_DATA`
      (`@/core/config/mockData`) is honored — the mock path renders plausible static settings without
      a network call, matching every other engine hook's mock/live split.

## Out of Scope
The backend endpoints and the controller-role gate (story 05); full runtime model/deployment
configuration UI (explicitly rejected in story 05 — this panel never grows a deployment/model
field); a redesign of `EngineControlBar`'s overall three-position kill-switch UX beyond the label fix
(the cycle itself, and the degraded-mode indicator, are unchanged); a new toolstrip/extension
mechanism (reuses `useRegisterSurfaceTool()` verbatim); reconciling every historical telemetry gap in
`useEngineControl.ts` (the "KNOWN GAP" comment there about discarding the authoritative
`EngineAutonomyStateDto` — this story's settings hook is the first consumer to actually read that
DTO for display, but does not retrofit `useEngineControl`'s kill-switch derivation beyond the label).

## Technical Notes
Staff world — COBRA only (`@/theme/styledComponents`), never raw MUI components directly; FontAwesome
icons only (never `@mui/icons-material`); MUI 9 `sx`-only system props (no top-level `alignItems`/
`padding` props); TypeScript strict. New files this story owns:
- `src/frontend/src/features/controller/engine/components/EngineSettingsPanel.tsx` — the flyout
  content (autonomy toggle, tier picker, read-only provider/tier display), COBRA dark chrome
  matching `ReviewQueue`/`EngineControlBar`'s existing `chrome` tokens.
- `src/frontend/src/features/controller/engine/hooks/useEngineSettings.ts` — the settings
  read/write hook (mirrors `useEngineControl`'s per-exercise module-singleton-store shape and
  `USE_MOCK_DATA` split), the single source both the panel and the control-bar label read.
- `src/frontend/src/features/controller/engine/services/engineSettingsActions.ts` — the live
  `GET`/`POST` calls against the shared axios client (`@/core/services/api.ts`), mirroring
  `liveEngineControlActions.ts`'s conventions (no client `exerciseId`, `actingHumanId` +
  scope-server-resolved).

Edits (small, scoped):
- `ControllerConsole.tsx` — register the "ENGINE" tool + render `<EngineSettingsPanel>` alongside the
  existing "PERSONAS" registration (same file both already live in; not a new composition root).
- `EngineControlBar.tsx` — the "Live" label reads `useEngineSettings()`'s autonomy default instead of
  assuming Delayed-auto.

Cross-reference `implementation.md` (story 06, reuse map + wave — depends on story 05's contract as a
serial edge, no codegen).

## Dependencies
Story 05 (the settings API this panel calls); staff-shell story 02 (`toolRegistry.ts`'s
`useRegisterSurfaceTool()`/`useToolstrip()` seam); `ControllerConsole.tsx`'s existing "PERSONAS" tool
registration (the pattern this story mirrors, not replaces).

## Tests
- Unit: the tool registers/unregisters correctly; the flyout opens/closes on `isActive` and `Escape`;
  keyboard operation reaches every control.
- Unit: an optimistic flip reverts on a rejected POST (mock the live service to reject); the mock path
  renders without a network call when `USE_MOCK_DATA` is true.
- Unit: `EngineControlBar`'s "Live" label reflects the settings hook's autonomy default, not a
  hardcoded assumption — covers both the Suggest-today and Delayed-auto-after-a-flip cases.
- **UAT (required — not just unit-green).** On UAT with `mock=false`: open the ENGINE tool as a
  controller, flip Suggest → Delayed-auto, confirm the control bar's "Live" label updates and a
  subsequently generated burst actually counts down instead of queuing (cross-checked against story
  05's own UAT pass); flip back to Suggest and confirm the label + behavior follow. Screenshot or
  recording attached to the story/issue before flipping Status to Complete.

### As implemented — AC ↔ test linkage (unit-green; UAT above still outstanding)

- **AC1 (ENGINE tool registration + flyout via `isActive`)** —
  `ControllerConsole.engineSettingsTool.test.tsx`: `registers into the toolstrip SURFACE zone with no
  badge`, `opens the settings panel when activated, keeping the console body mounted`, `activating
  ENGINE closes an already-open Personas palette (one-flyout-at-a-time)`, `activating Personas closes
  an already-open ENGINE settings panel`.
- **AC2 (read-only autonomy default / tier-policy mode / provider+tier mapping)** —
  `EngineSettingsPanel.test.tsx`: `shows the current autonomy default, tier-policy mode, and read-only
  provider/tier mapping`, `never renders the provider/tier mapping as an editable field`, `always
  surfaces the inMemoryStateNote — never hidden`.
- **AC3 (autonomy flip — optimistic, reverts on rejection)** — `useEngineSettings.test.ts`:
  `setAutonomyDefault optimistically flips, calls the live POST, and reconciles from the authoritative
  response`, `reverts ONLY the changed field when the live POST rejects, and records the 400 body
  verbatim`, `a stale rejection does not clobber a newer change (rapid re-toggle safety)`, `does not
  touch effectiveLevel optimistically while a safety clamp is active`.
- **AC4 (tier-policy pick — same pattern; provider/model never editable)** —
  `useEngineSettings.test.ts`: `setTierPolicyMode flips the mode with no live POST` (mock),
  `a 403 flips forbidden` (live); `EngineSettingsPanel.test.tsx`: `never renders the provider/tier
  mapping as an editable field`.
- **AC5 (`EngineControlBar`'s "Live" label states the TRUE effective level)** —
  `EngineControlBar.test.tsx`, describe `the "Live" label honestly states the TRUE effective level`:
  `the Suggest-today case`, `the Delayed-auto-after-a-flip case`, and — the WR-003 trap case — `follows
  effectiveLevel, NOT exerciseDefaultLevel, while a safety clamp is active`.
- **NFR-001 (text not colour; keyboard-operable; Escape closes)** — `EngineSettingsPanel.test.tsx`
  describe `a11y`: `closes on Escape`, `moves focus to the close button on open`, `every autonomy/tier
  control is keyboard-reachable and Enter-activatable`; the clamp/stopped/read-only states are all
  rendered as `Typography` text (asserted via `toHaveTextContent`), never a colour-only cue.
- **COR-001/XC-002 (exercise-scoped; mock/live split honoured)** — `useEngineSettings.test.ts`:
  `renders a plausible static snapshot with NO network call` (mock), `a different exercise never
  observes another exercise's mutation` (per-exercise scoping), `fetches GET /api/engine/settings once
  per exercise` / `a second hook instance for the SAME exercise does not refire the GET` (live).
- **Clamp-detection correctness (pre-empted, confirmed clean at Gate-1 — `effectiveLevel ===
  exerciseDefaultLevel` does NOT imply "no clamp")** — `EngineSettingsPanel.test.tsx` describe `the
  clamp indicator (WR-003 trap case)`: `renders the clamp note when safetyClampActive is true, EVEN
  WHEN effectiveLevel equals exerciseDefaultLevel`, `shows no clamp note when safetyClampActive is
  false`, `reports "generation fully stopped" from generationStopped alone, not from a null
  effectiveLevel guess`. The panel derives its clamp indicator from
  `autonomy.safetyClampActive`/`autonomy.generationStopped` only — never by comparing the two levels.

### Gate-1 review findings — fixed, this pass (2 Critical + 5 Warnings + 4 Small)

Both traps the brief singled out (the label deriving from `effectiveLevel` verbatim, and the clamp
indicator deriving from `safetyClampActive`/`generationStopped` only) were confirmed genuinely handled
from the start. The two Criticals found were the SAME bug class reached a different way — a control
asserting a state the server never applied — via **staleness** and a **bad revert baseline**, not a
bad derivation:

- **CR-001 (staleness)** — the live settings snapshot was fetched exactly once per exercise per page
  load, with no invalidation path, so the sibling kill switch (which mutates the SAME server-side
  `EngineAutonomyState`) or a server-side degrade could leave this hook reporting "no clamp"
  indefinitely. Fixed with `useEngineSettings().refetch()` (a forced, unconditional re-GET, no-op under
  mock): `<EngineControlBar>` calls it whenever `engineControl.mode`/`degraded` changes (skipping the
  initial mount), and `<EngineSettingsPanel>` calls it on every OPEN TRANSITION. Tests:
  `useEngineSettings.test.ts` (`refetch() forces a fresh GET even after the initial one already
  completed, picking up a clamp applied out-of-band`), `EngineControlBar.refetchOnKillSwitch.test.tsx`
  (wiring: refetches once per kill-switch mode change, not merely on mount),
  `EngineSettingsPanel.refetchOnOpen.test.tsx` (wiring: refetches on each open TRANSITION, not "each
  render while open").
- **CR-002 (bad revert baseline)** — a rejection reverted to the OPTIMISTIC value captured at
  click-time, which under a rapid re-toggle can itself be another in-flight request's unconfirmed
  guess — so a double-rejection could leave the panel claiming a posture NEITHER POST ever actually
  applied. Fixed by tracking the last SERVER-CONFIRMED snapshot separately from the optimistic display,
  plus a per-exercise sequence number (shared across both mutation kinds) so only the newest issued
  request's own resolution may touch the display; a stale rejection is discarded entirely (no revert,
  no error). Test: `useEngineSettings.test.ts` — `CR-002 exact repro: reverts to the TRUE last-confirmed
  baseline, never a stale click-time optimistic value, when BOTH requests reject` (two
  never-resolved-until-explicitly-rejected requests; the old logic would have reverted to the first
  request's never-confirmed value).
- **WR-001 (`effectiveLevel: null` conflated with "not loaded")** — `EngineControlBar`'s `labelFor` took
  a flattened, nullable `effectiveLevel`, so "settings not loaded" and "generation fully stopped" both
  rendered the same (unsuffixed, pre-fix-ambiguous) label. Fixed by passing the FULL `autonomy` snapshot
  (or `null` while genuinely not loaded) and checking `generationStopped` explicitly, first — the label
  now reads `ENGINE · LIVE (GENERATION STOPPED)` distinctly. Covered implicitly by
  `EngineControlBar.test.tsx`'s existing label describe block (unsuffixed only while `autonomy` is
  `null`) — see `labelFor`'s doc comment for the explicit contract.
- **WR-002 (tautological stale-rejection test)** — the original test happened to assert a value both
  the guarded and unguarded code produced, so it passed even with the guard deleted. Replaced with the
  3-valued `tierPolicyMode` fixture the review suggested (`auto -> standard (pending) -> ambient
  (resolves, confirmed) -> reject standard` — guarded stays `ambient`, unguarded would revert to
  `auto`): `useEngineSettings.test.ts` — `WR-002 guard is OBSERVABLE (not tautological): ...`.
- **WR-003 (a superseded rejection could still raise an error banner over a change that succeeded)** —
  fixed as part of the CR-002 rework: a stale request's rejection is discarded ENTIRELY (not just
  "declined to revert the value") — no `error` write either. Proved by the same WR-002 test (asserts
  `error` stays `null` after the stale rejection).
- **WR-004 (a failed initial GET was terminal)** — `liveFetchStarted` is now cleared in the `catch`, and
  the panel's load-error state renders a visible "Retry" button calling the same `refetch()`. Tests:
  `useEngineSettings.test.ts` (`WR-004: a failed initial GET can be retried via refetch()...`),
  `EngineSettingsPanel.refetchOnOpen.test.tsx` (`a failed initial GET shows a Retry button that calls
  the SAME refetch()`).
- **WR-005 (the engine flyout could obscure a mounted, Tab-focusable persona composer)** — the
  persona-dock host's `open` (`dockPersonaId !== null`) is independent of the toolstrip's
  one-flyout-at-a-time `activeToolId`, so activating ENGINE didn't close a dock left open from an
  earlier persona selection. Fixed with a `useEffect` in `ControllerConsole` that clears
  `dockPersonaId` whenever the ENGINE tool activates. Test:
  `ControllerConsole.engineSettingsTool.test.tsx` — `Gate-1 WR-005: activating ENGINE closes an
  already-open persona-dock host...` (drives a real persona selection via `renderPersonaResults`, then
  asserts the dock closes on ENGINE activation).
- **S-001 (`setForTests` re-exported through the production barrel)** — `engine/index.ts` no longer
  re-exports `engineSettingsStore`; it mirrors `engineControlStore` (also absent from that barrel).
  Every test that needs the store imports it directly from `./hooks/useEngineSettings`.
- **S-002 (selected segment conveyed by colour/border alone for sighted users)** — both option groups
  now render a check-glyph + "(current)" suffix on the selected segment (`SegmentLabel`), in addition to
  (never instead of) `aria-pressed` and the colour/border treatment. Covered by the existing
  `aria-pressed` assertions plus the visible text these add.
- **S-003 (stray blank line in `ControllerConsole.tsx`'s docblock)** — removed.
- **S-004 (`'(no effective level reported)'` read as an ordinary state)** — reworded to
  `'CONTRACT VIOLATION: no effective level reported while generation is not stopped.'` so the
  (unreachable-under-contract) case names itself as a bug if ever seen, rather than reading as silent,
  ordinary output.
