# Implementation: Profiles & social graph

> Participant-world profiles + the trust signal + the audience-magnitude formula (the single source
> E8/E10 compute reach over). Backend not present — follow/profile/magnitude are the contract seam.

## Per-story tech notes

| Story | Approach | Key files (owns) | Exports |
|-------|----------|------------------|---------|
| 01 Profile page | Profile layout + tabs over PostCard. | `features/social/pages/Profile.tsx` | `<Profile>` |
| 02 Follow | Follow edge write + optimistic count. | `features/social/hooks/useFollow.ts` | `useFollow()` |
| 03 Verification/impersonation | Fixed seal-blue mark; lookalikes unflagged. | `features/social/components/VerifiedMark.tsx` (shared w/ posts/02) | `<VerifiedMark>` |
| 04 Who to follow | Suggestion module, no authority labels. | `features/social/components/WhoToFollow.tsx` | `<WhoToFollow>` |
| 05 Audience magnitude | Count = magnitude + edges; shared reach formula. | `features/social/services/audience.ts`, `components/FollowerList.tsx` | `audienceReach()`, `formatMagnitude()` |
| 06 Persona presentation fields (backend) | Persist + project real `Bio`/`PersonaType`/`AudienceBand`/`AudienceMagnitude`/`JoinedAt`; extend the engine's fixed-cast seeder to the full nine-persona set incl. the SOC-052 pair. | `Data/Entities/Persona.cs`, `Data/Migrations/**` (new), `Features/Social/PersonaEndpoints.cs` (`PersonaResponseDto.FromPersona`), `Features/Ops/EngineContentSeed/PersonaCastSeeder.cs` | Real `PersonaResponseDto` values (contract shape unchanged); the seeded nine-persona catalog |
| 07 Follow graph (backend) | New `Follow` entity + follow/unfollow endpoints + composed counts + a following-scoped feed read. | `Data/Entities/Follow.cs`, `Data/Migrations/**` (new), `Features/Social/Follows/{FollowEndpoints.cs,FollowService.cs}`, extends `PersonaEndpoints.cs`/`FeedEndpoints.cs` | `POST/DELETE /api/personas/{id}/follow`; composed `followerCount`/`followingCount`; `GET /api/feed?scope=following` |

## Reuse map
- `<PostCard>`, `<VerifiedMark>` (posts); scenario-time (COR-053); telemetry (XC-004)
- E1 verification flag + audience-magnitude band (COR-020/SOC-054)
- `audienceReach()` (05) — **imported by E8 (ADP-004) and E10 (EVL-012)** — single source of the formula
- E7 CTL-021 (adjust suggested follows); feeds-discovery (Following feed, search People)
- Verified-mark token `#2D9CDB` fixed, separate from `--pulse-ac`
- Backend (06/07): `PulseDbContext` central exercise-scope query filter + write-guard (COR-001,
  never a story-local filter); `PersonaCastSeeder`'s existing `PostSanitizer.Sanitize` funnel
  (NFR-004) for new free-text fields; `ReadOnlySessionWriteFilter` (COR-015/D1-011) for the new
  follow/unfollow writes; the session-identity accessor pattern established by
  `CurrentStaffSessionAccessor`/`ReadOnlySessionProbe` (`identity-auth-roles`) for resolving the
  caller's own persona; the XC-004 telemetry sink already used by `PostWriteEndpoints`; the
  `CompositionRootWiringTests` pattern (`identity-auth-roles/10`) for verifying new endpoints are
  actually reachable through `Program.cs`.

## Wave Plan (DAG-ready)

