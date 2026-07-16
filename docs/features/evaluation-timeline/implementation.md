# Implementation: Evaluation timeline & replay foundation

> Wave 1 of the E10 backlog — the read model every other evaluator-dashboard feature consumes.
> Staff world (COBRA). Backend not present; timeline/replay data is mocked behind the axios client
> until the real telemetry-read and replay-snapshot contracts exist.

## Per-story tech notes

| Story | Approach | Key files (owns) | Exports (that others import) |
|-------|----------|-------------------|-------------------------------|
| 01 Read-only staff access | Route guard on the Evaluator role (COR-013) + the shell tab-row (Live/Timeline/Replay/Metrics) with the read-only caption. | `features/evaluator/routes/EvaluatorDashboardRoute.tsx`, `components/shell/EvaluatorTabRow.tsx` | `<EvaluatorDashboardRoute>`, `<EvaluatorTabRow>` |
| 02 Timeline explorer | Filterable/searchable event list over the telemetry read model; chip filters + actor search; per-row attribution + off-platform tagging; deep-link into Replay. | `features/evaluator/components/timeline/TimelineExplorer.tsx`, `FilterChips.tsx`, `TimelineRow.tsx`, `hooks/useTimelineEvents.ts` | `<TimelineExplorer>`, `<TimelineRow>` (reused by Live stream), `useTimelineEvents()` |
| 03 Replay player | Video-player transport over wall-elapsed time; activity ridgeline + staff lane + bookmark lane; honesty chips. | `features/evaluator/components/replay/ReplayPlayer.tsx`, `TransportBar.tsx`, `ActivityTrack.tsx`, `StaffLane.tsx`, `BookmarkLane.tsx`, `ReplayStage.tsx`, `hooks/useReplaySnapshot.ts` | `<ReplayPlayer>`, `useReplaySnapshot()`, replay route state (`playhead`, `channel`) consumed by story 02's deep-link |
| 04 Hotwash mode switch | Segmented `EVALUATOR ⇄ HOTWASH` control on a `replayMode` runtime-state field; conditionally *removes* (does not hide) the staff lane + per-post origin lines; deliberate-click only. | `features/evaluator/components/replay/HotwashToggle.tsx` (reads/writes `replayMode` on evaluator state) | `<HotwashToggle>`, the `replayMode` state `ReplayPlayer`/`StaffLane`/stream origin-rendering read |

## Reuse map
- COBRA theme + `@/theme/styledComponents` (staff surface) — `src/frontend/src/theme/`
- Shared axios client + React Query — `core/services/api.ts`, `@tanstack/react-query`
- FontAwesome icons — `@fortawesome/react-fontawesome`
- Telemetry emitter / read model (`XC-004` v0 schema) — the timeline and replay both read this stream
- Exercise-context / scoping layer (E1, `XC-001`) — every query in this feature scopes through it
- Scenario clock (COR-050/053) — drives all participant-visible time display in Timeline + Replay
- Shared staff shell per `SHELL-CONTRACT.md`/D7 — header + toolstrip are shell-owned; this feature
  registers no toolstrip tools itself (Annotations/AAR-export tools belong to `evaluator-tools` and
  `aar-export`) — it only mounts inside the shell's work area
- D1 social-app skin + D2 portal skin — reused **read-only** inside the Replay stage (story 03) and
  (later) the Live world-view panel (`evaluator-tools/01`) — one skin, two read-only consumers
- `posts`/`soft-delete-tombstones` (CTL-025) — the tombstone read model Replay must honor

## Wave Plan (DAG-ready)

| Story | Files it owns | Depends-on | Can-run-with | Wave | Effort |
|-------|----------------|------------|----------------|------|--------|
| 01 Read-only staff access | `routes/`, `components/shell/EvaluatorTabRow.tsx` | E1 roles (COR-013); D7 staff shell | — | 1 | S |
| 02 Timeline explorer | `components/timeline/*`, `hooks/useTimelineEvents.ts` | 01; E1 telemetry (`XC-004`) | 03 | 2 | M |
| 03 Replay player | `components/replay/*` (minus HotwashToggle), `hooks/useReplaySnapshot.ts` | 01; timeline event/snapshot model; D1/D2 skins | 02 | 2 | L |
| 04 Hotwash mode switch | `components/replay/HotwashToggle.tsx`, `replayMode` state | 03 (lives in the player it governs) | — | 3 | S |

This feature is Wave 1 for the whole E10 epic: story 01 must land before any other evaluator-dashboard
feature has a host to mount into, and stories 02/03 supply the event stream and replay contract that
`evaluation-metrics`, `evaluator-tools`, and `aar-export` all read from.
