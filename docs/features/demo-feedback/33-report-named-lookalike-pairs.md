# Story: Exercise report: controller-named lookalike pairs

**Feature:** Demo feedback cut (10/20)  ·  **Phase:** 1 (post-demo)  ·  **Status:** Not Started · backlog
**Requirements:** EVL-030 (lite), SOC-052  ·  **Decisions:** none yet  ·  **Issue:** #588
**Stack:** backend + frontend  ·  **Review:** Tier-1  ·  **Priority:** Could  ·  **Effort:** M

## Context

The report pairs a verified persona with an unverified lookalike by handle prefix (story 29, rules in story 32,
DF-48). An impersonator whose handle does not start with the real one (`@KestrelEM_Official` against
`@KestrelCoEM`, or a display-name-only lookalike) is never paired, so the section misses exactly the accounts a
scenario designer built to fool participants. Split out of story 32 by Tom (10/16): it needs a schema change and a
staff configuration UI, which story 32 (effort S) did not.

## Acceptance Criteria (draft, settle before build)

- [ ] A controller can name lookalike pairs for the exercise (verified persona → lookalike persona), in the
      exercise's persona or report configuration. Exercise-scoped (`IExerciseScoped`), so a pair never crosses
      exercises.
- [ ] When the exercise has at least one named pair, the report uses the named pairs and **only** them; otherwise the
      handle-prefix heuristic applies as today. Decide before build whether named pairs replace or extend it.
- [ ] Named pairs follow the story 32 rules: both sides posted in the window, post counts, the DF-48 verdict rule,
      the minimum bar range.
- [ ] A named pair whose persona is deleted or no longer verified is skipped with no error.
- [ ] Isolation (cross-exercise read and write refused), telemetry for create/delete, NFR-001 as in story 29.

## Out of Scope

Detecting impersonation automatically by avatar or display-name similarity; scoring participants on it.

## Dependencies

Story 32 (DF-48 rules).

## Tests

Backend: named pairs override the heuristic; a pair from another exercise is invisible and cannot be written; a
deleted persona is skipped. Frontend: the configuration UI adds and removes a pair; the report shows a named pair
that shares no prefix.
