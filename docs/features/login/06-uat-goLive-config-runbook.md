# Story: UAT go-live config & runbook

**Feature:** Login & UAT go-live  ·  **Epic:** E1  ·  **Phase:** 1  ·  **Status:** Not Started
**Requirements:** NFR-009  ·  **Design decisions:** none  ·  **Issue:** #309
**Stack:** infra/ops (bicep + GitHub Actions config; **not** buildable end-to-end by a coding agent alone
— see the human-action callouts below)
**Review:** Tier-2 (touches deployment secrets and the mock-data fail-open/closed guarantee)

## Context

Three concrete, already-confirmed gaps stand between "the code from stories 01–05 is merged" and "UAT
actually runs full-stack":

1. **`ASPNETCORE_ENVIRONMENT` is silently `Production` in UAT.** `infrastructure/modules/webapp.bicep`
   defaults `aspnetcoreEnvironment` to `'Production'`, and `infrastructure/main.bicep`'s `webApp` module
   invocation never passes it — there is no override anywhere in the parameter chain
   (`infrastructure/parameters/uat.bicepparam` doesn't set it either).
2. **The staff allowlist is empty.** `Authentication:StaffIdentity:Accounts`
   (`DynamisIdentityProviderOptions`) is, by its own doc comment, *"NOT one of the keys provisioned by
   `infrastructure/modules/*.bicep`"* — nothing sets it for UAT today, so every staff login fails closed
   (correctly — but unusably, with no staff able to sign in at all).
3. **`VITE_USE_MOCK_DATA=true` in the UAT GitHub Actions frontend environment** is exactly why the SPA
   still runs on canned data — flipping it is the last step, not the first, and flipping it before 1/2
   are fixed and story 05 has actually been run reproduces the "blank screen" bug this whole feature
   exists to fix.

This story is the config plumbing + the runbook that retires all three, in the safe order (backend
config → seed the database via story 05's endpoint → frontend flip), mirroring the **already-established**
secret-threading pattern this repo uses for `jwtSecretKey` (a `@secure()` bicep param, defaulted empty,
supplied via a GitHub Actions secret referenced in `deploy-infrastructure.yml`, never committed).

## Acceptance Criteria

- [ ] `infrastructure/modules/webapp.bicep` and `infrastructure/main.bicep` thread an
      `aspnetcoreEnvironment` value through to the UAT deployment that is **not** the bare `'Production'`
      default (e.g. a `'Staging'` value for UAT, or an explicit per-environment param) — verified by
      reading the deployed App Service's `ASPNETCORE_ENVIRONMENT` app setting after a `Deploy
      Infrastructure` run, not just by inspecting the bicep.
- [ ] A new `@secure()` param threading the staff allowlist (`Authentication:StaffIdentity:Accounts`,
      story 05 of `identity-auth-roles`) is added to `webapp.bicep` + `main.bicep`, following the
      **exact** existing `jwtSecretKey` pattern (secure param, empty default, never committed) — **not**
      hardcoded into any committed `appsettings.*.json`, per `DynamisIdentityProviderOptions`'s own
      remark that this config "should never be committed to source-controlled `appsettings.json`."
- [ ] A new `@secure()` param threading story 05's bootstrap secret
      (`Authentication:Bootstrap:Secret`) is added the same way.
- [ ] `.github/workflows/deploy-infrastructure.yml` gains the two new GitHub Actions secrets (e.g.
      `STAFF_IDENTITY_ACCOUNTS_JSON`, `BOOTSTRAP_SECRET`) threaded into the `--parameters` call, mirroring
      the existing `JWT_SECRET_KEY` secret exactly.
- [ ] **A written runbook** (this file, or a short companion doc this story adds under `docs/`) states the
      order of operations for taking a *fresh* UAT database from empty to working: (1) deploy
      infrastructure with the two new secrets set; (2) deploy the backend (already-existing
      `deploy-backend.yml`, unchanged); (3) call `POST /api/ops/bootstrap-exercise` once (story 05) with
      the UAT hostname (`pulse-uat.cobrasoftware.com`), a staff username from the configured allowlist, and
      (recommended) a `SharedCredential`/starter `Account`; (4) verify a real staff login and a real
      participant login both succeed against the deployed backend; (5) **only then** flip the `uat`
      GitHub Actions environment's `VITE_USE_MOCK_DATA` to `false` and redeploy the frontend
      (`deploy-frontend.yml`, unchanged).
- [ ] The runbook states the **rollback**: setting `VITE_USE_MOCK_DATA` back to `true` and redeploying
      the frontend is the immediate kill-switch if live auth breaks post-flip — consistent with
      `core/config/mockData.ts`'s own documented opt-in-by-construction design (this is what that escape
      hatch is *for* in a pre-production pilot environment; the same flag must never be set in a real
      participant-facing production environment, per that module's header and root `CLAUDE.md`).

## Out of Scope

Any application code (stories 01–05 cover all of it). Production (`pulse.cobrasoftware.com`) config —
this story is UAT-only; production go-live repeats this runbook against its own secrets/hostname and is
not scoped here (production isn't live yet). Disabling/removing the bootstrap endpoint from a real
customer-facing deployment (a decision for whenever multi-customer go-live, `exercise-isolation/11`,
actually happens) — for UAT, secret-gated is the accepted control.

## Technical Notes

This is genuinely **not fully agent-executable**: an agent can prepare the bicep parameter plumbing and
write the runbook, but the actual secret **values** (the staff allowlist JSON, the bootstrap secret) must
be generated and stored as GitHub Actions environment secrets by a human with repo-admin access — never
generated by, or passed through, an agent session. Flag this explicitly in any build plan: this story's
code portion (bicep param threading) can run in the same wave as story 05; the **runbook execution**
(actually calling `deploy-infrastructure`, then story 05's endpoint, then flipping the frontend flag) is a
manual, human-gated final step, sequenced after stories 01–05 are merged and deployed. See
`docs/features/login/implementation.md` for the reuse map and Wave-4 slot.

## Dependencies

Story 05 (the bootstrap endpoint this runbook calls). Stories 01–04 (the frontend must actually work
before flipping `VITE_USE_MOCK_DATA` is worth doing — flipping it first just reproduces today's bug).

## Tests

- No automated test suite covers bicep parameter threading in this repo today; verify manually per the
  ACs above (read the deployed App Service's app settings after a `Deploy Infrastructure` run).
- Manual, documented runbook walk-through (the AC list above, run once against a real UAT deploy) is the
  acceptance check for this story — record the outcome (which staff/participant credentials were seeded)
  in the PR description rather than in committed docs.
