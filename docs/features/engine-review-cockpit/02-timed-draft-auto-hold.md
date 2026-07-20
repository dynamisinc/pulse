# Story: Timed-draft expiry auto-HOLDs (never auto-sends)

**Feature:** Engine review cockpit  ·  **Epic:** E7  ·  **Phase:** 1  ·  **Status:** Not Started
**Requirements:** ADP-040  ·  **Design decisions:** D5-014/1.1 (supersedes D5-005)  ·  **Issue:** #35

## Context
Safety-critical. When a delayed/timed engine draft's countdown expires without a controller decision,
it must **auto-HOLD**, not auto-send. The D5 review reversed the original "inaction = approval"
behavior: **silence is never approval.** An expired draft holds ("timer expired — held for you") and
surfaces in the NEEDS-YOU bar for an explicit decision.

> **Amendment (D5-014/1.1, supersedes D5-005).** Before: expired timed drafts auto-**send**. After:
> expired drafts **auto-HOLD** and surface in NEEDS YOU; auto-send exists only via swamped mode
> (story 03). Automation never escalates its own autonomy.

## Acceptance Criteria
- [ ] Given a delayed/timed draft, when its countdown reaches zero **without** a controller decision,
      then the draft moves to **HELD** (not published) with a "timer expired — held for you" state.
- [ ] The held-on-expiry draft appears in story 01's **inline pending/held indicator**
      (`useReviewQueue`) as an outstanding to-do — console-shell/02's NEEDS-YOU bar is not built yet
      and will surface it once it lands; it publishes only on an explicit later Approve.
- [ ] **No draft is ever auto-published on timeout** in the default configuration (verified — the only
      path to timeout auto-send is swamped mode, story 03).
- [ ] The expiry→HOLD transition is logged with its trigger/storyline (ADP-041/XC-004).
- [ ] Countdown + expiry state are conveyed by text/number, not color alone (NFR-001).

## Out of Scope
Swamped-mode auto-send (story 03); the base queue actions (story 01); the engine's countdown
generation (E8, Phase 2 — mock the timer now).

## Technical Notes
Staff world (COBRA). `useDraftTimer` calls story 01's `autoHoldPolicy.decide()` (the TS mirror of the
backend `AutoHoldPolicy.Decide`) against the current scenario minute; the terminal action is HOLD
unless the caller passes `swampedMode: true` (an **input parameter**, not an import of story 03 — keeps
the two files disjoint). Held-on-expiry items feed story 01's `useReviewQueue()` inline indicator, not
`useToDos` (console-shell/02's NEEDS-YOU bar is not built yet). See implementation.md (story 02). Ticks
STORY-UPDATES.md §A **ADP-040** and §C RECONCILE (D5-005 superseded).

## Dependencies
Story 01 (queue + HELD state + inline indicator + `autoHoldPolicy`); story 03 (supplies the
`swampedMode` boolean — the only auto-send path). E8 timers (Phase 2). console-shell/02's NEEDS-YOU
bar is not built yet (will surface this state once it lands).

## Tests
- Unit: a timer expiring with no decision sets state HELD and does not publish (default config).
- Unit: the held-on-expiry item appears in the NEEDS-YOU to-dos and logs the transition.
