# Story: Participant touch targets at 44px

**Feature:** Phones and tablets  ·  **Epic:** E2  ·  **Phase:** 2  ·  **Status:** In Review
**Requirements:** NFR-001 (WCAG 2.1 AA; 2.5.8 target size), D0 §4.6  ·  **Design decisions:** none  ·  **Issue:** #524

## Context
Audit gap G4: on a coarse pointer many participant controls are under 44px. One focused sweep, so the stories that fix layout do not also fight over hit areas.
Participant world: the visible controls keep their brand look; only the hit area grows (padding or an extended `::before` hit area), never a visual redesign.
Inline text links inside running prose (author names, "Sign in here.") are exempt under the WCAG 2.5.8 inline exception.

## Acceptance Criteria
Measured on a coarse pointer at 360, 390 and 768 with `expectTouchTargets(page, locator, 44)`:
- [x] Post action row on every post card (feed, thread, profile, hashtag, Pinned): Reply, Repost, Like (currently ~41-60x23) and Pin (27x23) are each at least 44x44, with adjacent targets not overlapping.
- [x] Composer and reply composer: Add photos/video and Add emoji (36x36), Post (71x34) and Reply (79x34) are each at least 44x44; the composer layout does not overflow at 360.
- [x] `DetailHeader` Back (36x36) and the participant Sign out control (40x40) are at least 44x44.
- [x] Profile "N Followers" / following links (101x19) are at least 44px tall.
- [x] Given a mouse pointer on desktop, then the visual layout is unchanged (use `@media (pointer: coarse)`, real layout space rather than an invisible hit-area extension; no density regression for desktop), verified by the existing layout tests staying green.
- [x] An exemption list (inline prose links, controls in the media viewer owned by story 04, alert bar owned by story 05, channel nav owned by story 17) is stated in the spec so the helper does not flag them.
- [x] Accessibility (NFR-001): focus ring still visible and not clipped by the extended hit area; accessible names unchanged.
- [x] User guide: no guide impact.

## Out of Scope
Media viewer controls (04), alert bar (05), channel nav links (17), any new controls, desktop restyling, staff surfaces (stories 14, 15).

## Technical Notes
Files: `features/social/components/post/PostActions.*`, `components/{Composer,ReplyComposer}.*` (module CSS only), `layout/DetailHeader.*`, `pages/Profile.*`,
`participant-shell/components/ParticipantSignOutControl.*`, and the shared `--pulse-touch-min: 44px` on the social root. Runs after story 02 (same CSS modules). See `implementation.md` story 18.

## Dependencies
Stories 01, 02.

## Tests
`e2e/participant-touch-targets.phone.spec.ts` (per screen x viewport); existing `PostCard*`, `Composer*`, `FollowButton*` tests stay green.

## Implementation notes
Real layout space on `@media (pointer: coarse)` (min 44px via `--pulse-touch-min`, published by `SocialBrandScope`), no pseudo-element slop (PR #584 lesson): action rows, composer buttons, Back and Followers grow a little taller on touch devices. Profile "Following" is plain text, not a control. Sign out was done in story 02. SG-005: the thread focused post's bottom margin now grows by 6% of its layout height (ResizeObserver) so the 1.06 scale never reaches the first reply.

*Gate-1 note (10/16):* the SG-005 focused-post margin fix (ThreadView `ResizeObserver`) applies on **all pointers**. It is a bug fix, since the scaled card also overlapped the first reply on desktop, not a density change. AC5's "mouse layout unchanged" covers the 44 px rules only. Deferred: a unit test that pins the observer math with a stubbed `ResizeObserver` (S-004), and a drift guard tying `FOCUSED_SCALE` to the CSS `scale(1.06)` (S-002).
