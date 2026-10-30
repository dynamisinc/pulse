# Story: Shared content primitives (dateline, watermark slot, sanitized body, media, live region)

**Feature:** Channels foundation  ·  **Epic:** E4/E5/E6 (shared)  ·  **Phase:** 3 — December release (Tom, 10/21)  ·  **Status:** In Review
**Requirements:** COR-053, XC-008, NWS-014 (inline video via existing player), NWS-032, NFR-001, NFR-004, NFR-008  ·  **Design decisions:** D3-P1 (slots 5–7), D4-012, D2-008  ·  **Issue:** #710
**Stack:** frontend  ·  **World:** participant  ·  **Wave:** 2  ·  **Effort:** M

## Context
The pieces every channel page needs and that the D3/D4 briefs mandate be identical: the scenario-time dateline, the EXERCISE watermark chip slot (bottom-right on high-risk imagery),
the sanitized body renderer, media with the existing band overlay, and one live-region announcer. Presentational only: no fetching, no skin ownership.

## Acceptance Criteria
- [x] **`ScenarioDateline`.** Given a `scenarioTime` ISO string, then it renders in the exercise time zone via `formatScenarioTime` / the shell's `scenarioNow` (relative "2h ago" derived from `scenarioNow`, never `Date.now()`); the format string comes from the skin's `dateline.format`, resolved through a **format registry** (`registerDatelineFormat(name, fn)`; built-ins `standard`, `relative`, `compact`; a channel registers its own, e.g. news's `wire`, so no channel forks the primitive, news FU-3c) and every format function receives only the scenario-time formatter, never a `Date`; it never says "scenario time"; a lint/test rule forbids `toLocale*`/`Date.now` in this module (COR-053/XC-008).
- [x] **`WatermarkSlot`.** Given a high-risk container (hero image, radar/cone image, warning product), then a bottom-right "EXERCISE" chip slot is reserved and **rendered when** `isWatermarkRequired(chromeConfig)` (`watermark || !enabled`); it is `aria-hidden`, `pointer-events: none`, ≥ 4.5:1, does not overlap the video control row, and reserves its space when off so layout does not shift (NFR-008; chrome and watermark never both off).
- [x] **`ContentMedia`.** Given a `ContentMediaDto`, then images and video render via the existing media components with `ExerciseBands` when required, `alt` required for images (a missing alt falls back to a non-empty placeholder and warns in dev), video uses the existing inline player imported from `core/media` (extracted from the Social components if it currently lives there, so no channel pulls Social chrome, news FU-9; fullscreen the wrapper, not the `<video>`), and `document` kind renders a download link only, with its file name (Q-03, Tom 10/29: PDFs are download-only attachments in December; inline PDF rendering is post-December and `ContentMedia` gains no page-count field, press FU-7).
- [x] **`SanitizedBody`.** Given server-sanitized `bodyHtml`, then it renders through one DOMPurify pass with the same allowlist (defense in depth), forces `rel="noopener noreferrer"` and in-sim links to client-side routes, strips inline event handlers/`javascript:`, and a stored `<script>` or `onerror` payload never executes (NFR-004; test with a payload corpus).
- [x] **Embedded Pulse posts.** The body renderer supports an `<pulse-post data-id>` placeholder resolved by a render-prop so E4 can embed a post in D1 anatomy without this module depending on social.
- [x] **`LiveRegionAnnouncer`.** Given content arrivals, then one polite live region announces "N new stories" no more than once per 5 s (coalesced) and severity text is never color-only; emergency alerts are not announced here (the alert bar owns that).
- [x] **Accessibility.** Primitives are keyboard-operable, have visible focus, meet 44px touch targets on coarse pointers (`useCoarsePointer`), respect `usePrefersReducedMotion`, and pass `axe` with no serious/critical violations in Vitest.
- [x] **No enterprise look.** No default MUI component styling is visible (every component is styled by tokens/CSS vars), no COBRA import (static test).

## Out of Scope
Article layout and slot grid (E4), letterhead (E5; an inline PDF viewer is post-December), warning-product formatting (E6), data hooks (15), the skin provider (13). Pull quotes and share button are E4's.

## Technical Notes
Files: `features/channels/primitives/**` (+ tests), plus `core/media/**` only if the player must be extracted. Reuse `core/clock`, `core/media`, `ExerciseBands`, `isWatermarkRequired`, `useCoarsePointer`, `usePrefersReducedMotion`. MUI 9: `sx` for system props. FontAwesome only.

## Build notes (F14)
- **Player extraction:** the inline player and its helpers moved to `core/media/player/` (Social keeps re-export shims at the old paths; the staff boundary test covers the new path). `ParticipantTooltip` moved with it because the player depends on it.
- **Updated stamp:** `ScenarioDateline` takes `updatedScenarioTime` and renders "Updated 3:05 PM" from that field alone (never from `revisions[]`), so a `silent_rewrite` shows the stamp. A stamp not after publish is hidden. A next-day stamp carries its date.
- **Sanitizer allowlist:** the client allowlist is the union of rich-basic and rich-tables plus `<pulse-post data-id>`, exported for an F04 parity test. Story 04's rich profiles did not exist when this was built (`PostSanitizer` strips every tag), so "the same allowlist" is defined here and F04 mirrors it.
- **Skin variables:** styles read F13's `--pulse-skin-*` custom properties (`text`, `link`, `rule`, `surface`, `font-body`, `font-hed`, `body-size`, `radius`; source of truth `SKIN_CSS_VARS` in `skin/theme.ts`), each with a neutral fallback that also applies inside `SkinResetBoundary`.
- **Document file name:** `ContentMediaDto` has no file-name field. The link uses the URL's last segment when it has an extension, else the alt text plus `.pdf`.
- **Known layering debt (follow-up):** `core/media/player` imports `features/participant-shell` (chrome config, `SHELL_Z`, overlay state) and the tooltip composes Social's token class. All of this is inherited from the moved code. Moving those small contracts into `core/` is a follow-up, not December scope.
- **External links:** body `http(s)` links are allowed and open in a new tab with an "(opens in new tab)" note. Whether real-world hosts may appear in fiction bodies is F04's server-profile call (FC-9 rule 3).
- **Lint rule:** the COR-053 ban for this module is a static test (`primitives.static.test.ts`), not an `eslint.config.js` edit, to keep the footprint inside `primitives/**`.

## Dependencies
02. Can run with 03, 04, 08, 09, 10, 13.
