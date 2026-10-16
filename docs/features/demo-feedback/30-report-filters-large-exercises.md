# Story: Exercise report: filters, and large exercises never refused

**Feature:** Demo feedback cut (10/20)  ·  **Phase:** 1  ·  **Status:** In Progress
**Requirements:** EVL-030 (lite), COR-053, NFR-001  ·  **Decisions:** DF-43, DF-44  ·  **Issue:** #561
**Stack:** backend + frontend  ·  **Review:** Tier-1  ·  **Priority:** Must  ·  **Wave:** 4  ·  **Effort:** S–M

## Context

On UAT (10/16) the demo exercise had 5,983 non-noise posts, and the printable report ([29](29-printable-exercise-report.md))
refused with 413 ("more than the printable report can hold (5,000)"). Rehearsals pile posts up, so a real exercise can
pass the limit too. The limit exists for the **post record** (a 5,000-card page is already ~500 printed pages). The
metrics and charts have no such problem, and refusing the whole report is the wrong answer.

## Decisions

- **DF-43 · Summary always, record when it fits.** The header, At a glance, activity chart, inject responses and
  lookalikes are always built over **every** post. Only the post record is limited: when more than 5,000 posts match
  the record's filters, the record is **withheld** (not truncated, so no partial list can pass for a full one) and
  the page says how many match and how to narrow it. A 413 remains only above 50,000 posts in the exercise (the same
  ceiling as the `.xlsx` export), where even the summary read is refused.
- **DF-44 · Record filters.** The post record can be narrowed by **source** (participant incl. controller-as-persona,
  scripted, engine, background noise) and by a **scenario-time window** (`from`/`to`, exercise zone). The defaults
  list everything except noise (DF-41 unchanged). Filters change only the record; the summary never changes with
  them, and the page states the active filters above the record so a printout says what it contains.

## Acceptance Criteria

**Endpoint** — `GET /api/staff/exports/report`

- [ ] New query parameters: `sources` (comma list of `participant,scripted,engine,noise`; default
      `participant,scripted,engine`, so `includeNoise=true` remains an alias that adds `noise`), `from`, `to`
      (`yyyy-MM-dd HH:mm`, exercise zone, inclusive; either may be omitted). An unknown source or an unparsable or
      inverted window returns 400 with a readable reason.
- [ ] Summary, activity, inject responses and lookalikes are identical whatever the filters are.
- [ ] New `postRecord` object: `{ matching, limit, withheld, sources, from, to }`. `withheld` is true when
      `matching > limit` (5,000); `posts` is then empty. Engagement, media and avatar signing run only for listed posts.
- [ ] `omittedNoiseCount` stays the noise posts left out by the source filter (0 when `noise` is selected).
- [ ] More than 50,000 posts in the exercise returns 413 with a readable reason; nothing else returns 413.
- [ ] Isolation, telemetry (`{ posts }` = listed count) and time formatting unchanged from story 29.

**Page** — `/staff/console/report`

- [ ] Toolbar (screen only): source checkboxes (Participant, Scripted inject, Engine, Background noise) replacing the
      single noise checkbox, and From / To scenario-time fields bounded by the exercise window, with Clear. Changing
      a filter refetches; Print stays disabled while fetching (story 29 rule).
- [ ] Above the post record, a one-line statement of the active filters ("Showing participant and scripted posts,
      10-15 09:00 – 10-15 10:00"), printed too.
- [ ] When `withheld`: the record section prints "5,983 posts match. The printable record holds up to 5,000. Narrow
      the sources or the time window above." Summary and charts still render and print, so a summary-only report can
      be saved.
- [ ] Filters are labeled controls (NFR-001), keyboard-operable, and the time fields reject input outside the window
      with a readable message.

## Out of Scope

Paging the record across several PDFs; per-persona or per-inject filters; saving filter presets.

## Technical Notes

- Backend: `ExerciseReportService` already reads every post's facts for the metrics. Apply the filter to the in-memory
  list for the record, drop `MaxListedPosts` refusals, and add `MaxExercisePosts = 50_000` checked by a count before
  the read. Parse `from`/`to` in the exercise zone (`ExerciseDay.ResolveTimeZone`), not UTC.
- Frontend: `features/controller/report/`; `useExerciseReport` takes a filter object (query key includes it);
  `reportService` serializes it.

## Dependencies

Story 29 (merged, #551).

## Tests

Backend: filter parsing (400s), summary invariance across filters, withheld above 5,000 (use a lowered limit seam or a
test-only option), 413 above 50,000 via the count, source and window filtering, noise alias. Frontend: filter controls
refetch with the right params, filter statement text, withheld message, summary still rendered when withheld.
