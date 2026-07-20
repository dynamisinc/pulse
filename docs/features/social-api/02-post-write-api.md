# Story: Post write API — POST /posts (the server-side blessed ingest)

**Feature:** Social API (backend)  ·  **Epic:** E2  ·  **Phase:** 1  ·  **Status:** Not Started
**Requirements:** SOC-003, COR-018 (NFR-004, XC-004, XC-002)  ·  **Design decisions:** none  ·  **Issue:** #271

## Context
`postService.createPost()` is documented as "the blessed ingest path — every new post (a
participant's compose action, a controller operating a persona, a fired MSEL inject, the future
adaptive engine) goes through this one function" (`postService.ts:12-19`). This story is that
function's server-side realization: `POST /posts`. **Both** callers that exist in Phase B1 —
the participant composer and the controller's `composeAsPersona()` (`composeService.ts:73-86`,
which fixes `origin: 'controller-as-persona'`) — POST here instead of a local, in-memory
`postStore.appendPost()` call. Sanitization (NFR-004), `exerciseId`/`origin` stamping, persistence,
and the XC-004 telemetry emission all move server-side, matching `BACKEND_ROADMAP.md`'s Phase B1
framing exactly.

The endpoint accepts the full `PostOrigin` union (`participant` / `controller-as-persona` /
`engine` / `inject`) even though only the first two have a real caller this phase: Phase B3's
`engine-runtime/01-reaction-loop-host` is documented to publish through this **exact same path**
("engine posts as an ordinary post," `BACKEND_ROADMAP.md` §4 Phase B3), and Phase 4's E9 inject-fire
(INT-004) targets it too. Do not narrow the accepted values to this phase's two callers.

The response is this feature's one deliberately **role-conditional** exception to unconditional
XC-002 projection: the controller console renders `originConsoleLabel(lastPublished)` directly off
the value `composeAsPersona()`'s (eventual) `POST /posts` call returns
(`PersonaComposer.tsx:150-157`) — a staff-authenticated caller's own write response must still
carry `origin`/`actingHumanId`, or the console's origin line breaks. A participant-authenticated
caller's response never does, matching `01-feed-read-api`'s unconditional guarantee.

## Acceptance Criteria
- [ ] **Happy-path ingest (SOC-003).** Given a `POST /posts` body
      (`authorPersonaId`, `actingHumanId`, `text`, `scenarioTime`, `origin`, `media?`, `injectId?`)
      with `origin` ∈ `{'participant','controller-as-persona'}`, when the request's resolved
      exercise scope is A, then the server sanitizes `text` server-side (NFR-004, mirroring
      `sanitize.ts:41-45`'s strip-not-encode approach — never double-encode), stamps
      `exerciseId = A` from the resolved scope (never a client-supplied value, even if present in
      the body), derives `createdWallClock` from the server's own UTC clock (never client-
      supplied), persists the post, and returns 201.
- [ ] **NFR-004 content security.** Given `text` contains `<script>…</script>` or an
      `<img onerror=…>` payload, when the post is created and later read back via
      `01-feed-read-api`, then the stored/served text contains no executable markup — a stored
      script cannot execute in another session. Add this case to the standing stored-XSS suite
      (`exercise-isolation/07`, COR-007/NFR-004).
- [ ] **XC-004 telemetry, server-side, single emission.** Given a successful `POST /posts`, when
      the server persists the post, then it emits exactly one `'post'` event server-side against
      the locked v0 envelope (`core/telemetry/schema.ts`'s `telemetryEventV0Schema`:
      `exerciseId`, `actor: {kind:'persona', personaId: authorPersonaId, actingHumanId}`, `origin`,
      `channel:'social'`, `wallClockTime` = server UTC now, `scenarioTime` as supplied,
      `target: {entityType:'post', entityId}`) via `telemetry/02`'s sink. Once the frontend
      write path is flipped live (an orchestrator integration edit, see implementation.md), the
      client-side `buildAndEmit` call currently inside `createPost` is retired so the event is
      never double-counted.
- [ ] **COR-018 attribution preserved.** Given `origin: 'controller-as-persona'`, when the post is
      persisted, then `actingHumanId` (the operating controller) is stored — satisfying the
      envelope schema's own conditional requirement (`schema.ts`'s `superRefine`: `actingHumanId`
      required when `origin === 'controller-as-persona'`). The full `PostOrigin` union is accepted
      and stored even though only two values have a real caller this phase (see Context).
