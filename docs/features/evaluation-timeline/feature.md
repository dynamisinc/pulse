# Feature: Evaluation timeline & replay foundation

**Epic:** E10 — Evaluation & AAR  ·  **Phase:** 4  ·  **Feature ref:** F10.1 The timeline (foundation)
**World:** staff  ·  **Issue:** —

## Summary
The evaluator's foundation surface: a staff-only, exercise-scoped, ordered record of everything
the information environment did — content published, participant/persona actions, controller
actions, engine actions, alerts, and storyline state changes — filterable/searchable and
replayable as a scrubbable, video-style reconstruction with an honest fidelity contract. Every
other E10 feature (metrics, live tools, AAR export) reads from this timeline; it is Wave 1 for
the whole epic.

## Requirements covered
EVL-001, EVL-002, EVL-003, EVL-004 · COR-013 (evaluator read-only), COR-018 (per-human
attribution behind shared org accounts), COR-053 (scenario time), COR-054 (EndEx / hotwash
availability), CTL-025 (takedown tombstoning — replay honors it), CTL-026 (off-platform response
marker)

## Design references
`design/handoffs/evaluator-dashboard/README.md`, `design/handoffs/evaluator-dashboard/DECISIONS.md`
(**D6-002, D6-004, D6-005, D6-006, D6-007**), `design/handoffs/evaluator-dashboard/SHELL-CONTRACT.md`
(the D7 staff shell this surface renders inside), and `design/handoffs/evaluator-dashboard/Evaluator
Dashboard.dc.html` (reference DOM: tab row, timeline rows, replay transport bar). Pre-design brief:
`docs/design/D6-evaluator-dashboard.md`. Session 7 (D6) is the final Pulse design surface — there is
no `STORY-UPDATES.md` for it (unlike D5's controller console); `DECISIONS.md`'s D6 section is the
canonical, first-pass log, so this backlog is decomposed directly from it rather than reconciling an
amendment.

> **Phasing note.** E10 is mapped to Phase 4 in the Master PRD (§4). This feature is authored now,
> ahead of that build gate, because the D6 design session just landed and the epic asked to be
> decomposed while the design is fresh — it does not pull E10 work into the active Phase 1/2
> backlog. Build sequencing still waits for Phase 4.

## Stories
| # | Story | Requirement(s) | Design | Status | Issue |
|---|---|---|---|---|---|
| 01 | Read-only staff access, live during conduct | EVL-004, COR-013 | D6-002 | Not Started | — |
| 02 | Timeline explorer (filters, attribution, deep-link) | EVL-001, EVL-002, COR-018, CTL-026 | D6-004 | Not Started | — |
| 03 | Replay player (honest fidelity) | EVL-003, COR-053 | D6-005, D6-006 | Not Started | — |
| 04 | Hotwash mode switch (participant-visible replay) | EVL-014, EVL-033, COR-054 | D6-007 | Not Started | — |

## Dependencies
E1 telemetry (`XC-004` v0 event schema) — the timeline is a read model over that event stream.
Consumes fired-inject and controller-dial events from `world-steering`/`inject-queue` (E7), engine
events from E8, off-platform markers (`CTL-026`, `world-steering`), and takedown tombstones
(`CTL-025`, `posts`). Renders inside the D7 staff shell (header/toolstrip are shell-owned) and, in
Replay, re-renders the D1 social-app and D2 portal participant skins read-only.

## Design notes
Staff world throughout — COBRA (`@/theme/styledComponents`), MUI 9, desktop-first, never confusable
with a participant view. Read-only is expressed by the *absence* of steering affordances (D6-002,
the `COR-015` pattern extended to evaluators), never a disabled control. The replay player renders
participant surfaces (Portal/Pulse) *inside* the evaluator frame using the real D1/D7 participant
anatomy (green compliance banners, alert bar, channel strip) — that inner "stage" is a faithful skin
render, not a COBRA-themed substitute; it is the one place a staff surface deliberately quotes the
participant world, and it must stay visually contained (a bordered/shadowed stage, never bleeding
into the outer staff frame — the D0 §2 cardinal rule). NFR-001 is a hard constraint across the whole
feature: every state/severity encoding (fidelity chip, jump seam, hotwash tag) is word + shape +
color together, never color alone.
