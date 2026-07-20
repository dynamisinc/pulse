# Story: Voice consistency — dossier + prior-post conditioning

**Feature:** Persona voice engine  ·  **Epic:** E8  ·  **Phase:** 2 (v1)  ·  **Status:** Complete
**Requirements:** ADP-020  ·  **Design decisions:** none  ·  **Issue:** #148

> **Delivered:** `PersonaVoice/Services/VoiceProfileBuilder` — `RefreshStyle` (from post history, cold-start
> → seed), `SelectExemplars` (2–3 recent), `ToDossier` (projection carrying voice notes + style + exemplars
> + type guidance). Exercise-scoped (XC-001). Tests: `VoiceProfileBuilderTests`.

## Context
A persona must sound like the same person all exercise (ADP-020). Its generation context always
carries: the **dossier** (voice/personality notes COR-020, persona type, audience band), **style
params** (avg length, emoji rate, hashtag rate, caps convention) extracted from the dossier at seed
time and refreshed from real post history, and **2–3 of its own recent posts** as exemplars
(prior-post conditioning). Same persona → same dossier + its own history → stable voice.

## Acceptance Criteria
- [x] Given a persona, when the engine generates for it, then the prompt includes its voice notes,
      style params, and 2–3 of its own most recent posts as exemplars.
- [x] Given a persona with accumulating post history, when style params are computed, then they are
      refreshed from the persona's actual posts (not only the seed dossier), so the voice tracks how
      the persona has actually been writing this exercise.
- [x] Given repeated generations for one persona, when their output is compared, then it conforms to
      that persona's style params (emoji/length/caps/hashtag) within tolerance — a consistency check
      the acceptance metric (story 04) enforces.
- [x] Given a persona with sparse or no history, when it is generated for, then the dossier exemplars
      alone drive the voice (graceful cold start).
- [x] **LLM governance (NFR-005):** conditioning uses only the persona's own exercise-scoped content
      via the tenant-bounded provider; no cross-exercise history leaks (XC-001).

## Out of Scope
Cross-persona diversity (story 02); persona-type behavior (story 03); the metric itself (story 04);
authoring the voice notes (persona-management story 01); the prompt-assembly mechanics
(engine-generation-infra story 02 — this story specifies *what persona context* it must carry).

## Technical Notes
Staff/backend. Style-param extraction can be simple heuristics (emoji/hashtag/length/caps rates) over
the dossier + recent posts; the spike's `styleParams` fixture shows the shape. Feeds
engine-generation-infra's prompt assembly (story 02). See implementation.md (story 01) and
architecture §5.1.

## Dependencies
engine-generation-infra story 02 (prompt assembly); persona-management (dossier); E2 (persona post
history). Feeds story 04 (consistency check).

## Tests
- Unit: generation context for a persona includes dossier + style params + prior-post exemplars.
- Unit: style params refresh from post history; a persona with no history falls back to dossier
  exemplars without error.
