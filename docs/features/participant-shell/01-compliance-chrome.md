# Story: Compliance chrome (two banners, config-driven, chrome-off legal)

**Feature:** Participant shell  ·  **Epic:** E1  ·  **Phase:** 1  ·  **Status:** Not Started
**Requirements:** COR-031 (COR-066)  ·  **Design decisions:** D7-005, D7-006  ·  **Issue:** #185

## Context
Compliance chrome is the participant world's frame and one of the only two exercise signals a
participant ever sees (XC-002/003). The shell renders **two fixed 22px banners** at the absolute top
and bottom of the viewport — visually *outside* the app frame (the D1 two-banner inset model is
canonical, D7-005) — green `#2e6b2e` on `#eaf5e6`, Figtree 700 10px caps, `.14em` tracking. Strings
and colors are **config-driven** (COR-030/066); the app zone insets between them. **Chrome-off is a
legal state** — the layout must survive it (the watermark is the fallback signal, NFR-008).

## Acceptance Criteria
- [ ] Given an exercise with chrome enabled, when any channel renders, then two fixed 22px banners
      appear at the viewport top and bottom with the configured classification strings (default top
      `UNCLASSIFIED // EXERCISE · EXERCISE · EXERCISE — ALL CONTENT SIMULATED`; bottom
      `PULSE TRAINING ENVIRONMENT — SIMULATED INFORMATION SPACE — NOT REAL NEWS`) and the content zone
      insets between them.
- [ ] Banner **text and colors are config-driven** per exercise (COR-030/066); zero brand/classification
      strings are hardcoded in shell code (the "Fairhaven"/demo strings are config).
- [ ] Given **chrome-off** (a legal per-exercise state), when a channel renders, then the layout is
      intact (no reserved-gap artifact) and the in-content **EXERCISE watermark** remains the fallback
      signal — **chrome and watermark are never both off** (NFR-008).
- [ ] Banners are **participant-world** styled (green, Figtree) — never COBRA / Cadence / default MUI
      (D0 §2) — and are visually outside the app frame (not part of any channel's content).
- [ ] Chrome is announced to assistive tech as exercise/classification context, not as interactive
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
- Component (RTL): both banners render with configured strings; content region insets 22px top+bottom.
- Component (RTL): chrome-off yields an intact layout with no gap artifact.
- Unit: banner strings/colors come from config, not constants.
