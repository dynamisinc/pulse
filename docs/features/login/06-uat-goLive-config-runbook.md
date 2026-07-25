# Story: UAT go-live config & runbook

**Feature:** Login & UAT go-live  ·  **Epic:** E1  ·  **Phase:** 1  ·  **Status:** Complete
**Requirements:** NFR-009  ·  **Design decisions:** none  ·  **Issue:** #309
**Stack:** infra/ops (bicep + GitHub Actions config; **not** buildable end-to-end by a coding agent alone
— see the human-action callouts below)
**Review:** Tier-2 (touches deployment secrets and the mock-data fail-open/closed guarantee)

> **Close-out status.** The **code portion** — the bicep param threading (`bootstrapSecret` +
> `staffIdentityAccountsJson` in `webapp.bicep`/`main.bicep`/`uat.bicepparam`) and the two new workflow
> secrets in `deploy-infrastructure.yml` — **has landed** (this Wave-4 PR). The **human-gated execution**
> in the *Operator runbook* below has now **also run**: a repo-admin set the two GitHub secrets, ran the
> bootstrap endpoint against UAT, and flipped `VITE_USE_MOCK_DATA=false` — the frontend has been redeployed
> and verified live off mock data. See "Runbook executed against UAT" below for the evidence and its one
> documented residual caveat. **No agent ran those steps** — the secret *values* were generated and stored
> by a human and never passed through an agent session (NFR-009).

## Context

Three concrete, already-confirmed gaps stood between "the code from stories 01–05 is merged" and "UAT
actually runs full-stack". This story retires them in the safe order (backend config → seed the database
via story 05's endpoint → frontend flip), mirroring the **already-established** secret-threading pattern
this repo uses for `jwtSecretKey` (a `@secure()` bicep param, defaulted empty, supplied via a GitHub
Actions secret referenced in `deploy-infrastructure.yml`, never committed).

1. **`ASPNETCORE_ENVIRONMENT` is `Production` in UAT.** *(Resolved as a no-op decision — see below.)*
2. **The staff allowlist is empty.** `Authentication:StaffIdentity:Accounts`
   (`DynamisIdentityProviderOptions`) was *"NOT one of the keys provisioned by
   `infrastructure/modules/*.bicep`"* — so every staff login failed closed (correctly, but unusably).
   **Now threaded** via the `staffIdentityAccountsJson` secure param.
3. **`VITE_USE_MOCK_DATA=true` in the UAT GitHub frontend environment** is why the SPA still runs on
   canned data. Flipping it is the **last** step, not the first — flipping it before 2 is done and the
   database is seeded just reproduces the "blank screen" bug this whole feature exists to fix.

### Decision: `ASPNETCORE_ENVIRONMENT` stays `Production` for UAT (no code change)

The original AC asked to thread a non-`Production` environment value. On investigation that concern does
**not** hold, so it is resolved as a **documented decision, not a change**:

- A repo-wide search of `src/Pulse.WebApi` finds **zero** uses of `IsDevelopment` / `IsProduction` /
  `IsStaging` / `IsEnvironment` / `EnvironmentName` / `Environments.*`. **No code path branches on the
  environment name**, so the bootstrap endpoint, staff login, and every other behavior are byte-identical
  regardless of what `ASPNETCORE_ENVIRONMENT` is set to.
- The bootstrap endpoint is gated **solely** by its secret (by design, per `BootstrapOptions`), never by
  environment — so `Production` does not "silently disable" anything the go-live needs.
- `Production` is the correct, safe posture for a pilot environment that faces real users (no developer
  exception pages / stack-trace leakage). Threading a per-environment value would add a knob with **no
  consumer**.

If a future story introduces environment-gated behavior (e.g. a dev-only diagnostics endpoint), thread
`aspnetcoreEnvironment` then — the `webapp.bicep` param already exists and defaults to `'Production'`.

## Acceptance Criteria

- [x] **`ASPNETCORE_ENVIRONMENT`** — resolved as a **documented decision** (above): UAT stays `Production`
      because no backend code path branches on the environment name, so a non-`Production` value would be
      a behavioral no-op. (The original AC's premise — that `Production` silently changes go-live
      behavior — does not hold.) **This is a deliberate deviation from issue #309's literal wording**
      (which asked for a non-`Production` value); flagged for **Tier-2 sign-off** and recorded as a comment
      on issue #309. If a reviewer wants the value threaded regardless, the `webapp.bicep`
      `aspnetcoreEnvironment` param already exists (defaults `'Production'`) — pass it from `main.bicep` +
      `uat.bicepparam` in a one-line follow-up.
