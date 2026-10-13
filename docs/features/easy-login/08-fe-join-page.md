# Story: Join page: tap the link, you are in

**Feature:** Easy participant login  ·  **Epic:** E1  ·  **Phase:** 1  ·  **Status:** Not Started
**Requirements:** COR-011, COR-012, NFR-001, NFR-004  ·  **Design decisions:** none (EL-6, EL-7, C-2 in `implementation.md`)  ·  **Issue:** —
**Stack:** frontend  ·  **Review:** Tier-1  ·  **Priority:** Must  ·  **Wave:** 2  ·  **Effort:** S

## Context

The participant taps their personal link (or scans the QR) on a phone. That opens `https://<site>/join/<token>`.
This page exchanges the token for a session and drops the participant onto the participant surface as
themselves. **There is nothing to type**, and that is the whole point: it must work first time on a phone, on a
bad network, in front of a room.

**World: participant.** A brand-neutral consumer skin from a CSS Module (the same one the sign-in page uses): no
`@mui/material`, no `@/theme/*`, no COBRA, FontAwesome icons only. The exercise brand cannot be applied here
because brand tokens are behind the session gate (C-2); the page shows the exercise name instead. The page is
**mobile-first**.

The token is a bearer credential, so the page handles it carefully: it is read once, sent in a POST body (never in
an API URL), and removed from the address bar.

## Acceptance Criteria

- [ ] **Given** a participant opens `/join/<token>` (a pre-auth route beside `/login`), **when** the page mounts,
      **then** it posts `{ token }` to `POST /auth/join` **exactly once** (guarded so React 19 StrictMode's double
      effect does not post twice), stores the returned pair with `setTokens(pair, { persist: true })`, clears the
      React Query cache, and navigates to `/` with `replace`, so the role-aware entry lands them on the
      participant feed with their composer. Back does not return to the join page.
- [ ] **Given** the page has read the token, **then** before the network call completes the address bar is
      rewritten with `history.replaceState` to `/join` (no token in the URL, history or a later share/bookmark), and
      `public/staticwebapp.config.json` sends `Referrer-Policy: no-referrer` and `Cache-Control: no-store` for
      `/join/*` (a route override; the existing `navigationFallback` is preserved).
- [ ] **Given** the exchange is in flight, **then** the page shows a clear "Signing you in…" state in a
      `role="status"` / `aria-live="polite"` region. **Given** a `401`, **then** it shows one generic message
      (the link isn't working any more; ask your controller for a new one, or use today's word) in a `role="alert"`
      with an icon, a button to `/login`, and never says whether the link was wrong, revoked or replaced.
      **Given** `429`, **then** "Too many tries, wait a minute and tap the link again". **Given** a network error or
      `5xx`, **then** "Couldn't reach the exercise" with a **Try again** button that repeats the exchange.
- [ ] **Given** the browser already holds a different participant's session, **then** the new link's identity
      replaces it (tokens replaced, query cache cleared, nothing of the previous user shown). **Given** a staff
      session in `sessionStorage` on the same browser, **then** `persist: true` removes it, so the participant
      session is the one in use (documented: opening a participant link in a staff tab signs the staff user out).
- [ ] **Given** a phone at 320 px wide, **then** the page needs no horizontal scroll, text is at least 16 px,
      the one button is at least 44 px tall, and it works with the on-screen keyboard never appearing. It heads with
      the exercise name when `GET /exercise-context` resolves (non-blocking, as the sign-in page does) and still
      renders and exchanges when it does not.

### Cross-cutting
- [ ] **No-enterprise-look (D0 §2):** no COBRA theme, no default MUI look, no `@/theme/*` import; styled by the
      page's own CSS Module in the sign-in page's brand-neutral consumer skin. A source-scan test reads the page's real
      source with `import.meta.glob(…, { query: '?raw', eager: true })` (the technique
      `staffShell/twoWorldsSeparation.test.ts` uses) and fails on any import of `@mui/*`, `@/theme/*`, `cobraTheme`,
      `styledComponents` or `CobraStyles`.
- [ ] **Accessibility (NFR-001):** the page has one `<h1>`, a `<main>`, focus moves to the status/alert region when
      it changes, the retry and sign-in controls are real buttons/links reachable by keyboard, and the error is never
      colour-only (icon plus text). WCAG 2.1 AA contrast.
- [ ] **Content security (NFR-004):** the exercise name renders as a React text node; no `dangerouslySetInnerHTML`;
      the token never appears in a log, a console message or an error string.
- [ ] **Scenario time (COR-053):** not applicable: the page shows no time. **Telemetry (XC-004):** none from the
      client; the server records the sign-in (`login`, `method: link`, story 03).

## Out of Scope

Typing a token by hand. A per-exercise branded skin (C-2). Remembering "which participant" for a shared device. The
backend exchange (03). The Today's-word path (09). Handling an in-app browser's separate storage (documented
limitation in `implementation.md`).

## Technical Notes

Frontend, participant world. New: `features/login/pages/JoinPage.tsx` (+ `JoinPage.module.css`, reusing the sign-in
page's tokens by copy or by importing the shared class names; do not edit `ParticipantSignInPage.module.css`, story
09 owns it), `features/login/services/joinService.ts` (`signInWithLink(token)` over the shared axios client,
reusing `ParticipantSignInError` and `LoginEnvelope` from `participantSignInService.ts` by import only; **no mock
adapter**, like the other sign-in services, because a canned login would defeat the gate), `public/staticwebapp.config.json`.
The **orchestrator seam** adds `JOIN_PATH = '/join'` to `app-shell/constants.ts` and the `/join/:token` route in
`app-shell/routes.tsx` beside `/login`; the page reads `useParams().token`. Use a `useRef` guard for the single
exchange. Build the page so the route is testable on its own with a memory router. MUI 9 does not apply (no MUI).
See `implementation.md` (story 08, gotchas 9, 11).

**One browser, one identity (from story 07, S-1).** The persisted participant session is per origin, not per tab. A new
`setTokens(pair, { persist: true })` in any tab replaces the pair every tab uses, and `core/auth/crossTabSessionSync`
reloads the OTHER tabs so they show the new identity. So when a tester opens a second join link in the same browser while
another sign-in is still in progress in another tab, that earlier sign-in can be interrupted by the reload (its exchange
result is lost along with the already-scrubbed link) and has to be started again from the link. This is intended: do not
try to defend against it in the page. Document it in the tester notes (feature walk-through) rather than in the UI.

## Dependencies

Story 07 (`setTokens` with `persist`). Backend story 03 (`POST /api/auth/join`) for live use; unit tests mock the
service. Consumed by 12 (cards print this URL) and 14.

## Tests

`features/login/pages/JoinPage.test.tsx` (single exchange under StrictMode, URL scrub, each state, persist flag,
cache cleared, replace navigation, the import-boundary assertion), `features/login/services/joinService.test.ts`
(request shape, 401/429/network mapping, malformed envelope rejected), a `staticwebapp.config.json` shape test.
Manual: open a real link on a phone, close the browser, reopen (still signed in); open it in a Gmail/Outlook in-app
browser and note the behaviour (feature walk-through steps 3 and 4).
