# Implementation: Exercise isolation

> The platform foundation. Mostly backend/infra (the .NET backend does not exist yet — this feature
> largely *defines* it). The frontend consumes a scoped API and must never construct cross-exercise
> requests. Mirrors Cadence's multi-tenant filtering.

## Per-story tech notes

| Story | Approach | Key files (owns) | Exports (that others import) |
|-------|----------|------------------|------------------------------|
| 01 Central scoping | `ExerciseId` on entities + a global query filter/interceptor; fail-closed. | (backend) query-filter layer; exercise-context resolver | scoped `DbContext` / repository contract |
| 02 Scoped surfaces + media | Access-checked, opaque media URLs; scoping on derived surfaces. | (backend) media serving + URL signing | media URL helper |
| 03 Multi-instance personas | Template↔instance split with per-instance exercise-scoped state. | (backend) Persona/PersonaTemplate model | Persona instance contract |
| 04 No exercise selection | Host-resolved exercise context; participant router with no picker. | `src/frontend/src/core/exerciseContext.ts`, participant route guard | `useExerciseContext()` |
| 05 Staff switcher | Staff-only active-exercise selector driving scope. | `features/staff/components/ExerciseSwitcher.tsx` | `useActiveExercise()` |
| 06 Archived separation | Lifecycle-status exclusion from live queries + export set. | (backend) archive filter | — |
| 07 Isolation suite | Cross-exercise + stored-XSS attempts on each participant endpoint. | `src/frontend/src/**/*.isolation.test.ts` (+ backend suite) | the standing suite |
| 08 Hostname | Host→exercise mapping; automated cert/DNS. | (infra) provisioning; host resolver | host→exercise map |
| 09 Network readiness | Self-test page + allowlist doc. | `features/connectivity/pages/SelfTest.tsx` | — |

## Reuse map
- Shared axios client — `core/services/api.ts` (all scoped calls go through it)
- Exercise-context resolver (story 01/04) — **consumed by every participant-facing feature**
- COBRA theme (staff switcher, story 05) — `@/theme/styledComponents`
- `testing-agent` isolation suite conventions (story 07) — the cross-exercise guardrail
- Cadence multi-tenant query-filter pattern — reuse the proven approach

## Wave Plan (DAG-ready)

| Story | Files it owns | Depends-on | Can-run-with | Wave | Effort |
|-------|---------------|------------|--------------|------|--------|
| 01 Central scoping | query-filter, exercise-context | Exercise entity | 03 | 1 | L |
| 03 Multi-instance personas | Persona model | Exercise entity | 01 | 1 | M |
| 02 Scoped surfaces + media | media serving/URL | 01 | 08 | 2 | M |
| 08 Hostname | host resolver, infra | 01 | 02 | 2 | L |
| 04 No exercise selection | exerciseContext, route guard | 01, 08 | 05 | 3 | M |
| 05 Staff switcher | ExerciseSwitcher | 01 | 04 | 3 | S |
| 06 Archived separation | archive filter | 01; lifecycle | 07 | 3 | S |
| 07 Isolation suite | isolation tests | 01, 02 | 06 | 3 | M |
| 09 Network readiness | SelfTest page | 08; transports | — | 4 | S |

Story 01 is the deepest foundation in the whole product — it precedes essentially everything.
