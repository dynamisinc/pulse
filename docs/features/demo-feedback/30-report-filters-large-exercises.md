# Story: Exercise report: filters, and large exercises never refused

**Feature:** Demo feedback cut (10/20)  ·  **Phase:** 1  ·  **Status:** Complete
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

- [x] New query parameters: `sources` (comma list of `participant,scripted,engine,noise`; default
      `participant,scripted,engine`, so `includeNoise=true` remains an alias that adds `noise`), `from`, `to`
      (`yyyy-MM-dd HH:mm`, exercise zone, inclusive; either may be omitted). An unknown source or an unparsable or
      inverted window returns 400 with a readable reason.
- [x] Summary, activity, inject responses and lookalikes are identical whatever the filters are. *(Superseded for the time
      window by story 31, DF-45: the window now scopes every section; the sources still change only the record.)*
- [x] New `postRecord` object: `{ matching, limit, withheld, sources, from, to }`. `withheld` is true when
      `matching > limit` (5,000); `posts` is then empty. Engagement, media and avatar signing run only for listed posts.
- [x] `omittedNoiseCount` stays the noise posts left out by the source filter (0 when `noise` is selected).
- [x] More than 50,000 posts in the exercise returns 413 with a readable reason; nothing else returns 413.
- [x] Isolation, telemetry (`{ posts }` = listed count) and time formatting unchanged from story 29.

**Page** — `/staff/console/report`

- [x] Toolbar (screen only): source checkboxes (Participant, Scripted inject, Engine, Background noise) replacing the
      single noise checkbox, and From / To scenario-time fields bounded by the exercise window, with Clear. Changing
      a filter refetches; Print stays disabled while fetching (story 29 rule).