- [x] **Staff allowlist threaded** — a new `@secure() param staffIdentityAccountsJson` in `webapp.bicep`
      + `main.bicep` (empty default, never committed), sourced from the `STAFF_IDENTITY_ACCOUNTS_JSON`
      GitHub secret. `webapp.bicep` expands the JSON array into the indexed
      `Authentication__StaffIdentity__Accounts__{i}__{Field}` app settings the .NET options binder reads.
      Empty/unset → no accounts emitted → fail closed.
- [x] **Bootstrap secret threaded** — a new `@secure() param bootstrapSecret` added the same way, sourced
      from the `BOOTSTRAP_SECRET` GitHub secret, surfaced as the `Authentication__Bootstrap__Secret` app
      setting. Empty/unset → the seed endpoint is disabled entirely (404, fail closed).
- [x] **`deploy-infrastructure.yml`** threads both new secrets (`BOOTSTRAP_SECRET`,
      `STAFF_IDENTITY_ACCOUNTS_JSON`) as `env:` into **both** the What-If and Deploy steps, mirroring the
      existing `JWT_SECRET_KEY` secret exactly (the `.bicepparam` reads them via
      `readEnvironmentVariable`).
- [x] **A written runbook** (the *Operator runbook* below) states the fresh-database order of operations.
- [x] **The runbook states the rollback** (setting `VITE_USE_MOCK_DATA` back to `true` + redeploy the
      frontend is the immediate kill-switch).
- [x] **Runbook executed against UAT.** Verified live on 2026-07-25 against
      `https://app-pulse-api-uat-dynamis.azurewebsites.net` and `https://pulse-uat.cobrasoftware.com`
      (credential **values** live only where step 1 put them — the `uat` GitHub environment secrets —
      never recorded here or in any other committed doc, NFR-009):
      - **Step 2** — `az webapp config appsettings list` on `rg-pulse-uat-centralus/app-pulse-api-uat-dynamis`
        confirms `Authentication__Bootstrap__Secret` and the indexed
        `Authentication__StaffIdentity__Accounts__0__{Username,Secret,ExternalSubject,DisplayName}` app
        settings all landed.
      - **Step 3** — `GET /health` returns `200`.
      - **Step 4** — `GET /api/exercise-context` returns `200` with
        `{"exerciseId":"a72df119-81f2-48e3-acf6-c5d07a7682eb","exerciseName":"Pulse UAT Pilot",
        "timeZone":"America/Chicago","status":"active"}` — the exercise is seeded under the **backend**
        host, exactly as the step's CRITICAL callout requires (not the frontend domain — see #322). The
        bootstrap gate itself still fails closed post-seed: `POST /api/ops/bootstrap-exercise` with no
        secret, or with a wrong secret, both return `404`.
      - **Step 5** — all three login endpoints are live and fail closed with anti-enumeration intact:
        participant, staff (against the real seeded `exerciseId`), and shared all return `401` on bogus
        credentials with empty bodies — notably **not** the `"exerciseId must be a non-empty GUID"` error
        that would indicate the host-mismatch failure mode the CRITICAL callout warns about.
        `GET /api/session` unauthenticated returns `401`.
      - **Step 6** — the `uat` GitHub environment has `VITE_USE_MOCK_DATA=false` and
        `VITE_API_URL=https://app-pulse-api-uat-dynamis.azurewebsites.net/api`. Live `/login` renders the
        participant sign-in surface with the heading **"Sign in to Pulse UAT Pilot"** — the exercise name
        resolved from the real backend, conclusive proof the SPA is off mock data — with the Account
        sign-in / Exercise code tabs and the "Staff or controller? Sign in here." link to `/staff/login`.
        Live `/staff/login` renders username + secret only (no exercise field), COBRA-themed, as story 03
        specifies.

      **Remaining caveat (not re-verified in this pass, and deliberately not verifiable without
      credential values passing through an agent session, NFR-009):** a successful `200` on the three
      login endpoints using the real seeded credentials; an idempotent re-POST of the bootstrap endpoint
      with the real secret; and the in-browser "a real login lands on the feed" / "a real staff login
      reaches the console" walkthrough. Those remain operator-executed, by design.

## As-built config reference

