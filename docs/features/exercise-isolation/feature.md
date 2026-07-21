# Feature: Exercise isolation

**Epic:** E1 — Platform Core & Exercise Isolation  ·  **Phase:** 1  ·  **Feature ref:** F1.1
**World:** platform/foundation  ·  **Issue:** #38

## Summary
The platform's worst-possible failure is a participant seeing another exercise's content — this
feature makes that impossible. Every content and social-graph entity is exercise-scoped, enforced
centrally; per-exercise hostnames scope the session; and a standing test suite attacks isolation on
every participant-facing path. Everything else in Pulse builds on the guarantees here.

## Requirements covered
COR-001, COR-002, COR-003, COR-004, COR-005, COR-006, COR-007, COR-008, COR-009 (with the
cross-cutting XC-001/002 and NFR-004 stored-XSS surface).

## Design references
`docs/design/D0-FOUNDATIONS.md` (the two worlds; participant-visible surfaces never expose exercise
selection). COR-005's conduct-time behavior is amended by D5-012(g) (static identity badge during
conduct) — see `docs/features/console-shell/03-static-identity-badge.md`.

## Stories
| # | Story | Requirement(s) | Status | Issue |
|---|-------|----------------|--------|-------|
| 01 | Every entity is exercise-scoped (central query filter) | COR-001 | Not Started | #44 |
| 02 | Scoped surfaces & non-guessable media URLs | COR-002 | Not Started | #45 |
| 03 | Same persona template, independent instances per exercise | COR-003 | Not Started | #46 |
| 04 | Participants have no exercise-selection concept | COR-004 | Not Started | #47 |
| 05 | Staff cross-exercise switcher (staff-only) | COR-005 | Not Started | #48 |
| 06 | Archived exercises fully separable | COR-006 | Not Started | #49 |
| 07 | Standing cross-exercise isolation test suite | COR-007 | Not Started | #50 |
| 08 | Per-exercise hostname (subdomain) | COR-008 | Complete | #51 |
| 09 | Network readiness (self-test, allowlist, GFE guidance) | COR-009 | Not Started | #52 |
| 10 | Mock ExerciseContext provider (Wave-0 frontend seam) | COR-001, COR-004 | Complete | #211 |
| 11 | Organization tenant boundary (customer scoping above the exercise) | COR-001, COR-010 | Deferred (multi-customer go-live gate) | — |

## Dependencies
The Exercise / Organization entities and the exercise-context resolution (which exercise a session
belongs to). Blocks every channel epic (E2–E6), E7, E8. **`backend-host`** (Phase B0,
`docs/BACKEND_ROADMAP.md` §4): story 01's EF Core global query filter **extends** the `PulseDbContext`
that `backend-host/02-persistence-efcore` stands up (both merged). The frontend consumes a scoped API.

**Phase B2 backend build (`docs/BACKEND_ROADMAP.md` §4) — the scope-resolution seam.** Story **08** now
carries the B2 backend build (`fullstack`, **Tier-2**): the host → exercise resolution middleware
(`UseExerciseResolution()`) that **sets the B0 `ExerciseContext.CurrentExerciseId` seam** for anonymous /
pre-auth participant requests, plus the frozen `GET /exercise-context` resolver (it flips
`USE_MOCK_EXERCISE_CONTEXT` live). It **owns the population-precedence model** (authenticated session >
host resolution > unset), reconciled with identity-auth-roles/03 (session) and /05 (staff active-exercise)
— the same one `ExerciseContext.CurrentExerciseId` seam, three populators. Endpoint ownership is clean:
**`/exercise-context` is story 08's; `/session` is identity-auth-roles/03's.** Stories **04** (participant
landing route guard) and **05** (staff switcher) become `frontend` **make-real** stories that build on the
now-live session/exercise/`StaffAssignment` seams. Story 01 (central filter), 10 (mock provider) are
Complete; 02/03/06/07/09 keep their prior scope.

## Design notes
This is the hard dependency under the whole platform (XC-001). Isolation is enforced **centrally**
(a query filter/interceptor), never per-endpoint, so new endpoints inherit it. Media URLs are
non-guessable and access-checked. Participant sessions never expose exercise selection, simulation
status, or admin (XC-002). The standing test suite (COR-007) grows as endpoints are added and
includes stored-XSS attempts (NFR-004).

A Wave-0 mock `ExerciseContextProvider` (story 10) seeds the frontend contract ahead of the real
host-resolution + query-filter wiring (stories 01/04/08), so the parallel Wave-0 foundation work
(`exercise-clock/04` scenario-time, `telemetry/01`) has a stable, single-exercise scope shape to build
against from day one. Story 10 is deliberately code-decoupled from those two seams — it does not
import the clock or the telemetry emitter, and they do not import it; wiring happens later, in
consumers.

**Two-tier tenancy — a resolved decision, deferred to a pre-multi-customer wave (story 11).** The design nests isolation as **Organization** (customer
tenant — "mirrors Cadence's org concept", `docs/01-platform-core-isolation.md`) → owns many **Exercises** (the
built, participant-facing scope, COR-001). Only the exercise tier is built; the `Organization` entity is
designed-but-deferred (Option B — built in a wave gated on multi-customer go-live), so Pulse is multi-tenant on the exercise axis only today. Story **11**
records that gap and its two consequences (staff/planner access not customer-scoped; `PersonaTemplate`/cast
globally shared vs. the design's org-owned → a latent cross-customer leak). **Decision: deferred (Option B)**
— the `Organization` tier is built in a dedicated wave gated on multi-customer go-live (a hard blocker), with
single-customer the explicit operating assumption until then. This is distinct from the *in-fiction*
org-account (COR-018,
`identity-auth-roles/09`).
