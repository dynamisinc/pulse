# Story: Printable card sheet (staff)

**Feature:** Easy participant login  ·  **Epic:** E1  ·  **Phase:** 1  ·  **Status:** In Progress
**Requirements:** COR-017 (part: handing out credentials at StartEx), NFR-001  ·  **Design decisions:** none (EL-12, EL-15)  ·  **Issue:** #477
**Stack:** frontend  ·  **Review:** Tier-1  ·  **Priority:** Must  ·  **Wave:** 1  ·  **Effort:** M

## Context

Tom's third way in: a **printed card** per person with their name, a QR code, their link, their sign-in name, and a
slot to write today's word. Staff print the sheet from the console and hand cards out at StartEx. The QR codes come
from the server (backend story 04, EL-12) as SVG data URIs, so this story adds **no npm package**: it fetches the
cards, shows a preview, and prints.

Two worlds meet here and neither owns the paper (EL-15). The **button and the preview toolbar** are staff-world
(COBRA). The **printed card** is a logistics artifact handed to participants: plain black on white, with the
exercise name and a "training exercise" line. It is not COBRA and it is not an in-fiction brand.

The staff shell is a fixed-height, `overflow: hidden` flex column; printing it as it stands prints one screenful.
So the sheet is rendered in a **portal outside `#root`**, and `@media print` hides `#root` and shows only the sheet.

## Acceptance Criteria

- [ ] **Given** `<PrintCardsButton selection={ids} />` (mounted by the orchestrator into the roster's
      `renderCardsAction`), **then** it renders a COBRA button reading **Print cards (N)** for N selected people, or
      **Print all cards** when the selection is empty. Activating it opens the preview and calls
      `GET /staff/roster/cards`, passing `id` for each selected participant (in chunks of at most 500 and
      concatenated; none when the selection is empty).
- [ ] **Given** the cards arrive, **then** a full-screen preview (a portal appended to `document.body`, a sibling
      of `#root`) shows every card as it will print, a count, and a toolbar with **Print** (`window.print()`) and
      **Close**. **Given** `skipped` entries, **then** the toolbar says how many were left out and why, by reason
      (no active link, disabled, link needs reissue, not found) and tells staff to fix them in the roster and print again.
      **Given** `409` (links not configured) or `403`, **then** a clear message replaces the sheet.
- [ ] **Given** the printed sheet, **then** each card shows: the exercise name, a "Training exercise" line, the
      person's **name** (large), **agency · role** when present, the **QR** (an `<img>` of `qrSvgDataUri`, at least
      1.25 in square, `alt="QR code: sign in as {name}"`), **Sign-in name: `jsmith`** in a monospace face,
      **Today's word: ______** with a writing line, the full **link** as small monospace text, and one line of help
      ("Scan with your phone's camera. No QR? Open {site}/login and enter your sign-in name and today's word."), where
      `{site}` comes from the card's own `joinUrl` origin.
- [ ] **Given** `@media print`, **then** the sheet prints on US Letter portrait with 0.5 in margins, **eight cards per
      page (two columns by four rows)**, each card with a cut-guide border, `break-inside: avoid` so a card never
      splits across pages, in black on white that stays readable with background graphics off. `#root` and the
      preview toolbar are `display: none`, so **nothing from the staff shell, the toolbar or the on-screen warning
      prints**.
- [ ] **Given** the preview is open, **then** an on-screen (not printed) banner reads "These cards contain personal
      sign-in links. Hand them out one by one and shred any left over."
- [ ] **Given** `USE_MOCK_DATA`, **then** a mock adapter returns a realistic set of cards (a small static SVG data URI
      as the QR, an agency/role on some, one skipped for each reason) so the sheet and print layout can be built and
      reviewed with no backend.

### Cross-cutting
- [ ] **Two worlds / look (D0 §2, EL-15):** the button and toolbar use `@/theme/styledComponents`; the card and its CSS
      are neutral, with no COBRA colours or components and no brand skin. MUI 9 `sx` only where MUI is used; the
      sheet itself is plain semantic HTML and a CSS Module.
- [ ] **Accessibility (NFR-001):** the preview is a dialog (`role="dialog"`, labelled, focus moved in and trapped,
      Escape closes, focus returns to the button), the toolbar is keyboard-operable, every QR has meaningful `alt`
      text, and nothing on a card depends on colour.
- [ ] **Secrets:** the cards query uses `staleTime: 0` and `gcTime: 0` and is discarded when the preview closes; a
      `joinUrl` appears only inside the preview/print DOM (it has to, it is the card) and is never in a toast, title,
      log or URL. No card data is written to storage.
- [ ] **Isolation (XC-001/COR-001):** the component sends no exercise id; the React Query key includes the active
      exercise id from `useExerciseContext()`.
- [ ] **Scenario time (COR-053):** not applicable; a card shows no time.

## Out of Scope

Generating the QR (backend 04). A PDF download. Choosing a card size or a logo. Pre-filling today's word on the card
(the server never re-shows it; the slot is blank on purpose). Per-card print for a single person beyond selecting
that one row. Reissuing links (10). The roster page and slot composition (10 and the orchestrator).

## Technical Notes

Frontend, staff world with a neutral printed artifact. New folder `features/participantAdmin/cards/`:
`PrintCardsButton.tsx` (exported, props `{ selection: readonly string[] }`), `CardSheetPreview.tsx` (portal +
toolbar), `CardSheet.tsx` and `Card.tsx` (pure, props-only, no data fetching), `cardSheet.module.css` (print rules;
use `:global(#root)` for the hide rule and `@page { size: letter portrait; margin: 0.5in }`),
`cardsService.ts` (axios `/staff/roster/cards` with `id` params, runtime guards, typed error), `cardsMocks.ts`,
`useRosterCards.ts`, its own `types.ts` (the cards half of the frozen contract). jsdom cannot evaluate print media,
so unit-test the structure and `window.print`, and cover the paper layout with the manual checklist below. No new
npm package: `window.print()` only. Render the sheet only while the preview is open (100+ data-URI images).
See `implementation.md` (story 12, gotcha 12).

## Dependencies

None for development (contract, mock-first). Live use needs backend stories 03 and 04. Mounted by the orchestrator
into story 10's `renderCardsAction`.

## Tests

`features/participantAdmin/cards/*.test.tsx`: `PrintCardsButton` (label for selection vs all, chunking at 500),
`CardSheetPreview` (portal location, skipped summary, 409/403, banner not in the print subtree, `window.print`
called, Escape and focus restore), `Card` (every field, `alt`, link origin help line), a structural test that the
print subtree contains only cards, the query-key and no-cache checks. **Manual print checklist** (Chrome and Edge, US
Letter, default margins, background graphics off): 8 cards per page, no card split across pages, no staff chrome
printed, QR scans from paper with a phone camera, 100 cards renders without freezing (walk-through step 4).