| Concern | bicep param (`@secure()`, default `''`) | GitHub secret (`uat` env) | Backend config it produces |
|---|---|---|---|
| JWT signing key *(precedent)* | `jwtSecretKey` | `JWT_SECRET_KEY` | `Authentication__Jwt__SecretKey` |
| Bootstrap seed secret | `bootstrapSecret` | `BOOTSTRAP_SECRET` | `Authentication__Bootstrap__Secret` |
| Staff allowlist | `staffIdentityAccountsJson` | `STAFF_IDENTITY_ACCOUNTS_JSON` | `Authentication__StaffIdentity__Accounts__{i}__{Username,Secret,ExternalSubject,DisplayName}` |

**`STAFF_IDENTITY_ACCOUNTS_JSON` shape** — a JSON **array**; each object's keys match `DynamisStaffAccount`
(PascalCase). Every field must be non-empty or that entry can never authenticate (fail closed):

```json
[
  {
    "Username": "controller1",
    "Secret": "<long-random-staff-secret>",
    "ExternalSubject": "uat-controller1",
    "DisplayName": "Exercise Controller"
  }
]
```

- `Username` — the login handle presented at `/api/auth/staff/login` (matched case-insensitively). This is
  also the `staff.username` the bootstrap call references.
- `Secret` — the staff login secret (compared in constant time, never logged/persisted).
- `ExternalSubject` — the stable external-IdP subject the `StaffUser` is provisioned from (any stable
  string for Phase 1, e.g. `uat-controller1`).
- `DisplayName` — staff-world display name.

`webapp.bicep` expands `[ {...}, {...} ]` at deploy time into
`Authentication__StaffIdentity__Accounts__0__Username`, `…__0__Secret`, `…__1__Username`, … — so a
variable-length allowlist is supported from the single secret. Empty/unset → an empty array → no account
settings emitted → the provider authenticates no one.

## Operator runbook (human-gated)

> **Prerequisites:** repo-admin (to set `uat` environment secrets/variables) and Contributor on the
> `rg-pulse-uat-centralus` resource group (Shared SandBox sub `2a127d53-c9bf-471a-8196-3155eae6cb1b`).
> Backend host: `https://app-pulse-api-uat-dynamis.azurewebsites.net`; frontend:
> `https://pulse-uat.cobrasoftware.com`. Do the steps **in order** — do not flip step 6 early.

**1 — Set the two new GitHub secrets on the `uat` environment.** Generate strong values (the bootstrap
secret should be long + random; each staff `Secret` likewise). Never commit them; never paste them into an
agent session.

```bash
# from a repo-admin shell (gh CLI), or via GitHub UI: Settings > Environments > uat > Secrets
gh secret set BOOTSTRAP_SECRET --env uat --body '<long-random-bootstrap-secret>'
gh secret set STAFF_IDENTITY_ACCOUNTS_JSON --env uat --body '[{"Username":"controller1","Secret":"<staff-secret>","ExternalSubject":"uat-controller1","DisplayName":"Exercise Controller"}]'
```

**2 — Deploy infrastructure** (surfaces the new app settings on the App Service). Run the **Deploy
Infrastructure** workflow (`workflow_dispatch`, environment `uat`). Optionally run once with
`what_if: true` first to preview — the what-if evaluates the JSON→indexed-settings expansion against
Azure. **If you run What-If, confirm the `Authentication__StaffIdentity__Accounts__*__Secret` and
`Authentication__Bootstrap__Secret` lines are redacted (`null` / `*****`) in the persisted step summary**
before relying on it — they derive from `@secure()` params so ARM should redact them exactly as it does
`jwtSecretKey`, but this is a Tier-2 secret-touching change worth eyeballing once. Then verify the app
settings actually landed:

```bash
az account set --subscription 2a127d53-c9bf-471a-8196-3155eae6cb1b
az webapp config appsettings list -g rg-pulse-uat-centralus -n app-pulse-api-uat-dynamis \
  --query "[?starts_with(name,'Authentication__Bootstrap') || starts_with(name,'Authentication__StaffIdentity')].name" -o tsv
# expect: Authentication__Bootstrap__Secret and one Authentication__StaffIdentity__Accounts__0__* set per account
```

**3 — Deploy the backend** via the existing **Deploy Backend** workflow (unchanged) so the app restarts
and picks up the new settings. (If infra + backend were already current, a restart is enough:
`az webapp restart -g rg-pulse-uat-centralus -n app-pulse-api-uat-dynamis`.)

