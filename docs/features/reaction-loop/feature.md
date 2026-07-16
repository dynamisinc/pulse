# Feature: Reaction loop

**Epic:** E8 — Adaptive Content Engine  ·  **Phase:** 2 (v1)  ·  **Feature ref:** F8.1 (orchestration)
**World:** staff / backend  ·  **Issue:** #130

## Summary
The scenario-time-driven orchestration that turns storyline state into published public reaction:
**observe** (participant actions + inaction timers + world events + dial target) → **decide** (a
generation intent from storyline rules + curve + rate caps + autonomy) → **generate** (via the
generation infra + voice engine) → **review** (per autonomy level, into the E7 cockpit) →
**publish** (through the E2 pipeline as a persona-authored post) → **measure** (telemetry + storyline
update). It is a scheduler, not a synchronous request/response service — nothing here is on a
participant's hot path.

## Requirements covered
The F8.1 reactive-behavior orchestration (the loop that the specific behaviors — silence-escalation,
response-reaction, amplification, ambient-chatter — plug into). Consumes ADP-040 (review queue),
XC-004 (telemetry), COR-050/051 (scenario time).

## Design references
`docs/design/E8-ENGINE-ARCHITECTURE.md` §1.2 (the reaction loop) and §2 (system shape). The review
target is engine-review-cockpit (#34–36); the publish target is the E2 posts pipeline.

## Stories
| # | Story | Requirement(s) | Status | Issue |
|---|-------|----------------|--------|-------|
| 01 | Observe stage — triggers + inaction timers (scenario time) | F8.1 / COR-050 | Not Started | #157 |
| 02 | Decide stage — generation intent | F8.1 / ADP-010/011 | Not Started | #158 |
| 03 | Generate → review → publish wiring | F8.1 / ADP-040 | Not Started | #159 |
| 04 | Measure stage — telemetry + storyline update | ADP-041 / XC-004 | Not Started | #160 |

## Dependencies
`storyline-model` (state + curves + caps + target), `persona-voice-engine` (burst generation +
diversity gate), `engine-generation-infra` (provider + prompt + guard), E1 exercise clock (COR-050),
engine-review-cockpit (#34–36, the review target), E2 publish pipeline, engine-telemetry-tuning
(events). The reactive behaviors (silence-escalation, response-reaction, amplification-engine,
ambient-chatter) are the *decide-stage triggers* that drive this loop.

## Design notes
Staff/backend. The loop is **scenario-time-driven** (COR-050/051) — inaction timers and windows are
scenario minutes, and freeze (CTL-023) stops them. Output is never on a participant's synchronous
path (it lands in the review queue or a Delayed-auto countdown), which is what makes the latency
budget generous (architecture §4.3). Every published post goes through E2 as any post; origin is
captured but never participant-visible (SOC-003).
