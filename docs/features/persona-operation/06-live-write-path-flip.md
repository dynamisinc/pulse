# Story: Live write-path flip — controller persona post reaches other participants in near real time

**Feature:** Persona operation  ·  **Epic:** E7  ·  **Phase:** 1  ·  **Status:** Delivered in PR #338 (one documented deviation, below)
**Requirements:** CTL-001, SOC-083, SOC-003, XC-002, COR-018, COR-053, COR-001, NFR-003, NFR-004, XC-004  ·  **Design decisions:** none  ·  **Issue:** #329

> **Delivery note (PR #338, UAT fix off `main`, 2026-07-24).** The write-path flip landed at the
> composer-hook boundary as scoped, PLUS the read-side companion (`useFeed` was discarding
> `resolveFeed()`'s result and reading in-memory `postStore` — now consumes the live `/api/feed`
> baseline). AC2 (mock unchanged), AC5 (controller-as-persona origin + actingHumanId), and AC6 (live
> `GET /api/personas` cast) are met. **Deviation from AC1/AC4 on the controller-persona path only:** the
> **participant** path (`useComposePost`) is POST-only — no local `createPost`, single-count telemetry
> (server-owned) — per spec. The **controller-persona** path (`useComposeAsPersona`) additionally keeps
> the synchronous `createPost` because the console consumes the returned `Post` for its own-tab view +
> the R-003 origin label; so on that path the caller receives a LOCAL `Post` (not the server one, AC1)
> and the client emits its own XC-004 `post` event ALONGSIDE the server's (AC4 double-count). Accepted
> until the Phase-B2 auth item (the same B2 hardening AC5 already flags) lets the server become the sole
> emitter — the clean fix decouples local-`Post` assembly from telemetry without touching the
> security-critical `createPost` ingest path. Own-post display is via the SignalR pill (AC3), already
> wired. Code-review clean; full vitest suite green.

## Context
Wave 1 (stories 01–03) shipped **POST-ONLY** persona operation against the in-memory, same-tab
`postStore` module singleton (`features/social/services/postStore.ts` — its own header admits "no
cross-tab / cross-participant fan-out"). At the time, `createPost` had no backend to call. That has
changed: the Social API "B1" backend now exists and is wired in `Pulse.WebApi/Program.cs` —
`POST /api/posts` (sanitize, server-stamp `exerciseId`/`createdWallClock`, persist, single XC-004
telemetry event, SignalR broadcast), `GET /api/feed`, `GET /api/personas`, and the
`ExerciseRealtimeHub` at `/hubs/exercise` (`PostReceived`). The frontend **read/receive** side is
already flipped onto it — `feedService.ts`'s `resolveFeed()`, `feedStreamSource.ts`'s mock↔realtime
switch, and `useFeedStream`'s "▲ N new posts" pill all work against the live backend today
(`feeds-discovery/04`, Complete).

The one gap operationalizing **CTL-001** ("post as any persona... no logging in/out per persona")
across a real exercise is the **write** side: the frontend never calls `POST /api/posts`.
`composeService.ts`'s `composeAsPersona()` still calls the synchronous, in-memory `createPost`, whose
result is appended straight to `postStore` at `ControllerConsoleRoute.tsx:101` — a same-tab side
effect only. So Wave-1's "browser-verified: appears in the participant feed" (`01-post-as-persona.md`)
was true only within one browser tab / one JS module instance, never across sessions or devices. This
story is the documented flip: `docs/features/social-api/implementation.md`'s "Post-B1 follow-ups"
section already scoped it as "#271 write-path frontend flip (deferred)" and recommends landing the
live `api.post('/posts', …)` call at the **composer-hook boundary**
(`useComposeAsPersona`/`useComposePost`) rather than inside `createPost` itself, so `createPost` stays
available as the synchronous path the engine review-publish pipeline and mock fixtures still need.
This story follows that recommendation. See `F7.1` in the epic (CTL-001) and `feature.md`.

## Acceptance Criteria
- [ ] Given `USE_MOCK_DATA` is `false`, when a controller calls `useComposeAsPersona().publish()` (or
      a participant calls `useComposePost().publish()`), then the publish path is **asynchronous** and
      POSTs to `/api/posts` via the shared axios client (`@/core/services/api`), mirroring
      `feedService.ts`'s `resolveFeed()` / `personaService.ts`'s `resolvePersonas()` mock/live adapter
      flip — the caller receives the **server-created** `Post` (server-owned `id`/`exerciseId`/
      `createdWallClock`), not a locally-assembled one.
- [ ] Given `USE_MOCK_DATA` is `true` (dev/demo/test), when either composer publishes, then the
      existing synchronous, in-memory `createPost` → `postStore.appendPost` behavior is **unchanged**
      — no network call, no regression to the mock/demo experience.
- [ ] Given the live path, when a post is published, then the caller does **not** append the result to
      `postStore` itself — the author's own post (and every other participant's) arrives back via the
      already-wired SignalR `PostReceived` push (`realtimeFeed.ts`, auto-selected by
      `feedStreamSource.ts` when mock is off) or its polling fallback — with a guard against
      double-inserting the author's own post when its own push arrives.
- [ ] Given a live publish, when telemetry is recorded, then the **server** emits exactly one XC-004
      `post` event (already verified server-side by
      `SuccessfulIngest_EmitsExactlyOneTelemetryEvent_MatchingV0Envelope`) and the client emits **none**
      for that action — `createPost`'s client-side `buildAndEmit` call does not run on the live path, so
      the event is never double-counted.
- [ ] Given a controller publishes as a persona, when the request reaches `POST /api/posts`, then the
      client sends `origin: 'controller-as-persona'` + `actingHumanId`; a request missing
      `actingHumanId` for that origin is rejected 400 with nothing persisted (already enforced
      server-side, `ControllerAsPersona_WithoutActingHumanId_Returns400_AndPersistsNothing`). Record as
      an explicit follow-up (mirrors `social-api`'s own SG-4 note) that `actingHumanId` should
      ultimately be derived from the authenticated staff session server-side rather than trusted from
      the client body (COR-018/XC-002) — a Phase B2 hardening item, not a blocker for this story.
- [ ] Given `USE_MOCK_DATA` is `false`, when the persona picker/composer resolve the exercise's cast,
      then `usePersonas()`/`resolvePersonas()` read the live `GET /api/personas` endpoint (the flip
      point already exists in `personaService.ts`), replacing the seeded mock cast with the exercise's
      real personas.
- [ ] Given a publish is in flight, when the controller or participant fires again before the response
      returns, then the fire control (`PersonaComposer`'s Post button; the participant `Composer`'s
      equivalent) is disabled for the duration; given the request fails, then the failure is surfaced
      (not silently swallowed) and the drafted text is **not** cleared, so the sender can retry without
      retyping.
- [ ] Given the async signature change ripples beyond the two composer hooks, when `useComposePost`
      (participant) and the engine review-publish pipeline
      (`features/controller/engine/services/reviewActions.ts`) are audited against the new
      `Promise<Post>` shape, then each caller either awaits the result or is explicitly scoped out with
      a tracked follow-up — landed as its own reviewed integration commit, per
      `social-api/implementation.md`'s "Post-B1 follow-ups" guidance.
- [ ] Given a controller in one browser session publishes as a persona, when a participant in a
      **different** browser session is viewing the feed, then the new post appears behind the
      "▲ N new posts" pill within push latency (≤5s on the NFR-003 polling fallback if SignalR is
      degraded) — with no controller identity/`origin`/`actingHumanId` ever present in that
      participant's response body or DOM (SOC-003/XC-002).
- [ ] **Isolation (XC-001/COR-001):** the live write call sends **no** client `exerciseId` scoping
      param (matches the `resolveFeed`/`resolvePersonas` precedent); the post persists scoped to the
      caller's server-resolved exercise only, extending the standing isolation suite.
- [ ] **Content security (NFR-004):** on the live path, sanitization is enforced **server-side**
      (`PostSanitizer`, already shipped); a stored-script payload composed in either composer never
      executes in another participant's session. The client-side `sanitizeText` continues to run
      unchanged on the mock path.

## Out of Scope
Reply/repost/quote/DM as a persona (needs a `Post` parent/thread model extension — a separate
follow-up, GH #100); multi-controller presence (`persona-operation/04`); mid-exercise persona creation
(`persona-operation/05`); the deployment/runtime configuration itself — flipping
`VITE_USE_MOCK_DATA`, setting `VITE_API_URL`, and bootstrapping an exercise are **dependencies** of
this story going live, not code this story writes; deriving `actingHumanId` server-side from the
staff session (flagged above as a follow-up, not built here); a Playwright multi-session e2e (later
addition, see Tests).

## Technical Notes
Staff world (COBRA) for the composer/picker; the published output lands in the participant world
(unchanged skin/rules). MUI 9 sx-only; FontAwesome only.

Files this story touches:
- `features/social/services/postService.ts` (`createPost`) — stays the synchronous path used by mock
  fixtures and the engine review-publish pipeline; not converted to async itself (per
  `social-api/implementation.md`'s recommendation).
- `features/controller/services/composeService.ts` (`composeAsPersona`) and
  `features/controller/hooks/useComposeAsPersona.ts` (`publish()`) — become the async live/mock flip
  point for the controller path.
- `features/social/hooks/useComposePost.ts` (`publish()`) — the participant-composer equivalent flip.
- `features/controller/components/PersonaComposer.tsx` — in-flight/error UX on the fire control.
- `features/controller/ControllerConsoleRoute.tsx:101` — today wires `onPublished` straight to
  `postStore.appendPost(post)`; on the live path this wiring is removed/guarded (new posts arrive via
  SignalR instead).
- `features/personas/personaService.ts` (`resolvePersonas`) — already has the `USE_MOCK_PERSONAS` flip
  point; this story is what actually exercises it end-to-end from the picker.
- `features/controller/engine/services/reviewActions.ts` — audit only (AC8); out of scope to rebuild,
  in scope to confirm it still compiles/behaves against whatever `createPost`/composer signature
  results.

Mirror `feedService.ts`'s existing mock-adapter pattern (`USE_MOCK_FEED` / `mockAdapter`) for the
live/mock flip rather than inventing a new one. Backend contract reference: `Pulse.WebApi/Program.cs`
lines ~99-102 (DI) and ~185-196 (mapped endpoints); `Features/Social/PostWriteEndpoints.cs` for the
exact request/response shape (`origin`, `actingHumanId` required when `controller-as-persona`, 400
otherwise). See `implementation.md` (story 06 row) for the reuse map + wave placement.

## Dependencies
Social API B1 (backend, already built and wired — GH #267/#270/#271/#272/#273); Phase B2 per-request
session→exercise scope resolution (so `POST /api/posts` is authorized/scoped for a staff session — it
fails closed 401 on an unresolved scope); a deployed backend with `VITE_USE_MOCK_DATA=false` +
`VITE_API_URL` set and a bootstrapped exercise to publish/read against.

## Tests
- Component (RTL): `useComposeAsPersona`/`useComposePost` publish happy-path on the live flip — POSTs
  to `/api/posts`, resolves with the server-returned `Post`, does not touch `postStore`.
- Component (RTL): in-flight disables the fire control; a rejected POST surfaces an error and leaves
  the draft text intact.
- Unit: the mock-vs-live seam — `USE_MOCK_DATA=true` never calls `api.post`; `false` never calls the
  synchronous in-memory path.
- Unit: no duplicate telemetry emission on the live path (client-side `buildAndEmit` is not invoked
  from the composer hooks when live).
- Already covered server-side (Docker-gated, not this story's to (re)write): `PostWriteEndpointTests`
  — `SuccessfulIngest_EmitsExactlyOneTelemetryEvent_MatchingV0Envelope`,
  `Broadcaster_IsInvokedExactlyOnce_WithTheParticipantSafePayload`,
  `ControllerAsPersona_WithoutActingHumanId_Returns400_AndPersistsNothing`.
- Later addition (not this story): a Playwright two-browser-session e2e proving cross-session
  fan-out end to end against a deployed backend.
