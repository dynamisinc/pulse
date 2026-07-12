# Implementation: Threads & replies

> Participant-world flattened thread built on `<PostCard>`. Backend not present — thread fetch is the
> contract seam; mock now.

## Per-story tech notes

| Story | Approach | Key files (owns) | Exports |
|-------|----------|------------------|---------|
| 01 Flattened view | Ancestry→focused→replies render; tombstone in-thread. | `features/social/components/ThreadView.tsx`, `hooks/useThread.ts` | `<ThreadView>`, `useThread()` |
| 02 Reply counts/open | Count on PostCard + thread navigation. | (extends PostCard action row) | — |
| 03 Both-direction replies | Render replies of any author type; provenance hidden. | (reuses ThreadView + Composer) | — |

## Reuse map
- `<PostCard>`, `<Tombstone>`, `<Composer>` (posts) — reused, not reforked
- Scenario-time utility (COR-053); telemetry/provenance (posts/03)
- Pulse participant skin (not COBRA)

## Wave Plan (DAG-ready)

| Story | Files it owns | Depends-on | Can-run-with | Wave | Effort |
|-------|---------------|------------|--------------|------|--------|
| 01 Flattened view | ThreadView, useThread | posts (PostCard, Tombstone) | 02 | 1 | M |
| 02 Reply counts/open | PostCard action-row count | posts/02; 01 | 01 | 1 | S |
| 03 Both-direction replies | ThreadView + Composer wiring | 01; posts composer | — | 2 | S |
