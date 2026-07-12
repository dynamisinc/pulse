# Story: Per-exercise settings

**Feature:** Exercise configuration  ·  **Epic:** E1  ·  **Phase:** 1  ·  **Status:** Not Started
**Requirements:** COR-030 (XC-008)  ·  **Design decisions:** none  ·  **Issue:** #67

## Context
The per-exercise settings that define a world: internal name, participant-visible world name/locale,
time zone (single zone per exercise), schedule, enabled channels (Social/News/Press/Weather), theming
(portal branding, outlet names), and compliance chrome config (COR-030).

## Acceptance Criteria
- [ ] Planners can configure per-exercise: internal name, participant-visible world name/locale, time
      zone, schedule, enabled channels, theming, and compliance-chrome config (story 02).
- [ ] Enabled-channel settings gate which channels exist for the exercise (Phase 1: Social; others as
      E3–E6 land).
- [ ] The time zone is a single zone per exercise (XC-008, known constraint) and drives all
      scenario-time rendering (COR-053).
- [ ] Settings are staff-only (XC-002) and exercise-scoped.

## Out of Scope
Compliance chrome specifics (story 02); lifecycle (story 03); the actual theming/skin implementation
per surface (each channel epic); multi-time-zone support (deferred, open question 4).

## Technical Notes
Staff world (COBRA). Settings drive routing, channel enablement, theming providers, and the clock's
time zone. See implementation.md (story 01).

## Dependencies
Exercise entity (exercise-isolation); consumed by exercise-clock (TZ), every channel (enablement/
theming).

## Tests
- Integration: settings persist and gate channel enablement; time zone drives scenario-time rendering.
