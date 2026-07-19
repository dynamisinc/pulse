# Orchestration Mechanics

> **Companion to [`FEATURE_ORCHESTRATION_PLAYBOOK.md`](FEATURE_ORCHESTRATION_PLAYBOOK.md).**
> The playbook defines the *contracts* (Wave Plan, reuse map, the two `code-review` gates, DoD, the
> GitHub Epic→Feature→Story hierarchy) and deliberately leaves the *mechanics* to the team. This doc
> fills that gap: **branch model, worktrees, the umbrella integration flow, the per-wave Workflow
> fan-out, and the copy-paste session-kickoff prompt.** [`BUILD_PLAN.md`](BUILD_PLAN.md) is the live
> checklist of which wave is next.

These mechanics reflect three locked decisions:
1. **Umbrella branch per feature** — builder branches → feature umbrella (Gate 1) → one feature PR to `main` (Gate 2).
2. **Workflow fan-out per wave** — a wave's disjoint stories are built by parallel agents in one `Workflow` run.
3. **Worktree per builder** — the checkout is shared and live-edited by parallel sessions, so every builder is isolated.

---

## 1. Branch model

| Branch | Pattern | Off | Lifetime |
|---|---|---|---|
| **Feature umbrella** | `feature/<slug>` | `main` | Whole feature; deleted after its PR merges |
| **Story builder** | `build/<slug>/<NN-slug>` | the feature umbrella | One story; deleted after it merges to the umbrella |

`<slug>` is the `docs/features/<slug>/` folder name (e.g. `participant-shell`, `posts`). `<NN-slug>` is
the story file stem (e.g. `04-channel-mount-contract`). This 1:1 naming keeps branch ↔ story ↔ GitHub
issue traceable.

**Never build directly on `main` or on another session's branch.** At any moment `main` may be behind
several open branches (evaluator, engine, etc.); always branch a feature umbrella from the latest
`origin/main`.

---

## 2. Worktree per builder (mandatory)

The repo is one shared checkout that concurrent sessions live-edit. Isolate every builder:

```bash
git worktree add ../pulse-wt-<slug>-<NN> -b build/<slug>/<NN-slug> feature/<slug>
```

- Build, test, and run checks inside the worktree; commit to the builder branch there.
- The `Workflow` tool's `isolation: 'worktree'` option creates a worktree per builder automatically —
  convenient for fan-out, but each is auto-created off the **session HEAD** (ambiguous base) and starts
  with no `node_modules`. To control the base (fork off the umbrella) *and* share `node_modules` (see
  below), **pre-create** the worktrees off `feature/<slug>` and pass each path to the build+test agents
  instead. For hand-driven single stories, create the worktree manually.
- Remove a worktree once its branch is merged: `git worktree remove ../pulse-wt-<slug>-<NN>`.
- **Never** leave uncommitted new files in the primary checkout — a parallel session may sweep them
  into the wrong commit.

### Sharing `node_modules` (skip per-worktree installs)

Fresh worktrees start with **no `node_modules`**, and `npm ci` in every builder is slow and adds a
failure surface. Because each worktree is checked out at the same commit (same lockfile), share the
primary checkout's installed modules read-only via a junction/symlink, then tell builders **not** to run
`npm install`/`npm ci`:

```powershell
# Windows (PowerShell). POSIX: ln -s <primary>/src/frontend/node_modules <worktree>/src/frontend/node_modules
New-Item -ItemType Junction -Path <worktree>\src\frontend\node_modules -Target C:\Code\pulse\src\frontend\node_modules
```

The store is read-only during type-check/lint/test, so parallel builders don't collide. This pairs with
**pre-created** worktrees (above), not `isolation:'worktree'`. Cleanup: remove the junction before
`git worktree remove` (or use `--force`) so it doesn't choke on the reparse point. From Git Bash use the
PowerShell form — `cmd //c mklink /J` mangles the paths under MSYS.

---

## 3. The gates (from the playbook)

**Gate 0 — machine (CI), the enforcement floor.** The umbrella→`main` PR (and every push to `main`) is
gated by `.github/workflows/ci.yml`: the **affected stack's** `build + lint + type-check + test` must
pass (frontend → `lint + type-check + test:run`; backend → `dotnet build + dotnet test`; a full-stack
story → both). It triggers on `pull_request`/`push` to `main`, so it runs **before** anything reaches
`main` — the machine backstop that makes the Definition of Done enforced rather than honor-system.
Builder branches are not CI-gated on their own: they run the same stack checks **locally in the
worktree** at Gate 1 (below) and are enforced by Gate 0 at the feature PR. (To gate builder branches in
CI as well, open their PRs against the umbrella or add the umbrella branches to the `pull_request`
targets.) Deploy workflows assume-green and no longer re-run these checks.
**No second contributor (human or unattended agent) lands work on `main` without Gate 0.**

