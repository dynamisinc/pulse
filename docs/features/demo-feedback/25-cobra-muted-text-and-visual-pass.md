# Story: COBRA muted-text token and a browser visual pass

**Feature:** Demo feedback cut (10/20)  ·  **Phase:** 1  ·  **Status:** Not Started
**Requirements:** NFR-001 (WCAG 2.1 AA), D0 two worlds  ·  **Decisions:** DF-37  ·  **Issue:** #543
**Stack:** frontend  ·  **World:** staff (token) + both (visual pass)  ·  **Review:** Tier-1  ·  **Priority:** Should  ·  **Wave:** 4  ·  **Effort:** S
**Owner:** Wave 3 session · **Branch:** `build/demo-feedback/25-muted-token-visual-pass` → `feature/demo-feedback-w4-polish`

## Context

COBRA's `text.secondary` is `#848482` (`theme/cobraTheme.ts` ~:189), about 3.6:1 on white, below AA. Staff files work
around it with local constants (`personaEditStyles.ts:17` `#5c5c5a`, `rosterStyles.ts:18` `#595957`,
`PersonaContextPanel.tsx:98` `#6b6b69`, `PersonaComposerEmoji.module.css:38-41`, `staffShellTokens.ts:58,107`), and
`PersonaContextPanel.tsx:280,299,321,331,359` still uses raw `#848482`. Then a last look at both worlds in a real
browser before pencils down.

## Acceptance Criteria

### Token

- [ ] One COBRA muted-text token (e.g. `palette.text.muted`, typed through the existing palette augmentation) with
      contrast ≥ 4.5:1 on white and on every COBRA surface it is used on (record the ratios in the PR). Decide whether
      `text.secondary` itself moves to the AA value; if it does, check every staff use of it.
- [ ] The listed local constants and raw `#848482` text uses are replaced by the token. `consoleChrome.ts` dark-surface
      inks (`inkMuted`, `inkFaint`) are checked for AA on their surface and fixed there if below.
- [ ] No participant theme imports or inherits the token (participant brands mount their own theme); a test or grep
      check proves `theme/cobraTheme` is not imported under `features/social/**` or `participant-shell/**`.

### Visual pass (after 20 and 21 merge into their branches)

- [ ] Screenshots at 1280, 1440 and 1920 px of: participant home, thread with video, profile, Pinned, composer with
      emoji, holding page; console with Live world, run sheet, persona composer, Exercise Management; evaluator
      read-only console. Light mode; dark mode where supported.
- [ ] A findings list in the PR. Fixes of size S land in this story **only in files no other Wave 4 story owns**;
      everything else goes to the owning story's branch or a post-demo issue.

## Out of Scope

Participant brand colors, mobile layouts (#524), a design-system rework.

## Technical Notes

Owns `theme/cobraTheme.ts`, `theme/CobraStyles.ts`, the listed constant files. MUI 9 `sx`-only; COBRA components on
staff surfaces only.

## Dependencies

None for the token; the visual pass after 20 and 21.

## Tests

A contrast unit test for the token against the COBRA surfaces; the import-boundary check; existing snapshot tests
updated.
