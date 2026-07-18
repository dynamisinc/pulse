# Story: Cadence chrome tokens + thumbnail-distinguishability gate

**Feature:** Staff shell frame  ·  **Epic:** E7  ·  **Phase:** 1  ·  **Status:** Complete
**Requirements:** D7-009, COR-063  ·  **Design decisions:** D7-009, D7-005  ·  **Issue:** #196

## Context
The staff frame adopts the binding **Cadence Design System** look (D7-009): navy `#1e3a5f` header,
light `#f8f8f8` work area with white panels, Cadence red `#e42217` badges/lockout, gray `#848482`
secondary text, pill-shaped buttons (the Cobra idiom). This story is the **token/styling foundation**
the other staff-shell stories build on, and it enforces the **hard gate**: a staff surface must be
thumbnail-distinguishable from a participant surface — navy chrome + light work area vs a light world
framed by two green banners. The participant shell stays **out** of Cadence; it must look like
consumer media, not the exercise platform.

## Acceptance Criteria
- [x] The staff frame renders in the Cadence palette (navy `#1e3a5f` header, `#f8f8f8` work area,
      white panels, `#e42217` accents, `#848482` secondary, pill buttons), sourced from COBRA tokens /
      `@/theme/styledComponents` — never a default MUI look.
- [x] **Hard gate:** at thumbnail size a staff surface is unmistakable from a participant surface (dark
      chrome + single top bar vs light world framed by two green banners); the two are **never** mixed
      on one surface (SHELL-CONTRACT §4). *(The one deliberate, labelled exception is Preview-as, story
      04, which stages the participant shell inside the frame.)*
- [x] The **participant shell uses none** of these Cadence tokens (D7-009) — enforced by the two-worlds
      route separation (COBRA theme mounts on staff routes only; participant routes never import it).
- [x] Tokens are consistent with the wider Cadence/COBRA system so a Cadence-trained controller reads
      the console immediately (D0 §1); state/severity styling is never color-only (NFR-001).
- [x] Classification tag styling (`UNCLASSIFIED // FOUO`, mono) and the navy exercise-bar-free header
      (D7-010) derive from these tokens.

## Out of Scope
The COBRA theme system itself (`src/frontend/src/theme/`, already present) — this story **applies** it
to the shell frame, it doesn't re-author the theme; the participant brand tokens (`participant-shell`
story 07); individual header/toolstrip components (stories 01/02 consume these tokens).

## Technical Notes
Staff world. Consumes the existing COBRA theme (`@/theme/cobraTheme`, `@/theme/styledComponents`,
`CobraStyles`) — the MUI 9 port per CLAUDE.md. This story is the wave-1 styling foundation the other
staff-shell stories depend on. See implementation.md (story 05). Enforces the D0 §2 / E1 §5 hard gate.

## Dependencies
The existing COBRA theme (`src/frontend/src/theme/`); consumed by staff-shell stories 01–04. Ticks
STORY-UPDATES.md §A.

## Tests
- Component (RTL): the frame renders Cadence-navy chrome + light work area from COBRA tokens.
- Unit/lint: participant-shell paths import no COBRA/Cadence tokens (two-worlds separation holds).
- Visual/manual: thumbnail check — staff vs participant are unmistakable.
