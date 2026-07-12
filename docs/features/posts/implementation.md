# Implementation: Posts

> Participant-world (Pulse skin — never COBRA/default MUI). The post card + composer are the most-reused
> E2 components. Backend not present — compose/publish/preview are the contract seam; mock now.

## Per-story tech notes

| Story | Approach | Key files (owns) | Exports (that others import) |
|-------|----------|------------------|------------------------------|
| 01 Composition | Inline + modal composer with ring counter; sanitized publish. | `features/social/components/Composer.tsx`, `hooks/useComposePost.ts` | `<Composer>`, `useComposePost()` |
| 02 Rendering/identity | The canonical PostCard + verified seal. | `features/social/components/PostCard.tsx`, `components/VerifiedMark.tsx` | `<PostCard>` |
| 03 Provenance | Provenance fields + telemetry on publish. | `features/social/services/postService.ts` | post model, provenance |
| 04 Link previews | In-sim, scoped preview resolution + card. | `features/social/components/LinkPreviewCard.tsx` | `<LinkPreviewCard>` |
| 05 Soft delete/tombstone | Soft-delete + thread-only tombstone; feed omit. | `features/social/components/Tombstone.tsx`, `services/postService.ts` | `deletePost()`, `<Tombstone>` |
| 06 Post-as-org | Grant-gated "Posting as" chip; single active identity. | `features/social/components/PostingAsChip.tsx`, `hooks/usePostingIdentity.ts` | `usePostingIdentity()` |

## Reuse map
- **Pulse participant theme / skin** (NOT COBRA) — `features/social/theme/` (per-exercise accent `--pulse-ac`)
- Verified-mark token `#2D9CDB` (fixed, D1-003) — separate from the accent
- Scenario-time utility (`formatScenarioTime`, E1 COR-053) — all timestamps
- Telemetry emitter (XC-004) + provenance — publish path
- E1 org grants + attribution (COR-018) — post-as-org (06)
- Sanitization (NFR-004) — compose publish path
- Observer flag (COR-015 / D1-011) — hide composer/Post
- `<PostCard>` (02) — reused by feeds, threads, profiles, search, amplification

## Wave Plan (DAG-ready)

| Story | Files it owns | Depends-on | Can-run-with | Wave | Effort |
|-------|---------------|------------|--------------|------|--------|
| 02 Rendering/identity | PostCard, VerifiedMark | E1 verification flag; scenario-time | 03 | 1 | M |
| 03 Provenance | postService provenance | E1 clock, telemetry, COR-018 | 02 | 1 | M |
| 01 Composition | Composer, useComposePost | 02; sanitization; E1 session | — | 2 | M |
| 05 Soft delete/tombstone | Tombstone, postService | 02; threads; XC-010 | 04, 06 | 2 | S |
| 04 Link previews | LinkPreviewCard | 02; isolation | 05 | 2 | S |
| 06 Post-as-org | PostingAsChip, usePostingIdentity | 01; E1 COR-018 | 05 | 3 | M |

PostCard (02) is the E2 keystone component — build it first.
