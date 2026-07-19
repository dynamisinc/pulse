# Operate (UAT)

> Proportional to where Pulse actually is: UAT only, no production, no database migrations yet. This is
> the whole ceremony until prod exists — do not write a production-shaped runbook the project can't honor.
> Companion to [`ORCHESTRATION_MECHANICS.md`](ORCHESTRATION_MECHANICS.md) (the build/gate loop).

## Gate order

Quality gates run **pre-merge** in [`.github/workflows/ci.yml`](../.github/workflows/ci.yml) (Gate 0).
Deploy **assumes-green** and runs only after merge to `main`. A lint/test regression is caught on the PR,
never first on `main`.

## Deploy

- **Frontend:** automatic on push to `main` touching `src/frontend/**`
  ([`deploy-frontend.yml`](../.github/workflows/deploy-frontend.yml)) → Azure Static Web App
  (`stapp-pulse-uat`).
- **Infrastructure:** manual `workflow_dispatch`
  ([`deploy-infrastructure.yml`](../.github/workflows/deploy-infrastructure.yml)), with `what_if` preview.

## Rollback

Deploy-only (no DB migrations to reverse yet):

1. Find the last-good commit SHA (green CI, working UAT).
2. Re-run **Deploy Frontend** via `workflow_dispatch` on that SHA — SWA overwrites with the prior build.
   (Redeploy = rollback.)
3. Append an incident line below.

When a backend + database land, this section grows a migration-reversal step and a real runbook — not before.

## Incident log

<!-- One dated line per incident: date · symptom · SHA · action taken. -->

_(none yet)_
