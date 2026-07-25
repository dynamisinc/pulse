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

## Reuse map
- `<PostCard>`, `<VerifiedMark>` (posts); scenario-time (COR-053); telemetry (XC-004)
- E1 verification flag + audience-magnitude band (COR-020/SOC-054)
- `audienceReach()` (05) — **imported by E8 (ADP-004) and E10 (EVL-012)** — single source of the formula
- E7 CTL-021 (adjust suggested follows); feeds-discovery (Following feed, search People)
- Verified-mark token `#2D9CDB` fixed, separate from `--pulse-ac`

## Wave Plan (DAG-ready)

| Story | Files it owns | Depends-on | Can-run-with | Wave | Effort |
|-------|---------------|------------|--------------|------|--------|
| 03 Verification/imperson. | **none** — `VerifiedMark.tsx`/`Avatar.tsx` already ship this (posts/02, Complete) + persona-management fixtures; this is a verification/regression pass exercised via story 01's profile header, not a new component | posts/02 (Complete); E1 flag | 01 | 1 | XS |
| 01 Profile page | Profile (+ shared view-composition wiring — see seam below) | posts (PostCard); 03 (no real file wait — see note) | 03, reactions/01, amplification/01, hashtags-trending/01 (files disjoint) | 1 | M |
| 05 Audience magnitude | audience, FollowerList | E1 magnitude band | 01 | 1 | M |
| 02 Follow | useFollow | 01; feeds Following | 04 | 2 | S |
| 04 Who to follow | WhoToFollow | 02, 03; E7 CTL-021 | 02 | 2 | S |

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

**Landed (Wave-S3.1 integration, commit `9d935b8`):** a "View my profile" entry point is wired into
`SocialChannel.tsx` and verified end-to-end (`SocialChannel.navigation.test.tsx`) — stories 01 and 03
are Complete. **WR-003 — RESOLVED (#88).** `Profile` (and `ThreadView`, `threads-replies/01`) now
thread the shell's read-only `variant` through to every `<PostCard>` they render — an observer/
read-only session sees the action controls genuinely absent (D1-011), not present-and-inert. See
story 01's Deferred section for the full resolution note.
