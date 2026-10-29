# Story: Staff authoring — product and forecast editors

**Feature:** Weather source  ·  **Epic:** E6  ·  **Phase:** 3 — December release (Tom, 10/21)  ·  **Status:** Not Started
**Requirements:** WX-002, WX-010, WX-011, WX-012, WX-013, WX-020  ·  **Design decisions:** D4-009, D4-010, D4-011 (#9, #10), D5 STORY-UPDATES §E  ·  **Issue:** #762
**Stack:** frontend  ·  **World:** staff (COBRA)  ·  **Wave:** 5  ·  **Effort:** L

## Context
Weather is **staff-authored only** (D4-011 #9): there is no participant composer. The foundation's `ContentAuthoringShell` (F17) owns list/status/schedule/publish/retract/revise/preview; E6 supplies the two
kind editors that fill its editor slot via `registerContentKindEditor`. The editor is a controller tool: dense, keyboard-first, COBRA. It must make the *right* thing fast: author a warning in the IBW
shape, see exactly what participants will read, and have the delivery options (alert, `@WeatherDesk` post) pre-set the D4 way.

## Acceptance Criteria
- [ ] **Registration.** Given `registerContentKindEditor('weather_product', …, { ownsDeliveryOptions: true })` and `('forecast', …)` (registration module in `features/weather/staff/`, imported by the orchestrator; F17 hides its generic alert/post block for these kinds and the editor's `delivery` payload is used via FC-7a, FU-6 resolved), then F17's "New"/"Edit" opens the right editor and a kind with no editor never crashes.
- [ ] **Product editor.** Given the form, then a controller sets product type, hazard, zones (multi-select from the zone list, with "add a zone first" when none), effective/expires in scenario time (shown as scenario/wall pair like Cadence), headline (preview of the verbatim string), IBW What/Where/When/Impacts, preparedness actions, narrative, and imagery from the media library with required alt text; server validation errors map to fields; `version` conflicts (409) prompt a reload.
- [ ] **Live participant preview.** Given any edit, then a side preview renders the real `IbwGrid` + `ProductText` + `SeverityChip` in the participant subtree inside the staff frame (COR-041) so the NWS furniture (`...HEADLINE...`, `&&`, `$$`) is visible while typing; the participant skin never leaks into staff chrome and vice versa.
- [ ] **Delivery options (D4-010/011).** Given watch/warning/advisory, then "Raise alert" shows the mapped severity as read-only text ("Warning — emergency band on every channel", D4-010) and is **locked on** for warnings; "Post from @WeatherDesk" shows the exact link card, default text = headline verbatim, editable pre-publish and capped at 280 (Q2 sets the default checked state); options persist into the payload `delivery` block so scheduled issuance honours them (FC-7a).
- [ ] **Forecast editor.** Given a zone, then the controller enters current conditions and 1–14 periods (condition code picker with icon + text), discussion and an optional "uncertainty note" (WX-003), can **clone the zone's current forecast** as the starting point for the next issuance, and can upload imagery (radar/cone/snowfall) as media (WX-013).
- [ ] **Follow-up actions.** Given a published product, then "Upgrade to warning", "Update" and "Cancel" call the issue-update helper (05) and open the pre-filled draft; invalid actions are absent, not disabled-with-no-reason.
- [ ] **Staff world, inject, access (NFR-001).** All controls use `@/theme/styledComponents` and FontAwesome (no default MUI look), are keyboard-operable with visible focus and shortcut hints, axe clean, severity shown icon + text + colour; a read-only role sees no mutating controls; "Add to inject queue" is F17's control and works for both kinds (WX-012).
- [ ] **User guide.** Adds/updates the controller weather-authoring page in `docs/guide/` (screenshot list) or states "no guide impact".

## Out of Scope
Publish/schedule/retract mechanics (F17), the timeline panel (12), zone admin (13), any participant-side authoring, generating imagery (Beat-generated images arrive via the media library), engine drafting of weather (E8, later).

## Technical Notes
Files: `src/frontend/src/features/weather/staff/{register.ts, ProductEditor.tsx, ForecastEditor.tsx, deliveryOptions/**, hooks/**}` — kept under `features/weather/` (not `features/controller/content/`, which is F17's). Reuse `features/channels/contract` types, `features/weather/contract`, `registerContentKindEditor`, `useZones` (owned by story 03). The participant preview mounts `OutletSkinScope` for `weather-desk`.

## Dependencies
01, 07 (preview components), F17 (shell + `registerContentKindEditor`), F14; 05 for the follow-up actions (mock until live); 02 for zones (mock until live). Can run with 08, 09, 10, 13. **Story 12 waits for this story** (it hands editing to these editors), so 12 is not a parallel peer.
