# Feature: Participant shell

**Epic:** E1 — Platform Core & Exercise Isolation  ·  **Phase:** 1  ·  **Feature ref:** D7 (application shells)
**World:** participant  ·  **Issue:** #183  ·  **Status:** Complete — all 7 stories built, tested, Gate-1 + Gate-2
clean on the `feature/participant-shell` umbrella (30 files / 299 tests); ready for the umbrella→`main` PR.

## Summary
The one container every participant-facing channel (social app, portal, news, press, weather) mounts
into. The shell owns the layers *around* the channel — compliance chrome, the alert bar, channel nav,
scenario time, the overlay layer (pause / EndEx / break-fiction), and the participant variants — and
imposes **zero styling inside** the content region. This is what stops every channel from
re-improvising its own banners and alert bar (the D1/D5 divergence the D7 session resolved), and it is
half of the thumbnail-distinguishability gate: a light world framed by two green banners, never the
staff console's dark Cadence chrome.

## Requirements covered
COR-031 (compliance chrome), COR-060/061/062/064/065/066 (shell ownership, nav, variants, overlay
layer, theming), COR-053 (scenario time is the participant-visible time), PRT-010/011/012 (alert bar),
CTL-023 / CTL-024 / COR-054 (overlay content the shell renders), COR-015 (read-only), COR-041 (preview
target), PRT-040 (kiosk — Phase 3). With XC-002/003 (no exercise concept in-fiction; chrome is the
only exercise signal), NFR-001 (a11y), NFR-008 (watermark readiness on high-risk overlays).

## Design references
`docs/design/D7-application-shells/` — **`SHELL-CONTRACT.md`** (normative: shell-owns vs channel-owns,
alert-bar contract, overlay z-order, hard gates), `README.md`, `RETROFIT-NOTES.md`; the canonical
`docs/design/DECISIONS.md` **D7 section** (D7-001..008); the session-3 shell inventory
`docs/design/COMPONENTS.md` (R-006). Mockup: `Pulse Shell.dc.html` (desktop + mobile, all states as
Tweaks props). **STORY-UPDATES.md** §A (this ADD) + §B (participant-surface retrofit).

## Stories
| # | Story | Requirement(s) | Status | Issue |
|---|-------|----------------|--------|-------|
| 01 | Compliance chrome (two banners, config-driven, chrome-off legal) | COR-031 / COR-066 | Complete | #185 |
| 02 | Alert-bar host (4 states, ticker default, emergency escapes) | PRT-010/011/012 / D7-002 | Complete | #186 |
| 03 | Channel nav — global strip + mobile tabs (config-driven) | COR-061/062 / D7-001 | Complete | #187 |
| 04 | Channel-mount contract (content region, scenario time, variant) | COR-060 / COR-053/062 | Complete | #188 |
| 05 | Overlay layer — pause / EndEx / break-fiction rendering | COR-065 / CTL-023/024 / COR-054 | Complete | #189 |
| 06 | Variants — read-only, kiosk (Phase 3), preview | COR-064/015 / PRT-040 / COR-041 | Complete | #190 |
| 07 | Per-exercise brand theming hooks | COR-066 / COR-030 | Complete | #191 |

## Dependencies
E1 exercise-context + scenario clock (COR-050/053) — the shell reads server-driven exercise-scoped
state and is the single scenario-time source for channels; exercise-configuration (compliance-chrome
**config** COR-030/066, lifecycle COR-032); world-steering **triggers** the overlays this shell
**renders** (break-fiction #27, tiered-pause #26 — see STORY-UPDATES §B); E2 social is the first
channel to mount (pilot mode); the SignalR host pushes alert/overlay/scenario-now state. Backend .NET
not present yet — shell state is the contract seam (`{chromeConfig, alerts[], overlayState, variant,
scenarioNow}`).

## Design notes
**Participant world** — per-brand skin, Figtree for shell chrome only; channels bring their own type
and color. **Never COBRA / Cadence, never a default MUI look** (D0 §2). The shell imposes zero styling
inside the content region (COR-060). Severity/state never color-only; alert bar is `role="status"`
with a live-region announce (NFR-001). Scenario time is the only time shown in-fiction (COR-053) — the
shell never annotates it as "scenario time." Compliance chrome + overlays are the **only** exercise
signals a participant sees (XC-002/003); no instructional banners inside the fiction. State is
exercise-scoped and server-driven (XC-001).
