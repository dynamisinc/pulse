# Story: Emoji picker in both composers

**Feature:** Demo feedback cut (10/20)  ·  **Phase:** 1  ·  **Status:** In Progress (12a merged; 12b pending)
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

**12b (persona composer)** — reuses `core/emoji` unchanged (`useEmojiPicker` + `EmojiPickerButton` + `EmojiPicker`)
with the COBRA skin
[`features/controller/components/PersonaComposerEmoji.module.css`](../../../src/frontend/src/features/controller/components/PersonaComposerEmoji.module.css):
- [`features/controller/components/PersonaComposer.emoji.test.tsx`](../../../src/frontend/src/features/controller/components/PersonaComposer.emoji.test.tsx)
  (composer mounted in the real `PersonaDockHost`): the face-smile button under the persona text field with the COBRA
  skin classes (not the participant skin); insert at the caret (focus kept, caret after the emoji, typing continues
  there) and over a selection; the counter counts the emoji, can go over the limit, and Post (enabled at the limit)
  is then disabled;
  keyboard: Enter on the button opens with focus in the search box, arrows move the active emoji, typing searches,
  Enter inserts; Ctrl/Cmd+Enter in the search box inserts and never posts (`onPublished` spy, with the same chord
  from the text field as the positive control); Escape (in the picker, and on the open trigger) closes only the picker,
  returns focus to the text field with its selection intact and does **not** close the dock, while the next Escape
  from the text field still does; **no `fetch` and no `XMLHttpRequest` during picker use (spies)**; the skin sets
  **every** `--emoji-*` property the picker reads (both sets parsed from the stylesheets on disk), each value equals
  the `cobraTheme` entry it mirrors, and the text/edge/ring pairs meet WCAG AA contrast; the trigger's rest, hover/open,
  active and focus colours mirror `CobraSecondaryButton`'s; the button follows the text field in document order.
- [`features/controller/components/PersonaComposer.emoji.inFlight.test.tsx`](../../../src/frontend/src/features/controller/components/PersonaComposer.emoji.inFlight.test.tsx)
  (live mode, a hand-settled `publishPost`): while a post is out the button is disabled and a picker that was open
  closes; once it settles the button works again and the picker stays closed.
