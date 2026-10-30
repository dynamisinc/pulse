# Story: Skin token file — Newsline 7 (local TV)

**Feature:** News network  ·  **Epic:** E4  ·  **Phase:** 3 — December release (Tom, 10/21)  ·  **Status:** Not Started
**Requirements:** NWS-002, NWS-001, NFR-001  ·  **Design decisions:** D3-P1, D3-P2, D3-P3  ·  **Issue:** #727
**Stack:** frontend  ·  **World:** participant  ·  **Wave:** E4-1  ·  **Effort:** S

## Context
First of four register files (D3-P3). A skin is **data over one rendering system**: this story adds `newsline7.ts` to the foundation token registry (`skin/tokens/<skinKey>.ts`, foundation 13) and
touches **zero layout code** (the NWS-002 acceptance test). Register: local TV, video-forward, condensed urgent headlines.

## Acceptance Criteria
- [ ] **Token file validates.** Given `skin/tokens/newsline7.ts` with `skinKey: 'newsline7'`, then it passes the foundation `OutletSkinTokens` schema (`schemaVersion: 1`) with no unknown keys and no `clutter` key.
- [ ] **D3-P3 values.** Type: `mastheadFamily`/`hedFamily` Oswald (condensed, `hedCase` uppercase-capable), `bodyFamily`/`dekFamily` Source Sans 3; palette accent red `#c8102e` on navy `#0f2749` masthead, neutral light `bg`/`surface`, `breaking` red `#c8102e`; `layout.homeLead: 'video-lead'`, `layout.rail: true`; `media.playerTint` navy; `breaking.vocabulary: "BREAKING NEWS"`, banner style `bar`; kicker pattern supports "BREAKING · WATER CRISIS" (kicker is content, the token only styles it); `ext.news.masthead: 'tv-bar'` with `liveChip: true` (● LIVE).
- [ ] **A11y floor.** Every text/background pair in the file meets AA (4.5:1 body, 3:1 large) per the foundation `contrast.ts` check; the file has a unit test asserting this, including white-on-red banner text and red-on-white link text (a failing pair is fixed by tuning the *token*, not by exempting it).
- [ ] **Register legibility.** A rendered-snapshot test of the article, home and breaking states in this skin passes the shared four-skin slot-order test (04) and the video-forward home test (15: video lead when a video hero exists, else text lead fallback).
- [ ] **Fonts.** Oswald and Source Sans 3 are declared with generic fallbacks (`sans-serif`/condensed system stack) and load only inside this outlet's scope (`registerSkinFonts`, F13; self-hosted woff2 shipped in this skin's folder); with the web font blocked, layout holds (no overflow of the masthead or h1 at 360px).
- [ ] **Zero layout code touched.** The change set is confined to `features/news/skins/newsline7/**` plus its one registration line; no file under `features/news/{article,masthead,home,...}` or `features/channels/**` is edited (the NWS-002 fifth-outlet property).

## Out of Scope
Layout, components, other skins; per-exercise overrides (`skinOverrides`, outlet data); Looking Glass NewsNow embedding (PDF-05).

## Technical Notes
Participant world. Foundation story 13 owns `features/channels/skin/**` and says "E4 adds `newsline7`, `courier-ledger`, `national-wire`, `the-scoop`". To keep a foundation file untouched, E4 owns `features/news/skins/<key>/tokens.ts` (+ tests + font faces) and registers with the foundation's one registration call, `registerSkinTokens(key, tokens, { fonts })` (F13, FC-8a), collected in `features/news/skins/index.ts`; the `ext.news` schema is registered once with `registerSkinExtension('news', …)` (news FU-3, resolved in F13/F03). Values are the starting contents; refinement is a token edit, not a build.

## Dependencies
Foundation 13 (schema, registry, contrast check). Can run with every other E4-1 story.