| Story | Files it owns | Depends-on | Can-run-with | Wave | Effort |
|-------|---------------|------------|--------------|------|--------|
| 06 Persona presentation fields (backend) | `Data/Entities/Persona.cs`, `Data/Migrations/**`, `PersonaEndpoints.cs` (DTO projection), `PersonaCastSeeder.cs` | `backend-host/02`; `social-api/04`; `engine-content-seed/01` | **07 — SERIAL, not parallel** (see note) | 0 | M |
| 07 Follow graph (backend) | `Data/Entities/Follow.cs`, `Data/Migrations/**`, new `Features/Social/Follows/*`, extends `PersonaEndpoints.cs`/`FeedEndpoints.cs` | `backend-host/02`; `social-api/04`; `social-api/01`; `identity-auth-roles/03,05` | **06 — SERIAL, not parallel** (see note) | 0 | M |
| 03 Verification/imperson. | **none** — `VerifiedMark.tsx`/`Avatar.tsx` already ship this (posts/02, Complete) + persona-management fixtures; this is a verification/regression pass exercised via story 01's profile header, not a new component | posts/02 (Complete); E1 flag | 01 | 1 | XS |
| 01 Profile page | Profile (+ shared view-composition wiring — see seam below) | posts (PostCard); 03 (no real file wait — see note) | 03, reactions/01, amplification/01, hashtags-trending/01 (files disjoint) | 1 | M |
| 05 Audience magnitude | audience, FollowerList | E1 magnitude band; **06** (real `AudienceMagnitude` to compose against, replacing the B1-stand-in path) | 01 | 1 | M |
| 02 Follow | useFollow | 01; feeds Following; **07** (the follow/unfollow endpoints this hook calls) | 04 | 2 | S |
| 04 Who to follow | WhoToFollow | 02, 03; E7 CTL-021; **07** (the following-set read used to exclude already-followed accounts) | 02 | 2 | S |

**Wave 0 — backend foundation, ahead of everything else.** Stories 06 and 07 are **Wave 0**, and are
**SERIAL with each other**, not parallel, even though their runtime code (`PersonaEndpoints.cs`
edits vs. a brand-new `Follows/` slice) is largely file-disjoint: both stories add an EF Core
migration in the same pass, and both migrations regenerate the single shared
`PulseDbContextModelSnapshot.cs` — authoring two migrations against the same snapshot in parallel
produces a conflicting/incorrect diff (see the standing EF-migration gotcha: `--no-build` and
concurrent authoring both silently scaffold the wrong snapshot). Land 06's migration, then 07's,
each its own reviewed commit. Stories 02/04/05 (previously Wave 1/2 with no backend dependency
recorded) now additionally depend on Wave 0: 05 needs story 06's real `AudienceMagnitude`, and
02/04 need story 07's endpoints/following-read to be anything more than a mock-backed seam.

**~~06 requires no frontend change.~~ CORRECTED (Gate-1 WR-001, story-owner-approved amendment).** This
paragraph previously said the frozen client contract and `PersonaResponseDto`'s JSON shape were both
unchanged by story 06. **Both halves are now false**, and stories 05/07 and the frontend integration
must plan against the amended reality:

- **The JSON shape changed, per world.** `GET /api/personas` now returns one of two shapes, branching on
  the caller's session (`ICurrentStaffSessionAccessor`, fail-closed to participant, mirroring the
  `ParticipantPostDto`/`StaffPostDto` provenance split). The **participant** shape structurally OMITS
  `personaType`: the archetype labels exactly one seeded account `bad-actor`, so serving it to the feed
  would be a machine-readable flag on the SOC-052 lookalike (D1-008). The **staff** shape
  (`StaffPersonaResponseDto`) keeps `personaType` for `PersonaPicker.tsx` / `PersonaContextPanel.tsx` /
  `controller/services/personaVoice.ts`. Everything else (`bio`, `audienceBand`, `followerCount`,
  `joinedAt`, `avatarColor`, `initials`) is identical in both and now carries real persisted values.
- **The frozen contract therefore needs a change, and it is already being built elsewhere.**
  `features/personas/types.ts:91` declares `personaType` as required on `Persona`, which the participant
  payload no longer satisfies. The approved resolution is a **participant/staff TYPE SPLIT** — `Persona`
  without `personaType`, plus a staff shape widening by exactly that one field — being built on branch
  **`build/profiles-social-graph/persona-contract-split`**. It is explicitly **NOT** "make `personaType`
  optional"; do not implement that version. Nothing breaks at runtime in the meantime: `isValidPersona`
  does not check the field and no participant surface reads it.
