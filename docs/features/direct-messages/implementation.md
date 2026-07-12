# Implementation: Direct messages

> Participant-world two-pane DMs; observable by staff (SOC-062). Backend not present — DM send/fetch is
> the contract seam; mock now.

## Per-story tech notes

| Story | Approach | Key files (owns) | Exports |
|-------|----------|------------------|---------|
| 01 1:1 DMs | Two-pane list + chat; sanitized send. | `features/social/pages/Messages.tsx`, `hooks/useDMs.ts` | `useDMs()` |
| 02 Use cases | Scenario patterns over the same infra. | (reuses useDMs) | — |
| 03 Observability | Staff-surface DM read + telemetry. | (backend) DM telemetry | — |

## Reuse map
- org identity/attribution (posts/06, COR-018); scenario-time (COR-053); sanitization (NFR-004); telemetry (XC-004)
- E7 monitoring (CTL-030) + E10 consume DM events; observer flag (D1-011) hides composer

## Wave Plan (DAG-ready)

| Story | Files it owns | Depends-on | Can-run-with | Wave | Effort |
|-------|---------------|------------|--------------|------|--------|
| 01 1:1 DMs | Messages, useDMs | E1 session/COR-018; sanitization | — | 1 | M |
| 02 Use cases | (reuses 01) | 01; E7/E8 | 03 | 2 | S |
| 03 Observability | DM telemetry | 01; E7 monitoring; NFR-007 | 02 | 2 | S |
