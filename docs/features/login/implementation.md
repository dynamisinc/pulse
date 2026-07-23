# Implementation: Login & UAT go-live

> This feature is a **consumer** of the Complete `identity-auth-roles` backend (stories 02/03/05/06/07)
> and `exercise-isolation/08` — it builds the frontend that was never built, plus one new, narrowly-scoped
> backend seam (story 05) that neither of those Complete stories anticipated (the empty-database
> bootstrap problem). No story here edits an existing, reviewed `Pulse.WebApi` identity file.

## Per-story tech notes

| Story | Approach | Key files (owns) | Exports / seams (that others import) |
|-------|----------|-------------------|----------------------------------------|
| 01 Frontend session & token wiring | Token store + axios interceptor + one-shot silent refresh + redirect-on-fail-closed. | `core/auth/tokenStore.ts` (new), `core/services/api.ts` (edit — interceptors), `core/auth/session.tsx` (edit — `Navigate` on failure), `core/auth/logout.ts` (new, small — the shared `logout()` helper story 04 wires into both headers) | `tokenStore.{getAccessToken,getRefreshToken,setTokens,clearTokens}`; the axios client's now-live `Authorization` attach + refresh behavior (transparent to every existing consumer of `api`); `logout()` |
| 02 Participant sign-in | A page hosting both `/api/auth/login` and `/api/auth/shared`, tabbed. | `features/login/pages/ParticipantSignInPage.tsx`, `features/login/services/participantSignInService.ts` | `ParticipantSignInPage` (mounted by story 04 at `LOGIN_PATH`) |
| 03 Staff sign-in | A COBRA page deriving `exerciseId` from host-resolved `/exercise-context`, posting to `/api/auth/staff/login`. | `features/login/pages/StaffSignInPage.tsx`, `features/login/services/staffSignInService.ts` | `StaffSignInPage` (mounted by story 04 at `/staff/login`) |
| 04 Wire routes + logout | Route-table edit (delete `SignInFallback`, mount 02/03) + a logout control in each world. | `features/app-shell/routes.tsx`, `constants.ts` (edits); `features/staffShell/components/StaffHeader.tsx` (edit — logout control); participant shell header (edit — logout control) | The live `/login` + `/staff/login` routes; nothing new exported (pure integration) |
| 05 UAT bootstrap seam | A secret-gated, idempotent seed endpoint creating `Exercise`/`StaffAssignment`/`Account`/`SharedCredential` rows directly. | `src/Pulse.WebApi/Features/Ops/Bootstrap/` (`BootstrapEndpoints.cs`, `BootstrapOptions.cs`, `BootstrapService.cs`) | `POST /api/ops/bootstrap-exercise`; `AddOpsBootstrap()` / `MapBootstrapEndpoints()` |
| 06 UAT go-live config & runbook | bicep param threading (mirrors `jwtSecretKey`) + a written, human-executed runbook. | `infrastructure/modules/webapp.bicep`, `infrastructure/main.bicep` (edits); `.github/workflows/deploy-infrastructure.yml` (edit — new secrets) | The deployed UAT app settings; no code seam (an ops runbook, not an API) |

## Reuse map

- **Complete backend contracts (consume, never rebuild):**
  - `POST /api/auth/login` — `identity-auth-roles/02`. `POST /api/auth/staff/login`,
    `GET /api/staff/assignments`, `POST /api/staff/active-exercise` — `/05`. `GET /api/session`,
    `POST /api/auth/refresh`, `POST /api/auth/logout` — `/03`. `POST /api/auth/shared` — `/06`. All three
    login endpoints return the **same** `{ token, refreshToken?, session }` envelope
    (`ParticipantLoginResponseDto` / `StaffLoginResponseDto` / `SharedReadOnlyLoginResponseDto` all mirror
    each other field-for-field) — stories 02/03 must consume that one shape, not invent per-page variants.
  - `GET /api/exercise-context` — `exercise-isolation/08`, already safely callable pre-auth (host-resolved,
    no session required). Stories 02/03 both call it for their own benign `ExerciseContextProvider`
    re-resolve.