- **Still true:** no story-06 change was made to any frontend file, and the mock→live flip needs no
  consumer edit for bios/bands/join dates/the impersonator to render.

**06 also added a server-side `Persona.Castable` gate** (not on any DTO, participant or staff): the
SOC-052 lookalike and `@TheScoopHQ` are seeded as rows but excluded from the engine's eligible cast until
a scenario opts in. Story 07 and any future persona read must keep it off the wire.

Note on 01/03 ordering: 03 has no net-new owned file in this wave (see left column), so 01 does not
actually block on a file 03 produces — both can build in the same pass; 03's remaining job (a
regression assertion that the profile header renders the impersonation pair honestly) is verified
once 01's `Profile.tsx` exists, and 03's Status can close out immediately after.

### Integration seam (orchestrator-owned — never a wave story)
`Profile.tsx` is a pure consumer of `<PostCard>`/`<VerifiedMark>` — no shared-file edit needed to
build/test it standalone. Reaching a profile from a tap (author name/handle in a post), however, is a
shared view-composition change:

| Seam | File(s) | Rule |
|------|---------|------|
| Channel view composition | `features/social/SocialChannel.tsx` | Same seam `hashtags-trending/01` needs for its hashtag-feed view (Phase 1's local-`useState` composition root, mirrors `openThreadId`). Orchestrator-owned, serial, in Wave 2 after both stories land their own pages. |

Build `Profile.tsx` and its unit/RTL tests standalone in Wave 1 (rendered directly with a
personaId/route param, no live tap-through yet); the `SocialChannel.tsx` "open profile" wiring is a
Wave-2 orchestrator pass alongside hashtag-feed navigation.

**Landed (final integration pass, #88).** The seam above is now fully wired, and the remaining
channel-composition work for this feature is done:
- **Author tap-through (SOC-050).** A typed optional `onOpenProfile?: (personaId: string) => void` is
  threaded `SocialChannel` → `<Feed>` / `<ThreadView>` / `<HashtagFeed>` → `<PostCard>` — the same
  optional-callback shape `onOpenThread`/`onHashtagOpen` use (no event delegation, no `data-`-attribute
  scraping, no `any`), and a `useCallback` at the channel so `<Feed>`'s memoized rows still bail out
  under burst (NFR-002/SOC-071). `<PostCard>` renders it as a transparent overlay `<button>` scoped to
  the author identity box, stacked (`z-index: 2`) above the card's own body-open overlay (`z-index: 1`)
  — the pattern already shipping for `.openTarget`/the hashtag anchors, so the two controls stay
  SIBLINGS (WR-001) and the identity text + verified seal stay outside any interactive ancestor
  (SOC-052). Unwired ⇒ no button at all (WR-002).
- **`<WhoToFollow>` (story 04) is mounted** in the channel's feed region — a sibling of the feed, never
  inside a `<PostCard>` — capped to the first three suggestions. It hides with the feed region, so it
  is absent from the thread/hashtag/profile views.
- **All Posts ↔ Following tablist** (feeds-discovery/02 AC3) — see that story for the details; absent
  entirely for a read-only/no-persona session (COR-015's rule itself stays in `useFeed`).
- **SUG-001 focus gap closed** — the view-swap effect now repositions focus on detail→detail
  transitions too. See story 01's Deferred section.

**Landed earlier (Wave-S3.1 integration, commit `9d935b8`):** a "View my profile" entry point is wired
into `SocialChannel.tsx` and verified end-to-end (`SocialChannel.navigation.test.tsx`) — stories 01 and
03 are Complete. **WR-003 — RESOLVED (#88).** `Profile` (and `ThreadView`, `threads-replies/01`) now
thread the shell's read-only `variant` through to every `<PostCard>` they render — an observer/
read-only session sees the action controls genuinely absent (D1-011), not present-and-inert. See
story 01's Deferred section for the full resolution note.
