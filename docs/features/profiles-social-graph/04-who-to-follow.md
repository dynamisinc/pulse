# Story: "Who to follow" suggested follows

**Feature:** Profiles & social graph  ·  **Epic:** E2  ·  **Phase:** 1  ·  **Status:** Complete —
built, mounted, and LIVE: story 08 merged `GET /api/personas/suggestions` and the live-mode test this
story gated itself on now exists (`services/whoToFollowService.live.test.ts`). **AC2's "adjustable
live by controllers" half remains explicitly DEFERRED** to `world-steering/01` (CTL-021, Not Started,
issue #24) — this story delivers the planner-seeded READ half and the display, never the controller
write path. See "Live-data gap — CLOSED" below.
**Requirements:** SOC-053  ·  **Design decisions:** D1-R1  ·  **Issue:** #112

## Context
Suggested follows surfaced on social onboarding (and the portal, Phase 3), seeded by planners and
adjustable live by controllers as an attention-steering lever (SOC-053). Per the adversarial review
(D1-R1), the module is titled **"Who to follow"** — the platform must **never** label accounts
"official" or authoritative. The verified mark (and its absence) is the only credibility signal.

## Acceptance Criteria
- [x] A **"Who to follow"** module suggests accounts; it carries **no** authority/"official" labels
      (D1-R1) — only identity + the verified mark where applicable (story 03). *(`<WhoToFollow>`
      (`components/WhoToFollow.tsx`): a labelled `<section>` titled exactly "Who to follow", each row
      rendering avatar/name/verified-mark/handle/bio/follow-action and nothing else. Covered by
      `components/WhoToFollow.test.tsx`.)*
- [x] Suggestions are planner-seeded, exercise-scoped (COR-001). — **the read half is delivered; the
      controller-write half is deferred, see the split below.**
      *(`hooks/useWhoToFollow.ts` → `services/whoToFollowService.ts`'s `resolveSuggestedFollowIds()`
      takes no client `exerciseId`; the session binds the exercise server-side. **Live mode is real:**
      `GET /api/personas/suggestions` is served by
      `src/Pulse.WebApi/Features/Social/Suggestions/SuggestionEndpoints.cs` +
      `SuggestionService.cs` (story 08, merged) — exercise-scoped from `IExerciseContext` + the central
      query filter, ids only, no invented ranking. The client half is pinned live-mode by
      `services/whoToFollowService.live.test.ts` (`USE_MOCK_DATA = false`: the real request URL, the
      real `undefined` axios config, and `?limit=N` on the wire). **In mock mode** the same seam
      resolves a believable planner-seeded order over the Fairhaven cast
      (`MOCK_SUGGESTED_FOLLOW_IDS`), and its adapter now applies the self / already-followed exclusions
      BEFORE `?limit=` exactly as the server does, so mock and live return the same row count as the
      viewer follows people (WR-001).)*
      **The "adjustable live by controllers" half is DEFERRED to `world-steering/01`
      (CTL-021, Not Started, issue #24)** — that story is the write path that will edit this same
      backing list; this story only builds the planner-seeded read half and the display, per its own
      Out of Scope. **Nothing in this story lets a controller adjust suggestions live, and this AC
      must not be read as claiming otherwise.**
- [x] An impersonator can appear in the module (a legitimate controller lever) — the module does not
      vouch for anyone (D1-R1/D1-008). *(The mock suggestion order includes `@FairhavenWaterUpd` at
      its natural seed position, rendered identically to every other row — no muted styling, no
      re-sort, no counter-badge. Covered by `components/WhoToFollow.test.tsx` /
      `services/whoToFollowService.test.ts`.)*
- [x] Observer mode: Follow actions within the module are **absent** (D1-011). *(Each row reuses
      `<FollowButton>` unmodified — the same `canFollow` gate story 02 already tests — rather than
      re-implementing the guard. Covered by `components/WhoToFollow.readonly.test.tsx` /
      `WhoToFollow.noPersona.test.tsx`.)*

## Live-data gap — CLOSED
`<WhoToFollow>` is built, tested, and **mounted** in `SocialChannel.tsx`'s feed region (capped to 3
rows via the `limit` prop, which is now threaded all the way to the wire as `?limit=3`).

The gap that held this story at Blocked was that `GET /api/personas/suggestions` had no backend route,
so a live (mock-off) session's read 404'd and the module degraded to its error state. **Both
conditions this story set for flipping to Complete now hold:**

1. **Story 08 merged** — `Features/Social/Suggestions/{SuggestionEndpoints,SuggestionService}.cs`,
   composed into the already-wired persona endpoints and proven mapped-exactly-once through the real
   `WebApplicationFactory<Program>`.
2. **The live-mode test exists** — `services/whoToFollowService.live.test.ts`, mirroring
   `feedService.following.live.test.ts`'s pattern (`vi.mock('@/core/config/mockData', () => ({
   USE_MOCK_DATA: false }))`). It asserts the real request shape, including that the cap reaches the
   wire as `?limit=N` and that the live path passes an `undefined` axios config rather than the mock
   adapter. The pre-existing "wire contract" block in `whoToFollowService.test.ts` could NOT have
   covered this: it runs with `USE_MOCK_DATA` **true**, so its `expect.anything()` second argument was
   matching `{ adapter: mockAdapter }` — and `expect.anything()` does not match `undefined`.

What is still **not** delivered here is AC2's controller-adjustable half (CTL-021) — see the AC itself
and Out of Scope. That is a deferral, not a gap in this story.

## Out of Scope
The E7 control to adjust suggestions (world-steering CTL-021, #24, Not Started — the write path this
story's data seam will eventually serve); the portal placement (E3, Phase 3); follow mechanics
(story 02); the backend `GET /api/personas/suggestions` endpoint itself (story 08, **merged**, owned
there not here).

## Technical Notes
Participant world. Module renders identity only; no authority chrome. Seeded config today (mock);
E7-adjustable once CTL-021 lands. See implementation.md (story 04).

## Dependencies
story 02 (follow, Complete); story 03 (verified mark, Complete); story 08 (`GET
/api/personas/suggestions`, **Complete/merged** — the live read this story's hook calls); E7 CTL-021
(adjust, Not Started — the deferred half of AC2). Portal reuse in E3.

## Tests
- Component (RTL) — `components/WhoToFollow.test.tsx` / `WhoToFollow.readonly.test.tsx` /
  `WhoToFollow.noPersona.test.tsx`: the module titled "Who to follow" shows no authority labels; an
  unverified account (the impersonator) can appear with no platform vouch; the Follow action is
  absent for observer/no-persona sessions.
- Service (unit, mock mode) — `services/whoToFollowService.test.ts`: mock suggestion order,
  malformed-body fail-closed, the `limit` cap, and the WR-001 block — the mock adapter excludes
  already-followed accounts BEFORE it caps, so following a top suggestion never shrinks the module
  below `limit` rows the way live never would.
- Service (unit, LIVE mode) — `services/whoToFollowService.live.test.ts`: the real request URL and
  axios config with `USE_MOCK_DATA = false`, `?limit=N` on the wire, order relayed unmodified, and
  fail-closed on an envelope body / rejected request. This is the test that gated this story's status.
- Hook (unit) — `hooks/useWhoToFollow.test.ts`: exclusion tests (own persona; already-followed),
  order preservation, `limit` forwarding, fail-closed on error.
- Hook (unit, mock/live parity) — `hooks/useWhoToFollow.mockParity.test.ts`: against the SHIPPED seams
  (no service mocking), a capped read still yields `limit` rows after the viewer follows a top
  suggestion and the module remounts.
