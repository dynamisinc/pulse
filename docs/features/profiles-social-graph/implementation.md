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
| 03 Verification/imperson. | VerifiedMark | posts/02; E1 flag | 01 | 1 | S |
| 01 Profile page | Profile | posts (PostCard); 03 | 03 | 1 | M |
| 05 Audience magnitude | audience, FollowerList | E1 magnitude band | 01 | 1 | M |
| 02 Follow | useFollow | 01; feeds Following | 04 | 2 | S |
| 04 Who to follow | WhoToFollow | 02, 03; E7 CTL-021 | 02 | 2 | S |
