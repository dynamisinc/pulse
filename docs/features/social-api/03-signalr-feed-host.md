# Story: SignalR feed host — real-time fan-out + polling fallback

**Feature:** Social API (backend)  ·  **Epic:** E2  ·  **Phase:** 1  ·  **Status:** Not Started
**Requirements:** SOC-083, NFR-003 (COR-001/002, XC-002)  ·  **Design decisions:** none  ·  **Issue:** —

## Context
This is the story that makes a controller's post appear in a **different participant's browser**.
`postStore.ts` says so itself: it is "an in-memory store in one tab… no cross-tab /
cross-participant fan-out" (`postStore.ts:20-21`) — the loop looks alive on one machine and is dead
across sessions. This story replaces that in-memory pub/sub with a real SignalR hub, exercise-
scoped by group, plus the NFR-003 polling fallback. It directly **unblocks**
`feeds-discovery/04-realtime-new-posts-pill` (Not Started, #123) — the buffered "▲ N new posts"
pill — which this story does not build or rewrite; it ships the transport that story's
`useFeedStream()` will consume.

Two existing code comments already anticipate this exact seam and its shape: `overlayState.ts`
("overlay pushes are server state that will ultimately arrive over the shared SignalR connection —
**one connection, new handlers added to it** — rather than polling," `overlayState.ts:17-19`) and
`useAlerts.ts` ("swap this constant + `mockAdapter` for a live `/alerts` call (plus a SignalR
push)," `useAlerts.ts:33`). `live-monitoring/feature.md`'s own Dependencies line names "the SignalR
real-time host" as something CTL-030 will need later, too. This story is the **first** consumer,
not the only one — its frontend connection module must be built as a shared primitive future
consumers add handlers to, not a feed-specific fork.

## Acceptance Criteria
- [ ] **Exercise-scoped group membership.** Given a client establishes a SignalR connection, when
      the hub's connection handler resolves the connection's exercise scope (`IExerciseContext`,
      the same mechanism the HTTP endpoints use), then the connection is added to a group keyed by
      that resolved exercise only (e.g. `exercise:{exerciseId}`) — the group name is never a
      client-supplied parameter.
- [ ] **Fan-out on publish — the headline behavior.** Given a post is persisted via
      `02-post-write-api` for exercise A, when the server broadcasts it, then every currently-
      connected session in exercise A's group receives a `PostReceived` push, and no session in any
      other exercise's group receives anything. This closes the exact gap `postStore.ts` names
      above.
- [ ] **XC-002 guarantee, unconditional (testable).** Given a `PostReceived` push, when its payload
      is inspected, then it carries no `origin`/`actingHumanId`/`createdWallClock`/`injectId` — the
      same participant-safe shape as `01-feed-read-api`'s reads, unconditional (this route's
      documented first consumer, `feeds-discovery/04`'s future `useFeedStream()`, is
      participant-world only).
- [ ] **[Tier-2 — human sign-off, always-Critical isolation class]** Given a connection resolved to
      exercise A, when the client attempts to join or read another exercise's group by any
      client-controlled means (a manipulated group-name argument, a forged header, a second
      `JoinGroup`-style call, etc.), then the attempt fails closed — no cross-exercise message is
      ever delivered to that connection. Extend the standing isolation suite
      (`exercise-isolation/07`, COR-007) with a real-time-transport case, not just an HTTP one.
- [ ] **Degraded-mode polling fallback (NFR-003).** Given the SignalR connection cannot be
      established, or drops and fails to reconnect within a bounded retry window, when the
      client-side connection module detects this, then it falls back to polling
      `01-feed-read-api`'s `GET /feed` on an interval until the connection recovers — never a
      silent, permanent loss of "real time."
- [ ] **Shared-connection shape honored.** Given this story ships the first real consumer of the
      client-side real-time transport, when it is built, then it establishes **one** shared
      connection module (`core/realtime/`) exposing a subscribe-by-event-name primitive — not a
      feed-only connection — so future consumers (break-fiction/pause overlay pushes, alert-bar
      pushes, `live-monitoring`'s CTL-030 board, multi-controller presence CTL-004) add handlers to
      the same connection later rather than opening a second one.

## Out of Scope
The buffered "▲ N new posts" pill UX, scroll-position preservation, hover-to-pause — all
`feeds-discovery/04` (referenced, not built here; this story ships the transport it will consume,
not its UI). Multi-controller presence (CTL-004, `persona-operation/04`) and overlay-state/
alert-bar push handlers (their own later stories) — this story proves the shared-connection shape
works; it does not add their handlers. `postStore.ts`'s own code retirement — that file is owned by
`feeds-discovery/07`'s (Complete) docs, not edited here; its pub/sub *role* is superseded once
`feeds-discovery/04` is built against this story's connection module instead, which is a
consequence of this story landing, not a doc edit in this pass. Reconnection/backoff tuning beyond
"bounded retry window, then fall back to polling" — perf/resilience hardening is
`BACKEND_ROADMAP.md`'s explicit "one hardening pass after B1" (§3.6/§8).

## Technical Notes
Backend + a small, genuinely new frontend piece — not a mock→live flip (there is no pre-existing
mock adapter for real-time; this story builds the mock and live paths together in one pass, the
same way `feedService.ts` originally was). Owns, backend:
`Pulse.WebApi/Features/Realtime/{ExerciseRealtimeHub.cs,IFeedBroadcaster.cs,
SignalRFeedBroadcaster.cs}`; frontend (new): `core/realtime/connection.ts`,
`features/social/services/realtimeFeed.ts`. Activates the dormant
`infrastructure/modules/signalr.bicep` module (`BACKEND_ROADMAP.md` §2.3). The
`Pulse.WebApi/Program.cs` hub mapping (`MapHub<ExerciseRealtimeHub>(...)`) is orchestrator-owned —
this story exposes an extension method, per implementation.md's Integration seam table. Cross-
reference the `IFeedBroadcaster` contract-first note shared with `02-post-write-api`.

## Dependencies
Phase B0 (`backend-host/01,02`; filter via `backend-host/03` **[Tier-2]**). Contract-first seam
with `02-post-write-api` (`IFeedBroadcaster.BroadcastPostAsync`) — both build in the same wave
against the agreed interface. Soft reuse of `01-feed-read-api`'s `GET /feed` as the polling-
fallback data source (not a hard dependency — 01 already exists as a read endpoint regardless of
this story's own build order).

## Tests
xUnit hub-integration tests: two simulated exercises, assert a broadcast to A's group is never
delivered to B's connections; assert group join is always server-derived, never accepts a client
group-name override. A documented manual/RTL check: with the hub unreachable (or the WebSocket
forcibly closed in a test harness), the connection module's consumer falls back to polling
`GET /feed` within the bounded window and recovers automatically when the hub returns.
