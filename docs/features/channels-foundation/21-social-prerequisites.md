# Story: Social prerequisites for channel consumers (read-only exports, bounded posts, compose-with-link)

**Feature:** Channels foundation  ·  **Epic:** E2 (consumed by E3/E4)  ·  **Phase:** 3 — December release (Tom, 10/21)  ·  **Status:** Not Started
**Requirements:** PRT-005, NWS-015, NWS-011, SOC-004, COR-015, XC-001, XC-004, NFR-001, NFR-002  ·  **Design decisions:** D1 (PostCard anatomy), D7-001  ·  **Issue:** #717
**Stack:** frontend  ·  **World:** participant  ·  **Wave:** 1  ·  **Effort:** M
**Added by:** the December consolidation pass — portal request **R-S1** plus news follow-ups **FU-5** (compose-with-link) and **FU-6a** (post-by-id). The social feature folders are complete; this is the
one additive, no-behavior-change story that exposes what the channels need, so neither the portal nor news deep-imports Social internals or forks `PostCard`.

## Context
Two channels render Social content inside their own pages: the portal's Social Stream / Trending modules and the kiosk feed slide (E3 10, 19), and news articles that embed a post and share to Pulse
(E4 06, 09). Today the pieces are importable only by deep path (`features/social/explore/useTrending.ts`, `theme/SocialBrandScope.tsx`, `layout/socialNavigation.ts`'s `socialPaths`), the public
barrel was **frozen** by demo-polish F0, there is no bounded recent-public-posts read, no post-by-id read for embeds and no way to open the composer pre-filled with an in-sim permalink. This story adds
exactly those, additively, and lifts the barrel freeze for them (the freeze existed to keep parallel Wave-2 builders from colliding; that wave is done). Participant world; Social keeps its own skin
(`SocialBrandScope`), never COBRA.

## Acceptance Criteria
- [ ] **Barrel exports.** Given `@/features/social`, then it additionally exports `useTrending` (+ `TrendingTopic`), `SocialBrandScope`, `socialPaths` and two thin helpers `socialPostPath(postId)` / `socialProfilePath(handle)` over it; each export is the **same identity** as the deep-path original (a test asserts it), no existing import changes behavior, and the barrel stays free of staff/COBRA imports.
- [ ] **Bounded recent public posts (R-S1).** Given `useRecentPublicPosts({ limit })` (limit 1–20, default 5), then it returns the newest top-level, public, non-deleted, non-hidden posts for the session's exercise (no replies, no DMs, no tombstones), read from the existing feed/explore store so there is **no second subscription or connection**, and it re-renders at most once per animation frame under a 120 posts/min burst (a fake-timer test); it never accepts an exercise id (XC-001).
- [ ] **Read-only `PostCard` (R-S1, COR-015).** Given `<PostCard post … />` with no action callbacks (or an explicit `readOnly` prop), then reply / repost / like / share / follow / overflow menus are **absent from the DOM and the a11y tree** (not disabled), the author and timestamp links remain, the card's anatomy and verified-mark treatment are unchanged, and the existing feed rendering is byte-identical (existing snapshots pass).
- [ ] **Post by id (news FU-6a, NWS-015).** Given `usePostById(postId)`, then it returns the participant-safe post for the session's exercise; a post from another exercise answers exactly like an unknown id, and a deleted/hidden post returns `{ status: 'unavailable' }` so the embedding article shows "post unavailable" (XC-010, E4-Q10) — never an error boundary.
- [ ] **Compose with link (news FU-5, SOC-004).** Given `useComposeWithLink()` returning `openComposerWithLink(permalink)`, then the participant composer opens pre-filled with that **host-relative in-sim permalink** (a value containing `://` or a leading `//` is rejected, FC-9.3), renders inside the content region / existing overlay layer (it never draws above the shell overlay, D7), and the post that results goes through the normal composer so it is a normal `post` event whose link card resolves via the foundation link-preview route; in a read-only session the helper returns `false` and opens nothing.
- [ ] **No regression / a11y.** Given the full existing social test suite, then it passes unchanged; the new read-only card and the hooks add no serious/critical axe violations; Social stays in its own brand scope and no COBRA or default MUI look is introduced (NFR-001, D0 §2).

## Out of Scope
Any portal, news or kiosk UI (E3/E4 stories own those); a social-side "share to news"; changes to feed ordering, trending computation or composer behavior beyond accepting an initial permalink; pagination beyond `limit` 20.

## Technical Notes
Participant world. Files: `features/social/index.ts` (additive exports), additive `export` lines in `explore/useTrending.ts`, `theme/SocialBrandScope.tsx`, `layout/socialNavigation.ts`; new `hooks/useRecentPublicPosts.ts`, `hooks/usePostById.ts`, `hooks/useComposeWithLink.ts`; `components/post/**` / `components/PostCard.tsx` for the read-only mode only. Reuse `exploreFeedStore` / `useExploreBaseline`, the existing post service, `useComposePost`. Consumers: portal 10, 19; news 06, 09. See `implementation.md` § FC-8 (social side) and § Follow-up resolution ledger.

## Dependencies
None (existing Social). Can run with 01, 02. Blocks portal 10/19 and news 06/09 (they may start on adapter stubs, then swap one import line).
