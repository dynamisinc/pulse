# Implementation: Response, coverage, reach & sentiment metrics

> Staff world (COBRA). Reads exclusively from `evaluation-timeline`'s event/snapshot model — this
> feature computes and presents, it does not own a separate event log. Backend not present; all
> aggregation is mocked behind the axios client until real backend contracts exist.

## Per-story tech notes

| Story | Approach | Key files (owns) | Exports (that others import) |
|-------|----------|-------------------|-------------------------------|
| 01 Response latency | Latency table over prompt/response pairs; evidence-level derivation. | `features/evaluator/components/metrics/LatencyTable.tsx`, `hooks/useLatencyRows.ts`, `components/metrics/EvidenceLevelChip.tsx` | `<LatencyTable>`, `<EvidenceLevelChip>` (reused by story 03), `useLatencyRows()` |
| 02 Coverage provisional-confirm | Missed-opportunity list with local confirm/dismiss mutation; three-state styling. | `components/metrics/CoverageList.tsx`, `hooks/useCoverageRows.ts` | `<CoverageList>`, `useCoverageRows()` (unconfirmed count read by `aar-export/01`) |
| 03 Reach & sentiment dial overlay | SVG sentiment chart with dial/jump overlays; reach panel over the audience-magnitude model. | `components/metrics/SentimentChart.tsx`, `ReachPanel.tsx` | `<SentimentChart>`, `<ReachPanel>` |
| 04 Pre-E8 graceful degradation | One `engineEnabled` flag gates story 03's chart and `evaluator-tools/01`'s tile rows via a shared fallback card. | `components/metrics/EngineOffCard.tsx`, `hooks/useEngineEnabled.ts` | `<EngineOffCard>`, `useEngineEnabled()` |
| 05 Misinformation spread tree | Deferred — no implementation. | — | — |

## Reuse map
- COBRA theme + `@/theme/styledComponents` (staff surface) — `src/frontend/src/theme/`
- Shared axios client + React Query — `core/services/api.ts`, `@tanstack/react-query`
- FontAwesome icons — `@fortawesome/react-fontawesome`
- Telemetry emitter / read model (`XC-004` v0 schema) — via `evaluation-timeline`'s hooks, not
  re-read directly
- `evaluation-timeline`'s dial/jump-event data — the single source both this feature's sentiment
  chart (story 03) and the replay staff lane (`evaluation-timeline/03`) render from
- `exercise-configuration`'s engine-enabled flag (story 04)
- Scenario clock (COR-050/053) for chart axis labeling

## Wave Plan (DAG-ready)

| Story | Files it owns | Depends-on | Can-run-with | Wave | Effort |
|-------|----------------|------------|----------------|------|--------|
| 01 Response latency | `LatencyTable.tsx`, `useLatencyRows.ts`, `EvidenceLevelChip.tsx` | `evaluation-timeline` (event stream); CTL-026 source | 02 | 1 | M |
| 02 Coverage provisional-confirm | `CoverageList.tsx`, `useCoverageRows.ts` | `evaluation-timeline` | 01 | 1 | M |
| 03 Reach & sentiment dial overlay | `SentimentChart.tsx`, `ReachPanel.tsx` | `evaluation-timeline` (dial/jump data); story 01's `EvidenceLevelChip` | — | 2 | L |
| 04 Pre-E8 graceful degradation | `EngineOffCard.tsx`, `useEngineEnabled.ts` | story 03 (chart it replaces); `evaluator-tools/01` (tiles it replaces); `exercise-configuration` flag | — | 3 | S |
| 05 Misinformation spread tree | — | metrics-v2 design pass | — | out of wave (deferred) | — |

Story 04 lands last because it wraps stories that must already exist to be replaced; it is a thin,
cross-cutting story rather than a large build. Story 05 is excluded from the wave plan entirely —
it has no design decision to build against.
