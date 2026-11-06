# Story: Skin token file — Newsline 7 (local TV)

**Feature:** News network  ·  **Epic:** E4  ·  **Phase:** 3 — December release (Tom, 10/21)  ·  **Status:** In Progress (PR for #727; one AC deferred, see Build notes)
**Requirements:** NWS-002, NWS-001, NFR-001  ·  **Design decisions:** D3-P1, D3-P2, D3-P3  ·  **Issue:** #727
**Stack:** frontend  ·  **World:** participant  ·  **Wave:** E4-1  ·  **Effort:** S

## Context
First of four register files (D3-P3). A skin is **data over one rendering system**: this story adds `newsline7.ts` to the foundation token registry (`skin/tokens/<skinKey>.ts`, foundation 13) and
touches **zero layout code** (the NWS-002 acceptance test). Register: local TV, video-forward, condensed urgent headlines.

## Acceptance Criteria
- [x] **Token file validates.** Given `skin/tokens/newsline7.ts` with `skinKey: 'newsline7'`, then it passes the foundation `OutletSkinTokens` schema (`schemaVersion: 1`) with no unknown keys and no `clutter` key.
- [x] **D3-P3 values.** Type: `mastheadFamily`/`hedFamily` Oswald (condensed, `hedCase` uppercase-capable), `bodyFamily`/`dekFamily` Source Sans 3; palette accent red `#c8102e` on navy `#0f2749` masthead, neutral light `bg`/`surface`, `breaking` red `#c8102e`; `layout.homeLead: 'video-lead'`, `layout.rail: true`; `media.playerTint` navy; `breaking.vocabulary: "BREAKING NEWS"`, banner style `bar`; kicker pattern supports "BREAKING · WATER CRISIS" (kicker is content, the token only styles it); `ext.news.masthead: 'tv-bar'` with `liveChip: true` (● LIVE).
- [x] **A11y floor.** Every text/background pair in the file meets AA (4.5:1 body, 3:1 large) per the foundation `contrast.ts` check; the file has a unit test asserting this, including white-on-red banner text and red-on-white link text (a failing pair is fixed by tuning the *token*, not by exempting it).
- [ ] *(deferred to 04 / 15)* **Register legibility.** A rendered-snapshot test of the article, home and breaking states in this skin passes the shared four-skin slot-order test (04) and the video-forward home test (15: video lead when a video hero exists, else text lead fallback).
- [x] **Fonts.** Oswald and Source Sans 3 are declared with generic fallbacks (`sans-serif`/condensed system stack) and load only inside this outlet's scope (`registerSkinFonts`, F13; self-hosted woff2 shipped in this skin's folder); with the web font blocked, layout holds (no overflow of the masthead or h1 at 360px).
- [x] **Zero layout code touched.** The change set is confined to `features/news/skins/newsline7/**` plus its one registration line; no file under `features/news/{article,masthead,home,...}` or `features/channels/**` is edited (the NWS-002 fifth-outlet property).

## Out of Scope
Layout, components, other skins; per-exercise overrides (`skinOverrides`, outlet data); Looking Glass NewsNow embedding (PDF-05).

## Technical Notes
Participant world. Foundation story 13 owns `features/channels/skin/**` and says "E4 adds `newsline7`, `courier-ledger`, `national-wire`, `the-scoop`". To keep a foundation file untouched, E4 owns `features/news/skins/<key>/tokens.ts` (+ tests + font faces) and registers with the foundation's one registration call, `registerSkinTokens(key, tokens, { fonts })` (F13, FC-8a), collected in `features/news/skins/index.ts`; the `ext.news` schema is registered once with `registerSkinExtension('news', …)` (news FU-3, resolved in F13/F03). Values are the starting contents; refinement is a token edit, not a build.

## Dependencies
Foundation 13 (schema, registry, contrast check). Can run with every other E4-1 story.

## Build notes (#727)
- **Outlet name.** F03 seeds this skin's outlet as **"Metro Desk 9"** (`metro-desk-9`, FIC-001). The skinKey stays `newsline7`. "Newsline 7" in the title is the key's historical name, and the tokens carry no outlet name.
- **Files.** `features/news/skins/newsline7/{tokens,fonts,index}.ts`, plus the self-hosted woff2 files and their OFL licences under `fonts/`. Tests are `tokens.test.ts` (schema, D3-P3 values, every AA pair, no clamp) and `registration.test.tsx` (registry and scoped font loading).
- **Beyond `newsline7/**`.** There is `features/news/skins/index.ts`, which holds one `import` line per skin. There is also `features/news/skins/newsExtension.ts`, the single `ext.news` schema: no other file may call `registerSkinExtension('news', …)`. It is shared with news 03 and 11.
- **`liveChip`** is a string, the skin's own word (`'LIVE'`), not `true`. That way the platform never authors the chip text (story 03, D3-P4). The masthead draws the "●".
- **The navy masthead band** is `ext.news.mastheadFill` (`color`, 3:1 on `bg`). The palette has no masthead key.
- **Deferred.** The "Register legibility" AC needs the shared slot-order test (story 04) and the video-forward home test (15), and neither exists yet. Those stories run every registered skin, newsline7 included.
- **Font swap, checked by hand at 360px** (dev harness, Windows/Chromium, not committed):
  - Nothing overflowed in either state.
  - The h1 was 224px tall with the face loaded and with it blocked (Arial Narrow fallback).
  - The masthead nameplate shifted 10px with default line-height, and 0px with `line-height: 1.1` (a note for story 03).

