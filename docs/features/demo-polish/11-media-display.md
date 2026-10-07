# Story: Media display — grid, inline video, viewer

**Feature:** Demo polish  ·  **Epic:** E2  ·  **Phase:** 1  ·  **Status:** Not Started
**Requirements:** SOC-001, XC-009, NFR-001, NFR-004, NFR-008, COR-002  ·  **Design decisions:** NFR-008 watermark slot; DP-12 (no captions)  ·  **Issue:** —
**Story ID:** F2  ·  **Stack:** frontend  ·  **Priority:** Must  ·  **Effort:** L  ·  **Wave:** 2
**Home stories:** [`posts/01`](../posts/01-post-composition.md) (video AC), [`posts/04`](../posts/04-link-previews.md) (card image).

## Context
**As** a PIO, **I want** photos to show as photos and a news video to play inline and open full-screen, **so
that** the feed looks real (demo beats 1–2). Today there is no `<img>` or `<video>` anywhere — `PostCard` draws
a grey box with the alt text. **World: participant** (CSS Modules, no COBRA/MUI, FontAwesome). A video post is a
**high-risk content class**: the player reserves the "EXERCISE" watermark slot (NFR-008).

## Acceptance Criteria
- [ ] **Image grid.** `MediaGrid` renders X-style layouts for 1/2/3/4 images (1: natural aspect clamped to
      4:5…16:9; 2: two columns; 3: one large + two stacked; 4: 2×2) with 16 px radius, aspect ratio from
      `width`/`height` (fallback 16:9) so there is no layout shift, `loading="lazy"`, `alt` from the contract on
      every `<img>` (never empty), and an on-error tile showing the alt text.
- [ ] **Inline video.** `VideoPlayer` renders `<video controls playsInline preload="metadata"
      poster={posterUrl}>`, never autoplays, shows a duration badge (`0:24`), pauses when another video plays,
      and uses `preload="metadata"` + `#t=0.1` when no poster exists (first-frame fallback for Safari). Clicking
      the player does **not** open the thread (it sits above the card's open-overlay, like hashtag anchors).
- [ ] **Keyboard operable (NFR-001).** The player wrapper is focusable with `role="group"` and `aria-label` =
      the alt text; Space/K toggles play/pause, ←/→ seek ±5 s, M mutes, F toggles fullscreen — in addition to
      the native controls — with a visible focus ring. No state is color-only (play/pause/mute have text or icon
      + `aria-pressed`).
- [ ] **Watermark slot (NFR-008).** The player has a reserved overlay `data-testid="media-watermark-slot"`; it
      renders the text "EXERCISE" whenever `isWatermarkRequired(useChromeConfig())` is true (chrome off) and
      stays reserved (empty, same layout) otherwise — the layout never shifts when it toggles.
- [ ] **Viewer.** Activating an image opens `MediaViewer` (modal: focus-trapped, Esc closes, ←/→ moves across
      the post's images, focus returns to the thumbnail); a video's "Expand" uses native fullscreen with a modal
      fallback. Alt text is shown to assistive tech in the viewer.
- [ ] **Safe URLs only (NFR-004/COR-002).** `src` is rendered only for `https:` URLs, same-origin paths, `blob:`
      object URLs, and `http://localhost`/`127.0.0.1` in dev; anything else (`javascript:`, `data:` outside the
      mock set, other schemes) is dropped and the tile falls back to the alt-text placeholder. A legacy
      `{kind:'image', alt}` item with no `url` still renders the accessible placeholder (back-compat for old
      mocks).
- [ ] **Realtime and cards.** `services/realtimeFeed.ts` keeps `media` and `inReplyTo` when rebuilding a
      `PostReceived` payload field by field (malformed media entries are dropped, never crash the stream; no
      provenance key can ride along); `PostLinkCard` renders `linkPreview.imageUrl` when present
      (**mock-verified only** — the server sends no link previews this push); `MediaTabGrid` renders a 3-column
      square-thumbnail grid of media posts (video poster with a play badge; activating opens the thread) for
      F5's Media tab.

## Out of Scope
Captions/WebVTT (DP-12 — flagged NFR-001 gap), Picture-in-Picture, image zoom/pan, GIF controls, video quality
selection, autoplay-on-scroll, upload UI (F4), controller thumbnails (C1/C2).

## Technical Notes
- Files: implementation.md §4.1 row F2 (`social/components/media/**`, `post/PostMediaSlot.*`,
  `post/PostLinkCard.*`, `services/realtimeFeed.ts`). F0 already mounts `PostMediaSlot` in `PostCard`; you
  replace its body — do not edit `post/PostCard.tsx`. `useChromeConfig`/`isWatermarkRequired` live in
  `features/participant-shell/chromeConfig.ts`.
- Reads only URLs from the contract; never builds a blob URL itself. The video may be non-H.264 MP4 (the server
  cannot tell) — the error state must say "This video can't be played in this browser" with the alt text, not a
  blank box.
- No wall-clock display; the duration badge is a media length, not a clock (COR-053 unaffected).

## Dependencies
F0 (types, stubs, mocks). Runs with F1, F3–F6. **Live check** once BM+BP are deployed: a seeded photo and the
UAT-smoke MP4 render, play, seek (range) and open full-screen in Chrome and Safari. C5 later edits
`realtimeFeed.ts` after this merges.

## Tests
- Layout matrix for 1–4 images incl. portrait; alt present on every image; error fallback; unsafe-URL rejection
  matrix (the NFR-004 case).
- `VideoPlayer` with a stubbed `HTMLMediaElement` (play/pause/seek/volume/fullscreen): key handling,
  single-playing-video rule, no thread-open on click, duration badge formatting (`formatDuration`), watermark
  slot present both ways.
- `MediaViewer` focus trap/return/arrow navigation; `MediaTabGrid` render + activation.
- `realtimeFeed.test.ts`: v2 payload keeps media/inReplyTo, drops malformed items, never copies provenance keys
  (XC-002).
