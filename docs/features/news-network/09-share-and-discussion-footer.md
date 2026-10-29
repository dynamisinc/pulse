# Story: Share to Pulse and the discussion footer (no comments, ever)

**Feature:** News network  ·  **Epic:** E4  ·  **Phase:** 3 — December release (Tom, 10/21)  ·  **Status:** Not Started
**Requirements:** NWS-011, NWS-015, NWS-004 (link target), NWS-030 (share-out), NWS-031, XC-004  ·  **Design decisions:** D3-P1 (slots 5 and 9), D3-P2  ·  **Issue:** —
**Stack:** frontend  ·  **World:** participant  ·  **Wave:** E4-1  ·  **Effort:** M

## Context
Two fixed affordances. (1) The **share** affordance in slot 5 always opens a Pulse composer pre-filled with the article permalink, which Pulse renders as an outlet **link card** (SOC-004; foundation 06
resolver). (2) The **discussion footer** (slot 9) closes every article with "Join the discussion on Pulse" linking to the outlet's paired post (`pairedPostId`, foundation 18). There are no comments, ever:
D3-P1 hardens the epic's "out of scope at launch" (NWS-031) to "ever" — flagged in `feature.md`.

## Acceptance Criteria
- [ ] **Share always posts a link card.** Given the share control, when activated, then the participant's own Pulse composer opens pre-filled with the host-relative permalink (no absolute URL, FC-9.3); the resulting post renders a link card via the foundation link-preview endpoint; there is no "copy raw URL", Facebook/X-style external share or other destination (the compose-with-link seam is `openComposerWithLink` from foundation story 21).
- [ ] **Share telemetry.** Given a post is composed from share, then the normal `post` event carries `payload.sharedContentId`, and exactly one `content_share` (FC-6) is emitted once, server-side, by the foundation path (story 18); this story emits nothing client-side for it (no double count).
- [ ] **Discussion footer.** Given `pairedPostId` is non-null, then the footer renders "Join the discussion on Pulse" (copy from `ext.news.discussionLabel`, neutral default) linking to that post's thread within the Social channel; given it is null the footer is **absent** (no dead link, no placeholder text).
- [ ] **No comments, ever (NWS-031).** A test mounts every skin plus hostile `skinOverrides` and asserts there is no comment form, count, thread, reaction control or textarea anywhere on the article page, and no token key can introduce one.
- [ ] **Fixed behavior across skins.** Skins may restyle the share button's look (type/palette/radius) but not its action, label semantics, slot, or footer placement; an `aria-label` names the action ("Share this story on Pulse").
- [ ] **Mobile and a11y.** Both controls are ≥ 44px on coarse pointers, keyboard-operable with visible focus, and the footer link text is meaningful out of context; axe clean in all skins (NFR-001).
- [ ] **Isolation.** The footer link and the composer prefill never carry an exercise id; a `pairedPostId` from another exercise 404s at the thread view (the social route's standing guard).

## Out of Scope
Creating the paired post (foundation 18); the staff "Post from @outlet" option (foundation 17); the participant's choice of which persona shares (the existing composer's persona handling); share counts; any comment system.

## Technical Notes
Participant world. Files: `src/frontend/src/features/news/share/{ShareBar,DiscussionFooter}.tsx` + tests. The compose-with-link seam is **not** built here: it is `useComposeWithLink().openComposerWithLink(permalink)` from the `features/social` barrel (foundation story 21, news FU-5 resolved). The control is built against a `ShareToPulse` prop (callback); the container in 02 injects the real helper, and until F21 lands a mock with the same signature. The Social thread route is `socialPostPath(postId)` from the same barrel.

## Dependencies
Foundation 14, 13, 02; foundation 18 (paired post, `content_share`), foundation 21 (compose-with-link, `socialPostPath`). Can run with 03, 05–08, 10–14.
