# Story: Emoji picker in both composers

**Feature:** Demo feedback cut (10/20)  ·  **Phase:** 1  ·  **Status:** Not Started
**Requirements:** D1 composer polish  ·  **Decisions:** DF-15  ·  **Issue:** #508
**Stack:** frontend  ·  **World:** both  ·  **Review:** Tier-1  ·  **Priority:** Should  ·  **Wave:** 2 (12a), 3 (12b)  ·  **Effort:** S

## Context

"PIOs like emojis." Phone keyboards already have emoji; desktop users need a button. **12a** adds a shared picker and
puts it in the participant composer (wave 2). **12b** adds the same button to the controller's persona composer
(wave 3, before 11, because 11 also edits `PersonaComposer.tsx`).

## Acceptance Criteria

- [ ] **Library (DF-15):** before adding anything, check the current version and advisories and record both in the PR.
      The chosen option must support React 19, render native emoji, and make **no runtime network request** (verify in
      the test or the dev server's network log); any data file is self-hosted under `public/`. A small hand-rolled
      picker over a bundled list of common emoji is acceptable if no library meets the bar.
- [ ] **12a:** an emoji button (FontAwesome face-smile) in the participant `ComposerForm` tools row opens the picker;
      choosing an emoji **inserts it at the caret** (or replaces the selection) in the textarea, keeps focus, and counts
      toward the 280 limit like any character. Works in Composer, ComposeModal and ReplyComposer.
- [ ] The participant picker is skinned with participant tokens (no default MUI look, no COBRA).
- [ ] **12b:** the persona composer gets the same button with COBRA styling, inserting at the caret of its text field.
- [ ] Keyboard: the picker opens from the button, is searchable, arrow-navigable, Enter inserts, Escape closes and
      returns focus to the text field.

### Cross-cutting
- [ ] **Two worlds** as above. **No network** at runtime.

## Out of Scope

GIF search (external service). Emoji reactions on posts.

## Tests

Insert at caret and over a selection; character count; Escape returns focus; no `fetch` to a third-party host during
picker use (spy); both composers.

**12a (participant)** — all under `src/frontend/src/`:
- [`core/emoji/emojiLogic.test.ts`](../../../src/frontend/src/core/emoji/emojiLogic.test.ts): bundled data (whole
  grid rows per category, no duplicates, single native graphemes, no URLs/skin tones/ZWJ), search, grid movement,
  `insertAtSelection` (caret, selection, clamping).
- [`core/emoji/EmojiPicker.test.tsx`](../../../src/frontend/src/core/emoji/EmojiPicker.test.tsx): opens from the
  button (click and Enter) with focus in the search box; search + count; arrows move the active emoji; Enter inserts
  at the caret and never submits the form; a press replaces the selection; Escape closes, restores focus and
  selection, and does not reach an ancestor; Tab out and an outside press close; disabled while busy; no
  images/MUI; **no `fetch` and no `XMLHttpRequest` during picker use (spies)**.
- [`features/social/components/Composer.emoji.test.tsx`](../../../src/frontend/src/features/social/components/Composer.emoji.test.tsx):
  the face-smile button in the `ComposerForm` tools row; insert at the caret and over a selection in `Composer`;
  the 280 ring counts the emoji and can go over; Escape returns focus; participant skin (no MUI/COBRA); no network
  spy; `ComposeModal` (Escape closes only the picker, then the dialog's own Escape works); `ReplyComposer`.

**Library decision (DF-15, checked 10/14):** hand-rolled, no dependency added. `frimousse` 0.4.0 (2026-09-21, peer
React ^18 || ^19, no advisories) fetches emojibase data from a CDN by default and caches it in browser storage;
`emoji-picker-react` 5.0.0 (2026-10-10, peer React >=16.8, native by default, no advisories; dependency
`shipstyles` 1.0.0, no advisories) is a four-day-old major at 50 MB unpacked. A bundled list of 176 common emoji
(Unicode <= 13, no skin-tone/ZWJ sequences) meets the bar with no network path at all.

**12b (persona composer)**: not built yet - reuse `core/emoji` (`useEmojiPicker` + `EmojiPickerButton` +
`EmojiPicker`) with a COBRA skin class that sets the `--emoji-*` properties.
