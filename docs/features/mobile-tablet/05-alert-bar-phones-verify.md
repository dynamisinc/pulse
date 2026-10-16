# Story: Alert bar on phones: verify and close remaining gaps

**Feature:** Phones and tablets  ·  **Epic:** E1  ·  **Phase:** 2  ·  **Status:** Not Started
**Requirements:** PRT-010, PRT-012, NFR-001, COR-053  ·  **Design decisions:** D7-002  ·  **Issue:** #524

## Context
The core phone defects were reported on 10/16 (text truncated to about 3 characters, bar covering the channel label,
"Details ->" going to a missing `/alerts`) and **already fixed by PR #562**: the bar wraps, the shell reserves
`--pulse-alert-height`, and `/alerts` is a real route (`AlertsRoute`, see
[participant-shell/02](../participant-shell/02-alert-bar-host.md)). This is a **verify-and-close-gaps** story, not a
rebuild. Participant world; the EAS analog persists across every channel.

### Verification run (10/16, mock server, Chromium touch, 360/390/768)
- **Verified:** full message at all three widths (band 87 px tall at 360/390, 47 px at 768); `--pulse-alert-height`
  matches; nothing overlaps the channel nav or page headers; "Details →" opens `/alerts`; no horizontal scroll.
- **Gap G1:** "Details →" hit area is 52×18 and the "+N more" chip is 67×16. Both are under 44 px.
- **Gap G2 (COR-053):** at ≥ 768 px the `ChannelNav` dateline shows the **wall-clock** date ("OCT 16, 2026") while posts
  show scenario time (Sep 4 2033). No real `IExerciseClock` is installed on participant paths
  ([exercise-clock/01](../exercise-clock/feature.md) #77 Not Started), so the default clock mirrors wall time.
  Mitigation here: hide the dateline while only the default wall-mirroring clock is installed. It comes back
  once story 01 installs the real provider.

## Acceptance Criteria
- [ ] G1: on a coarse pointer, "Details →" and "+N more" have hit areas of at least 44×44 CSS px. The visual size of the band does not grow.
- [ ] G2: the `ChannelNav` dateline does not render while only the default (wall-mirroring) exercise clock is installed. It renders scenario time once a real clock is installed with `setExerciseClock`. Unit-tested both ways.
- [ ] Given info, advisory and emergency alerts at 360, 390 and 768 px, when the bar renders, then the full message is visible (wrapped, never ellipsized), the severity chip shows icon plus text label, and nothing overlaps the channel nav or the compliance chrome (`expectNoHorizontalScroll` and bounding-box non-overlap).
- [ ] Given an alert is active, when the page scrolls, then the in-flow content begins below the bar (published `--pulse-alert-height` matches the bar's measured height within 1px) at all three widths, including multi-alert (+N more) and ticker rotation.
- [ ] Given "Details ->", when tapped (target at least 44px), then it navigates client-side to `/alerts` listing active alerts most severe first, and browser Back returns to the prior screen with scroll preserved.
- [ ] Given an emergency alert together with a pause/Freeze overlay on a phone, when both are active, then neither hides the other's required text and the overlay's focus trap still works (interplay check).
- [ ] Given an alert timestamp, then it renders in scenario time (COR-053); `expectNoWallClock` passes.
- [ ] Accessibility (NFR-001): `role="status"` and live-region announce on change still fire at phone sizes; severity is never color-only; reduced-motion stops ticker rotation (verify, fix if not).
- [ ] Any gap found is fixed in `AlertBar/*` or `ShellLayout`; if none is found the PR records "verified, no change" with the spec as evidence. User guide: `docs/guide/participant-guide.md` alert-bar section confirmed accurate; `participant-alert-bar` shot recaptured at phone sizes (story 08).

## Out of Scope
Alerts history for expired/cleared alerts (needs the backend feed), alert content authoring, a redesign of the ticker (D7-002
stays), push notifications.

## Technical Notes
Use the guide-shots `alerts` override to inject alerts in e2e. Files: `participant-shell/components/AlertBar/*`,
`ShellLayout.tsx`, `ChannelNav.tsx`. Existing unit tests: `AlertBar.mobile.test.tsx`, `AlertsHistory.test.tsx`,
`ShellLayout.test.tsx`. See `implementation.md` story 05.

## Dependencies
Story 01. PR #562 merged.

## Tests
`e2e/alert-bar.phone.spec.ts` (new); the three existing unit test files above stay green.