- [ ] **XC-002 guarantee, role-conditional (testable — this feature's one deliberate exception).**
      Given the request is authenticated as a participant caller (their own compose action), when
      `POST /posts` succeeds, then the JSON response contains no `origin`/`actingHumanId`/
      `createdWallClock`/`injectId` key — identical to `01`'s read-path guarantee. Given the
      request is instead authenticated as a staff/controller caller, when it succeeds, then the
      response **does** include `origin`/`actingHumanId`, because `originConsoleLabel
      (lastPublished)` (`PersonaComposer.tsx:150-157`) depends on it.
- [ ] **Server-stamped scope, never client-trusted.** Given a request body that includes (or a
      manipulated client attempts to inject) an `exerciseId` different from the request's own
      resolved scope, when the post is persisted, then the server's resolved scope wins
      unconditionally — a cross-exercise-stamped post is never created. (Baseline COR-001 hygiene
      inherited from the central filter; not separately Tier-2-tagged this pass — `01` and `03`
      carry the Tier-2 isolation sign-off for this feature.)

## Out of Scope
Reply-, repost/quote-, and DM-as-persona (the shipped `Post` model has no parent/thread/quote
field yet — `persona-operation/01`'s own documented Wave-1 limit, POST-ONLY; this endpoint is
post-only to match). The takedown/soft-delete mutation (SOC-005, CTL-025). Posting-endpoint rate
limiting / abuse resistance (NFR-009) — flagged as a real, near-term follow-up, not blocking the
walking skeleton. Server-side scenario-time *authority* (COR-050's backend clock service is
`engine-runtime/03-scenario-clock-service`, Phase B3) — `scenarioTime` remains client-supplied
input this phase, exactly as the shipped `CreatePostInput.scenarioTime` already contracts. The
actual SignalR broadcast call (owned by `03-signalr-feed-host`'s `IFeedBroadcaster` — this story
only calls the agreed interface, it does not implement fan-out). Inject-fired posts
(`origin:'inject'`, E9 INT-004, Phase 4) and engine-authored posts (`origin:'engine'`,
`engine-runtime/01`, Phase B3) — both structurally accepted, neither has a real caller yet.

## Technical Notes
Backend/service work. Owns `Pulse.WebApi/Features/Social/{PostWriteEndpoints.cs,
PostIngestService.cs,PostSanitizer.cs}` (+ xUnit). **Flag for whoever performs the frontend
flip:** unlike the read seams, `postService.createPost(input): Post` is synchronous today and
**never routed through the axios client at all** (no `api.*` call anywhere in `postService.ts`) —
flipping it live is not a mock-adapter swap, it is introducing `api.post('/posts', …)` for the
first time and changing the exported signature to `Promise<Post>`, which ripples to
`composeService.composeAsPersona` (same signature change) and `useComposeAsPersona.publish()`
(currently a synchronous call site) plus the participant composer's equivalent hook. This is a
materially bigger integration edit than 01/03/04's flips — see implementation.md's Integration
seam table, which calls it out as its own reviewed commit. Cross-reference implementation.md's
Reuse map + Wave Plan, and the `IFeedBroadcaster` contract-first note shared with `03`.

## Dependencies
Phase B0 (`backend-host/01,02`; read filter `exercise-isolation/01` on `backend-host/02`'s **[Tier-2]** write guard) plus
`telemetry/02-telemetry-sink-backend` (needed for the XC-004 AC). Contract-first seam with
`03-signalr-feed-host` (`IFeedBroadcaster.BroadcastPostAsync`) — see implementation.md; both build
in the same wave against the agreed interface shape.

## Tests
xUnit covering: sanitize-on-ingest (stored-XSS suite extension); server-side stamping of
`exerciseId`/`createdWallClock` regardless of client input; single telemetry emission per post
matching the locked v0 schema; `actingHumanId` required/stored when `origin` is
`controller-as-persona`; role-conditional response shape (participant vs. staff caller); rejection
of a client-supplied cross-exercise `exerciseId`. A documented manual check: the console's origin
line (`PersonaComposer.tsx`) still renders after the flip, proving the staff-caller response branch
carries what it needs.
