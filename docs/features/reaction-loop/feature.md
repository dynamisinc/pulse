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
| 01 | Observe stage — triggers + inaction timers (scenario time) | F8.1 / COR-050 | Complete | #157 |
| 02 | Decide stage — generation intent | F8.1 / ADP-010/011 | Complete | #158 |
| 03 | Generate → review → publish wiring | F8.1 / ADP-040 | Unblocked → built as `engine-runtime/01` | #159 |
| 04 | Measure stage — telemetry + storyline update | ADP-041 / XC-004 | Unblocked → built as `engine-runtime/01` | #160 |

**Partially delivered; back-half now rehomed.** The pure front stages **observe (#157)** and **decide
(#158)** plus the decide-stage behavior registry ship as `Pulse.Core/Features/ReactionLoop/*` (see its
`README.md`) — pure backend, no E2/E7 dependency. `ObserveStage` raises scenario-time inaction triggers
+ addressing candidates; `IntentComposer` + `DecideStage` compose the `GenerationIntent` from
curve/caps/target + autonomy + eligible cast, and expose the `IReactionBehavior` registry the reactive
behaviors plug into. Stories **03/04's blockers are retired at the docs level**: B1 (`social-api`)
shipped the E2 publish pipeline (`PostIngestService.IngestAsync` + `IFeedBroadcaster`) and
`engine-review-cockpit` (#34–36) shipped the E7 review queue — both now exist. The **generate → publish
→ measure back-half these two stories describe is built as `docs/features/engine-runtime/01-reaction-loop-host.md`**
(Phase B3 of `BACKEND_ROADMAP.md`), which wires this feature's `ObserveStage`/`DecideStage` output into
the guard-filtered generate stage, B1's publish pipeline, and the measure stage — not a rewrite of this
feature's built front stages.

## Dependencies
`storyline-model` (state + curves + caps + target), `persona-voice-engine` (burst generation +
diversity gate), `engine-generation-infra` (provider + prompt + guard), E1 exercise clock (COR-050;
the loop-facing subset now delivered by `engine-runtime/03`), engine-review-cockpit (#34–36, the review
target — now served live by `engine-runtime/02`), **the E2 publish pipeline (delivered — B1's
`PostIngestService`/`IFeedBroadcaster`, `social-api`)**, engine-telemetry-tuning (events). The reactive
behaviors (silence-escalation, response-reaction, amplification-engine, ambient-chatter) are the
*decide-stage triggers* that drive this loop. **The back-half wiring (stories 03/04) is now built in
`engine-runtime/01`** — this feature's Dependencies on the E2 pipeline and the E7 cockpit are satisfied.

## Design notes
Staff/backend. The loop is **scenario-time-driven** (COR-050/051) — inaction timers and windows are
scenario minutes, and freeze (CTL-023) stops them. Output is never on a participant's synchronous
path (it lands in the review queue or a Delayed-auto countdown), which is what makes the latency
budget generous (architecture §4.3). Every published post goes through E2 as any post; origin is
captured but never participant-visible (SOC-003).
