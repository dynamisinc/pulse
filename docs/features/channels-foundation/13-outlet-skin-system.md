# Story: Outlet skin system (token files, scope provider)

**Feature:** Channels foundation  ·  **Epic:** E4 (with E5/E6)  ·  **Phase:** 3 — December release (Tom, 10/21)  ·  **Status:** Not Started
**Requirements:** NWS-002, NWS-012 (breaking vocabulary as token), COR-030, COR-066, NFR-001  ·  **Design decisions:** D3-P1, D3-P2  ·  **Issue:** #709
**Stack:** frontend  ·  **World:** participant  ·  **Wave:** 2  ·  **Effort:** L

## Context
D3-P1: one rendering system, each outlet a **token file**; "a fifth outlet is a token file, not a new build". This story builds the mechanism once: the token schema (the D3-P2
**CAN** list), the registry, and a scope provider that mounts a per-outlet theme in its route subtree. E4 supplies the four news token files and the article/homepage layout; E5/E6
use the same mechanism for the Wire Room and Weather Desk.

## Acceptance Criteria
- [ ] **Schema = the CAN list.** Given `OutletSkinTokens` (FC-3b), then it exposes only type, palette, density, media treatment, breaking treatment, byline/dateline format, layout enums and the sanctioned clutter set; no key can address slot order, the scenario-time source, the Pulse embed/link-card, the watermark slot, share behaviour, comments or the a11y floor (a type-level test and a schema test with unknown keys → rejected).
- [ ] **Merge.** Given an `OutletDto` with `skinKey` and `skinOverrides`, when `useOutletSkin(slug)` resolves it, then the result is the registry token file ⊕ the validated overrides; an unknown `skinKey` falls back to the neutral skin and logs once; a fifth outlet needs only a token file + a registry line (an AC test adds a fake outlet and asserts **zero layout code touched**).
- [ ] **Scope provider.** Given `<OutletSkinScope outlet>`, then it mounts CSS custom properties and a per-outlet MUI theme **inside the subtree only**; it never imports COBRA, never wraps the shell, and two scopes on one page do not bleed into each other.
- [ ] **A11y floor enforced.** Given any token file or override, when its palette is applied, then text/background pairs meet WCAG 2.1 AA (4.5:1 body, 3:1 large) and body size is ≥ 16px on mobile; a violating pair is clamped to the neutral fallback and reported in dev; the floor cannot be overridden (D3-P2 CANNOT list).
- [ ] **Clutter guard.** `clutter` and `homeLead: 'clutter'` are honoured only for the tabloid skin key; elsewhere they are ignored (and the server rejects them, story 03).
- [ ] **External registration (FC-8a; news FU-3, press FU-1, weather FU-4, portal FU-4a).** Given `registerSkinTokens(skinKey, tokens, { fonts? })` called from a channel's own folder as an import side effect, then the key resolves through `useOutletSkin` with **no edit to `features/channels/skin/**`**; a neutral fallback plus **replaceable** `wire-room` / `weather-desk` stubs ship (a channel registration replaces a stub; a second registration of any other key is a dev-time error); E4 registers `newsline7`, `courier-ledger`, `national-wire`, `the-scoop` (values from D3-P3), E5 the final `wire-room`, E6 the final `weather-desk`, E3 the portal's, each from its own folder.
- [ ] **Token-object scope and reset boundary.** Given `<SkinScope scopeId tokens>` (a scope that is **not** an outlet, e.g. the portal) and `OutletSkinScope` as a thin wrapper over it, then both mount the same CSS custom properties + MUI theme inside the subtree only; `<SkinResetBoundary>` re-applies the **exercise brand tokens** inside any scope so an embedded Social `PostCard` is immune to outlet tokens (news FU-6b), proven by a test that nests one in a loud skin.
- [ ] **Extension namespaces.** Given `registerSkinExtension(ns, schema)` for `news` / `press` / `weather` / `portal`, then `ext.<ns>` keys are validated against the schema (mirroring F03's server allowlist), keys declared as colors enter the AA contrast check, and an unregistered namespace is ignored and reported in dev.
- [ ] **Fonts (news FU-4).** Given `registerSkinFonts(skinKey, faces[])`, then faces are self-hosted `woff2` supplied from the registering channel's folder (no third-party CDN), `font-display: swap`, loaded lazily **only when a scope using the skin mounts**, and work under CSP `font-src 'self'` (the header edit is platform prerequisite PP-3); token files name font stacks only, and a missing or blocked font falls back to the declared generic family without layout shift beyond the existing tolerance.
- [ ] **Nothing breaks fiction.** No platform-authored badge, "exercise", "preview" or "breaking" string is produced by the skin system; breaking vocabulary comes only from `breaking.vocabulary` and is rendered only when content sets the breaking slot.

## Out of Scope
The article/homepage layout and the four news token files (E4); the final letterhead/`ext.press`, `ext.weather` and portal values (E5/E6/E3, registered by them); the outlet admin editor for overrides (story 17 hosts a JSON-safe field editor if time permits, otherwise staff edit via API).

## Technical Notes
Files: `features/channels/skin/**` (`tokens/{neutral,wire-room,weather-desk}.ts` stubs only, `schema.ts`, `registry.ts` (`registerSkinTokens`, `registerSkinExtension`, `registerSkinFonts`), `SkinScope.tsx`, `OutletSkinScope.tsx`, `SkinResetBoundary.tsx`, `useOutletSkin.ts`, `contrast.ts`, `fonts.ts`). Effort raised M → L by the consolidation; it still blocks 12 and every channel skin, so it stays in Wave 2. MUI 9 `sx`-only system props. Participant world: no COBRA, no default MUI look. Mirror `BrandThemeProvider` / `brandTokens.ts` for the provider and default handling.

## Dependencies
02 (types, `OutletDto`). Can run with 03, 04, 08, 09, 10, 14. Blocks 12.
