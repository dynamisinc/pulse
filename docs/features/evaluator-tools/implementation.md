# Implementation: Live evaluator tools — storyline board & annotation capture

> Staff world (COBRA). Backend not present; live-board and annotation data are mocked behind the
> axios client. The Annotations tool registers into the shared D7 staff shell's toolstrip — this
> feature must not draw its own strip.

## Per-story tech notes

| Story | Approach | Key files (owns) | Exports (that others import) |
|-------|----------|-------------------|-------------------------------|
| 01 Live storyline board | Full-width tile row (state × time-in-state hero) + live stream + read-only world-view panel. | `features/evaluator/components/live/StorylineBoard.tsx`, `LiveStream.tsx`, `WorldViewPanel.tsx`, `hooks/useStorylineTiles.ts` | `<StorylineBoard>`, `<LiveStream>` (row renderer shared with `evaluation-timeline/02`) |
| 02 Live annotation capture | Root-mounted popover + global keydown handler (B / 1-2-3 / Enter / Esc) with a context-anchor deriver. | `components/annotation/AnnotationPopover.tsx`, `hooks/useAnnotationCapture.ts` | `useAnnotationCapture()`, `<AnnotationPopover>` (mounted once at dashboard root) |
| 03 Annotation push to Cadence | Toolstrip tool + flyout listing annotations; single + batch push mutation. | `components/annotation/AnnotationsFlyout.tsx`, `hooks/usePushToCadence.ts` | `<AnnotationsFlyout>` (registered as a toolstrip tool) |

## Reuse map
- COBRA theme + `@/theme/styledComponents` (staff surface) — `src/frontend/src/theme/`
- Shared axios client + React Query — `core/services/api.ts`, `@tanstack/react-query`
- FontAwesome icons — `@fortawesome/react-fontawesome`
- Telemetry emitter (`XC-004` v0 schema) — annotation capture, confirm, and push actions all emit
  through it
- `evaluation-timeline`'s `TimelineRow` renderer — reused verbatim by the Live stream (story 01)
- `evaluation-metrics`'s hooks (latency/coverage/sentiment figures, `EngineOffCard`) — read by the
  storyline tiles (story 01)
- D1/D2 participant skins — reused read-only in the world-view panel (story 01), same pattern as
  `evaluation-timeline/03`'s replay stage
- Shared staff shell per `SHELL-CONTRACT.md`/D7 — header + toolstrip are shell-owned; this feature
  registers **one** toolstrip tool (Annotations, story 03) via the shell's tool-registration point
  (the same extension point documented in `console-shell/implementation.md`'s `registerTool()`)

## Wave Plan (DAG-ready)

| Story | Files it owns | Depends-on | Can-run-with | Wave | Effort |
|-------|----------------|------------|----------------|------|--------|
| 01 Live storyline board | `live/*`, `useStorylineTiles.ts` | `evaluation-timeline` (row renderer, pre-filter target); `evaluation-metrics` (tile figures) | — | 1 | M |
| 02 Live annotation capture | `annotation/AnnotationPopover.tsx`, `useAnnotationCapture.ts` | `evaluation-timeline` + story 01 (context-anchor sources) | — | 2 | M |
| 03 Annotation push to Cadence | `annotation/AnnotationsFlyout.tsx`, `usePushToCadence.ts` | story 02 (annotation data model); E9/`INT-030` (serial edge for a real push) | — | 3 | M |

Story 01 is this feature's Wave 1 because it is the primary live surface every evaluator lands on;
02 needs at least one real view rendering to anchor against; 03 needs 02's data shape settled before
it can list/push anything.
