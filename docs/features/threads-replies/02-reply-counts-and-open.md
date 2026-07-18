# Story: Reply counts & thread open

**Feature:** Threads & replies  ·  **Epic:** E2  ·  **Phase:** 1  ·  **Status:** Complete
**Requirements:** SOC-011  ·  **Design decisions:** none  ·  **Issue:** #99

## Context
Reply counts display on posts; tapping a post (or its reply affordance) opens the thread (SOC-011).

## Acceptance Criteria
- [x] A post card shows its reply count in the action row (posts/02).
- [x] Tapping the post (or reply count) opens the flattened thread (story 01) focused on that post.
      *(Wired in the integration step: the feed's `onOpenThread` is threaded to each `<PostCard>`'s
      `onOpen` (body-tap) AND `onReply` (reply affordance) — either activates the same thread-open.)*
- [ ] Reply counts update as replies are added (real-time consistent with feed updates, feeds-discovery).
      *(Deferred — real-time; see Deferred. Counts render from props today; there is no live-update
      mechanism yet.)*
- [x] Keyboard/screen-reader operable (NFR-001).

## Deferred (tracked follow-ups)
- **Live-updating reply counts.** This AC's real-time clause is out of this wave. `<PostCard>` renders
  whatever `PostCounts` it is handed; nothing here subscribes to new replies and pushes an updated count.
  Lands with feeds-discovery/04 (#123), the real-time story this AC itself points at.

## Out of Scope
Thread rendering (story 01); the reply composer (posts SOC-001).

## Technical Notes
Participant world. Count on `<PostCard>`'s action row; opening a thread is local view state in
`SocialChannel` (Phase 1 has no cross-channel router yet), not a URL route — `SocialChannel` swaps
`<Feed>`+`<Composer>` for `<ThreadView>` on `onOpenThread`, with a "Back to feed" control. See
implementation.md (story 02).

## Dependencies
posts (PostCard), story 01 (thread view).

## Tests
- Component (RTL) — `components/PostCard.test.tsx`: shows the reply count in the action row; fires
  `onReply` with the post id on click and on keyboard activation (Enter/Space); leaves the reply button a
  no-op when `onReply` isn't supplied (unchanged default behavior); never wires `onReply` onto the inert
  `readOnly` counts; fires `onReply` (not `onOpen`) when both handlers are supplied and the reply button
  is clicked; exposes reply/repost/like as accessibly-labelled buttons, not a color/icon-only signal
  (NFR-001).
- Integration (RTL) — `SocialChannel.test.tsx`: "opens a post into its flattened thread and returns via
  'Back to feed'" — the feed's `onOpenThread` wiring end-to-end.
