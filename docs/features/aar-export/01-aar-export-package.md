# Story: AAR export package

**Feature:** AAR export package  ·  **Epic:** E10  ·  **Phase:** 4  ·  **Status:** Not Started
**Requirements:** EVL-030, EVL-031  ·  **Design decisions:** D6-012  ·  **Issue:** #223

## Context
EVL-030 wants a one-click AAR package export per exercise: timeline (data + readable document),
metrics report (EVL-010…015 with charts, including the scenario-design-input overlays per EVL-014),
annotated moments, content archive (all published content with media; takedowns logged, content not
republished), and rumor/storyline post-mortems. EVL-031 requires both machine-readable (JSON/CSV) and
presentation-ready formats, structured to slot alongside Cadence's own AAR ZIP (`INT-032`). D6-012
resolves the concrete UI: a toolstrip tool opens a flyout with a **five-line contents manifest**
(timeline log / replay bundle / annotations with unpushed-count detail / metrics / scenario design
record — "the EVL-014 dial layer ships in the package"), a provisional-items warning, and one
**"Export AAR package"** COBRA button with progress and a named `.zip` result line. See
`docs/10-evaluation-aar.md` F10.4 and `feature.md`.

## Acceptance Criteria
- [ ] Given the AAR Export toolstrip tool, when the evaluator opens its flyout, then it lists a
      five-line contents manifest — **Timeline log**, **Replay bundle**, **Annotations** (with the
      unpushed-count detail), **Metrics**, and **Scenario design record** — per D6-012's exact
      manifest.
- [ ] Given the manifest's "Scenario design record" line, when it renders, then its detail states it
      carries the dial events and time jumps — the EVL-014 defensibility layer ships inside the
      package as its own named artifact, not folded silently into the metrics report.
- [ ] Given any coverage items are still unconfirmed (`evaluation-metrics/02`), when the flyout
      renders, then a warning banner states how many items remain unconfirmed and that they "export
      flagged PROVISIONAL until confirmed" — per D6-010/D6-012's shared contract.
- [ ] Given the flyout, when the evaluator clicks "Export AAR package", then a progress indicator
      advances through named steps (e.g. bundling replay segments → rendering metrics snapshots →
      signing package) and on completion shows a named result line (e.g. "✓
      {exercise-slug}_aar-package.zip · size — ready") — per D6-012.
- [ ] Given the exported package, when its contents are inspected, then it includes both
      machine-readable (JSON/CSV) and presentation-ready document formats (EVL-031), and its
      structure is documented to slot alongside Cadence's own AAR ZIP (`INT-032`) rather than
      duplicate it.
- [ ] Given a takedown occurred during the exercise (CTL-025), when the content archive is built into
      the package, then the takedown is logged in the archive but the removed content is not
      republished or re-rendered — mirroring `evaluation-timeline/03`'s replay guarantee, applied to
      the static archive.
- [ ] Telemetry (XC-004): starting and completing an export emits events (who exported, when, package
      identity).
- [ ] Accessibility (NFR-001): export progress is announced to assistive tech via a live region, not
      conveyed by a progress bar alone; the provisional-items warning is text, not color-only.

## Out of Scope
Authoring the presentation-ready AAR *document* narrative itself (Cadence's job — E10 §4 "Out of
scope: ... AAR document authoring ... (all Cadence)"); the retention/expiry policy for exported
packages (story 02); building the individual artifacts this story bundles (each is owned by its
originating feature — this story is the packaging/export action only).

## Technical Notes
Staff world; `features/evaluator/components/export/AarExportFlyout.tsx`, `hooks/useAarExport.ts` (a
bundling job with mocked progress behind the shared axios client until a real backend export-job/
queue contract exists — that is a serial dependency once defined). Registers into the D7 shell
toolstrip — does not draw its own strip, same pattern as the Annotations tool
(`evaluator-tools/03`). See `implementation.md`.

## Dependencies
`evaluation-timeline` (log + replay bundle sources); `evaluator-tools` (annotations, incl. unpushed
count); `evaluation-metrics` (metrics + scenario-design record, incl. story 02's provisional
coverage count); `posts`/`soft-delete-tombstones` (CTL-025 takedown logging); E9/`INT-032` for the
Cadence-ZIP-slot contract.

## Tests
- Component (RTL): manifest-contents test (five lines, correct per-line detail).
- Component (RTL): provisional-warning-count test.
- Component (RTL): export-progress-and-named-result test.
- Integration: takedown content is logged in the archive but never republished.