The review gates are **structurally independent** of the builder — a different context reviews the diff,
so independence is cheap (no human queue). Two review tiers:

- **Tier 1 — structural independence (always).** The `code-review` agent (Gates 1 & 2 below) plus
  **GitHub Copilot on the umbrella→`main` PR**. Both are independent of the builder agent; fold their
  findings before merge.
- **Tier 2 — human sign-off (Critical classes only).** A second person, reserved for isolation-scope
  breaks, security, and schema/contract changes. Everything else ships on Tier 1.

- **Gate 1 — per story.** Before a builder branch merges into the umbrella, `code-review` checks the
  diff (`git diff feature/<slug>...build/<slug>/<NN-slug>`) against the story's ACs, the attached
  cross-cutting ACs, and the reuse map, and emits a `clean` verdict. **No Critical findings → eligible
  to merge.** Always-Critical: an isolation-scope break, an unsanitized free-text surface, or COBRA on
  a participant path.
- **Gate 2 — integrated delta.** After the wave's clean builder branches are merged into the umbrella,
  re-run `code-review` on the integrated umbrella (`git diff main...feature/<slug>`) to keep it green
  and warning-clean before the next wave (and before the feature PR).

---

## 4. Per-wave Workflow fan-out

A wave is a set of stories whose `Files it owns` (from the feature's `implementation.md` Wave Plan) are
disjoint, so they build in parallel with no conflicts. One `Workflow` run per wave.

> **The composition root is disjoint from nothing.** The app's route/provider tree (`src/frontend/src/App.tsx`)
> is edited by *every* surface-adding story, so it can never be a wave story's owned file — file-disjointness
> has no word for it and it is the repo's single most-churned file. It is **orchestrator-owned**: after a
> wave's builder branches merge clean, the **orchestrator** makes the one composition-root edit that wires
> the new surfaces (routes/providers/subtree mounts), serially, in its own commit. No builder branch touches
> it. Declare it in the feature's `implementation.md` "Integration seam" row.

**Flow per story (pipeline stages):**
1. **Build** — `frontend-agent` (or the right builder) in an isolated worktree on `build/<slug>/<NN>`:
   implements strictly to the story's ACs (does *not* exceed them), reusing the modules named in the
   reuse map. Commits.
2. **Test** — `testing-agent` in the **same** worktree: covers the ACs (isolation, scenario-time,
   telemetry, sanitization first), then runs `npm run type-check && npm run lint && npm run test:run`.
   Commits.
3. **Review (Gate 1)** — `code-review` (read-only) on the builder branch diff; returns
   `{ clean: boolean, findings: [...] }`.

Then the **orchestrator (main loop, serial)** merges each `clean` builder branch into the umbrella one
at a time (serial = no merge races), and runs **Gate 2** on the integrated umbrella.

> **Worktree subtlety:** Build and Test must share one worktree (Test reads/extends Build's tree), so
> pin both to the same story worktree — either pre-create the worktree and pass its path to both agents,
> or run Build+Test as one combined builder step. `code-review` needs no worktree (it reads a branch
> diff). Don't give Build and Test *separate* `isolation:'worktree'` worktrees or Test won't see the code.

**Script skeleton** (refine on first run; `agentType` values map to `.claude/agents/*`):

```js
export const meta = {
  name: 'build-wave',
  description: 'Fan out one builder per story in a wave: build → test → Gate-1 review',
  phases: [{ title: 'Build' }, { title: 'Test' }, { title: 'Review' }],
}
// args = { slug, umbrella, stories: [{ nn, storyFile, world, crossCuttingACs }] }
const { slug, umbrella, stories } = args

const results = await pipeline(
  stories,
  // Build + Test share ONE worktree per story (isolation makes a fresh worktree for this pipeline item)
  (s) => agent(
    `You are building story ${s.storyFile} on branch build/${slug}/${s.nn} (base ${umbrella}).\n` +
    `Read docs/features/${slug}/{feature.md,implementation.md} and the story file. Build STRICTLY to its\n` +
    `Acceptance Criteria (do not exceed them), reusing the reuse-map modules. World: ${s.world}.\n` +
    `Honor the attached cross-cutting ACs: ${s.crossCuttingACs}. Then add tests covering the ACs and run\n` +
    `npm run type-check && npm run lint && npm run test:run (all must pass). Commit to the builder branch.`,
    { label: `build:${s.nn}`, phase: 'Build', isolation: 'worktree', agentType: 'frontend-agent' }
  ),
  // Gate 1 — adversarial, read-only, structured verdict
  (build, s) => agent(
    `Review the diff of build/${slug}/${s.nn} against ${umbrella} for story ${s.storyFile}: ACs,\n` +
    `cross-cutting ACs, reuse map, the two-worlds rule, isolation, scenario-time, telemetry. Be adversarial.`,
    { label: `review:${s.nn}`, phase: 'Review', agentType: 'code-review',
      schema: { type: 'object', properties: { clean: { type: 'boolean' },
        findings: { type: 'array', items: { type: 'object' } } }, required: ['clean', 'findings'] } }
  ),
)
return results.map((verdict, i) => ({ story: stories[i].nn, clean: verdict?.clean === true }))
```

After the run, the main loop merges the `clean` branches into `feature/<slug>` serially, then runs Gate 2.

**Hand-driven fallback** (single story, no fan-out): create the worktree (§2), drive `frontend-agent`
→ `testing-agent` → the three npm checks → `code-review`, then merge to the umbrella. Same gates.

---

## 5. Definition of done (per story — from the playbook)

- All ACs met and checked; the attached cross-cutting ACs are actually satisfied by the diff. **[reviewer-checked]**
- Tests (or a documented manual check while the harness is thin) cover the ACs, cited in the story's **Tests** section. **[reviewer-checked]**
- **The affected stack's gate passes** — frontend story → `type-check + lint + test:run`; backend story →
  `dotnet build + dotnet test`; full-stack story → both. Same commands CI runs (Gate 0). **[machine-enforced]**
- `code-review` verdict is `clean` (Tier 1 structural independence). **[reviewer-checked]**
- `story-agent` flips the story's `**Status:**` to Complete and mirrors the GitHub issue
  (see [`GITHUB_TRACKER.md`](GITHUB_TRACKER.md) — markdown is canonical; issues mirror it).

> The story row's `stack:` field (`frontend | backend | fullstack`) tells the orchestrator which builder
> to spawn (`frontend-agent` / `backend-agent`) and which gate to run. Every stack in the repo gets a
> builder and a gate; none is left ungated.

A **feature** is done when all its waves are green (Gate 2 clean) and the umbrella → `main` PR merges.

---

## 6. Session-kickoff prompt (copy-paste to start a build session)

A fresh session reads [`BUILD_PLAN.md`](BUILD_PLAN.md), finds the next unstarted wave, and pastes:

```
Build <feature-slug> Wave <N> per the orchestrator mechanics (docs/ORCHESTRATION_MECHANICS.md)
and the wave plan in docs/features/<feature-slug>/implementation.md.

Umbrella branch: feature/<slug>  (create off latest origin/main if it doesn't exist)
Stories in this wave (each in its own worktree on build/<slug>/<NN-slug>):
  - <NN-slug>  · world: <participant|staff> · cross-cutting ACs: <ids>
  - <NN-slug>  · world: <participant|staff> · cross-cutting ACs: <ids>
Mock seams in play (no backend): <e.g. exercise-context, scenarioNow, telemetry emitter — all mock>

Run the per-wave Workflow fan-out (build → test → Gate-1 code-review). Merge only clean builder
branches into the umbrella serially, then run Gate-2 code-review on the umbrella. On green: have
story-agent flip each story's Status and mirror its GitHub issue, then update docs/BUILD_PLAN.md.
Do NOT exceed the ACs. Do NOT put COBRA on a participant path.
```

Always-read context for any build session: [`../CLAUDE.md`](../CLAUDE.md) (two worlds, MUI 9 sx-only,
conventions) and [`design/D0-FOUNDATIONS.md`](design/D0-FOUNDATIONS.md) (design non-negotiables), plus
the relevant `design/D1..D7` brief for a participant surface.

---

## 7. Agent roles (quick map)

| Agent | Role in the loop |
|---|---|
| `story-agent` | Phase 0 (decompose epic → stories + `implementation.md`), fold design amendments, and close-out (flip Status + mirror issue). Does **not** write code/tests. |
| `frontend-agent` | The builder inside a wave for a `frontend`/`fullstack` story — builds a story's diff strictly to its ACs. |
| `backend-agent` | The builder for a `backend`/`fullstack` story (`Pulse.Core`); same "strictly to ACs" contract, `dotnet build + dotnet test` gate. |
| `testing-agent` | Covers the ACs (Vitest / xUnit); isolation / scenario-time / telemetry / sanitization first. |
| `code-review` | The Tier-1 gate — read-only, adversarial; emits the `{clean, findings}` verdict for Gates 1 & 2. |
| GitHub Copilot | Tier-1 independent reviewer on the umbrella→`main` PR; fold its findings before merge (`fix(...): address Copilot PR review`). |
