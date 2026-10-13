# Story: Notifications, derived client-side (Could)

**Feature:** Demo polish  ·  **Epic:** E2  ·  **Phase:** 1  ·  **Status:** In Review
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
Test paths are under `src/frontend/src/features/social/` (`n/` = `notifications/`, `l/` = `layout/`).

- [x] **Derived items.** Given the loaded feed (with `includeReplies`) and the session persona, then the list
      contains: (a) replies whose `inReplyTo.postId` is one of my posts, (b) posts whose text contains
      `@myhandle`, (c) one aggregated row per my post whose `counts.like` rose since I last looked ("Your post
      got 3 new likes"). Nothing is fabricated; with nothing new the page shows an honest empty state.
      *Tests:* `n/notificationModel.test.ts` (replies, mentions and their handle boundaries, like rise,
      first-load baseline, unlike, aggregation, empty, own activity never notifies);
      `n/NotificationsFlow.test.tsx` › "derived items" (through the real channel, incl. the
      `includeReplies` read and the empty state).
- [x] **Bell and badge.** The nav rail shows a Notifications link with an unread count rendered as **text**
      (`99+` cap) with an accessible name "Notifications, N unread" — never a color-only dot; absent for
      read-only / persona-less sessions (D1-011). The bell is gated on **both** the shell variant
      (`affordancesAvailable(variant)`, passed to `NavRail` as `showNotifications`) and the engine running for
      this viewer.
      *Tests:* `l/NavRail.notifications.test.tsx` (text badge, `99+`, accessible name, absent unless
      `showNotifications`, `aria-current`); `n/notificationText.test.ts` (badge strings);
      `n/NotificationsFlow.test.tsx` › "absent, not inert" (`readOnly` / `preview` / `kiosk` mounts);
      `n/NotificationsFlow.session.test.tsx` (persona-less and read-only sessions, plus a control that an
      ordinary session gets the bell).
- [x] **Page.** `/notifications` lists items newest-first in **scenario time**, each with a typed icon **and**
      text label (reply / mention / like), opening the relevant thread on activation; "Mark all read" persists
      per persona in **`localStorage`** under an exercise- and persona-scoped key
      (`pulse.notifications.v1:{exerciseId}:{personaId}`) and clears the badge. (*Amended:* it was
      `sessionStorage`; participant tokens now persist across a closed tab — easy-login 07 — so the read marks
      and like baselines must too, or every reopen would show the whole feed as unread again.)
      *Tests:* `n/NotificationsFlow.test.tsx` › "the page" and › "Mark all read" (newest first, icon + label,
      scenario-time stamp and zone, activation opens the thread and Back returns, heading focus, one `view`
      event, persistence, a closed-and-reopened tab); `n/notificationsStore.test.ts` › "state lives in
      localStorage"; `n/notifications.guards.test.ts` (contrast of every colour pair, light only, no
      wall-clock).
- [x] **Live and calm.** Reply and mention items arrive through the existing realtime feed subscription
      (`PostReceived`). **Like items come from count changes on the viewer's own posts**, detected by
      refetching the feed about every 30 s (first tick random; later ticks ±15 %; exponential backoff to ≈5 min
      on repeated failures) while the tab is visible: B3 adds no reaction broadcast, and `PostReceived` never
      carries a like. New items get a polite live-region announcement (mounted outside the frame that goes
      `inert` while composing, so a compose in progress does not swallow it); under a burst, items are
      aggregated (same post, same type) so the page stays legible (D1-005/SOC-071). A taken-down post drops out.
      The model is bounded (newest 500 rows), so a long session costs the same per snapshot as a short one.
      *Tests:* `n/notificationsStore.test.ts` (baseline vs live, arrivals before the baseline, the re-read and
      its visibility gating, jitter and backoff, no overlapping reads, burst cost — one coalesced publish and one
      throttled announcement for 120 arrivals —, takedown, row cap, "Mark all read" clears the badge after more
      than 500 events); `n/notificationModel.test.ts` › "the model is bounded", "Mark all read never leaves an
      old event unread", "cost under a burst"; `n/NotificationsFlow.test.tsx` › "live and calm" (incl.
      announcing while the compose modal is open and a 120-mention burst capped at `99+` / 100 rows).
- [x] **Isolation.** The derivation reads only the session's exercise-scoped feed; the storage key includes the
      exercise id and the persona id; nothing is read from another persona. Sign-out sweeps **both**
      `localStorage` and `sessionStorage` (registered with `core/auth/sessionReset`).
      *Tests:* `n/notificationStorage.test.ts` (key scope, no collision, untrusted values, sweep, merge);
      `n/notificationsStore.test.ts` › "Mark all read", "state lives in localStorage", "stop / restart /
      reset" (another persona / another exercise start clean; a read landing after sign-out writes nothing);
      `n/NotificationsFlow.test.tsx` › "sign-out".

## Out of Scope
A notifications endpoint, push, DMs/follows/reposts notifications, per-type settings, the platform alert
notification (SOC-072 — alert bar era), email.

## Technical Notes
- Files: implementation.md §4.1 row F7 — `social/notifications/**` (new) plus **minimal** edits to F1's
  `layout/NavRail.tsx`, `layout/SocialRoutes.tsx` (the `/notifications` route), `layout/socialNavigation.ts`
  (the route vocabulary: `/notifications` is a reserved segment, never a persona handle) and
  `SocialChannel.tsx` (mounts the engine outside the inert-while-composing frame and passes
  `showNotifications`). Reuse `resolveFeed`, the ref-counted `defaultArrivalSource`, `useSession().personaId`,
  `formatScenarioTime`/`useScenarioTime`, the shared `SocialDirectory`.
- Like-increase detection compares `counts.like` against a per-post snapshot stored in **`localStorage`**;
  first load establishes the baseline (no retroactive "new likes"). **Migration:** none — the earlier
  `sessionStorage` placement never shipped, so there is nothing to migrate; sign-out still sweeps any such
  leftover entry. Two tabs of one persona share the key: writes are merged (read marks unioned) so one tab does
  not undo the other's "Mark all read"; for a record both tabs know, the last writer wins.
- Only what is *written* is bounded (newest 500 read ids, 200 like records); the live read set is never
  trimmed, so "Mark all read" clears every row however many events there are.

## Known limitations / follow-ups
- **The feed window.** The re-read is `GET /api/feed?includeReplies=true`, which returns only the newest 200
  posts (`PostReadService.FeedTake`). Live likes, and replies seen after a reload, are therefore only visible
  for posts still inside that window — under a 120-posts/min burst that is about 100 s. Live replies and
  mentions still arrive through the realtime path while the tab is open. The real fix is a backend own-posts
  read (`GET /api/feed?author=self`), to be filed as a post-demo follow-up.
- In mock mode nothing raises a like count, so the like path is demonstrated by the store tests (fake timers),
  not in the browser.
- Reserved-handle validation (a persona whose handle is `notifications`, `home`, …) is a separate follow-up.

## Dependencies
F1 merged; F0 fixtures. No backend. Built only if time remains after Wave 2/3 (Cut line 2).

## Tests
- Derivation unit tests (reply/mention/like-increase, first-load baseline, aggregation, empty), badge
  text/accessible name, mark-all-read persistence and exercise-scoped key, scenario-time rendering, absent for
  read-only — see the per-AC links above. Guards: `n/notifications.guards.test.ts` (two worlds, light only,
  no wall-clock, computed contrast); the F6 "one feed read" counter in `explore/ExploreIntegration.test.tsx`
  now pins the engine's single `includeReplies` read separately from the top-level reads.
