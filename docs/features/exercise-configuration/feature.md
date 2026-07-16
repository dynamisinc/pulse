# Feature: Exercise configuration

**Epic:** E1 — Platform Core & Exercise Isolation  ·  **Phase:** 1  ·  **Feature ref:** F1.4
**World:** staff  ·  **Issue:** #41

## Summary
Per-exercise settings that shape the world: name/locale/time zone/schedule, enabled channels,
theming, the compliance chrome, the Build→…→Archived lifecycle, and a practice/sandbox flag that keeps
rehearsals out of evaluation exports.

## Requirements covered
COR-030, COR-031, COR-032, COR-033 (with NFR-008 leak protection for chrome/watermark, XC-003
compliance chrome, XC-008 time zone). Plus the **COR-005 participant-identity gap** (story 05 —
requirements decision, COMPONENTS.md divergence #5).

## Design references
D0 foundations (compliance chrome as environment chrome outside the app frame). Master decisions 4
(configurable chrome) and 9/13 (lifecycle, leak protection). **Session 3 (R-006):** the banner
chrome both mockups improvised is inventoried in `docs/design/COMPONENTS.md` and frozen pending the
**D7 unified shell** — story 02's banner presentation is interim, and story 05 files the
participant exercise-identity requirements gap (divergence #5) as a D7 input.

## Stories
| # | Story | Requirement(s) | Status | Issue |
|---|-------|----------------|--------|-------|
| 01 | Per-exercise settings (locale, TZ, channels, theming) | COR-030 | Not Started | #67 |
| 02 | Compliance chrome (configurable banners) | COR-031 | Not Started | #68 |
| 03 | Exercise lifecycle state machine | COR-032 | Not Started | #69 |
| 04 | Practice/sandbox flag | COR-033 | Not Started | #70 |
| 05 | Participant-visible exercise identity *(requirements gap → D7 input)* | COR-005 gap / R-006, COMPONENTS.md #5 | Not Started | #180 |

## Dependencies
Exercise entity (exercise-isolation); the exercise clock (exercise-clock) consumes the time zone;
build/go-live (exercise-build-golive) drives lifecycle transitions. Backend not present yet.

## Design notes
Staff world. Compliance chrome renders as persistent environment chrome **outside** the simulated app
frame, consistently on every channel (XC-003) — and can be disabled per exercise, but **never**
simultaneously with in-content watermarks off (NFR-008). Single time zone per exercise is a known,
accepted launch constraint (XC-008, open question 4).
