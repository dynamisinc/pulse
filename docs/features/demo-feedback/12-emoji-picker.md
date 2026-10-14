# Story: Emoji picker in both composers

**Feature:** Demo feedback cut (10/20)  ·  **Phase:** 1  ·  **Status:** Not Started
**Requirements:** D1 composer polish  ·  **Decisions:** DF-15  ·  **Issue:** _TBD_
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
