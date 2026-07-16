# Feature: Staff shell frame

**Epic:** E7 — Controller Command Surface  ·  **Phase:** 1  ·  **Feature ref:** D7 (application shells)
**World:** staff  ·  **Issue:** #184  ·  **Status:** decomposed — ready to build

## Summary
The frame every staff surface (controller console, evaluator dashboard) renders inside: the Cadence
navy header, the one shell-owned toolstrip dock, the participant-admin flyout, and preview-as-
participant. The surface owns its work area; the shell owns everything around it. This is the other
half of the thumbnail-distinguishability gate — navy chrome + light work area, **never** confusable
with the green-bannered participant world — and it is where `console-shell`'s toolbox and the
evaluator dashboard's (fewer) controls dock, so neither surface re-draws chrome.

## Requirements covered
COR-063 (staff shell owns), COR-005 (identity badge, static during conduct), COR-017 (participant
admin), COR-041 (preview as participant), D7-007/009/010/011 (staff frame extraction, Cadence
restyle, no separate exercise bar, one toolstrip dock). With XC-002 (staff-only, never a participant
view), NFR-001 (keyboard-first, state never color-only).

## Design references
`docs/design/D7-application-shells/` — **`SHELL-CONTRACT.md`** (§1 staff shell owns; §4 hard gates),
`README.md`, `RETROFIT-NOTES.md` (D5 container swaps); the canonical `docs/design/DECISIONS.md`
**D7 section** (D7-007/009/010/011) + the D5 section; `docs/design/COMPONENTS.md` (D5 improvised-chrome
inventory this frame replaces). Mockup: `Pulse Staff Shell.dc.html` (frame, preview-as, admin flyout).
Uses the COBRA/Cadence components (`@/theme/styledComponents`) where they map. **STORY-UPDATES.md**
§A (this ADD) + §B (console-shell reconcile).

## Stories
| # | Story | Requirement(s) | Status | Issue |
|---|-------|----------------|--------|-------|
| 01 | Staff header — lockup, identity badge, clocks, state pill, classification tag | COR-063 / COR-005 / D7-010 | Not Started | #192 |
| 02 | Toolstrip dock — one shell-owned strip, shell-global + surface zones | D7-011 / COR-063 | Not Started | #193 |
| 03 | Participant-admin flyout (login triage) | COR-017 | Not Started | #194 |
| 04 | Preview as participant (staged, read-only, scenario-moment picker) | COR-041 | Not Started | #195 |
| 05 | Cadence chrome tokens + thumbnail-distinguishability gate | D7-009 | Not Started | #196 |

## Dependencies
E1 exercise-context + roles (Director/Controller; lead-controller for some admin actions),
scenario+wall clock (COR-050), exercise identity + lifecycle (COR-005/032). `console-shell` docks its
toolbox + NEEDS-YOU bar into this frame's toolstrip + header action slot (see STORY-UPDATES §B);
`participant-shell` is what **Preview as participant** renders in a stage (COR-041). COBRA theme +
`@/theme/styledComponents`. Backend .NET not present yet — header/admin state is the contract seam.

## Design notes
**Staff world (COBRA/Cadence)** — navy `#1e3a5f` header, light `#f8f8f8` work area, Cadence red
`#e42217`, pill buttons; the participant shell stays **out** of Cadence (D7-009). **Hard gate:** staff
surfaces must be thumbnail-distinguishable from participant surfaces — dark chrome + single top bar vs
light world framed by two green banners; never mix (SHELL-CONTRACT §4). **No separate exercise bar**
(D7-010): the classification tag `UNCLASSIFIED // FOUO` folds into the header as a persistent mono tag;
everything else the old `.exbar` carried lives in the identity badge. **One toolstrip dock** (D7-011):
the shell owns the container; surfaces register tools into the surface-zone and never draw a second
strip. Fully keyboard-operable (NFR-001); state/severity never color-only.
