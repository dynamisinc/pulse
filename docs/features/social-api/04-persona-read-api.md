# Story: Persona read API — GET /personas

**Feature:** Social API (backend)  ·  **Epic:** E2  ·  **Phase:** 1  ·  **Status:** Complete
**Requirements:** XC-005, COR-003 (COR-018, XC-002)  ·  **Design decisions:** none  ·  **Issue:** #273

## Context
`personaService.ts`'s `SEEDED_PERSONAS` is explicitly flagged as "MOCK SCAFFOLD — dev/test +
mock-fixture use ONLY… these exist for the mock adapter, unit tests, and other mock fixtures (e.g.
mock post authorship) only" (`personaService.ts:33-49`). This story replaces it as the production
author source: `GET /personas` serves the exercise-scoped persona **instances** that
`resolvePersonas()`/`usePersonas()` (`personaService.ts:96-146`) resolve against, so a real,
persisted post's `authorPersonaId` (from `01-feed-read-api`) resolves to a real row through
`assembleFeedView`'s `Map` lookup (`feedService.ts:144-151`) — "the feed has real authors" per
`BACKEND_ROADMAP.md`'s framing of this story.

This is deliberately narrow: it serves persona **instances** already seeded into the exercise,
however that seeding happened. It does **not** build persona template/cast authoring (COR-020/021,
`persona-management`, a different feature this story does not touch) or mid-exercise creation
(COR-022, `persona-operation/05`, Not Started) — those write paths are out of scope; this is the
read side only.

## Acceptance Criteria
- [x] **Exercise-scoped instance read (XC-005, COR-003).** Given a request whose resolved scope is
      exercise A, when the client calls `GET /personas`, then the response is exactly exercise A's
      seeded persona instances — never another concurrent exercise's instances of the same
      template (COR-003's "no collision" guarantee) — and every item satisfies `personaService.ts`'s
      `isValidPersona` guard (`id`, `displayName`, `handle`, `kind ∈ {human,org}`,
      `verified: boolean` present).
- [x] **Contract fidelity.** Given the mock→live flip (orchestrator-owned, not this story), when
      `USE_MOCK_DATA` is off, then `resolvePersonas()`/`usePersonas()` resolve against this
      endpoint with no change to either function's signature or the shipped `Persona` type
      (`personas/types.ts:84-101`).
- [x] **Real authorship end-to-end.** Given `01-feed-read-api`'s feed/thread responses reference
      `authorPersonaId`, when the client resolves an author via `assembleFeedView`'s persona `Map`
      lookup, then every persona referenced by a real, persisted post resolves to a row this
      endpoint serves — `SEEDED_PERSONAS` (`personaService.ts:45-49`) is no longer the production
      author source.
- [x] **Isolation.** Given exercise A and exercise B each have a persona instantiated from the same
      `PersonaTemplate`, when a request scoped to A calls `GET /personas`, then B's instance never
      appears in the response. Extend the standing isolation suite (`exercise-isolation/07`,
      COR-007); not separately Tier-2-tagged this pass — `01` and `03` carry this feature's Tier-2
      isolation sign-off.
- [x] **XC-002 — no new leak.** Given the backend schema may eventually carry staff-only operator/
      presence metadata on a persona row (CTL-004 multi-controller presence, `persona-operation/04`,
      Not Started), when `GET /personas` serves this exercise's cast, then the response contains
      only the fields already in the shipped `Persona` type — no operator/session/attribution field
      is ever added to this participant-facing payload; presence, if built, is a separate
      staff-only surface.

## Out of Scope
`PersonaTemplate` / org-library CRUD and `usePersonaTemplates()` (`persona-management`, a
different feature, not touched here — and itself explicitly "not a participant-surface read path"
per `personaService.ts:148-159`). Cast-bundle authoring/seeding actions (COR-020/021). Mid-exercise
persona creation (COR-022, `persona-operation/05`). Avatar upload (COR-024). Multi-controller
presence (CTL-004, `persona-operation/04`) — see the XC-002 AC above; this story only guards
against leaking it, it does not build it.

## Technical Notes
Backend/service work. Owns `Pulse.WebApi/Features/Social/{PersonaEndpoints.cs,
PersonaReadService.cs}`. Unlike `01`/`02`, this endpoint's response needs no role-conditional
branch: the `Persona` shape has no provenance fields to begin with, so both known consumers — the
participant feed's author resolution (`usePersonas()`) and the controller console's persona picker
(`persona-operation/02`'s `PersonaPicker`, which "reads the exercise cast via the shipped
`usePersonas()`" per `persona-operation/implementation.md`) — get the identical, unconditional
shape. Cross-reference implementation.md's Reuse map + Wave Plan.

## Dependencies
Phase B0 (`backend-host/01,02`; read filter `exercise-isolation/01` on `backend-host/02`'s **[Tier-2]** write guard). No dependency on
`01`/`02`/`03` — file-disjoint and independently shippable within Wave 1.

## Tests
xUnit covering: exercise-scoped persona set (including the same-template-two-exercises
no-collision case, extending the standing isolation suite); response shape against
`isValidPersona`; confirmation that no field beyond the shipped `Persona` interface is present in
the payload.
