# Implementation: Notifications

> Participant-world center with aggregation under load + the SOC-072 alert path (pilot-mode alert
> delivery). Backend not present — notification stream is the contract seam.

## Per-story tech notes

| Story | Approach | Key files (owns) | Exports |
|-------|----------|------------------|---------|
| 01 Center & badge | Typed notification list + bell badge. | `features/social/pages/Notifications.tsx`, `hooks/useNotifications.ts` | `useNotifications()` |
| 02 Aggregation | Bucket by (type,target) under load; aria-live. | `features/social/services/notifAggregate.ts` | `aggregate()` |
| 03 Platform alerts | High-priority alert class from E7 flag. | (extends useNotifications) | alert delivery |

## Reuse map
- Notification sources: posts/threads/amplification/reactions/profiles/DMs; scenario-time (COR-053); telemetry (XC-004)
- Burst strategy shared with the feed "new posts" pill (feeds-discovery) — aria-live=polite (NFR-001)
- E7 CTL-021 flag-as-alert; E3 PRT-010 (Phase 3 successor); observer flag (D1-011)

## Wave Plan (DAG-ready)

| Story | Files it owns | Depends-on | Can-run-with | Wave | Effort |
|-------|---------------|------------|--------------|------|--------|
| 01 Center & badge | Notifications, useNotifications | sources; scenario-time | — | 1 | M |
| 02 Aggregation | notifAggregate | 01; NFR-002 | 03 | 2 | M |
| 03 Platform alerts | alert delivery | 01; E7 CTL-021 | 02 | 2 | S |
