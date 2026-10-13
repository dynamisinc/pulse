# participantAdmin / cards: printable card sheet

Easy participant login, story 12 (`docs/features/easy-login/12-fe-card-sheet.md`; COR-017 in part, NFR-001).
Staff print one card per person (name, QR, link, sign-in name, a blank slot for today's word) and hand them out
at StartEx.

**World: staff chrome, neutral paper (EL-15).** The button and the preview toolbar are COBRA
(`@/theme/styledComponents`). The printed card is a logistics artifact: plain black on white, no COBRA colour,
no brand skin, nothing that depends on background graphics.

## What is here

| File | Role |
|---|---|
| `PrintCardsButton.tsx` | **The export.** `<PrintCardsButton selection={ids} />`. COBRA button, "Print cards (N)" or "Print all cards". Owns open/closed and returns focus on close. |
| `CardSheetPreview.tsx` | Full-screen dialog in a portal on `document.body` (sibling of `#root`): toolbar (Print, Close, count, skipped summary), on-screen warning banner, the sheet. |
| `CardSheet.tsx` / `Card.tsx` | Pure, props-only paper. Pages of eight, one `<article>` per card. |
| `cardSheet.module.css` | Screen preview + `@media print` rules (read its header). |
| `cardsService.ts` | `GET /staff/roster/cards` through the shared axios client: repeated `id`, chunks of 500, runtime guards, typed `RosterCardsError`. |
| `cardsMocks.ts` | Mock adapter behind `USE_MOCK_DATA` (one flip point in the service). 20 cards + one skip per reason; scenarios for 409 / 403 / 500. |
| `useRosterCards.ts` | React Query hook: `staleTime: 0`, `gcTime: 0`, key includes the active exercise id. |
| `safeQrDataUri.ts` | The narrow allow-list for the QR `<img src>` (a base64 SVG data URI and nothing else). |
| `cardFormat.ts` | Pure helpers: affiliation line, `{site}` origin, label, pagination, skipped summary. |
| `types.ts` | The cards half of the frozen wire contract. |

## Mounting it (orchestrator seam)

In `features/participantAdmin/ParticipantAdminRoute.tsx`, into the roster's `renderCardsAction` slot:

```tsx
import { PrintCardsButton } from './cards'

<RosterPage renderCardsAction={selection => <PrintCardsButton selection={selection} />} />
```

The component sends no exercise id and needs no props beyond the selected account ids (`RosterEntryDto.id`).
It must be rendered under `QueryClientProvider`, `ExerciseContextProvider` and the COBRA theme (all provided by
the staff shell).

## How printing works

The staff shell is a fixed-height `overflow: hidden` column, so printing it as it stands prints one screenful.
While the preview is open it adds a class to `<html>`; under `@media print` and only with that class, `#root`
(and any other stray body-level layer) is `display: none`, the toolbar, banner and skipped summary
(`.screenOnly`) are `display: none`, and the overlay becomes ordinary page flow. The sheet is US Letter
portrait, 0.5 in margins, eight cards a page (two columns by four rows), one fixed-height grid per page with a
forced break after it, each card with a dashed cut-guide border and `break-inside: avoid`. Printing the roster
with the preview closed is untouched, except that `@page` (Letter, 0.5 in) cannot be scoped and applies to every
print in the session.

## Safety rails

* The QR is only ever an `<img src>` of a string that matched `data:image/svg+xml;base64,<base64>` and is under
  512 KB. No `dangerouslySetInnerHTML` anywhere; an SVG in an `<img>` cannot run script. The shared media
  allow-list (`safeMediaUrl.ts`) rejects `data:` on purpose and is NOT widened for this.
* `joinUrl` is a bearer credential. It is plain text inside the preview/print DOM only (not an `<a>`), never in a
  toast, title, log or URL. The query is not cached and is gone when the preview closes; nothing is stored.
* Errors carry a fixed message and a kind: no body, no request config, no cause.

## Tests

`npx vitest run src/features/participantAdmin/cards`. jsdom cannot evaluate print media, so
`cardSheet.css.test.ts` asserts the real stylesheet text (page size, 2 x 4 grid, breaks, hidden chrome, no COBRA
colour) plus source guards. What only paper can show is on the checklist below.

## Manual print checklist (Chrome and Edge, US Letter, default margins, "Background graphics" OFF)

Run against UAT after the backend seam deploy (or in dev with mock data: "Print all cards" gives 20 cards,
a part-filled third page, and one skipped person per reason).

- [ ] **Print all cards** from the roster opens the preview: banner "These cards contain personal sign-in links..."
      is visible, the count and the skipped summary read correctly, the toolbar has Print and Close.
- [ ] Ctrl+P / **Print**: the print preview shows only cards. **Nothing** from the staff shell, the toolbar, the
      banner or the skipped summary appears.
- [ ] **Eight cards per page**, two columns by four rows, a dashed border round each card, **no card split
      across pages**, no blank page between pages or after the last.
- [ ] Letter portrait, 0.5 in margins (the preview does not show the browser's own header/footer if you untick
      "Headers and footers").
- [ ] Everything is black on white and fully legible with background graphics off; the writing line under
      "Today's word:" is a clear line.
- [ ] A card with a long name and long agency/role is clamped (ellipsis) and does not overlap the sign-in name,
      the writing line or the link.
- [ ] **Scan a printed QR with a phone camera:** it opens `/join/...` and signs in as that person.
- [ ] Select 3 people: the label reads "Print cards (3)" and the sheet has exactly 3 cards.
- [ ] 100 cards: the preview opens and scrolls without freezing, and prints.
- [ ] Close or Escape returns focus to the Print cards button; with the preview closed, Ctrl+P prints the
      roster page as before.