**4 — Seed the database once** via the guarded bootstrap endpoint (story 05). `hostname` is the
idempotency key; `staff.username` **must** match a `Username` in the allowlist from step 1. Capture the
response — the shared-credential `password` is returned **once** and only the hash persists.

> **⚠️ CRITICAL — seed under the host the BACKEND sees, not the frontend domain.** Exercise resolution
> matches the incoming request's `Host` header exactly (`HostExerciseResolver` → `Request.Host.Host`,
> against `Exercise.Hostname`/`BrandedDomain`). The current UAT is a **split / cross-origin** topology: the
> SPA (SWA at `pulse-uat.cobrasoftware.com`) calls the API **directly** at
> `VITE_API_URL = app-pulse-api-uat-dynamis.azurewebsites.net`, so every SPA→API request carries
> `Host: app-pulse-api-uat-dynamis.azurewebsites.net`. **Seed the exercise under THAT host** (as below).
> Seeding under `pulse-uat.cobrasoftware.com` instead makes `/api/exercise-context` return 404 and staff
> login fail with *"exerciseId must be a non-empty GUID"* — while **participant login still works** (it
> needs no client-supplied `exerciseId`), which makes the mismatch easy to misdiagnose. Giving the exercise
> the participant-facing host `pulse-uat.cobrasoftware.com` requires the same-origin setup tracked in
> **#322** (SWA Standard SKU + linked backend + `UseForwardedHeaders` + `VITE_API_URL=/api`).

```bash
curl -sS -X POST https://app-pulse-api-uat-dynamis.azurewebsites.net/api/ops/bootstrap-exercise \
  -H "X-Bootstrap-Secret: <the BOOTSTRAP_SECRET from step 1>" \
  -H "Content-Type: application/json" \
  -d '{
        "hostname": "app-pulse-api-uat-dynamis.azurewebsites.net",
        "exerciseName": "Pulse UAT Pilot",
        "timeZone": "America/Chicago",
        "staff": { "username": "controller1", "role": "controller" },
        "sharedCredential": { "enabled": true },
        "participantAccount": {
          "username": "participant1",
          "displayName": "Test Participant",
          "role": "participant",
          "password": "<optional-initial-password>"
        }
      }'
```

- **200** → success; the body has `exerciseId`, `exerciseCreated`, and (when created) the one-time
  `sharedCredential.password`. Re-running with the same `hostname` is idempotent (never clobbers).
- **404** → wrong/missing `X-Bootstrap-Secret` (the endpoint reveals nothing to an unauthorized caller) —
  re-check step 1 landed and the backend restarted (step 3).
- **400** → invalid body (e.g. missing `hostname`, or `staff.username` not in the allowlist).

