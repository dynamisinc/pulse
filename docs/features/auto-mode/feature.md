# Feature: Auto mode

**Epic:** E8 — Adaptive Content Engine  ·  **Phase:** 2 (**v1.1** fast-follow)  ·  **Feature ref:** F8.5 / §2.3
**World:** staff  ·  **Issue:** #140
**Status:** feature.md stub — v1.1 fast-follow; decompose when it lands.

## Summary
The bounded **Auto** autonomy level: the engine publishes within configured bounds (rate caps,
persona set, intensity ceiling) with no per-item human gate; everything remains retractable and
logged. It is fast-follow — not v1 — because Auto leans entirely on the automated guard, so it ships
only after the v1 guard + eval harness are proven.

## Requirements covered
The Auto autonomy level (epic §2.3), ADP-041 (retractable + logged). *(v1.1)*

## Design references
Epic §2.3 (autonomy levels). `docs/design/E8-ENGINE-ARCHITECTURE.md` §8.1 (Auto is v1.1), §15 (why
Auto is deferred: it has no human gate). D5-014/1.1 spirit (automation never self-escalates).

## Stories (planned — v1.1; do not build until it lands)
| # | Story | Requirement(s) | Status | Issue |
|---|-------|----------------|--------|-------|
| 01 | Auto autonomy level within rate/persona/ceiling bounds | epic §2.3 | Not Started | — |
| 02 | Retractability + full logging of auto-published content | ADP-041 | Not Started | — |

## Dependencies
`autonomy-safety` (v1 — the Suggest/Delayed levels this extends; the self-escalation invariant),
`engine-eval-harness` (v1 — Auto ships only once the guard + injection red-team + scenario suite are
proven), `engine-generation-infra` (v1 — the guard Auto relies on), engine-review-cockpit (#34–36),
takedown (#28, retraction).

## Design notes
Staff. **Safety invariant:** automation **never self-escalates to Auto** — a human sets it
(D5-014/1.1 spirit). Auto publishes within bounds (rate caps ADP-011, persona set, intensity
ceiling); everything is retractable (via takedown #28) and logged (ADP-041). Deferred to v1.1
deliberately (architecture §15): Auto removes the human gate that Suggest/Delayed-auto provide, so it
is gated behind a proven v1 guard + eval harness rather than shipped on trust. Kill switch + degraded
mode still drop Auto to Suggest instantly.
