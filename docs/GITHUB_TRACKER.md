# GitHub Tracker — Pulse

> How the `docs/features/` backlog mirrors into **GitHub Issues** (repo `dynamisinc/pulse`).
> **Markdown story files are canonical**; issues mirror them for visibility and the work queue.
> The `story-agent` reads this before running any `gh` command.

## The three-level sub-issue hierarchy

Pulse's requirements already come as **Epic → Feature → Story**, so the issue tree mirrors it 1:1:

- **Epic** — one Issue per `E1..E10`, labeled `epic`. Title: `E7 — Controller Command Surface`.
- **Feature** — one Issue per `F#.#` section, labeled `feature` + `feature:{slug}`, a **sub-issue
  of** its Epic. Title: `F7.1 Persona operation`.
- **Story** — one Issue per requirement (or tight cluster), labeled `story` + `feature:{slug}`, a
  **sub-issue of** its Feature. Title from the story.

The `{slug}` matches the `docs/features/{slug}/` folder name.

## Labels

| Label | Meaning |
|---|---|
| `epic` / `feature` / `story` | hierarchy level |
| `feature:{slug}` | groups a feature's stories (and the feature issue itself) |
| `phase:1` … `phase:4` | build phase (Master PRD §4) |
| `status:todo` / `status:in-progress` / `status:in-review` / `status:blocked` | mirrors the markdown `**Status:**` (removed when closed) |
| `world:participant` / `world:staff` | which visual world the surface lives in |
| `channel:social` / `channel:portal` / `channel:news` / `channel:press` / `channel:weather` / `channel:controller` / `channel:evaluator` | optional, for filtering |

Create the label set once (idempotent — safe to re-run; ignore "already exists"):

```bash
for l in epic feature story; do gh label create "$l" -R dynamisinc/pulse 2>/dev/null; done
for p in 1 2 3 4; do gh label create "phase:$p" -R dynamisinc/pulse 2>/dev/null; done
for s in todo in-progress in-review blocked; do gh label create "status:$s" -R dynamisinc/pulse 2>/dev/null; done
```

## Issue body conventions

Every story/feature issue body links its canonical markdown and lists traceability:

```
**Source of truth:** docs/features/persona-operation/02-fast-persona-switching.md
**Epic:** E7 · **Feature:** F7.1 · **Phase:** 1 · **Requirements:** CTL-002
**Design decisions:** D5-012(g)   (omit if none)
```

Record the issue number back in the story header (`**Issue:** #123`) and the `feature.md` Stories
table.

## Status mapping (markdown is canonical)

| Markdown `**Status:**` | GitHub |
|---|---|
| Not Started | open + `status:todo` |
| In Progress | open + `status:in-progress` |
| In Review | open + `status:in-review` |
| Complete | closed (completed) + remove `status:*` |
| Blocked | open + `status:blocked` + a comment with the reason |
| Dropped | closed (not planned) + remove `status:*` |

## Commands (print each before running; show the resulting number/URL)

Create an Epic issue:

```bash
gh issue create -R dynamisinc/pulse --label epic --label phase:1 \
  --title "E7 — Controller Command Surface" \
  --body "The staff-only console... (epic summary). Source: docs/07-controller-command-surface.md"
```

Create a Feature issue, then link it under its Epic as a sub-issue:

```bash
gh issue create -R dynamisinc/pulse --label feature --label "feature:persona-operation" \
  --label phase:1 --label world:staff --label channel:controller \
  --title "F7.1 Persona operation" \
  --body "**Source of truth:** docs/features/persona-operation/feature.md ..."
# link as sub-issue of the epic (GraphQL sub-issue API):
gh api graphql -f query='mutation($parent:ID!,$child:ID!){addSubIssue(input:{issueId:$parent,subIssueId:$child}){subIssue{number}}}' \
  -f parent=<EPIC_NODE_ID> -f child=<FEATURE_NODE_ID>
```

Create a Story issue and link it under its Feature the same way (`status:todo` to start). Get an
issue's node id with `gh issue view <n> -R dynamisinc/pulse --json id -q .id`.

Swap a status label when the markdown status changes:

```bash
gh issue edit <n> -R dynamisinc/pulse --remove-label status:todo --add-label status:in-progress
```

> **Note on the sub-issue API.** GitHub sub-issues are managed via the GraphQL `addSubIssue`
> mutation (node IDs, not issue numbers). If the API shape has changed since this was written,
> verify with `gh api graphql` before bulk-linking, and fall back to a task-list checklist in the
> parent body if needed.

## Guardrails

- **Print each `gh` command before running it**; show the number/URL after.
- Auto-execute create/label/link/status-swap/body-update for a feature's issues.
- Do **not** auto-close an Epic, bulk-edit many issues, or remove a `feature:*` label without
  prompting first.
- If the markdown and the issue disagree, the **markdown wins** — reconcile toward it.
