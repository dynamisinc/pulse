# Story: Exercise report: when the verified-vs-lookalike section appears

**Feature:** Demo feedback cut (10/20)  ·  **Phase:** 1 (post-demo)  ·  **Status:** Not Started · backlog
**Requirements:** EVL-030 (lite), SOC-052  ·  **Decisions:** none yet  ·  **Issue:** #569
**Stack:** backend + frontend  ·  **Review:** Tier-1  ·  **Priority:** Should  ·  **Effort:** S

## Context

The printable report ([29](29-printable-exercise-report.md)) pairs an unverified persona with a verified one when its
handle starts with the verified handle and both authored posts anywhere in the exercise. On the 10/16 UAT PDF the
section showed "Fairhaven Water Utility: 0 likes, 0 reposts" against "Fairhaven Water Update: 0 likes, 1 repost" and
concluded "@FairhavenWaterUpd was reposted more than @FairhavenWater." With engagement that small, the comparison and
the full-width bar overstate a non-event, and once the time window scopes the whole report (story 31) a pair can
appear when one side did not post inside the window at all.

## Acceptance Criteria (draft, settle before build)

- [ ] A pair is shown only when **both** personas authored at least one post inside the report's window.
- [ ] The comparison sentence appears only when the difference is meaningful: decide the rule before build (for
      example, the larger total is at least 10 and at least 1.5× the smaller). Otherwise print the numbers without a
      verdict.
- [ ] Bars are scaled to a fixed minimum range (e.g. 10) so a 1-vs-0 difference never draws a full-width bar.
- [ ] Optional: let a controller name the lookalike pairs for the exercise (exercise configuration), overriding the
      handle-prefix heuristic, for impersonators that do not share a prefix.
- [ ] Each pair also shows post counts in the window, so engagement is read against activity.
- [ ] Isolation and NFR-001 (numbers in text; verified state in text) as in story 29.

## Out of Scope

Detecting impersonation by avatar or display-name similarity; scoring participants on it.

## Dependencies

Story 31 (time window scopes the whole report).

## Tests

Backend: pair omitted when one side has no posts in the window; verdict rule boundaries; configured pairs override the
heuristic (if built). Frontend: bars at the minimum range; no verdict sentence below the threshold.
