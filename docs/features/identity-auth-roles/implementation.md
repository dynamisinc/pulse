# Implementation: Identity, auth & roles

> Foundation spanning staff + participant worlds. The identity provider stays behind an interface
> (COR-014). Backend not present yet — auth/session/roles are backend contracts the frontend consumes.

## Per-story tech notes

| Story | Approach | Key files (owns) | Exports (that others import) |
|-------|----------|------------------|------------------------------|
| 01 Roles | Role enum + route/API guards aligned to Cadence ExerciseRole. | (backend) role model; `src/frontend/src/core/auth/roles.ts` | `useRole()`, role guards |
| 02 Named accounts | Provisioning (CSV import + planner-create); no self-signup. | `features/planner/components/AccountImport.tsx` (+ backend) | account provisioning API |
| 03 Sessions | Short-lived + refresh; exercise/account binding. | (backend) session; `core/auth/session.ts` | `useSession()` |
| 04 Evaluator read-only | Role-level write denial across sim actions. | (backend) authz policy | — |
| 05 Provider interface | Auth provider abstraction (Dynamis IdP now; Entra/SSO later). | (backend) `IIdentityProvider` | provider interface |
| 06 Shared read-only | Shared credential + ephemeral telemetry identity + All Posts landing. | (backend) shared-cred auth; `core/auth/readonly.ts` | read-only session |
| 07 Credential lifecycle | Rotation/revocation/lockout/per-IP limit. | (backend) credential lifecycle | — |
| 08 Participant admin | Staff console panel (reset/unlock/force-logout/reassign), audited. | `features/controller/components/ParticipantAdmin.tsx` | admin actions |
| 09 Org-account operation | Grant model + per-human attribution. | (backend) org-grant + attribution | `actingHumanId` attribution |

## Reuse map
- Exercise-context / scoping (exercise-isolation) — session binds the exercise scope
- Shared axios client — `core/services/api.ts`
- Telemetry emitter (XC-004) — attribution (09), admin audit (08), lifecycle log (07)
- COBRA theme (staff panels 08) — `@/theme/styledComponents`
- Cadence bulk-import UX (02) and ExerciseRole vocabulary (01) — reuse the proven patterns
- Consumed by: E2 SOC-006 (account switcher), E5 PRS-001, E7 (attribution, participant admin host)

## Wave Plan (DAG-ready)

| Story | Files it owns | Depends-on | Can-run-with | Wave | Effort |
|-------|---------------|------------|--------------|------|--------|
| 01 Roles | role model, guards | exercise-isolation | 05 | 1 | M |
| 03 Sessions | session | exercise-isolation | 01 | 1 | M |
| 05 Provider interface | IIdentityProvider | 03 | 01 | 1 | M |
| 02 Named accounts | AccountImport | 01, 03 | 04 | 2 | M |
| 04 Evaluator read-only | authz policy | 01 | 02 | 2 | S |
| 06 Shared read-only | readonly auth | 03; E2 feeds landing | 09 | 2 | M |
| 09 Org-account operation | org-grant, attribution | 01; telemetry | 06 | 2 | M |
| 07 Credential lifecycle | credential lifecycle | 06 | 08 | 3 | M |
| 08 Participant admin | ParticipantAdmin | 02, 03; console-shell | 07 | 3 | M |
