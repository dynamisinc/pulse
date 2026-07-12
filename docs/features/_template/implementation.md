# Implementation: <feature name>

> The bridge between planning (`feature.md` + stories) and orchestration
> (`docs/FEATURE_ORCHESTRATION_PLAYBOOK.md`). Written when the feature is fully specified so it is
> orchestration-ready. A single-story feature keeps this minimal ("single wave").

## Per-story tech notes
<For each NN story: approach, key files it will own, and what it exports that other stories import
(the contract/seam). Note where the .NET backend is needed vs. mock-data-behind-axios for now.>

| Story | Approach | Key files | Exports (that others import) |
|-------|----------|-----------|------------------------------|
| 01 | | | |
| 02 | | | |

## Reuse map
<The existing modules each story must reuse instead of reinventing — keeps parallel builders
consistent and faithful to the two worlds + isolation. Fill in the ones this feature touches:>

- COBRA theme + `@/theme/styledComponents` (staff surfaces) — `src/frontend/src/theme/`
- Shared axios client — `src/frontend/src/core/services/api.ts` (base URL `VITE_API_URL`)
- Env validation — `src/frontend/src/core/utils/validateEnv.ts`
- FontAwesome registration — icons via `@fortawesome/react-fontawesome`
- React Query hooks pattern — `@tanstack/react-query`
- Exercise-context / query-scoping layer (E1) — <path when it exists>
- Telemetry emitter (`XC-004` v0 schema) — <path when it exists>
- SignalR feed/notification hook — <path when it exists>
- Brand-theme provider for participant skins — <path when it exists>

## Wave Plan (DAG-ready)
<Size stories by file-footprint disjointness so a wave fans out with no further analysis.
Foundation first: the exercise-context layer and the telemetry schema precede the surfaces that
consume them. A frontend→backend contract edge is serial (the contract is the seam; no codegen).>

| Story | Files it owns | Depends-on | Can-run-with | Wave | Effort |
|-------|---------------|------------|--------------|------|--------|
| 01 | | | | 1 | |
| 02 | | | | 2 | |
