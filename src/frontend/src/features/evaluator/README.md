# Evaluator Dashboard (D6)

Staff surface — COBRA theme, dense-on-purpose, desktop-first. **Never** apply participant
skins to this surface's own chrome; the one place participant styling legitimately appears is
`ParticipantStageFrame`, a *read-only reproduction* of the Portal/Pulse participant stage used
by `WorldView` and the replay stage — not the real participant app, and never interactive
(COR-013/COR-015).

Source of truth: `design/handoffs/evaluator-dashboard/DECISIONS.md` (D6-001…D6-012),
`SHELL-CONTRACT.md` (D7, the shared staff shell this surface renders inside), and the reference
mockup `Evaluator Dashboard.dc.html` (its `renderVals()` is the exact data model transcribed
into `types/` + `services/mockData.ts`).

## Two-worlds note

This whole feature is **staff world**. It reads scenario data and telemetry to help evaluators
observe an exercise, but it is not itself part of the fiction. `ParticipantStageFrame` borrows
participant fonts/colors (Figtree, Libre Franklin, exercise-green banners) deliberately, the
same way D7's "Preview as participant" does — so evaluators see what participants really see —
while staying strictly read-only and living inside the COBRA-themed dashboard chrome.

## Runtime state model (replaces the mockup's `exState`/`projector` props)

`contexts/EvaluatorStateContext.tsx` is a React Context + `useReducer` that owns everything the
reference mockup kept in `class Component extends DCLogic { state = {...} }`:

- `exerciseState: 'live-quiet' | 'live-storm' | 'hotwash' | 'pre-e8'` — the exercise's real
  lifecycle phase. Drives the storyline board's storm variant, the sentiment/intensity panels'
  pre-E8 fallback, and the Replay view's default (hotwash opens straight into Replay, in hotwash
  mode). **TODO(E1):** source this from the real exercise-context/lifecycle API (COR-032/050)
  instead of the `DevExerciseStateToggle` strip.
- `projector: boolean` — scales the storyline tile hero numerals (30px → 46px).
- `view` / `replayMode` / `worldChannel` / `replayChannel` / replay transport
  (`playhead`/`playing`/`speed`) / timeline filters / annotation-capture state / coverage items /
  AAR export progress — all real state now, not demo props.
- Global keyboard shortcuts are wired once, centrally: **B** opens annotation capture anywhere
  (context-derived anchor), **1/2/3** pick its category while open, **Enter** saves, **Esc**
  cancels (and closes flyouts), **Space** toggles Replay playback while that view is active.

A dev-only, clearly labeled `DevExerciseStateToggle` (rendered at the top of the work area)
replaces the mockup's Tweaks editor for flipping `exerciseState`/`projector` during development.
**Delete it once E1 exists.**

## Component breakdown → D6 decisions

| Component | Decisions implemented |
|---|---|
| `StorylineBoard` + `StorylineTile` | D6-001 — 4 tiles, hero = state × time-in-state, severity as word+shape+color (never color-only, NFR-001), tile click → Timeline filtered |
| `LiveStream` | D6-003/008 — chronological stream incl. amber controller-dial rows, off-platform rows, inject rows; every row has a ⚑ |
| `WorldView` / `ParticipantStageFrame` | D6-002 — read-only participant stage (Portal/Pulse), affordances absent, not disabled |
| `TimelineExplorer` | D6-004 — chip filters + actor search, per-human attribution chips (COR-018), off-platform first-class rows, "View in situ →" deep-links to Replay |
| `replay/ReplayPlayer` (+ `ReplayStage`, `ReplayTrack`, `ReplayTransport`) | D6-005/006/007 — video-scrubber semantics, staff lane (absent in hotwash), hazard-hatched +4hr seam + toast, honest-fidelity chip that flips per mode, hotwash segmented switch |
| `metrics/MetricsViews` (+ `LatencyPanel`, `CoveragePanel`, `SentimentPanel`) | D6-008/009/010/011 — evidence-level chips, provisional-until-confirmed coverage, controller-dial sentiment overlay, pre-E8 "nothing synthesized" fallback |
| `AnnotationCapture` | D6-003 — ≤10s popover, no modal |
| `AnnotationsFlyout` | D6-003/EVL-021 — list + push-to-Cadence (evidence only; scoring stays in Cadence) |
| `AarExportPanel` | D6-012 — five-line manifest, provisional-items warning, one COBRA export button + progress |

