# Story: Exercise report: controller-named lookalike pairs

**Feature:** Demo feedback cut (10/20)  ·  **Phase:** 1 (post-demo)  ·  **Status:** In Progress
**Requirements:** EVL-030 (lite), SOC-052  ·  **Decisions:** DF-49  ·  **Issue:** #588
**Stack:** backend + frontend  ·  **Review:** Tier-1  ·  **Priority:** Could  ·  **Effort:** M

## Context

The report pairs a verified persona with an unverified lookalike by handle prefix (story 29, rules in story 32,
DF-48). An impersonator whose handle does not start with the real one (`@KestrelEM_Official` against
`@KestrelCoEM`, or a display-name-only lookalike) is never paired, so the section misses exactly the accounts a
scenario designer built to fool participants. Split out of story 32 by Tom (10/16): it needs a schema change and a
staff configuration UI, which story 32 (effort S) did not.

## Decisions

- **DF-49 · A lookalike names what it imitates (Tom, 10/16).** An unverified persona can name the one verified persona
  it imitates (`Persona.ImitatesPersonaId`, a logical reference with no foreign key, scoped with the persona). It is
  set in the persona editor's **Imitates** select through the existing persona PATCH. Named pairs **extend** the
  handle-prefix heuristic: the report shows both, and when a lookalike has a named pair, the named pair replaces its
  heuristic one. Every pair follows story 32 (both sides in the window, post counts, DF-48 verdict, bar range). Each
  pair says in text whether it was named by a controller or found by handle match. There is no pair table and no
  new endpoint: one lookalike imitates one account, which is what the scenarios need.

## Acceptance Criteria

**Backend**

- [ ] `PATCH /api/staff/personas/{id}` accepts `imitatesPersonaId` (guid sets, `null` clears). It returns 400 when
      the target is the persona itself, does not resolve in this exercise (same message as unknown), or is not
      verified, or when the edited persona is verified after the patch. Gates, 404s and read-only denial unchanged.
- [ ] Staff persona reads carry `imitatesPersonaId`; participant persona reads never do (XC-002).
- [ ] Report: a named pair is (P, V) for an unverified P whose `imitatesPersonaId` names a verified V. A dangling
      or no-longer-verified target is skipped with no error. A named pair replaces any heuristic pair for the same
      lookalike; other heuristic pairs are kept.
- [ ] Named pairs follow story 32's rules (both sides posted in the window, `posts`, `outdrew`); `lookalikes[]`
      gains `named: boolean`.
- [ ] Isolation: a target from another exercise is refused, and the column is covered by the central filter and
      write guard (persona is already `IExerciseScoped`). One migration, nullable column only.

**Page**

- [ ] Persona editor: an **Imitates** select, shown only while the persona is unverified. Options are None plus the
      exercise's other verified personas ("Display name (@handle)"). It saves through the same patch, and server
      errors show inline. Turning Verified on hides it and clears it.
- [ ] Console telemetry: the existing `steering_action` `persona_edit` event lists `imitatesPersonaId` when it
      changes.
- [ ] Report: each pair shows "Named by a controller" or "Handle match" as text (NFR-001). A pair that shares no
      prefix appears when it is named.

## Out of Scope

Detecting impersonation automatically by avatar or display-name similarity; scoring participants on it.

## Dependencies

Story 32 (DF-48 rules).

## Tests

Backend: named pairs override the heuristic; a pair from another exercise is invisible and cannot be written; a
deleted persona is skipped. Frontend: the configuration UI adds and removes a pair; the report shows a named pair
that shares no prefix.
