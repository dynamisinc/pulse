# Story: Article body, pull quotes, inline media and embedded Pulse posts

**Feature:** News network  ·  **Epic:** E4  ·  **Phase:** 3 — December release (Tom, 10/21)  ·  **Status:** Not Started
**Requirements:** NWS-010, NWS-015, NFR-004, NFR-001, SOC-002/004 (embed anatomy)  ·  **Design decisions:** D3-P1 (slot 7), D3-P2  ·  **Issue:** #723
**Stack:** frontend  ·  **World:** participant  ·  **Wave:** E4-1  ·  **Effort:** M

## Context
Slot 7: the rich body with pull quotes, inline images/video and **embedded Pulse posts** (a quoted official's post, a viral rumor post). The body is server-sanitized (story 01 policy) and
rendered through `SanitizedBody` (foundation 14). Skins style type and the pull quote; they **cannot** restyle the embedded post, which is rendered in D1 anatomy verbatim (seal `#2D9CDB` fixed),
so the same post looks identical in the feed, a link card and an article (cross-channel visual consistency).

## Acceptance Criteria
- [ ] **Body renders safely.** Given `bodyHtml`, then it renders through `SanitizedBody` only (no other `dangerouslySetInnerHTML` in `features/news/**`, static test); a payload corpus (`<script>`, `onerror`, `javascript:`, `<iframe>`, `style=`) never executes or injects in any skin (NFR-004).
- [ ] **Typography by skin.** Body size is ≥ 16px at mobile (NFR-001) and measure ≈ 66ch on desktop; paragraph rhythm, drop-cap or none, `h2/h3` and links use skin tokens; link color is never the only cue (underline retained) and meets 4.5:1 on the skin background.
- [ ] **Pull quote.** Given `blockquote.pull-quote`, then it renders with the skin's pull-quote treatment as a semantic `blockquote` with optional `cite`; it is not duplicated in text-to-speech (no `aria-hidden` trick that hides content from AT), and at mobile it never overflows the column.
- [ ] **Inline media.** Given `figure[data-media-id]`, then it resolves against `item.media` and renders `ContentMedia` with caption per `skin.media.captionStyle`; inline video uses the shared player (05) and gets the watermark chip and `ExerciseBands` when required; a `data-media-id` that is not in `item.media` renders nothing (no broken image).
- [ ] **Embedded Pulse post.** Given `<pulse-post data-id>`, then the render-prop (foundation 14) resolves the post by id within the session's exercise and renders it with the social `PostCard` anatomy verbatim, inside an isolation wrapper that resets to the exercise brand tokens (outlet tokens do not reach it: the boundary is F13's `SkinResetBoundary`); the embed is a link to the post thread, keyboard-operable, and shows a skeleton while loading and an in-fiction "post unavailable" tombstone line if deleted/not found (XC-010).
- [ ] **Cross-channel consistency test.** A visual/DOM snapshot test renders the same post inside the Newsline 7, Courier-Ledger, National Wire and The Scoop article bodies and asserts identical post-card markup/class tokens in all four, and equal to the feed rendering.
- [ ] **Isolation.** Given `data-id` of a post in another exercise, then the lookup is the participant post endpoint (exercise-scoped, no exercise id in the URL) and returns the same 404 → "post unavailable"; a cross-exercise id leaks nothing about existence (XC-001/002).

## Out of Scope
The editor's insertion UI (17); embedding non-Pulse sources; footnotes/related-links modules; share and discussion footer (09); the Scoop clutter modules in the body (14).

## Technical Notes
Participant world. Files: `src/frontend/src/features/news/body/{ArticleBody,PullQuote,EmbeddedPost,InlineFigure}.tsx` + tests. Imports `PostCard` from `features/social/components` (a read-only cross-feature import; do not fork it). The post fetch is **`usePostById` from the `features/social` barrel (foundation story 21)** and the card is the barrel's read-only `PostCard`; until F21 lands, build against a stub with the same signature and swap one import line. CSS modules; no MUI default visuals.

## Dependencies
Foundation 14 (`SanitizedBody`, `<pulse-post>` render-prop, `ContentMedia`), 13, 02, **21** (`usePostById`, read-only `PostCard`, `SkinResetBoundary` is F13); E4 01 (sanitizer profile semantics), 05 (player). Can run with 03, 07–14.
