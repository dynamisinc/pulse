# Process review — Pulse as the second data point

> Pulse was reviewed as an adversarial test of the AI-agent development methodology proven on
> QuibbleStone (solo, greenfield, fast-CI) and hardened once by `cadence`. Pulse was chosen to break
> QuibbleStone's proof conditions. This doc records what the review confirmed / contradicted and the
> revisions folded into the orchestration docs and CI as a result. It is the pulse-side revision log;
> the methodology-side log lives in the process package.

## Pulse's real conditions (Step 0, from the repo)

- **Team:** one human author (Tom Bull, 193/193 commits). The independence axis is a **subagent fleet +
  Copilot-as-PR-reviewer**, not multi-human handoff. Pulse does **not** test human review latency.
- **Coupling:** young but seam-concentrated — foundation seams have 41 / 35 / 16 / 13 non-test importers.
  Seams-first held; the composition root (`App.tsx`, 7× churn) is disjoint from nothing.
- **Architectural bets:** several competing invariants (two-worlds, isolation, scenario-time,
  telemetry-as-AAR, WCAG), not one.
- **CI:** was **not in the merge loop** — gates ran post-merge in deploy; the 155-test .NET suite was ungated.
- **Artifacts:** unusually complete (charter, design canon, docs-as-code backlog, tracker mirror, full
  orchestration layer) — more mature than QuibbleStone's.

## Findings folded (revision entries)

| # | Finding | Severity | Revision landed |
|---|---------|----------|-----------------|
| R1 | Gates were honor-system; backend ungated; quality gates ran post-merge | **Blocker** | Added `ci.yml` (Gate 0): affected-stack `build + lint + type-check + test` on every PR, frontend **and** backend. Stripped duplicated gates from `deploy-frontend.yml` (assumes-green). |
| R2 | Independence conflated "different context" with "different human" | Major | `ORCHESTRATION_MECHANICS.md §3`: two review tiers — Tier 1 structural (`code-review` agent + Copilot, always, cheap), Tier 2 human sign-off (Critical classes only). Copilot named in the §7 role table. |
| R3 | File-disjointness has no word for the composition root | Major | Mechanics §4 + template: `App.tsx` is **orchestrator-owned**, edited serially between waves; new "Integration seam" row in `implementation.md`. |
| R4 | DoD + builders were frontend-only; half the repo (`Pulse.Core`) orphaned | Major | Stack-agnostic DoD ("the affected stack's gate passes") with `[machine-enforced]`/`[reviewer-checked]` labels; `stack:` field on the wave-plan row; `backend-agent` role. |
| R5 | Gate order inverted; no Operate/rollback artifact | Major | Gates moved pre-merge (R1); added proportional `OPERATE.md` (UAT deploy + deploy-only rollback + incident log). |
| R6 | "Freeze schema v0" optimistic — highest-coupling seam churned most after lock | Minor | Playbook foundation section: "seed v0, reserve extension fields, budget one seam-hardening pass after the first consumer wave." |

## Cross-project signal

- **CONFIRM** — seams-before-fan-out (coupling is the real constraint; foundation-first is the answer).
- **CONTRADICT** — independence is a *human-latency* cost: pulse shows it is cheap when the reviewer is an
  agent/bot. Reframed into two tiers (R2).
- **CONTRADICT the premise** — "slow-CI gate variant": pulse had no gating CI at all; the fix is to make
  the gate *exist* (R1), not to subset it.
- **N/A** — Operate stage 5b against production: pulse has no prod. Kept proportional (R5). Production
  rollback/migration reversal remains **unproven on every project in the set**.

## Still open

- **The 7 unseen `cadence` findings** were not available at review time — cross-project confirm/contradict
  for them is pending their list.
- **Multi-human review latency** and **production operate/rollback** remain untested conditions; the
  methodology must not claim coverage of them.
- **Guardrail:** `features/evaluator/services/scenarioTime.ts` is a parallel scenario-time model — converge
  it onto the canonical `core/clock` utility when that surface is next touched (also in `WAVE0-REVIEW.md`
  deferred), and list the canonical clock in the reuse map so no new consumer picks the wrong one.