**4b — Bind a posting persona to the participant account** (`identity-auth-roles/10`, #342 — a downstream
consumer of this feature's bootstrap seam, **not** a step this feature depends on: skip 4b entirely if the
exercise's participants are meant to observe rather than post, which is a legitimate COR-015 mode). Without
it the participant
signs in and sees the feed, but the **composer is absent** — `Account.PersonaId` is null, so the session
carries no `personaId` and `canPost` is false. That is correct COR-015 observer behavior, *not* a
regression, but it is not what you want for a participant who is meant to post.

> **Ordering constraint — this step comes after the persona cast is seeded, not before.**
> `bootstrap-exercise` creates the *exercise*; personas only exist once
> `POST /api/ops/seed-engine-content` has run. A `personaHandle` supplied on the **first** bootstrap of a
> fresh host can therefore never resolve, and is rejected **400** by design (fail closed) rather than
> silently provisioning an unbound account. So the real order on a fresh environment is: bootstrap →
> seed-engine-content → **then** bind (either by re-running bootstrap with a `personaHandle`, which fills
> an *absent* binding but never overwrites a differing one, or via the dedicated endpoint below).

```bash
curl -sS -X POST https://app-pulse-api-uat-dynamis.azurewebsites.net/api/ops/bind-participant-persona \
  -H "X-Bootstrap-Secret: <the BOOTSTRAP_SECRET from step 1>" \
  -H "Content-Type: application/json" \
  -d '{
        "hostname": "app-pulse-api-uat-dynamis.azurewebsites.net",
        "username": "participant1",
        "personaHandle": "mvega_fh"
      }'
```

Bind by **handle**, not id — the seed endpoint returns only persona *counts*, and `GET /api/personas`
needs a session, so no id is discoverable from the ops surface. `PersonaCastSeeder.Catalog` seeds
`mvega_fh`, `tbrandt41`, `kwardFH` (individual people — the right choice for a participant) plus
`FairhavenWater`, `FulcoEM`, `Newsline7` (organization/outlet accounts — **not** what you want bound to a
human participant). Handles match case-insensitively and a leading `@` is ignored.

- **200** → bound; re-binding the same persona is an idempotent no-op success, and re-binding a
  *different* one rebinds and reports the previous persona.
- **404** → uniformly returned for a wrong/missing secret, an unknown hostname, an unknown username, or a
  persona that is unknown **or belongs to another exercise** (COR-001 — a cross-exercise persona is
  deliberately indistinguishable from one that does not exist, so this endpoint is not an existence
  oracle). Re-check the secret and that the cast has been seeded for *this* exercise.

**5 — Verify real logins against the deployed backend** (still on mock frontend — hit the API directly):

```bash
# staff login — uses an allowlist Username + its Secret
curl -sS -X POST https://app-pulse-api-uat-dynamis.azurewebsites.net/api/auth/staff/login \
  -H "Content-Type: application/json" \
  -d '{"username":"controller1","secret":"<that account'\''s Secret>"}' -o /dev/null -w "staff:%{http_code}\n"
# participant login — the account seeded in step 4
curl -sS -X POST https://app-pulse-api-uat-dynamis.azurewebsites.net/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"participant1","password":"<the initial password>"}' -o /dev/null -w "participant:%{http_code}\n"
```

Both should return **200** with a token envelope. (Confirm the exact staff-login field names against
`StaffAuthEndpoints`/`AccountEndpoints` if a payload is rejected.)

**6 — Only now, flip the frontend off mock and redeploy.** `VITE_USE_MOCK_DATA` is a GitHub **variable**
(not a secret) on the `uat` environment, consumed by `deploy-frontend.yml` (`vars.VITE_USE_MOCK_DATA`):

```bash
gh variable set VITE_USE_MOCK_DATA --env uat --body 'false'
```

Then run the **Deploy Frontend** workflow (unchanged). Load `https://pulse-uat.cobrasoftware.com`, confirm
the participant sign-in surface renders and a real login lands on the feed; confirm `/staff/login` renders
COBRA and a real staff login reaches the console.

### Rollback (immediate kill-switch)

If live auth breaks after the step-6 flip, set the variable back and redeploy the frontend — this is
exactly what the opt-in-by-construction mock flag (`core/config/mockData.ts`) is *for* in a pre-production
pilot:

```bash
gh variable set VITE_USE_MOCK_DATA --env uat --body 'true'   # then re-run Deploy Frontend
```

> `VITE_USE_MOCK_DATA` must **never** be set on a real participant-facing **production** environment
> (per that module's header and the root `CLAUDE.md`). It is a UAT/pilot escape hatch only.

## Out of Scope

Any application code (stories 01–05 cover all of it). Production (`pulse.cobrasoftware.com`) config — this
story is UAT-only; production go-live repeats this runbook against its own secrets/hostname and is not
scoped here (production isn't live yet). Disabling/removing the bootstrap endpoint from a real
customer-facing deployment (a decision for whenever multi-customer go-live, `exercise-isolation/11`,
actually happens) — for UAT, secret-gated is the accepted control.

## Technical Notes

The **code portion** (bicep param threading + workflow secrets) is done and validated (`az bicep build` +
`az bicep build-params` clean; CI's *Infra (Bicep)* check re-validates on Linux). The **runbook
execution** was a manual, human-gated step: the secret *values* were generated and stored as GitHub
Actions environment secrets by a human with repo-admin access — never generated by, or passed through, an
agent session — and the runbook has now run against UAT (see the final AC's evidence). See
`docs/features/login/implementation.md` for the reuse map and Wave-4 slot.

## Dependencies

Story 05 (the bootstrap endpoint this runbook calls — merged, PR #310 + wiring fix #317). Stories 01–04
(the frontend must actually work before flipping `VITE_USE_MOCK_DATA` — all merged).

## Tests

- No automated test suite covers bicep parameter threading; validated by `az bicep build` +
  `az bicep build-params` (clean) and the CI *Infra (Bicep)* check. Verify the deployed app settings after
  a `Deploy Infrastructure` run (step 2 above).
- The manual runbook walk-through (steps 1–6) is the acceptance check and has now **run once against the
  real UAT deploy** (2026-07-25 — see the final AC's evidence); the seeded credentials themselves are
  never recorded in committed docs (NFR-009), only where step 1 put them.
