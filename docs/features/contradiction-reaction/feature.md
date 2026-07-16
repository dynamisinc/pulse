# Feature: Contradiction reaction

**Epic:** E8 — Adaptive Content Engine  ·  **Phase:** 2 (**v1.1** fast-follow)  ·  **Feature ref:** F8.1
**World:** staff / backend  ·  **Issue:** #139
**Status:** feature.md stub — v1.1 fast-follow; decompose when it lands.

## Summary
When controllers flag two official statements as conflicting, the engine generates confusion content
(side-by-side callouts, "which is it?" posts) and applies a trust penalty on the storyline. This is
the "the officials contradicted themselves" reaction — a distinct behavior from silence and matched
response.

## Requirements covered
ADP-003 (contradiction reaction). *(v1.1)*

## Design references
Epic F8.1 / ADP-003. `docs/design/E8-ENGINE-ARCHITECTURE.md` §14 (feature cut — v1.1). Builds on the
v1 reaction loop + storyline model + voice engine.

## Stories (planned — v1.1; do not build until it lands)
| # | Story | Requirement(s) | Status | Issue |
|---|-------|----------------|--------|-------|
| 01 | Controller-flagged contradiction → confusion content + trust penalty | ADP-003 | Not Started | — |

## Dependencies
`reaction-loop` (v1 — decide/generate), `storyline-model` (v1 — the trust/sentiment penalty),
`persona-voice-engine` (v1 — voiced confusion posts), the E7 console (controllers flag the two
conflicting statements). No new schema obligation on v1.

## Design notes
Staff/backend. Trigger is a **controller flag** of two conflicting official statements (not
auto-detected). Generates confusion content (side-by-side "which is it?" posts) and applies a trust
penalty (sentiment down, skepticism up) on the affected storyline. Deferred to v1.1 with the rest of
the misinformation-adjacent behaviors so v1 stabilizes the core reactive loop first.
