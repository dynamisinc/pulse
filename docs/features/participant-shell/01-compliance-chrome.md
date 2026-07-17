# Story: Compliance chrome (two banners, config-driven, chrome-off legal)

**Feature:** Participant shell  ·  **Epic:** E1  ·  **Phase:** 1  ·  **Status:** Complete
**Requirements:** COR-031 (COR-066)  ·  **Design decisions:** D7-005, D7-006  ·  **Issue:** #185

## Context
Compliance chrome is the participant world's frame and one of the only two exercise signals a
participant ever sees (XC-002/003). The shell renders **two fixed 22px banners** at the absolute top
and bottom of the viewport — visually *outside* the app frame (the D1 two-banner inset model is
canonical, D7-005) — a `#2e6b2e` green banner **background** with `#eaf5e6` **text**, Figtree 700 10px
caps, `.14em` tracking. Strings and colors are **config-driven** (COR-030/066); the app zone insets
between them. **Chrome-off is a legal state** — the layout must survive it (the watermark is the
fallback signal, NFR-008).

## Acceptance Criteria
- [x] Given an exercise with chrome enabled, when any channel renders, then two fixed 22px banners
      appear at the viewport top and bottom with the configured classification strings (default top
      `UNCLASSIFIED // EXERCISE · EXERCISE · EXERCISE — ALL CONTENT SIMULATED`; bottom
      `PULSE TRAINING ENVIRONMENT — SIMULATED INFORMATION SPACE — NOT REAL NEWS`) and the content zone
      insets between them.
- [x] Banner **text and colors are config-driven** per exercise (COR-030/066); zero brand/classification
      strings are hardcoded in shell code (the "Fairhaven"/demo strings are config).
- [x] Given **chrome-off** (a legal per-exercise state), when a channel renders, then the layout is
      intact (no reserved-gap artifact) and the in-content **EXERCISE watermark** remains the fallback
      signal — **chrome and watermark are never both off** (NFR-008).
- [x] Banners are **participant-world** styled (green, Figtree) — never COBRA / Cadence / default MUI
      (D0 §2) — and are visually outside the app frame (not part of any channel's content).
- [x] Chrome is announced to assistive tech as exercise/classification context, not as interactive
      content (NFR-001); it renders in scenario-agnostic static copy (no wall-clock, no exercise
      language beyond the configured markings).

## Out of Scope
The **config authoring** UI (exercise-configuration `02-compliance-chrome.md`, COR-030/066 — this
story consumes the config); the staff-world classification tag (`staff-shell` header, D7-010); the
alert bar (story 02); the in-content watermark rendering itself (NFR-008, participant-channel concern).

## Technical Notes
Participant world. Reads `chromeConfig` (server-driven, exercise-scoped). Fixed-position banners
outside the channel's mounted content region. See implementation.md (story 01). Anchor: D1 `.xb .xbt/.xbb`;
Looking Glass green bars are the precedent (D0 §2).

## Dependencies
exercise-configuration compliance-chrome **config** (COR-030/066); the channel-mount contract (story
04) for the inset content region. Ticks STORY-UPDATES.md §A.

## Tests
AC-to-test mapping (all committed under `src/frontend/src/features/participant-shell/`):
- **AC1** (two fixed 22px banners with the configured classification strings; content zone insets
  between them): `components/ComplianceChrome.test.tsx` ("config-driven banners (AC1/AC2)" describe —
  "renders both banners with this config's text and colors, not any hardcoded string/color"); ("ShellLayout
  inset contract (AC1)" describe — "publishes both chrome inset CSS vars as 22px on :root when chrome is
  enabled", "removes both inset vars from :root on unmount, leaving no stale reserved gap");
  `chromeConfig.default.test.tsx` ("resolves the canned AC-canonical config through the real axios
  request pipeline" — confirms the default top/bottom strings are exactly the AC-specified copy).
- **AC2** (banner text/colors config-driven per exercise; zero hardcoded brand/classification
  strings): `components/ComplianceChrome.test.tsx` ("config-driven banners (AC1/AC2)" describe —
  the same "renders both banners with this config's text and colors" test also asserts the
  AC-canonical default copy appears **nowhere** when a non-default config is supplied, and "reflects a
  second, differently-configured exercise on the next render (not a cached first render)");
  `chromeConfig.test.tsx` ("resolves a non-default config from a valid mocked response (not the
  DEFAULT_CHROME_CONFIG fallback)", "never sends the exerciseId as a request URL substring or a params
  key (COR-001, XC-002, precedent 13)" — config resolution is per-exercise-scoped, never client-param
  scoped).
- **AC3** (chrome-off is legal; layout intact with no reserved-gap artifact; watermark is the required
  fallback; chrome and watermark never both off, NFR-008): `components/ComplianceChrome.test.tsx`
  ("chrome-off is legal, no gap artifact (AC3)" describe — "renders no banners and collapses both inset
  vars to 0px when chrome is disabled"); `chromeConfig.test.tsx` ("isWatermarkRequired (NFR-008
  invariant — chrome and watermark never both off)" describe — "is true when chrome is disabled - the
  watermark becomes the required fallback signal", "is false when chrome is enabled - the banners
  already carry the signal").
- **AC4** (participant-world styled — green, Figtree; never COBRA/Cadence/default MUI; visually outside
  the app frame): verified structurally, not by a dedicated runtime test — `ComplianceChrome.tsx`'s
  `bannerBaseStyle` hardcodes `position: 'fixed'` (viewport-level, outside any channel's mounted content
  region) and `fontFamily: "'Figtree', system-ui, sans-serif"`, and the module imports only plain React
  + inline style, never `@mui/material` or `@/theme/styledComponents` (per the module header comments;
  held to by the `code-review` gate, for which "COBRA on a participant path" is an always-Critical
  finding — both Gate-1 and Gate-2 passed clean). The default green values (`#2e6b2e` background /
  `#eaf5e6` text) resolve end-to-end via `chromeConfig.default.test.tsx`'s real-pipeline path; banner
  colors themselves are asserted generically against whatever config resolves (not hardcoded to green)
  in `components/ComplianceChrome.test.tsx`, per AC2's config-driven requirement.
- **AC5** (announced to assistive tech as context, not interactive; scenario-agnostic static copy, no
  wall-clock): `components/ComplianceChrome.test.tsx` ("non-interactive assistive-tech context (AC5)"
  describe — "announces each banner as role=\"note\" with a descriptive label, never as interactive
  content" (not focusable, no button/link role), "renders exactly the configured static copy with no
  injected wall-clock/time text").
