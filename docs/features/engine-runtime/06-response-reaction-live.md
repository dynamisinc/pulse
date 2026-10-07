# Story: Official responses reach the live loop — a PIO's post can address a storyline  `[backend]`

**Feature:** engine-runtime  ·  **Epic:** E8  ·  **Phase:** 2  ·  **Stack:** backend  ·  **Status:** In Review (built, suite-green; awaiting Gate-2 + UAT)
**Requirements:** ADP-002, ADP-002a (COR-001, XC-004, CTL-034, ADP-011, E8 arch §7 / §8.2)  ·  **Design decisions:** none new  ·  **Issue:** #415

> **Delivers the deferred half of `response-reaction/01` (#163).** That story's two unchecked ACs (the
> generated reaction burst, and its telemetry) were parked as "blocked on reaction-loop story 03 + #173".
> Both prerequisites shipped (story 01's generate/publish back-half, and #173's engine telemetry), but
> nothing connected the response slice to them. This story is that connection. It changes no matching,
> resolving or trust-curve logic; the `ResponseReaction` slice is used as built.

## Context
The response slice (`Pulse.Core/Features/ResponseReaction`: `ResponseMatcher`, `MissSafeResolver`,
`ResponseMatchTrustCurve`, `ResponseReactionBehavior`) was built, unit-tested and marked Complete as a
library. The live loop never called it. `ReactionLoopDriver` handed the observe stage `addressing: []` on
every tick, and its `DecideStage` had no behavior registered. The result: no participant post could ever
address a storyline. A PIO's official statement was invisible to the engine, the silence clock kept
running, and the world kept posting anxious "why is nobody saying anything" bursts at a PIO who had already
answered. That is the exact failure ADP-002a exists to prevent (adversarial review D4/A6).

Found by the October 2026 demo baseline (`docs/BUILD_PLAN.md`, "Beat 4 can't work"): the demo's fourth
beat is the PIO answering and the world calming down.

## Acceptance Criteria
- [x] **Participant posts reach the loop.** Given a participant post commits through the single ingest
  funnel (`PostIngestService.IngestAsync`), when it has been saved and broadcast, then every registered
  `IPostPublishedObserver` hears it with the **server-resolved** exercise scope (never a client value), and
  `EngineAddressingObserver` enqueues it into that exercise's `IAddressingInbox` as an official-post
  `AddressingObservation`. Engine, seed and controller posts are not enqueued: only `origin: participant`
  can be a response (the world talking is not an answer).
- [x] **An observer can never fail a post.** Given an observer throws, then the post (already committed
  and broadcast) still succeeds, the failure is logged, and later observers still run. A refused post
  notifies no observer.
- [x] **Each post resolves exactly once.** Given posts are waiting, when the loop ticks, then it drains the
  exercise's inbox into `ObserveStage.Observe`, so each post is resolved on one tick only. The inbox is
  bounded (50 per exercise, oldest dropped first) so a frozen or unregistered loop cannot grow it without
  limit, and a re-seed clears the exercise's queue.
- [x] **A genuine match addresses the storyline.** Given an official post matches a storyline (a hashtag
  hit, or enough coverage of the storyline's expectation) and response auto-confirm is on for the exercise,
  when the tick resolves it, then `MissSafeResolver.Apply` resets the silence clock, bends intensity and
  sentiment down, and moves the storyline to **Addressed**. That storyline gets no inaction burst on the
  same tick. A second matching post is safe: the transition is guarded, so it only re-resets the clock.
- [x] **The world reacts to the response.** Given a storyline was just addressed, then the loop decides it
  through the now-registered `ResponseReactionBehavior` (an `OfficialResponse` trigger) and enqueues one
  response burst of up to **3 voices** (`DefaultBurstSize`), bounded by the eligible cast and the
  per-minute cap, with the gratitude / follow-up / one-skeptic mix. It goes to the review queue like every
  other burst: one burst is one review decision (CTL-034).
- [x] **Miss-safe default (ADP-002a, safety-critical).** Given a plausible match that has not been
  confirmed (auto-confirm off), then the storyline is **not** addressed and its silence clock keeps running,
  but its inaction burst that tick is slowed (`MissSafeResolver.Slow`: fewer voices, never zero). Given an
  official post that matches nothing, then every storyline's inaction burst that tick is slowed. Neither
  case is ever treated as silence, and neither ever pauses escalation.
- [x] **The trust curve stays human-owned (E8 §8.2).** Auto-confirm is **off** unless the operator opts in
  on the seed request (`"autoConfirmResponses": true`), and the choice is recorded in the seed's audit
  event. The engine never turns it on itself.
- [x] **Isolation (COR-001).** The observer keys the inbox by the scope `PostIngestService` resolved on the
  server; the driver drains only the ticking exercise's queue; a re-seed clears only its own exercise.
- [x] **Telemetry (XC-004), no new types.** Each official post that relates to a storyline emits
  `engine.observed` with the taxonomy's existing `action-seen` trigger. A match emits the same
  `storyline.state_changed` (cause `matched-response`) and `engine.measured` events the measure stage
  emits, via the extracted `MeasureStage.MapStorylineEvents`. The response burst's `engine.decided` carries
  its tone mix. Each resolution is also logged (kind, confidence, storyline).
- [x] **Composition-root guard.** A real-`Program` test asserts the engine's observer is registered exactly
  once and that one inbox singleton is shared by the observer, the seed and the driver. Neutering either the
  drain or the observer registration fails 7 tests (verified).
- [ ] **UAT verification.** Given this build is deployed and the engine is re-seeded with
  `autoConfirmResponses: true`, when the PIO (bound to @FulcoEM) posts a statement carrying `#WaterIssues`
  or the expectation's wording, then within a tick or two the console shows the storyline **Addressed** and
  a 3-voice response burst waits in the review queue. *(Ticked only when seen in UAT.)*

## Out of Scope
- **The controller's "does this address #X? Y/N" surface** for a `NeedsConfirmation` suggestion (E7
  cockpit). Until it exists, a plausible match without the opt-in can only slow escalation, never address
  the storyline. Follow-up.