- [x] Above the post record, a one-line statement of the active filters ("Showing participant and scripted inject posts,
      10-15 09:00 – 10-15 10:00"), printed too.
- [x] When `withheld`: the record section prints "5,983 posts match. The printable record holds up to 5,000. Narrow
      the sources or the time window above." Summary and charts still render and print, so a summary-only report can
      be saved.
- [x] Filters are labeled controls (NFR-001), keyboard-operable, and the time fields reject input outside the window
      with a readable message.

## Out of Scope

Paging the record across several PDFs; per-persona or per-inject filters; saving filter presets.

## Technical Notes

- Backend: `ExerciseReportService` already reads every post's facts for the metrics. Apply the filter to the in-memory
  list for the record, drop `MaxListedPosts` refusals, and add `MaxExercisePosts = 50_000` checked by a count before
  the read. Parse `from`/`to` in the exercise zone (`ExerciseDay.ResolveTimeZone`), not UTC.
- Frontend: `features/controller/report/`; `useExerciseReport` takes a filter object (query key includes it);
  `reportService` serializes it.

## Contract

```ts
// GET /api/staff/exports/report?sources=participant,scripted,engine,noise&from=yyyy-MM-dd HH:mm&to=yyyy-MM-dd HH:mm&includeNoise=bool
// sources default: participant,scripted,engine. includeNoise=true adds noise (kept as an alias; false never removes it).
// "participant" covers origins participant AND controller-as-persona; "scripted" = inject.
// sources: comma list, case-insensitive, spaces and duplicates ignored; empty (or only commas) is a 400.
// from/to: an empty value is the same as omitting it. Inclusive to the printed minute in the exercise zone
// (to=10:00 keeps a post at 10:00:59); from = to selects one minute.
// 400 (ProblemDetails, title "Invalid report filter", readable `detail`): unknown source, empty sources, unparsable
// time, from > to. 413 only when the exercise has more than 50,000 posts (counted before the read, whatever the filter).
interface ExerciseReport {
  // ...everything as in story 29; omittedNoiseCount = noise posts left out because noise is not a selected source...
  postRecord: {
    matching: number          // posts matching the record filters
    limit: number             // 5000
    withheld: boolean         // matching > limit; posts is [] when true
    sources: ('participant' | 'scripted' | 'engine' | 'noise')[]   // the sources applied, canonical order
    from: string | null       // "yyyy-MM-dd HH:mm" exercise zone, as applied
    to: string | null
  }
}
```

## Dependencies

Story 29 (merged, #551).

## Tests

Backend: filter parsing (400s), summary invariance across filters, withheld above 5,000 (use a lowered limit seam or a
test-only option), 413 above 50,000 via the count, source and window filtering, noise alias. Frontend: filter controls
refetch with the right params, filter statement text, withheld message, summary still rendered when withheld.

Frontend tests by page AC (`ExerciseReportPage.test.tsx`; the To field has no upper bound, because a live exercise
keeps adding posts after the snapshot's `scenarioEnd`):

- **Toolbar, source checkboxes and refetch:** "has four labelled source checkboxes with the first three checked",
  "refetches with the right sources when one is unticked", "refetches with noise in sources when Background noise is
  ticked", "does not let the last source be unchecked"; Print stays disabled while fetching: "disables Print while the
  previous report is shown for a refetch", "disables Print while a cached report refreshes, so a stale record cannot be
  saved".
- **Toolbar, From / To with Clear:** "applies a valid window on blur, sends it as written, and Clear removes it",
  "allows To after the snapshot scenarioEnd (a live exercise keeps growing)", "clears a stale From-after-To error and
  applies From when To moves later".
- **Filter statement:** "states the whole-exercise default above the record" and the window text asserted in the
  "applies a valid window on blur..." test.
- **Withheld:** "withholds the record but still renders summary and charts, with Print enabled".
- **Labelled, keyboard-operable, readable rejection:** "rejects %s with an inline message and does not refetch" (bad
  format, hour 25, before the exercise start), "rejects a From after the applied To", "describes the disabled last
  source and keeps filters before Print in tab order".
- **Errors:** "shows a 400 detail near the filters, keeps the last good sheet, and disables Print"; the 413 message in
  "shows a readable message for a %i".

Backend tests written (`src/Pulse.WebApi.Tests/Features/Exports/`):

- AC endpoint (parameters, 400s): `ExerciseReportFilterTests.Absent_IsTheDefault_EverySourceButNoise_NoWindow`,
  `.Sources_AreCanonical_AndIncludeNoiseOnlyAdds`, `.Invalid_GivesAReadableReason`, `.EmptyTimes_AreAnOpenWindow_AndEqualBoundsAreValid`,
  `.Matches_IsInclusiveToThePrintedMinute_InTheExerciseZone`, `.EachOrigin_MatchesItsSource`;
  `ExerciseReportEndpointTests.AnInvalidFilter_Returns400_WithAReadableReason_AndNoTelemetry`,
  `.SourceFilter_ListsTheChosenSources_ParticipantIncludesControllerAsPersona`,
  `.TimeWindow_IsInclusiveAtBothEnds_InTheExerciseZone`, `.IncludeNoise_IsAnAliasThatAddsNoise_ToTheDefaultOrTheGivenSources`
- AC summary invariance: `ExerciseReportEndpointTests.Filters_ChangeOnlyTheRecord_EveryOtherSectionIsIdentical`,
  `.IncludeNoise_ListsNoise_AndTheMetricsAreIdentical`
- AC `postRecord` / withheld: `ExerciseReportEndpointTests.Report_CarriesEverySection_PerTheFrozenContract`,
  `.MatchingAboveTheLimit_WithholdsTheRecord_TheSummaryStillBuilt_TelemetryZero`,
  `.MoreThanFiveThousandListedPosts_IsNot413_TheRecordIsWithheld`, `.AtTheExerciseCeiling_IsBuilt`
- AC `omittedNoiseCount`: `ExerciseReportEndpointTests.SourceFilter_ListsTheChosenSources_ParticipantIncludesControllerAsPersona`,
  `.MatchingAboveTheLimit_WithholdsTheRecord_TheSummaryStillBuilt_TelemetryZero`
- AC 413 above 50,000: `ExerciseReportEndpointTests.MoreThanTheExerciseCeiling_Returns413_WithAReadableReason_AndNoTelemetry`,
  `.Limits_AreFiveThousandListed_AndFiftyThousandInTheExercise`
- AC isolation / telemetry / time formatting unchanged: `ExerciseReportEndpointTests.ReportFromA_NeverShowsBsPostsPersonasMediaOrInjects`,
  `.OneViewedEvent_PerRequest_StaffActor_PostsOnly`, `.MatchingAboveTheLimit_WithholdsTheRecord_TheSummaryStillBuilt_TelemetryZero`,
  `.PreparedAt_IsTheServerClock_InTheExerciseZone_NotUtc`
