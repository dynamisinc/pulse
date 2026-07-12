# Story: Attention levers (suggested-follows, flag-as-alert, trend boost)

**Feature:** World steering  ·  **Epic:** E7  ·  **Phase:** 1  ·  **Status:** Not Started
**Requirements:** CTL-021 (SOC-041, SOC-053, SOC-072)  ·  **Design decisions:** none  ·  **Issue:** #24

## Context
The controller's soft steering: adjust suggested-follows to point attention at key agencies/outlets
(SOC-053), flag a piece of content as a platform-wide alert (SOC-072 — the pilot-mode alert path
before the portal alert bar), and apply a trend **boost-weight** so a topic trends on cue (SOC-041).
Each is a logged steering action, and each must render to participants as **organic**, never as a
platform-declared badge (CTL-021).

## Acceptance Criteria
- [ ] Given the console, when the controller edits suggested-follows (add/remove/reorder), then the
      participant-facing suggested-follows change accordingly (SOC-053) with no indication a
      controller set them.
- [ ] When the controller flags content as a platform alert, then it delivers as a platform-wide
      notification (SOC-072) in pilot mode; nothing marks it as controller-originated to participants.
- [ ] When the controller applies a trend boost-weight to a topic, then the topic's trend weight is
      biased, but the trend still renders as an ordinary organic trend (SOC-041) — never labelled
      "boosted/official".
- [ ] Each lever action is logged as a steering action (XC-004) with actor + scenario time; the levers
      are staff-only (XC-002) and scoped to the active exercise (COR-001).
- [ ] Alert/notification severity is conveyed by icon/label, not color alone (NFR-001).

## Out of Scope
The escalation dial (story 02); the portal alert bar and Top-Stories pinning (CTL-020, Phase 3); the
trending computation itself (E2 SOC-041) and notification plumbing (E2 SOC-072) — this story drives
them, it doesn't build them.

## Technical Notes
Staff world (COBRA). Thin controls over E2 mechanisms (suggested-follows, notifications, trend
weight). "Boost-weight" biases input to the organic trend calc — it never sets a trend directly. See
implementation.md (story 01).

## Dependencies
E2 SOC-041 (trending), SOC-053 (suggested follows), SOC-072 (platform notifications); console-shell;
telemetry emitter.

## Tests
- Unit: a boost-weight biases the trend input but the rendered trend has no "boosted" marker.
- Unit: each lever emits a steering-action telemetry event.
- Component (RTL): editing suggested-follows updates the participant-facing list.