- **Feeding the trust curve's precision** (`ResponseMatchTrustCurve.RecordOutcome`): it needs that
  confirm/reject signal.
- **Off-platform markers (CTL-026 / #29) reaching the inbox.** The source exists in Core; nothing produces
  one into the inbox yet.
- **Dropping participant-bound personas from the engine cast** (BUILD_PLAN finding; a separate backend
  story). Today the citizens-first cast order keeps a burst of 3 on the three residents, so a response
  burst never voices @FulcoEM.
- **A silence-escalation behavior in the live loop.** `SilenceEscalationBehavior` exists in Core but is not
  registered; inaction triggers still run the default composer. Separate finding.
- **Persisting the inbox.** It lives in memory like the rest of the engine's state; a restart loses pending
  posts along with the storylines, and a re-seed rebuilds both.

## Technical Notes
- `Features/Social/IPostPublishedObserver.cs`: the seam. `PostIngestService` notifies observers as step 7,
  after commit and broadcast, each inside its own catch (cancellation still propagates).
- `Features/EngineRuntime/Addressing/`: `IAddressingInbox` / `AddressingInbox` (per-exercise concurrent
  queues) and `EngineAddressingObserver` (participant-origin filter).
- `ReactionLoopHost.cs`: `ReactionLoopDriver` drains the inbox, resolves each post
  (`ResolveOfficialPosts`), then decides response bursts first and inaction bursts second, minus any
  storyline a response just addressed. `ReactionLoopRegistration.ResponseMatching` carries the per-exercise
  trust curve.
- `MeasureStage.MapStorylineEvents`: extracted so the response path and the measure stage emit identical
  storyline telemetry.
- `ResponseReactionBehavior` (Core): sizes the response as a burst. The base composer sizes by phase, and
  a just-addressed storyline sizes to one voice, too few to carry the mix. Still bounded by cast and cap,
  never below the composer's count.
- Seed slice: `autoConfirmResponses` on the request, the response and the audit payload; the seed clears
  the exercise's inbox after registering the loop. Both `AddReactionLoopHost` and `AddEngineContentSeed`
  `TryAdd` the inbox so they converge on one singleton whichever is wired first.
- No `Program.cs` edit: the observer and inbox ride the already-wired `AddReactionLoopHost()`.

## Dependencies
Story 01 (the driver and publish funnel), #173 (engine telemetry), `response-reaction` 01–03 (#163–#165,
the slice used as built), `social-api` (`PostIngestService`).

## Tests
- `AddressingInboxTests`: drain-once, per-exercise isolation, the bound, clear; the observer's origin filter.
- `PostIngestServiceObserverTests` (real SQL): server-resolved scope, refused post notifies nobody, a
  throwing observer never fails the post.
- `ReactionLoopHostTests` (real SQL): matched → Addressed with a 3-voice gratitude burst and no silence
  burst; needs-confirmation stays Escalating but slowed; unmatched slows; each post resolved once; and the
  end-to-end path through the real `PostIngestService`.
- `EngineContentSeedServiceTests`: auto-confirm off by default, on only by opt-in (and audited); the seed
  clears only its own exercise's inbox.
- `ResponseReactionBehaviorTests` (Core): burst of 3, bounded by cast and by the per-minute cap.
- `ResponseReactionCompositionRootWiringTests`, `ReactionLoopHostDiTests`: the wiring guards.
