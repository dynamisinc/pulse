# Story: Sign-in page: Today's word

**Feature:** Easy participant login  ·  **Epic:** E1  ·  **Phase:** 1  ·  **Status:** Not Started
**Requirements:** COR-011, COR-012, NFR-001, NFR-009  ·  **Design decisions:** none (EL-9, EL-10, C-2 in `implementation.md`)  ·  **Issue:** #474
**Stack:** frontend  ·  **Review:** Tier-1  ·  **Priority:** Must  ·  **Wave:** 2  ·  **Effort:** S

## Context

For the participant who is not holding their card or whose camera cannot scan, staff read out **today's word** and
the participant types it with their short sign-in name. This story adds that path to the existing participant
sign-in page (`login/02`) and makes **all** participant sign-in methods on it persistent (EL-10), so every
participant, however they got in, stays signed in for the day.

**World: participant.** The page already carries the brand-neutral consumer skin from its own CSS Module; this
story extends it and stays inside it: no COBRA, no `@/theme/*`, no `@mui/material`. Mobile-first: this form will
mostly be filled in on a phone. The page's three methods need clear, plain names, because "Exercise code"
(the existing **view-only** shared password) and "Today's word" (sign in **as yourself**) sound alike.

## Acceptance Criteria

- [ ] **Given** the sign-in page, **then** it offers three methods as a group of real `<button type="button">`s with
      `aria-pressed`: **Today's word** (new, **default**), **Password** (the existing named-account form, relabelled
      from "Account sign-in"), and **View-only code** (the existing shared-code form, relabelled from "Exercise
      code"). Each is keyboard-reachable and activatable. Switching clears the error and keeps typed values per form.
- [ ] **Given** the Today's-word form, **then** it has a labelled **Sign-in name** field and a labelled **Today's
      word** field and a **Sign in** button. Both fields are 16 px or larger, `autocapitalize="none"`,
      `autocorrect="off"`, `spellcheck="false"`; the name has `autocomplete="username"`; the word is
      `type="text"` (it is read off a screen and typed on a phone, so a hidden field only causes typos) with
      `autocomplete="off"`.
- [ ] **Given** a valid name and word, **when** submitted, **then** `signInWithDayWord({ signInName, word })` posts
      to `POST /auth/word`, the envelope is stored with `setTokens(pair, { persist: true })`, and the page navigates
      to `/`, exactly as the other methods do.
- [ ] **Given** a `401`, **then** one generic message appears in a `role="alert"` ("That name or word wasn't
      recognized. Check today's word with your controller."), never saying which half was wrong, and only the
      **word** field is cleared (the name is kept). **Given** `429`, **then** "Too many tries. Wait a minute and try
      again." **Given** any other failure, the existing generic "Could not sign in. Please try again."
- [ ] **Given** the existing Password and View-only code forms, **then** their behaviour, messages and tests are
      unchanged except that a success now stores the pair with `{ persist: true }`, and except that the view-only
      form uses the one name **View-only code** throughout: its field label is "View-only code", its form
      `aria-label` is "Sign in with a view-only code", and its 401 reads "That view-only code wasn't recognized."
      (messages unchanged, except the view-only 401 names the method; amended 2026-10-13, Gate-1 W-1).
- [ ] **Given** the page, **then** the existing `GET /exercise-context` heading ("Sign in to {exercise name}") and the
      subordinate "Staff or controller? Sign in here." link are untouched.

### Cross-cutting
- [ ] **No-enterprise-look (D0 §2):** the new form and toggle use the page's own CSS Module classes; no COBRA
      import, no default-MUI look. The page has no such guard today (login/02 verified it by inspection), so this story
      adds the same source-scan test described in story 08 for `ParticipantSignInPage.tsx`.
- [ ] **Accessibility (NFR-001):** `<label htmlFor>` on every input (no placeholder-only labels), the three-way
      toggle is operable by keyboard with a visible focus ring, the error is `role="alert"` with an icon, the
      in-flight state is `role="status"` `aria-live="polite"`, touch targets at least 44 px, WCAG 2.1 AA contrast.
- [ ] **Content security (NFR-004 / NFR-009):** values are sent as typed and never logged or placed in a URL;
      nothing from the request is echoed back with `dangerouslySetInnerHTML`; the service never distinguishes
      failure reasons beyond the HTTP status.
- [ ] **Scenario time (COR-053):** not applicable (no time on the page).

## Out of Scope

A "forgot the word" flow (ask a controller). Showing whether a word is set today (would be a pre-auth disclosure).
A per-exercise branded skin (C-2). Changes to the staff sign-in page. The backend route (05).

## Technical Notes

Frontend, participant world. Edits `features/login/pages/ParticipantSignInPage.tsx` and `.module.css`, and
`features/login/services/participantSignInService.ts` (add `signInWithDayWord(credentials)` next to the existing two,
same `toSignInError` / `isLoginEnvelope` handling; **mock-first** behind the single `USE_MOCK_DATA` flip, per
`implementation.md` (amended 2026-10-13: this line previously said "no mock adapter"). The mock signs in the word
`demo-word` (normalised as EL-9 specifies before comparing) with any non-blank name, answers anything else with a
401, and waits about 1.5 s when the name or word is `slow`; add `/auth/word` to the file header's contract note). Extend the existing `ParticipantSignInPage.test.tsx` and `participantSignInService.test.ts`;
the labels they assert on change ("Account sign-in" becomes "Password"), so update them rather than adding a parallel
suite. `SignInMode` becomes `'word' | 'named' | 'shared'`. MUI 9 does not apply (no MUI). See `implementation.md`
(story 09).

## Dependencies

Story 07 (`setTokens` with `persist`). Backend story 05 (`POST /api/auth/word`) for live use; tests mock the service.

## Tests

Extend `features/login/pages/ParticipantSignInPage.test.tsx` and add a source-scan boundary test (three methods, default, field attributes, success
persists and navigates, 401/429/other, only the word cleared, other forms still persist) and
`features/login/services/participantSignInService.test.ts` (`signInWithDayWord` request shape, status mapping,
malformed envelope). Manual: sign in with name + word on a phone; a wrong word and a wrong name look identical
(walk-through step 5).
