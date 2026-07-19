# Feature Orchestration Playbook — Pulse

> **Status: v1 — adapted from a proven solo-project pattern; hardened by the pulse process review
> (see [`PROCESS_REVIEW-PULSE.md`](PROCESS_REVIEW-PULSE.md)): CI enforcement floor, two-tier review,
> orchestrator-owned composition root, stack-agnostic DoD.**
> This is the bridge between planning (`docs/features/` stories + `implementation.md`) and building
> a feature with one or more coding agents. The `story-agent` writes `implementation.md` to be
> orchestration-ready; `code-review` is the review gate; `frontend-agent` / `testing-agent` build
> and cover. If your team runs builds differently (PR-per-story by hand, a Workflow fan-out, etc.),
> keep the contracts below and adjust the mechanics.

## The inputs a feature must have before build

1. `feature.md` — scope, epic/phase, story list, cross-cutting requirements in play.
2. `NN-<slug>.md` stories — INVEST, with ACs (including the attached XC/NFR cross-cutting ACs).
3. `implementation.md` — **per-story tech notes**, a **reuse map**, and a **DAG-ready Wave Plan**.

The Wave Plan is the contract: each story lists `Files it owns | Depends-on | Can-run-with | Wave |
Effort`, sized by **file-footprint disjointness** so a wave can fan out with no further analysis.

## Build order

- **Foundation first.** In Pulse the load-bearing foundations are the **E1 exercise-context /
  query-scoping layer** (nothing participant-facing is safe to build until data is exercise-scoped)
  and the **`XC-004` telemetry event schema v0** (E10 metrics, E9's event stream, and E8 all consume
  it — a schema mistake becomes a cross-phase migration). These precede the surfaces that consume
  them and are serial dependencies for most Phase-1 work. **Seed the seam at v0 and reserve extension
  fields — do not assume "freeze once."** The highest-fan-in seam keeps revealing requirements as
  consumers wire up (telemetry, the most-imported core module, churned most *after* its v0 lock), so
  budget **one explicit seam-hardening pass after the first consumer wave** rather than treating v0 as
  final (see `docs/features/WAVE0-REVIEW.md` for the pass that hardened XC-004).
- **Parallelize disjoint stories** within a wave (different file footprints → no conflicts). Use a
  git worktree per parallel builder if they touch the tree simultaneously.
- **Serialize the contract seams.** The **frontend → backend** edge is serial: the .NET backend does
  not exist yet, so Phase-1 frontend runs against React Query + mock data behind the axios client,
  and any story needing a real endpoint depends on the backend contract (the hook/service signature
  is the seam — there is no codegen step).

## The gates

- **Gate 0 — machine (CI):** `.github/workflows/ci.yml` runs the affected stack's `build + lint +
  type-check + test` on every PR, **before** merge — the enforcement floor that makes the DoD
  machine-enforced, not honor-system (frontend and backend both gated). Deploy assumes-green. Review
  independence is **two-tier**: Tier 1 = `code-review` agent + Copilot on the PR (always, cheap); Tier 2
  = a human sign-off, reserved for Critical classes (isolation / security / contract). See
  [`ORCHESTRATION_MECHANICS.md §3`](ORCHESTRATION_MECHANICS.md).
- **Gate 1 — per-story:** before a builder's branch integrates, `code-review` checks the diff against
  the story's ACs, the cross-cutting ACs, and the reuse map, and emits a `clean` verdict. No Critical
  findings → eligible to integrate. Isolation breaks, unsanitized free-text surfaces, and COBRA on a
  participant path are always Critical.
- **Gate 2 — integrated delta:** after each serial merge onto the umbrella, `code-review` re-checks
  the integrated delta to keep the umbrella green and warning-clean.

## Definition of done for a story

- All ACs met and checked; the cross-cutting ACs it attached are actually satisfied by the diff.
- Tests (or a documented manual check while the harness is thin) cover the ACs, cited in the story's
  **Tests** section (`testing-agent`).
- `npm run type-check` + `npm run lint` + `npm run test:run` pass.
- `code-review` verdict is `clean`.
- Markdown `**Status:**` flipped to Complete and the GitHub issue mirrored (`docs/GITHUB_TRACKER.md`).

## What this playbook deliberately leaves to the team

Branching/PR conventions and whether builds run as a Claude Code Workflow fan-out or hand-driven. CI is
now wired (Gate 0 — `.github/workflows/ci.yml`) and deploy/rollback is described in
[`OPERATE.md`](OPERATE.md); refine both as Pulse's engineering process settles. This doc defines the
*contracts* (Wave Plan, reuse map, review gates), not the mechanics.

> **These mechanics are now defined** in [`ORCHESTRATION_MECHANICS.md`](ORCHESTRATION_MECHANICS.md)
> (umbrella-branch model, worktree-per-builder, per-wave Workflow fan-out, and the session-kickoff
> prompt). [`BUILD_PLAN.md`](BUILD_PLAN.md) is the live wave checklist.
