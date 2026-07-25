# Operate (UAT)

> Proportional to where Pulse actually is: UAT only, no production. This is the whole ceremony until prod
> exists — do not write a production-shaped runbook the project can't honor.
> Companion to [`ORCHESTRATION_MECHANICS.md`](ORCHESTRATION_MECHANICS.md) (the build/gate loop).

## Gate order

Quality gates run **pre-merge** in [`.github/workflows/ci.yml`](../.github/workflows/ci.yml) (Gate 0).
Deploy **assumes-green** and runs only after merge to `main`. A lint/test regression is caught on the PR,
never first on `main`.

## Deploy

- **Frontend:** automatic on push to `main` touching `src/frontend/**`
  ([`deploy-frontend.yml`](../.github/workflows/deploy-frontend.yml)) → Azure Static Web App
  (`stapp-pulse-uat`).
- **Backend:** automatic on push to `main` touching `src/Pulse.WebApi/**`, `src/Pulse.Core/**`,
  `global.json` or `pulse.slnx` ([`deploy-backend.yml`](../.github/workflows/deploy-backend.yml)) →
  App Service (`app-pulse-api-uat-dynamis`), applying the EF migration to `sqldb-pulse-uat` as an
  idempotent script **before** the new code is published.
- **Infrastructure:** manual `workflow_dispatch`
  ([`deploy-infrastructure.yml`](../.github/workflows/deploy-infrastructure.yml)), with `what_if` preview.

### ⚠ Frontend-before-backend, for any change to a fail-closed contract

The two deploy workflows both trigger on `push: main` with **disjoint path filters and separate
concurrency groups** — so a commit touching both halves fires them **concurrently, in no guaranteed
order**. That is normally harmless, but it is not when a change widens a value the frontend validates
fail-closed.

The live case is `ExerciseScope.status`: `isExerciseStatus` (`core/exerciseContext/exerciseContextResolver.ts`)
rejects unknown values, and `ExerciseContextProvider` returns `null` on a rejected scope — which blanks
the participant world *and* the staff shell rather than raising a visible error. If the backend deploy
wins the race, it rewrites rows to a vocabulary the currently-served bundle does not know.

**Rule:** when a change both widens a server-emitted value and widens the client guard that accepts it,
promote the **frontend first** — run *Deploy Frontend*, confirm the new bundle is serving, then let
*Deploy Backend* run. Client guards are widened additively (they accept the old and new vocabularies at
once) precisely so this ordering is safe in one direction only.

Left unmanaged the failure is **transient and self-healing** — both workflows complete, so UAT blanks
only for the window between them — but a tab holding the old bundle stays blank until a hard reload.

## Rollback

**Frontend (deploy-only):**

1. Find the last-good commit SHA (green CI, working UAT).
2. Re-run **Deploy Frontend** via `workflow_dispatch` on that SHA — SWA overwrites with the prior build.
   (Redeploy = rollback.)
3. Append an incident line below.

**Backend:** redeploying an earlier SHA rolls back the *code*, but **not the schema** — the migration
script is idempotent-forward only and is never auto-reversed. A schema rollback means running the
migration's `Down` by hand against `sqldb-pulse-uat`.

Note that a `Down` is not guaranteed loss-free: where a migration widens a vocabulary, `Down` maps the
new values back onto the narrower legacy set, so distinctions collapse (and a `Down` **then** re-`Up` is
not identity-preserving — it silently reclassifies). Read the specific migration's `Down` before relying
on it. UAT is a disposable playground: for anything non-trivial, re-seeding from a clean database is
faster and more honest than unwinding a migration.

## Incident log

<!-- One dated line per incident: date · symptom · SHA · action taken. -->

_(none yet)_
