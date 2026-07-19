# Feature: Persona operation

**Epic:** E7 — Controller Command Surface  ·  **Phase:** 1  ·  **Feature ref:** F7.1
**World:** staff  ·  **Issue:** #3  ·  **Status:** Wave 1 delivered (stories 01–03 Complete, POST-ONLY) — stories 04–05 Not Started

> **Wave 1 delivered.** Stories 01–03 (post as persona, fast switching, composer persona context)
> built in the 5-story cross-feature Wave-1 fan-out on `feature/simcell-operator` alongside
> `console-shell/01` and `feeds-discovery/07` — Gate-1 clean, wired at a serial integration step,
> Gate-2 clean on the integrated umbrella (684/684 tests, browser-verified end-to-end: ⌘K → picker →
> compose → publish → appears in the participant feed with no controller-origin leak). Story 01 is
> **POST-ONLY** this wave — reply/repost/DM-as-persona are deferred pending a `Post`-model
> parent/thread extension. Stories 04 (multi-controller presence) and 05 (mid-exercise persona
> creation) remain out of this wave.

## Summary
The controller's core loop: post, reply, repost, and DM as **any persona** in the exercise from
one console, with sub-3-second persona switching and enough in-context voice so a persona stays in
character across controllers. This is the muscle behind "one controller runs a believable world."

## Requirements covered
CTL-001, CTL-002, CTL-003, CTL-004, CTL-005 (with COR-018 attribution, COR-020 voice notes,
COR-022 mid-exercise persona creation, SOC-054 audience magnitude).

## Design references
Brief: `docs/design/D5-controller-console.md`. Handoff: `docs/design/D5-controller-console/`
(`README.md`; decision log: canonical `docs/design/DECISIONS.md`). Persona operation sits behind the console's persona dock / command
palette (Ctrl+K) — see the `console-shell` feature for the toolstrip/flyout host. No F7.1-specific
requirement amendments in `STORY-UPDATES.md`; the identity-badge change (COR-005, D5-012(g)) is
tracked in `console-shell`.

## Stories
| # | Story | Requirement(s) | Status | Issue |
|---|-------|----------------|--------|-------|
| 01 | Post as any persona into an enabled channel | CTL-001, COR-018 | Complete | #14 |
| 02 | Fast persona switching (searchable picker, ≤3s) | CTL-002 | Complete | #15 |
| 03 | Composer shows persona context while writing | CTL-003, COR-020, SOC-054 | Complete | #16 |
| 04 | Multi-controller presence & safe co-operation | CTL-004 | Not Started | #17 |
| 05 | Mid-exercise persona creation from the picker | CTL-005, COR-022 | Not Started | #18 |

## Dependencies
- **E1 foundations:** the Persona / PersonaTemplate model + exercise-context scoping (COR-001/003),
  the persona voice/personality notes field (COR-020), audience-magnitude band (SOC-054), and
  org-account attribution recording the individual human (COR-018/XC-004).
- **E2 social composer + post pipeline** (posting as a persona publishes through the same pipeline
  as any post; SOC-003 records origin `controller-as-persona`).
- **console-shell** (the persona dock, command palette, presence chrome host).
- Backend not present yet — Phase 1 runs against React Query + mock data behind the axios client;
  the persona picker/compose endpoints are a serial backend-contract edge.

## Design notes
**Staff world** — COBRA chrome, dense, keyboard-first (`@/theme/styledComponents`, never raw MUI).
The published *output* lands in the **participant world** (a Pulse social post), so the composer's
result must obey participant rules: scenario-time stamping (COR-053), sanitization before publish
(NFR-004), and telemetry on send (XC-004). Origin (`controller-as-persona`) is captured but
**never participant-visible** (SOC-003). Speed is the product metric — the fire path has zero modal
friction and is fully keyboard-operable (CTL-034 workload budget, NFR-001).