## COBRA component usage

Text inputs use `CobraTextField` throughout (annotation note, timeline actor search). Buttons
are a deliberate split: the two buttons the D6 decisions explicitly call "a COBRA button" —
`AnnotationsFlyout`'s "Push N to Cadence" footer and `AarExportPanel`'s "Export AAR package" —
use `CobraPrimaryButton`. Every other button on this surface (tab/segment/pill controls, chip
filters, Confirm-for-AAR/Dismiss, transport controls) is intentionally styled to the D6 mockup's
own navy (`#1e3a5f`) design language — which matches the D7 shell header navy, not the generic
COBRA cobalt-blue button palette — because the mockup's layout was user-confirmed pixel-for-pixel
and swapping in the four fixed-color Cobra button variants would drift from that sign-off. If a
future COBRA toggle/segmented-button primitive lands, these are the candidates to migrate.

## Shell hosting

This surface is hosted inside the real shared staff shell (`@/features/staffShell`, D7):
`App.tsx` mounts `StaffShellFrame` (the COBRA theme boundary) at `/evaluator`, with `StaffHeader`
filling its header slot and `Toolstrip` filling its toolstrip slot; `EvaluatorDashboardPage` is
the frame's `children` — see `App.tsx`'s `EvaluatorDashboardRoute`.

`evaluatorTools.ts` registers Annotations (badged with the unpushed-to-Cadence count) and AAR
export into the shell's ONE shared toolstrip dock via `useRegisterSurfaceTool()`
(`components/shell/EvaluatorToolstripRegistration.tsx`, D7-011) — this surface draws no toolstrip
of its own. `components/shell/EvaluatorFlyoutLayer.tsx` renders whichever tool's flyout is active,
keyed off the shell's shared `useToolstrip().activeToolId`.

## Data seam (mock today, real APIs later)

Every hook in `hooks/` wraps a pure function over fixtures in `services/mockData.ts` /
`services/stageContent.ts` (transcribed from the reference mockup's Fairhaven Water Response
26-3 arc — a 68-minute water-contamination scenario). Swapping in real data means changing the
hook bodies to React Query calls against `core/services/api.ts`; component props/shapes
(`types/index.ts`) are the intended stable contract:

- `useStorylineTiles` / `useLiveStream` → exercise-context + telemetry (XC-004)
- `useTimelineEvents` → event-log query (EVL-001/002)
- `useWorldStage` / `useReplayTrack` → replay-bundle query (EVL-003)
- `useMetrics` → metrics query (EVL-010…015); coverage confirm/dismiss stays evaluator-owned
  mutation state in `EvaluatorStateContext` (it's a judgment call, not engine output)
- `useAarManifest` → manifest is derived client-side today; `startExport()` only animates
  progress — point it at a real export-job API when one exists

`services/scenarioTime.ts` provides `scenarioClock(t)`, mirroring the mockup's `scn(t)` exactly
(COR-053 — every participant-visible timestamp on this surface is scenario time, never
wall-clock).

## Routing

Mounted at `/evaluator` in `src/frontend/src/App.tsx` (`ExerciseContextProvider` →
`ToolstripProvider` → `StaffShellFrame` → `EvaluatorDashboardPage`, which owns mounting its own
`EvaluatorStateProvider`). Existing routes (home, 404) are untouched.

## Known scaffold gaps

- Replay channel coverage: Portal + Pulse are fully built; Wire/Weather tabs are visually present
  on the participant-stage strip but static (matches the mockup's documented scope, D6 open items).
- Misinformation-spread tree (EVL-013) is out of scope for this pass (metrics-v2, per D6 open items).
- Annotation attach-to-selection (drag a post into the popover) is not built; the popover anchors
  by context only, per D6 open items.
