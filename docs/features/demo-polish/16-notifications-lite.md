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
      **Mention storms aggregate:** top-level mentions each keep a row of their own until MORE than 5 arrive
      within 60 s of *scenario* time; from then on they fold into one rolling storm row ("Keisha and 41 others
      mentioned you") that opens the newest mention, counts as ONE unread group on the badge, and keeps
      absorbing mentions within 60 s of its span until the burst stops. Mentions that are replies under one
      post already group by that post. Counts on a pushed post already known to be mine are ignored — only a
      feed read can move a like count (or lower its baseline).
      *Tests:* `n/notificationModel.test.ts` (replies, mentions and their handle boundaries, like rise,
      first-load baseline, unlike, aggregation, empty, own activity never notifies; "mention storms fold into
      ONE row"; "counts only move with a feed READ");
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
      per persona in **`localStorage`** under an exercise-, persona- and account-scoped key
      (`pulse.notifications.v1:{exerciseId}:{personaId}:{accountId}`) and clears the badge. (*Amended:* it was
      `sessionStorage`; easy-login 07 moves participant tokens to `localStorage`, so the read marks and like
      baselines must outlive a closed tab too, or every reopen would show the whole feed as unread again. The
      account id keeps two humans who each log in to a shared org persona from sharing read marks.)
      *Tests:* `n/NotificationsFlow.test.tsx` › "the page" and › "Mark all read" (newest first, icon + label,
      scenario-time stamp and zone, activation opens the thread and Back returns, heading focus, one `view`
      event, persistence, a closed-and-reopened tab); `n/notificationsStore.test.ts` › "state lives in
      localStorage"; `n/notifications.guards.test.ts` (contrast of every colour pair, light only, no
      wall-clock).
- [x] **Live and calm.** Reply and mention items arrive through the existing realtime feed subscription
      (`PostReceived`). **Like items come from count changes on the viewer's own posts**, detected by
      refetching the feed about every 30 s (first tick random; later ticks ±15 %; exponential backoff to ≈5 min
      on repeated failures; the baseline and the catch-up read after a hidden tab or a pause are jittered 0–2 s;
      the re-read holds while the shell's pause / EndEx overlay is up) while the tab is visible: B3 adds no reaction broadcast, and `PostReceived` never
      carries a like. New items get a polite live-region announcement (throttled to one per ≈12 s, held items
      spoken together, and dropped by "Mark all read"; mounted outside the frame that goes `inert` while
      composing, so a compose in progress does not swallow it); under a burst, items are
      aggregated (same post, same type; mention storms as above) so the page stays legible (D1-005/SOC-071). A taken-down post drops out.
      The model is bounded (newest 500 rows), so a long session costs the same per snapshot as a short one.
      *Tests:* `n/notificationsStore.test.ts` (baseline vs live, arrivals before the baseline, the re-read and
      its visibility gating, jitter and backoff, no overlapping reads, burst cost — one coalesced publish and one
      throttled announcement for 120 arrivals —, takedown, row cap, "Mark all read" clears the badge after more
      than 500 events); `n/notificationModel.test.ts` › "the model is bounded", "Mark all read never leaves an
      old event unread", "cost under a burst"; `n/NotificationsFlow.test.tsx` › "live and calm" (incl.
      announcing while the compose modal is open and a 120-mention burst capped at `99+` / 100 rows).
- [x] **Isolation.** The derivation reads only the session's exercise-scoped feed; the storage key includes the
      exercise id, the persona id and the account id; nothing is read from another viewer. Starting a session
      sweeps every notification entry that is not the current viewer's (one browser holds one participant
      session). Sign-out sweeps **both** `localStorage` and `sessionStorage` (registered with
      `core/auth/sessionReset`) — but only in a tab that ever ran a notifications session, so a staff
      sign-out cannot wipe a participant's state. If another tab removes the current key, this tab ends its
      session without writing its stale state back.
      *Tests:* `n/notificationStorage.test.ts` (key scope, no collision, untrusted values, sweep, merge);
      `n/notificationsStore.test.ts` › "Mark all read", "state lives in localStorage", "storage hygiene",
      "sign-out only wipes what this tab owns", "stop / restart / reset" (another persona / exercise /
      account start clean; a read landing after sign-out writes nothing; a `storage` event from another tab);
      `n/NotificationsFlow.test.tsx` › "absent, not inert" (a `preview` mount makes no `includeReplies`
      read and writes no key);
      `n/NotificationsFlow.test.tsx` › "sign-out".

## Out of Scope
A notifications endpoint, push, DMs/follows/reposts notifications, per-type settings, the platform alert
notification (SOC-072 — alert bar era), email.

## Technical Notes
- Files: implementation.md §4.1 row F7 — `social/notifications/**` (new) plus **minimal** edits to F1's
  `layout/NavRail.tsx`, `layout/SocialRoutes.tsx` (the `/notifications` route), `layout/socialNavigation.ts`
  (the route vocabulary: `/notifications` is a reserved segment, never a persona handle) and
  `SocialChannel.tsx` (mounts the engine outside the inert-while-composing frame and passes
  `showNotifications`). The staff preview needs no change: its `preview` variant has no affordances, so the
  engine never starts there. Reuse `resolveFeed`, the ref-counted `defaultArrivalSource`, `useSession().personaId`,
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
- **Shared persona / shared account.** The key is exercise + persona + account. Two humans who log in to a
  shared org persona with *different* accounts get separate read marks. Two humans on the *same* shared
  account (or one account in two browsers) are one viewer: they share read marks (last writer wins for a
  record both tabs know; read marks are unioned). Until easy-login 07 merges, participant tokens are still in
  `sessionStorage`, so on such a build this state can outlive the token across a closed tab — harmless
  (nothing in it is content, and the next `start()` sweeps entries that are not the signed-in viewer's), but
  not "lives and dies with the token".
- A mention storm's membership is not capped (only the row count is), like a reply group's; it is bounded by
  what a session can receive.
- Reserved-handle validation (a persona whose handle is `notifications`, `home`, …) is a separate follow-up.

## Dependencies
F1 merged; F0 fixtures. No backend. Built only if time remains after Wave 2/3 (Cut line 2).

## Tests
- Derivation unit tests (reply/mention/like-increase, first-load baseline, aggregation, empty), badge
  text/accessible name, mark-all-read persistence and exercise-scoped key, scenario-time rendering, absent for
  read-only — see the per-AC links above. Guards: `n/notifications.guards.test.ts` (two worlds, light only,
  no wall-clock, computed contrast); the F6 "one feed read" counter in `explore/ExploreIntegration.test.tsx`
  now pins the engine's single `includeReplies` read separately from the top-level reads.
