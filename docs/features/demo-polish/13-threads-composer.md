# Story: Threads and composer — replies, attach, instant own post

**Feature:** Demo polish  ·  **Epic:** E2  ·  **Phase:** 1  ·  **Status:** Not Started
**Requirements:** SOC-001, SOC-010, SOC-011, SOC-012, NFR-001, NFR-004, COR-053  ·  **Design decisions:** D1-006 (flattened thread), D1-R5 (ring counter), D1-009 (tombstone), D1-011  ·  **Issue:** —
**Story ID:** F4  ·  **Stack:** frontend  ·  **Priority:** Must  ·  **Effort:** L  ·  **Wave:** 2
**Home stories:** [`posts/01`](../posts/01-post-composition.md), [`threads-replies/02`](../threads-replies/02-reply-counts-and-open.md), [`/03`](../threads-replies/03-persona-participant-replies.md).

## Context
**As** a PIO, **I want** to attach a photo to my official statement, see my post appear at once, and read and
answer replies in a thread, **so that** the "PIO responds" beat works (demo beat 4). Today there is no reply
composer, the thread is empty, the composer's attach is a placeholder that rejects video ("Inline video is
coming soon", `useComposePost.ts:141`), and in live mode a participant's own post only arrives via the "▲ new
posts" pill. **World: participant** — no COBRA/MUI. Alt text is mandatory (NFR-001).

## Acceptance Criteria
- [ ] **Flattened real thread (D1-006).** `ThreadView` shows ancestors (root → parent) above, the focused post
      enlarged, replies below — flat, never indented — with `taken-down` replies rendered as an accessible "This
      post is unavailable" tombstone; `useThread` reads the live `GET /api/threads/{id}` (mock: F0 fixtures).
      Every reply card shows a "Replying to @handle" line (`PostReplyContext`, also on profile cards).
- [ ] **Reply composer.** Under the focused post, `ReplyComposer` shows "Replying to @handle", the 280-char ring
      counter, and the same attach tray; posting sends `parentPostId`; the reply button on any card opens the
      thread with the composer focused; read-only / persona-less sessions get no composer (absent, D1-011).
- [ ] **Live reply append.** A reply arriving over realtime for the focused post appends below (polite live
      region "1 new reply", no scroll jump) and increments the parent's reply count; your own reply's echo does
      not duplicate; replies **never** raise the "▲ new posts" pill (`feedStreamSource` filters `inReplyTo`
      posts out of the feed stream).
- [ ] **Own post appears instantly.** After a successful publish the post is at the top of the participant's
      feed immediately (no pill tap), exactly once; the SignalR echo does not raise the pill or duplicate it. A
      failed publish keeps the draft, shows an inline error with Retry, and never silently drops text
      (`publishPost` rejections are no longer swallowed). `Composer`'s `onPosted(view)` now fires in live mode
      too.
- [ ] **Attach becomes real.** Up to 4 images **or** 1 video through `useMediaUpload`; thumbnail/poster
      previews, a required alt-text field per item (Post stays disabled until each has non-empty alt), a
      per-file `role="progressbar"` with cancel, remove; client validation messages for type/size with the hint
      "MP4 (H.264)"; the "coming soon" video message is gone; mixed image+video is refused with a clear message.
- [ ] **Content security and time (NFR-004, COR-053).** Alt and body text go through `sanitizeText` before send
      (the server still sanitizes); upload files are validated before upload; reply/post times render in
      scenario time via `useScenarioTime`; no `exerciseId` in any request.
- [ ] **Telemetry.** Live mode: no frontend `post`/`reply` event (the server emits it); mock mode: one per
      publish, `reply` when `parentPostId` is set.

## Out of Scope
Quote posts, nested/indented threads, editing or deleting a post, drafts, hashtag/mention autocomplete,
GIF/emoji pickers, location tag, DMs, the modal wrapper (F1), media rendering (F2), persisted reactions (F3).

## Technical Notes
- Files: implementation.md §4.1 row F4 — `ThreadView.*`, `Composer.*`, new `ReplyComposer.*` and
  `ComposerMedia.*`, `useThread.ts`, `useComposePost.ts`, `post/PostReplyContext.*`, `pages/Feed.*`,
  `services/{feedStreamSource,ownPostStore}.ts`. You are the **only** Wave-2 editor of `Feed.tsx` (F5 only fills
  `FeedSkeleton.tsx`, which F0 already mounts). `post/{PostCard,PostHeader,PostBody}.tsx` are frozen.
- Reuse: `core/media` (`useMediaUpload`, `uploadVideoWithPoster`, `validateMediaFile`), `publishPost` v2,
  `sanitizeText`, the existing ring-counter code in `Composer`, `useScenarioTime`. Own-post flow suggestion:
  `ownPostStore` holds the created view; `Feed` merges it at the top and the stream's `admit` predicate excludes
  its id.
- The mock thread data in `useThread.ts` is yours to upgrade to the F0 fixtures. Runtime `inReplyTo` retention
  in the realtime parser is F2's (verified at Gate 2).

## Dependencies
F0. Runs with F1–F3, F5, F6. **Live check** once BM+BP+B2 are deployed: attach a photo, post it, see it
instantly; reply from a second session and watch it append. F1's `ComposeModal` auto-close depends on the
`onPosted` semantics here.

## Tests
- Thread: ancestry order, flat rendering, tombstone, reply line, live append (no duplicate, count bump, live
  region), reply never reaches the pill stream.
- Composer: attach validation matrix, alt-required gating, progress/cancel (mock uploader), publish failure
  keeps draft, `onPosted` in live mode, instant own-post + echo dedupe, read-only absent.
- Sanitization (stored `<script>` in alt/body stays inert), scenario-time rendering, no `exerciseId` in request
  bodies, telemetry once (mock) / zero (live).
- Regression: `Composer.test.tsx`, `Composer.readonly.test.tsx`, `ThreadView.test.tsx`, `useThread.test.ts`,
  `useComposePost*.test.ts`, `Feed.*.test.tsx` updated, not deleted.
