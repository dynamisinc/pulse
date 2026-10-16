# Story: Participant entry screens on phones (join, sign-in, holding page)

**Feature:** Phones and tablets  ·  **Epic:** E1  ·  **Phase:** 2  ·  **Status:** In Review
**Requirements:** NFR-001, D0 §4.6  ·  **Design decisions:** none  ·  **Issue:** #524

## Context
The first thing a participant sees on their own phone is the join link (QR/personal link), the sign-in (name + day word)
and, during pause/Freeze/EndEx, the holding page. These must work at 360/390/768 px. Participant world. The holding page
has in-fiction and out-of-fiction registers (CTL-023); the exercise compliance chrome must stay visible.

## Acceptance Criteria
- [x] Given `/join` and the participant sign-in at 360, 390 and 768 px, when loaded, then there is no horizontal scroll and the primary action is at least 44px tall and reachable above the keyboard.
- [x] Given the sign-in form, when a field gains focus on a touch device, then it carries the right input hints (`autocomplete`, `autocapitalize="none"`, `autocorrect="off"`, `inputmode`) so the day word and handle are not mangled by the phone keyboard.
- [x] Given a pause or Freeze overlay in each register (in-fiction, out-of-fiction) at 360/390/768, when shown, then the message is fully visible without scrolling the page, the compliance chrome is not covered, and focus is trapped per existing `useOverlayFocusTrap`.
- [x] Given EndEx and the holding page, when shown, then the severity/state is carried by text and icon, never color alone (NFR-001).
- [x] Given the join link, when opened, then the page still sets `no-store`/`no-referrer` behavior (unchanged; asserted in `staticWebAppConfig.test.ts`) and the join token is not shown in any visible text.
- [ ] The participant sign-out control's 44px hit area (audit: 40x40) was delivered by story 02 (#586); originally listed under story 18. Here only verify its confirmation fits the viewport at 360/390/768.
  (Left open: the 44px hit area is done in story 02 (#586; originally listed under story 18), and the control has no confirmation step today, so there is nothing to verify here.)
- [x] User guide: update the join/sign-in and holding-page sections of `docs/guide/participant-guide.md` and `docs/guide/troubleshooting.md` (player stuck on the holding page on a phone) if wording changes. (No user-visible wording changed; guide files left as is.)

## Out of Scope
Changing the sign-in model, passwords (Session A), the PWA (09-11), alert bar (05).

## Technical Notes
Files: `features/login/pages/{JoinPage,ParticipantSignInPage}.*`, `participant-shell/components/OverlayLayer/*`,
`ParticipantSignOutControl.tsx` (layout only; hit area in 18). Use the guide-shots `overlay` override to trigger pause/Freeze/EndEx in e2e. Participant
world only: do not import COBRA. See `implementation.md` story 03.

## Dependencies
Story 01.

## Tests
`e2e/participant-entry.phone.spec.ts`; existing login and OverlayLayer unit tests stay green.
