# Story: Notifications, derived client-side (Could)

**Feature:** Demo polish  ·  **Epic:** E2  ·  **Phase:** 1  ·  **Status:** Not Started
**Requirements:** SOC-070 (lite), SOC-071 (aggregation), NFR-001, COR-053  ·  **Design decisions:** D1-005 (aggregate under load), D1-011  ·  **Issue:** #435
**Story ID:** F7  ·  **Stack:** frontend  ·  **Priority:** Could  ·  **Effort:** M  ·  **Wave:** 3 slot (after F1 merged)  ·  **Cut line 2:** first thing cut
**Home story:** [`notifications/01`](../notifications/01-notification-center.md) (lite).

## Context
**As** a PIO, **I want** a bell with a count that tells me when someone replied to me, mentioned me or liked my
post, **so that** the app feels alive without a notifications backend. There is no notification service: this
story **derives** notifications on the client from data the app already loads (replies to my posts, `@mentions`
of my handle, like-count increases on my posts). **World: participant** — no COBRA/MUI. Notifications/Messages
were deliberately *absent* from F1's nav; this story adds only Notifications.

## Acceptance Criteria
- [ ] **Derived items.** Given the loaded feed (with `includeReplies`) and the session persona, then the list
      contains: (a) replies whose `inReplyTo.postId` is one of my posts, (b) posts whose text contains
      `@myhandle`, (c) one aggregated row per my post whose `counts.like` rose since I last looked ("Your post
      got 3 new likes"). Nothing is fabricated; with nothing new the page shows an honest empty state.
- [ ] **Bell and badge.** The nav rail shows a Notifications link with an unread count rendered as **text**
      (`99+` cap) with an accessible name "Notifications, N unread" — never a color-only dot; absent for
      read-only / persona-less sessions (D1-011).
- [ ] **Page.** `/notifications` lists items newest-first in **scenario time**, each with a typed icon **and**
      text label (reply / mention / like), opening the relevant thread on activation; "Mark all read" persists
      per persona in `sessionStorage` under an exercise-scoped key and clears the badge.
- [ ] **Live and calm.** Reply and mention items arrive through the existing realtime feed subscription
      (`PostReceived`). **Like items come from count changes on the viewer's own posts**, detected by
      refetching the feed every 30 s while the tab is visible: B3 adds no reaction broadcast, and
      `PostReceived` never carries a like. New items get a polite live-region announcement; under a burst, items are aggregated (same post, same type) so the page stays
      legible (D1-005/SOC-071).
- [ ] **Isolation.** The derivation reads only the session's exercise-scoped feed; the storage key includes the
      exercise id; nothing is read from another persona.

## Out of Scope
A notifications endpoint, push, DMs/follows/reposts notifications, per-type settings, the platform alert
notification (SOC-072 — alert bar era), email.

## Technical Notes
- Files: implementation.md §4.1 row F7 — `social/notifications/**` (new) plus a **minimal** edit to F1's
  `layout/NavRail.tsx` and `layout/SocialRoutes.tsx` (allowed only after F1 has merged; no other Wave-3 story
  touches them). Reuse `resolveFeed`/`useFeed`, `realtimeFeed.subscribe`, `useSession().personaId`,
  `formatScenarioTime`.
- Like-increase detection compares `counts.like` against a per-post snapshot stored in `sessionStorage`; first
  load establishes the baseline (no retroactive "new likes").

## Dependencies
F1 merged; F0 fixtures. No backend. Built only if time remains after Wave 2/3 (Cut line 2).

## Tests
- Derivation unit tests (reply/mention/like-increase, first-load baseline, aggregation, empty), badge
  text/accessible name, mark-all-read persistence and exercise-scoped key, scenario-time rendering, absent for
  read-only.
