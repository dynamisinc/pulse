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
- The `Workflow` tool's `isolation: 'worktree'` option does this automatically per builder agent —
  prefer it for fan-out. For hand-driven single stories, create the worktree manually.
- Remove a worktree once its branch is merged: `git worktree remove ../pulse-wt-<slug>-<NN>`.
- **Never** leave uncommitted new files in the primary checkout — a parallel session may sweep them
  into the wrong commit.

---

## 3. The two gates (from the playbook)

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

- All ACs met and checked; the attached cross-cutting ACs are actually satisfied by the diff.
- Tests (or a documented manual check while the harness is thin) cover the ACs, cited in the story's **Tests** section.
- `npm run type-check` + `npm run lint` + `npm run test:run` pass.
- `code-review` verdict is `clean`.
- `story-agent` flips the story's `**Status:**` to Complete and mirrors the GitHub issue
  (see [`GITHUB_TRACKER.md`](GITHUB_TRACKER.md) — markdown is canonical; issues mirror it).

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
| `frontend-agent` | The builder inside a wave — builds a story's diff strictly to its ACs. |
| `testing-agent` | Covers the ACs (Vitest); isolation / scenario-time / telemetry / sanitization first. |
| `code-review` | The gate — read-only, adversarial; emits the `{clean, findings}` verdict for Gates 1 & 2. |
