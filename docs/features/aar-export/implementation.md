# Implementation: AAR export package

> Staff world (COBRA). This feature is downstream of the entire E10 epic — its one active story
> packages artifacts every other evaluator-dashboard feature produces. Backend not present; the
> export job's progress is mocked behind the axios client until a real export-job/queue contract
> exists.

## Per-story tech notes

| Story | Approach | Key files (owns) | Exports (that others import) |
|-------|----------|-------------------|-------------------------------|
| 01 AAR export package | Toolstrip tool → flyout with a five-line manifest, provisional-count warning, and a single export action with progress + named result. | `features/evaluator/components/export/AarExportFlyout.tsx`, `hooks/useAarExport.ts` | `<AarExportFlyout>` (registered as a toolstrip tool) |
| 02 Retention & export policy | Deferred — no implementation. | — | — |

## Reuse map
- COBRA theme + `@/theme/styledComponents` (staff surface) — `src/frontend/src/theme/`
- Shared axios client + React Query — `core/services/api.ts`, `@tanstack/react-query`
- FontAwesome icons — `@fortawesome/react-fontawesome`
- Telemetry emitter (`XC-004` v0 schema) — export start/complete events
- `evaluation-timeline`'s event/replay read model — the "Timeline log" and "Replay bundle" manifest
  lines bundle directly from it
- `evaluator-tools/03`'s annotation data (incl. unpushed count) — the "Annotations" manifest line
- `evaluation-metrics`'s latency/coverage/sentiment hooks (incl. story 02's unconfirmed-count) — the
  "Metrics" and "Scenario design record" manifest lines
- `posts`/`soft-delete-tombstones` (CTL-025) — takedown logging in the content archive
- Shared staff shell per `SHELL-CONTRACT.md`/D7 — registers **one** toolstrip tool (AAR Export) via
  the shell's tool-registration point, same pattern as `evaluator-tools/03`'s Annotations tool —
  does not draw its own strip

## Wave Plan (DAG-ready)

| Story | Files it owns | Depends-on | Can-run-with | Wave | Effort |
|-------|----------------|------------|----------------|------|--------|
| 01 AAR export package | `export/AarExportFlyout.tsx`, `useAarExport.ts` | `evaluation-timeline`, `evaluator-tools`, `evaluation-metrics` (all data sources); E9/`INT-032` (serial edge for the real Cadence-ZIP-slot contract) | — | 1 (of this feature) | M |
| 02 Retention & export policy | — | metrics/policy design pass | — | out of wave (deferred) | — |

Single-story feature: this is "Wave 1" locally, but sits last in the epic's true build order —
across all four E10 features the real sequence is `evaluation-timeline` → (`evaluation-metrics` +
`evaluator-tools` in parallel) → `aar-export`, since the export manifest has nothing to bundle until
the other three exist.
