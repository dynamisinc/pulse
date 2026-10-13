# Story: Today's word panel (staff)

**Feature:** Easy participant login  ·  **Epic:** E1  ·  **Phase:** 1  ·  **Status:** In Review
**Requirements:** COR-017 (part: credential reset), NFR-009, NFR-001  ·  **Design decisions:** none (EL-9, EL-14)  ·  **Issue:** #476
**Stack:** frontend  ·  **Review:** Tier-1  ·  **Priority:** Must  ·  **Wave:** 1  ·  **Effort:** S

## Context

Staff set one word per exercise day and read it to the room; if it leaks they rotate it and the old one stops
working on the next sign-in. This is the staff panel for that: see whether today's word is set, set a word you
type or have Pulse generate one, rotate it, pre-set tomorrow's, and turn the path off. Because the server stores
only a hash (EL-9), **the word is visible exactly once**, at the moment it is set; this panel is built around that.

**World: staff.** COBRA only, desktop-first. It is a self-contained component mounted by the orchestrator into the
roster page's `dayWordSlot` (story 10), so it is disjoint from that page. It is mock-first against the frozen
contract.

## Acceptance Criteria

- [ ] **Given** the panel, **then** it loads `GET /staff/day-word` and shows today's date with the exercise time
      zone named, when today ends, and either **"Today's word is set"** (who set it, when, how many times it was
      replaced) or a prominent **"No word is set for today. People can only sign in with their personal link."** It
      never shows or fetches a word.
- [ ] **Given** **Generate a word** or **Set my own word**, **then** it calls `PUT /staff/day-word` (omitting `word`
      to generate) and shows the returned word **once** in a clearly framed block with the text "This is the only
      time Pulse shows this word", a **Copy** button and a **Show large** toggle that renders the word in very large,
      high-contrast type for reading out or projecting. A typed word is checked live against the server's rule (letters
      and digits only after normalising, 6 to 64 characters) and a `400` shows the server's reason.
- [ ] **Given** a word is already set, **then** the action reads **Rotate word** and asks for confirmation that says
      "New sign-ins need the new word at once. People already signed in stay signed in." On confirm it replaces the word
      the same way and shows the new one once.
- [ ] **Given** the **date** control, **then** staff can pick today or a later date up to 14 days ahead (in the
      exercise zone) to pre-set that day's word; the "Upcoming" list shows the dates that have a word (never the words)
      and lets staff clear one.
- [ ] **Given** **Turn off word sign-in for today** (behind a confirm), **then** it calls
      `DELETE /staff/day-word` and the panel returns to the "No word is set" state; the call is idempotent.
- [ ] **Given** `USE_MOCK_DATA`, **then** a mock adapter implements the three calls per the frozen contract (including
      generated vs typed, replaced, a `400`, and a `403`), so the panel runs and is tested with no backend.

### Cross-cutting
- [ ] **Secrets:** the plaintext word lives only in the panel's component state for the one result view; it is not
      put in the React Query cache (consume the mutation result immediately and reset it), `localStorage`,
      `sessionStorage`, a toast, a log, the document title or a URL, and it is cleared when the result view closes
      or the panel unmounts. The status query never contains a word.
- [ ] **Two worlds (D0 §2):** `@/theme/styledComponents` buttons and text fields, FontAwesome, MUI 9 `sx` only;
      the **Show large** view is still the staff look (COBRA), not a participant skin.
- [ ] **Accessibility (NFR-001):** labelled controls, the confirm dialogs are `role="alertdialog"` with focus
      management, results and errors go to an `aria-live` region that announces "Word set" **without reading the
      word aloud**, and "set / not set" is text plus icon, not colour alone.
- [ ] **Isolation (XC-001/COR-001):** the panel sends no exercise id; the React Query key includes the active
      exercise id from `useExerciseContext()` so a switch never shows another exercise's status.
- [ ] **Time (staff world):** dates and instants are shown in the exercise time zone with the zone named. Scenario
      time is never used for "today".

## Out of Scope

Ending sessions that used the old word on rotation (server does not; staff revoke or disable a person in the
roster). Showing a previously set word again. The sign-in page's word tab (09). The route and slot composition (10 and
the orchestrator). A reminder or schedule for setting tomorrow's word.

## Technical Notes

Frontend, staff world. New folder `features/participantAdmin/dayWord/`: `DayWordPanel.tsx` (the exported component,
no required props), `dayWordService.ts` (axios under `/staff/day-word`, guards, typed error), `dayWordMocks.ts`,
`useDayWord.ts` (a query for status and mutations for put/delete), its own small `types.ts` (the day-word half of
the frozen contract; do not import from story 10's files). Mirror the server's normalisation exactly (NFKD, accents stripped, lower-case, `a-z0-9`
only; amended after Gate-1 W-2) in a pure helper with a test, for the live length check only; the server stays authoritative. Wrap the
one-time result in a component that unmounts to clear it. See `implementation.md` (story 11).

## Dependencies

None for development (contract, mock-first). Live use needs backend story 05. Mounted by the orchestrator into story
10's `dayWordSlot`.

## Tests

`features/participantAdmin/dayWord/*.test.tsx`: `DayWordPanel` (not set / set states, generate, typed word and
validation, rotate with confirm, show-large, pre-set date bounds, upcoming list, clear with confirm, 403),
`dayWordService` (paths, bodies, guards), a secrets test (the word is absent from the query cache and storage after
the result view closes), the normalisation helper, and the exercise-id query-key check. Manual: walk-through step 5.
