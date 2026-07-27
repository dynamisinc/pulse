# Feature: Profiles & social graph

**Epic:** E2 — Social Network  ·  **Phase:** 1  ·  **Feature ref:** F2.6
**World:** participant  ·  **Issue:** #88

## Summary
Profile pages, follow/unfollow, the trainable verification signal (with impersonation support), the
"Who to follow" module, and the audience-magnitude model that reach/spread compute over.

## Requirements covered
SOC-050, SOC-051, SOC-052, SOC-053, SOC-054 (with COR-030 accent, E1 verification flag, XC-004).

## Design references
`docs/design/D1-social-app/` + `STORY-UPDATES.md`. Amendments: **SOC-052** verified mark fixed
seal-blue `#2D9CDB` + impersonation pair, platform never flags fake (D1-003/008); **SOC-053** module
titled **"Who to follow"**, never authority labels (D1-R1); **SOC-054** magnitude counts + "…and ~N
others", never fake lists (D1-012).

## Stories
**Status is carried on each story's own `Status:` header — this table is a summary that must never
drift from it; if the two disagree, the per-story header wins.**

| # | Story | Requirement(s) | Status | Issue |
|---|-------|----------------|--------|-------|
| 01 | Profile page (banner/avatar/bio/tabs) | SOC-050 | Complete | #109 |
| 02 | Follow / unfollow | SOC-051 | Complete (mounted in `<Profile>`) | #110 |
| 03 | Verification signal & impersonation support | SOC-052 / D1-003, D1-008 | Complete | #111 |
| 04 | "Who to follow" suggested follows | SOC-053 / D1-R1 | Complete (read half; AC2's controller-adjustable half deferred to `world-steering/01` CTL-021, Not Started) | #112 |
| 05 | Audience magnitude & follower affordance | SOC-054 / D1-012 | Complete except AC4 (exercise-scope test, unticked — no test covers it yet) | #113 |
| 06 | Persona presentation fields (backend) | COR-020, COR-021, SOC-052, SOC-054, XC-005 | Complete | #369 |
| 07 | Follow graph (backend) | SOC-051, SOC-054, SOC-081, COR-001, XC-004 | Complete | #370 |
| 08 | "Who to follow" suggestions API (backend) | SOC-053, SOC-052, COR-001, XC-002 | Complete | #88 (Gate-2 finding CR-001) |

**As of this pass, 01/02/03/04/06/07/08 are true against LIVE data too, not just the mock.** Stories 06
(#369) and 07 (#370) landed this session: `GET /api/personas` now projects real, persisted
`Bio`/`PersonaType` (staff-only)/`AudienceBand`/`AudienceMagnitude`/`JoinedAt`, and
`PersonaCastSeeder.Catalog` seeds the full nine-persona cast including the SOC-052 impersonation pair
(`@FairhavenWaterUpd`, unverified, near-identical lockup of the verified `@FairhavenWater`) and
`@TheScoopHQ` (low-credibility outlet) — both seeded with `Persona.Castable = false` so the rows exist
for participants to browse (and for 03's impersonation training) while the engine cannot yet voice
them (see `engine-content-seed`). Stories 02 (#110), 04 (#112) and 05 (#113) are now built AND wired
into `<Profile>`/`<SocialChannel>` against these real backend seams — see each story's own file for
what remains:
- **02** is Complete: `<FollowButton>`/`useFollow` are mounted in `<Profile>`'s header, call the live
  `POST`/`DELETE /api/personas/{id}/follow` (#370), and the mock adapters share one edge store with
  the Following feed (`services/followEdgeStore.ts`) so mock mode round-trips too.
- **04** is Complete and LIVE: `<WhoToFollow>` is mounted in `SocialChannel`'s feed region (capped
  `limit={3}`, threaded all the way to `?limit=3` on the wire) and its read seam,
  `GET /api/personas/suggestions`, is now served by story 08 (**merged** —
  `Features/Social/Suggestions/`). The live-mode test story 04 gated its own status on
  (`services/whoToFollowService.live.test.ts`, mirroring `feedService.following.live.test.ts`) exists.
  Mock and live also now agree on the *order of operations*: both exclude self / already-followed
  BEFORE applying the cap, so following a top suggestion never shrinks the module below `limit` rows
  (WR-001). **Still deferred:** AC2's "adjustable live by controllers" half → `world-steering/01`
  (CTL-021, Not Started, issue #24). Story 04 delivers the planner-seeded read, not the controller
  lever.
- **05** is Complete except AC4: `Profile.tsx` now renders `formatMagnitude(persona.followerCount)`
  (the server-composed magnitude+edges count) and a working Followers-expand
  (`<FollowerList>`, real edges resolved via `resolveFollowers`, XC-004 emitted on open — WR-005
  closed). AC4 ("counts are exercise-scoped") stays unticked: nothing at the frontend layer currently
  tests that a foreign-exercise follower id is dropped — see 05's own file for what test would close
  it. (The backend's own follow-graph isolation is separately covered by story 07's
  `FollowGraphIsolationTests`, extending `exercise-isolation/07`.)

## Dependencies
posts (PostCard, verified mark); E1 verification flag, isolation, telemetry; persona-management
(personas). Feeds E8 spread + E10 reach (SOC-054 formula). Steered by E7 CTL-021 (suggested follows).

## Design notes
Participant world. The verified mark (and its **absence**) is the **only** credibility signal — the
platform never flags impersonators (D1-008); near-duplicate lookalikes are allowed by design (SOC-052).
Follower **lists** never fabricate scrollable entries (D1-012).
