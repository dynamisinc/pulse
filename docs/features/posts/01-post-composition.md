# Story: Post composition (text / media / hashtags / mentions)

**Feature:** Posts  ·  **Epic:** E2  ·  **Phase:** 1  ·  **Status:** Complete
**Requirements:** SOC-001  ·  **Design decisions:** D1-R5  ·  **Issue:** #92

## Context
A participant composes a post: text (280-char default, per-exercise configurable), 0–4 images or 1
video (inline playback — the Utube replacement path), hashtags, @mentions, and an optional location tag
(SOC-001). The composer feels like X — an X-style depleting ring character counter, count text
appearing at ≤20 remaining (D1-R5).

## Acceptance Criteria
- [ ] A participant can compose and publish a post with text up to the configured limit (280 default),
      0–4 images **or** 1 video (inline playback), parsed hashtags/@mentions, and an optional location.
      *(partial — text + image-attach + #/@ parsing shipped; inline video, location, and #/@ persistence
      are deferred — see Deferred. The `Post`/`PostMedia` model (posts/03, #94) has no field for these
      yet, so nothing is silently dropped: a picked video is recognized and rejected with an explicit
      in-fiction message, and the location input was removed rather than accepted and discarded.)*
- [x] The composer shows an X-style depleting **ring counter**; count text appears at ≤20 chars
      remaining and an amber low state near the limit (D1-R5).
- [x] Post text and media are **sanitized/validated** before publish (HTML sanitization, MIME/size,
      NFR-004) — a script in a post never executes in another session.
- [x] Publishing emits a telemetry event (XC-004) and the post renders in scenario time (COR-053,
      story 03/02).
- [x] The composer is a **participant surface** — Pulse skin, no COBRA/default-MUI look (D0); in
      **observer mode** the composer/Post is **absent** (not disabled; D1-011).

## Deferred (tracked follow-ups)
Model-dependent — the `Post`/`PostMedia` model (posts/03, #94) carries no field for any of these yet, so
each is a documented gap, not a silent drop:
- **Inline video.** Phase-1 `PostMedia` is image-only (`{kind: 'image', alt}`). The attach validator
  recognizes a picked video file and rejects it with an explicit in-fiction message ("Inline video is
  coming soon — attach up to 4 images for now.") rather than silently failing. Needs a `PostMedia` video
  kind (D1 rich-media composer backlog) before this can ship.
- **Optional location tag.** The location input was intentionally **removed** from this slice rather than
  accepted and silently discarded — `Post` has no location field yet. Follow-up: add the field to the
  posts/03 model, then reintroduce the input.
- **Hashtag/@mention persistence.** `parseHashtags`/`parseMentions` run on every compose (deduped,
  order-preserved) and are exposed on `useComposePost` for telemetry/future use, but are **not stored on
  the `Post`** — the model has no `hashtags`/`mentions` field yet, and nothing is navigable/linked from
  them in this wave.

## Out of Scope
Author-identity rendering (story 02); provenance capture detail (story 03); link-preview cards (story
04); the "Posting as" org chip (story 06); quote-post/media-rich composer states (D1 backlog).

## Technical Notes
Participant world (Pulse skin). Reuse the shared compose pipeline; sanitize on the publish path. The
composer exists inline (feed) + as a modal (D1). See implementation.md (story 01).

## Dependencies
E1 isolation/session; scenario clock (COR-053); telemetry (XC-004); NFR-004 sanitization. Feeds every
other E2 surface.

## Tests
- Unit — `hooks/useComposePost.test.ts`: hashtag/mention extraction (deduped, order-preserved, marker
  stripped); image validation (accepts valid images, rejects >4 total, rejects unsupported MIME, rejects
  oversized, rejects a video with the documented follow-up message).
- Unit — `services/sanitize.test.ts`: strips a `<script>` block, an `<img onerror>` tag, and a
  `javascript:` link (keeping the visible label); leaves ordinary text/punctuation unchanged (no
  double-encode).
- Component (RTL) — `components/Composer.test.tsx`: publishes typed text and fires `onPosted`; emits
  exactly one `'post'` telemetry event stamped with scenario time + participant origin; shows/hides the
  ring count at the ≤20-remaining threshold (amber low); blocks publish over the limit and emits no
  telemetry for the blocked attempt; sanitizes a stored-XSS `<script>`/`<img onerror>` payload on the
  publish path; accepts a valid image attachment; rejects a video file with the documented message.
- Component (RTL) — `components/Composer.readonly.test.tsx`: renders nothing at all in a read-only
  session (absent, not disabled).
