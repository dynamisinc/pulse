# Story: "Who to follow" suggested follows

**Feature:** Profiles & social graph  ·  **Epic:** E2  ·  **Phase:** 1  ·  **Status:** Blocked — built +
mounted in mock mode; blocked on story 08 (`GET /api/personas/suggestions`, not yet merged) for live
operation. See "Live-data gap" below; do not mark Complete until story 08 lands and is verified.
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
- [x] Suggestions are planner-seeded, exercise-scoped (COR-001). — **half done; see split below.**
      *(`hooks/useWhoToFollow.ts` → `services/whoToFollowService.ts`'s `resolveSuggestedFollowIds()`
      takes no client `exerciseId`; the session binds the exercise server-side. **In mock mode** this
      resolves a believable planner-seeded order over the Fairhaven cast
      (`MOCK_SUGGESTED_FOLLOW_IDS`). **Live mode has no backend endpoint yet** —
      `GET /api/personas/suggestions` does not exist in `Pulse.WebApi` as of this pass (confirmed:
      no reference to `suggestions` anywhere under `src/Pulse.WebApi`); that endpoint is story 08,
      tracked separately and **not merged**. Until it lands, a live session's `<WhoToFollow>` shows its
      fail-closed error state (`who-to-follow-error`), never a crash or a silent empty list.)*
      **The "adjustable live by controllers" half is DEFERRED to `world-steering/01`
      (CTL-021, Not Started, issue #24)** — that story is the write path that will edit this same
      backing list; this story only builds the planner-seeded read half and the display, per its own
      Out of Scope.
- [x] An impersonator can appear in the module (a legitimate controller lever) — the module does not
      vouch for anyone (D1-R1/D1-008). *(The mock suggestion order includes `@FairhavenWaterUpd` at
      its natural seed position, rendered identically to every other row — no muted styling, no
      re-sort, no counter-badge. Covered by `components/WhoToFollow.test.tsx` /
      `services/whoToFollowService.test.ts`.)*
- [x] Observer mode: Follow actions within the module are **absent** (D1-011). *(Each row reuses
      `<FollowButton>` unmodified — the same `canFollow` gate story 02 already tests — rather than
      re-implementing the guard. Covered by `components/WhoToFollow.readonly.test.tsx` /
      `WhoToFollow.noPersona.test.tsx`.)*

## Live-data gap (why this story is Blocked, not Complete)
`<WhoToFollow>` is built, tested, and **mounted** in `SocialChannel.tsx`'s feed region (capped to 3
rows via the `limit` prop) — verified end-to-end in mock mode. It is genuinely **blocked** on story 08
(`POST`-free `GET /api/personas/suggestions`, currently unmerged/in parallel build) for live
operation: today, a live (mock-off) session's suggestions read 404s and the module degrades to its
error state rather than showing suggestions. Do not flip this story's Status to Complete until story
08 merges and a live-mode test (mirroring `feedService.following.live.test.ts`'s pattern) confirms the
real endpoint round-trips.

## Out of Scope
The E7 control to adjust suggestions (world-steering CTL-021, #24, Not Started — the write path this
story's data seam will eventually serve); the portal placement (E3, Phase 3); follow mechanics
(story 02); the backend `GET /api/personas/suggestions` endpoint itself (story 08, in progress
elsewhere, not owned here).

## Technical Notes
Participant world. Module renders identity only; no authority chrome. Seeded config today (mock);
E7-adjustable once CTL-021 lands. See implementation.md (story 04).

## Dependencies
story 02 (follow, Complete); story 03 (verified mark, Complete); story 08 (`GET
/api/personas/suggestions`, **not merged** — the live read this story's hook calls); E7 CTL-021
(adjust, Not Started). Portal reuse in E3.

## Tests
- Component (RTL) — `components/WhoToFollow.test.tsx` / `WhoToFollow.readonly.test.tsx` /
  `WhoToFollow.noPersona.test.tsx`: the module titled "Who to follow" shows no authority labels; an
  unverified account (the impersonator) can appear with no platform vouch; the Follow action is
  absent for observer/no-persona sessions.
- Service (unit) — `services/whoToFollowService.test.ts`: mock suggestion order, malformed-body
  fail-closed.
- Hook (unit) — `hooks/useWhoToFollow.ts` exclusion tests (own persona; already-followed) — see that
  hook's own test file for exact coverage.
