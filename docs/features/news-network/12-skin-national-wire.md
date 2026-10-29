# Story: Skin token file — The National Wire (wire service)

**Feature:** News network  ·  **Epic:** E4  ·  **Phase:** 3 — December release (Tom, 10/21)  ·  **Status:** Not Started
**Requirements:** NWS-002, NWS-001, NFR-001, COR-053  ·  **Design decisions:** D3-P1, D3-P2, D3-P3  ·  **Issue:** #729
**Stack:** frontend  ·  **World:** participant  ·  **Wave:** E4-1  ·  **Effort:** S

## Context
Third register (D3-P3). Wire service: austere, **timestamp-first** (monospace), slug codes, a wire dateline ("FAIRHAVEN, Fulton County (NW) —"), terse heds, minimal art. The timestamp-first
treatment changes only **format and position emphasis** of the scenario time; it never changes the time source (CANNOT list, COR-053).

## Acceptance Criteria
- [ ] **Token file validates.** `skinKey: 'national-wire'` passes the schema (`schemaVersion: 1`), no unknown keys, no `clutter`.
- [ ] **D3-P3 values.** Type: IBM Plex Sans (hed/body) + IBM Plex Mono (`kickerFamily` and dateline); rust `#9a3412` accent on mono timestamp/slug, neutral near-white `bg`; `layout.homeLead: 'list-lead'`, `layout.rail: false`; `media.cropAggression` low and art minimal (`media` tokens favour small/no hero); `byline.format` "BY THE NATIONAL WIRE" (org byline, no persona); `dateline.format: 'wire'` (timestamp-first, mono); `breaking.vocabulary` "URGENT", banner style `slug`; `ext.news.masthead: 'wire-strip'`, `ext.news.slugCode: true`.
- [ ] **Slug code and wire dateline are content, styled by token.** Given `payload.slugCode` ("NW-FAIRHAVEN-WATER-0142") and `payload.dateline` ({ place: "FAIRHAVEN, Fulton County", agency: "NW" }), then the head block (04) renders the slug line and "FAIRHAVEN, Fulton County (NW) —" lead-in when this skin's tokens ask for them; with no payload values neither renders (no invented slug).
- [ ] **Timestamp-first, scenario time.** The mono timestamp leads the head block and is produced by `ScenarioDateline` from the server `scenarioTime` (a test asserts it moves with `ScenarioClockChanged`/fixture time, and that no wall-clock appears); only the format differs from other skins.
- [ ] **A11y floor.** Rust `#9a3412` text on its background meets 4.5:1 (unit-tested via `contrast.ts`; tune the surface color, not the exemption); mono text stays ≥ 16px body-equivalent at mobile and no information relies on color alone.
- [ ] **Fonts and zero layout code.** Plex Sans/Mono load only within the outlet scope with fallbacks (`registerSkinFonts`, F13); change set confined to `features/news/skins/national-wire/**` plus its registration line.

## Out of Scope
Layout and components; other skins; generating wire slug codes automatically (authored in the editor, 17); a live "wire feed" ticker (not in the epic).

## Technical Notes
Participant world. Same ownership/registration approach as story 10 (`registerSkinTokens`, F13). The skin's `dateline.format: 'wire'` is a **format this skin registers** with F14's `registerDatelineFormat('wire', fn)` (built-ins: `standard`, `relative`, `compact`), so E4 never forks `ScenarioDateline`; the function uses only the scenario-time formatter.

## Dependencies
Foundation 13, 14. Can run with every other E4-1 story.