- **Frontend seams already frozen (extend, do not fork):** `core/auth/sessionResolver.ts` (`Session` type
  + `USE_MOCK_SESSION`, unchanged by this feature); `core/auth/session.tsx`
  (`SessionProvider`/`useSession()`, story 01 edits its failure branch only); `core/exerciseContext/*`
  (`ExerciseContextProvider`/`useExerciseContext()`, unchanged, reused per-page by 02/03);
  `core/services/api.ts` (the one shared axios client every request in the app already goes through —
  story 01's interceptors apply to all of them, transparently); `core/config/mockData.ts`'s
  `USE_MOCK_DATA` (the single flip point story 06's runbook actually flips for UAT).
- **COBRA (staff world only):** `@/theme/cobraTheme`, `@/theme/styledComponents`
  (`CobraTextField`, `CobraPrimaryButton`) — story 03 and story 04's `StaffHeader` logout control.
- **Backend service reuse (story 05 must call, not reimplement):** `AccountProvisioningService`'s
  sanitization path (`identity-auth-roles/02`), `ISharedCredentialHasher` +
  `SharedCredentialPasswordGenerator` (`/06`/`/07`), `DynamisIdentityProviderOptions` (`/05`) to resolve a
  named allowlist entry's external subject.
- **Existing secret-threading precedent (story 06 must mirror, not invent a new pattern):**
  `jwtSecretKey` in `webapp.bicep`/`main.bicep` (`@secure()` param, empty default, sourced from the
  `JWT_SECRET_KEY` GitHub Actions secret in `deploy-infrastructure.yml`).
- **FontAwesome icons** (`@fortawesome/react-fontawesome`) for both login pages' and both logout
  controls' icons — never `@mui/icons-material`.

## Wave Plan (DAG-ready)

| Story | Stack | Files it owns | Depends-on | Can-run-with | Wave | Effort |
|-------|-------|----------------|------------|---------------|------|--------|
| 01 Frontend session & token wiring | frontend | `core/auth/tokenStore.ts`, `core/auth/logout.ts`, `core/services/api.ts` (edit), `core/auth/session.tsx` (edit) | `identity-auth-roles/03` (Complete) | 05 (disjoint stack/files) | 1 | M |
| 05 UAT bootstrap seam | backend | `src/Pulse.WebApi/Features/Ops/Bootstrap/*` | `identity-auth-roles/02/05/06/07` (Complete) | 01 (disjoint stack/files) | 1 | L |
| 02 Participant sign-in | frontend | `features/login/pages/ParticipantSignInPage.tsx`, `features/login/services/participantSignInService.ts` | 01 (`tokenStore`) | 03 (disjoint files) | 2 | M |
| 03 Staff sign-in | frontend | `features/login/pages/StaffSignInPage.tsx`, `features/login/services/staffSignInService.ts` | 01 (`tokenStore`) | 02 (disjoint files) | 2 | M |
| 04 Wire routes + logout | frontend | `features/app-shell/routes.tsx`, `constants.ts`, `staffShell/components/StaffHeader.tsx`, participant shell header (edits) | 01, 02, 03 (mounts their exports) | — | 3 | S |
| 06 UAT go-live config & runbook | infra/ops | `infrastructure/modules/webapp.bicep`, `main.bicep`, `.github/workflows/deploy-infrastructure.yml` (edits); the runbook itself | 04 (frontend must work before flipping the flag), 05 (the endpoint the runbook calls) | — | 4 | M (code) + human-gated execution |

File-disjointness within a wave: Wave 1's two stories touch entirely different repos-within-the-repo
(`src/frontend/src/core/*` vs `src/Pulse.WebApi/Features/Ops/*`) — zero overlap. Wave 2's two stories each
own a distinct page + service pair under `features/login/` — zero overlap. Wave 3 is a single, small,
serial integration story (multiple small edits across two worlds' headers) — not parallelized further
because it is inherently one coherent routing change. Wave 4 is explicitly **not** a normal build wave:
its code portion is small, but its completion gate is a human running the runbook against a real Azure
deployment (see story 06 Technical Notes) — do not schedule it inside an unattended fan-out.

### Integration seam (orchestrator-owned — never a wave story)

| Seam | File(s) | Rule |
|------|---------|------|
| Backend composition root | `src/Pulse.WebApi/Program.cs` | Story 05 exports its own `AddOpsBootstrap()`/`MapBootstrapEndpoints()`; the orchestrator wires the one-line calls, same pattern as every other B2 slice. No new middleware ordering constraint (the bootstrap endpoint needs no exercise-scope/session middleware — its own header secret is the only gate). |
| Frontend composition root | `src/frontend/src/App.tsx` | This feature's route changes live inside `features/app-shell/routes.tsx`'s exported route table (already the orchestrator-owned splice point per `app-shell/implementation.md`) — no story here edits `App.tsx` directly. |
