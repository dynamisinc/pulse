# Story: Exercise report: when the verified-vs-lookalike section appears

**Feature:** Demo feedback cut (10/20)  ·  **Phase:** 1 (post-demo)  ·  **Status:** Complete
**Requirements:** EVL-030 (lite), SOC-052  ·  **Decisions:** DF-48  ·  **Issue:** #569
**Stack:** backend + frontend  ·  **Review:** Tier-1  ·  **Priority:** Should  ·  **Effort:** S

## Context

The printable report ([29](29-printable-exercise-report.md)) pairs an unverified persona with a verified one when its
handle starts with the verified handle and both authored posts anywhere in the exercise. On the 10/16 UAT PDF the
section showed "Fairhaven Water Utility: 0 likes, 0 reposts" against "Fairhaven Water Update: 0 likes, 1 repost" and
concluded "@FairhavenWaterUpd was reposted more than @FairhavenWater." With engagement that small, the comparison and
the full-width bar overstate a non-event, and once the time window scopes the whole report (story 31) a pair can
appear when one side did not post inside the window at all.

## Decisions

- **DF-48 · Lookalike verdicts need a real difference (Tom, 10/16).** A pair's engagement is its shown likes plus
  reposts over its posts inside the window. A verdict is printed only when the lookalike's total is **at least 10 and
  at least 1.5×** the verified account's total. It states the two totals the rule compares ("@x drew more engagement
  than @y: 23 likes and reposts against 8.") and never singles out one measure, so 1 like against 0 is never called
  "liked more" (adversarial review, Tom 10/16). Otherwise the numbers print with no verdict. Taken-down posts and
  replies count, as in the rest of the summary (participants saw them before a takedown); real reactions are counted
  as of the report, not cut off at the window's end. The server decides (`outdrew`), so the rule is unit
  tested in one place. Bars are scaled to `max(10, largest value)`, so 1 against 0 never draws a full-width bar.
  Controller-named pairs are deferred to their own story (see Out of Scope).

## Acceptance Criteria

**Backend** (`GET /api/staff/exports/report`)

- [x] A pair is shown only when **both** personas authored at least one post inside the report's window. The
      lookalike is matched against every author in the exercise first, so a shorter verified prefix that did post in
      the window never stands in for the real account that did not.
- [x] Each `lookalikes[].verified` / `.lookalike` account gains `posts: number`: its posts inside the window (all
      sources, as the rest of the summary).
- [x] Each `lookalikes[]` entry gains `outdrew: boolean` per DF-48: the lookalike's likes + reposts ≥ 10 and
      ≥ 1.5 × the verified account's. Rule boundaries tested (9 vs 0, 10 vs 0, 15 vs 10, 14 vs 10, 10 vs 7).
- [x] Isolation, telemetry and every other section unchanged.

**Page**

- [x] Each account row shows its post count in text ("3 posts") beside likes and reposts.
- [x] The verdict sentence appears only for pairs with `outdrew`, and states the two likes + reposts totals.
- [x] The page renders without `posts` from an older API (frontend and API deploy separately).
- [x] Bars are scaled to at least a range of 10: a 1-vs-0 pair draws a short bar, never a full-width one.
- [x] NFR-001: numbers and verified state are in text, as in story 29.

## Test coverage (AC → test)

| AC | Tests |
|---|---|
| Both personas posted in the window | `ExerciseReportLookalikeEndpointTests.APair_NeedsBothPersonasPostingInsideTheWindow` (each side outside in turn), `…APair_IsMatchedOverTheWholeExercise_SoAShorterPrefixNeverStandsInForTheRealAccount`; `ExerciseReportScopeEndpointTests.TimeWindow_ScopesEverySection_…` (both outside) |
| `posts` per account, in-window only | `ExerciseReportLookalikeEndpointTests.EachAccount_CarriesItsInWindowPosts_AndOutdrewFollowsTheTenAndOneAndAHalfRule` |
| `outdrew` per DF-48 | `ExerciseReportBuilderTests.LookalikeOutdrew_NeedsTenAndOneAndAHalfTimesTheVerifiedTotal` (0/1, 0/9, 0/10, 10/15, 10/14, 7/10, 20/10, 64-bit limits); the endpoint test above (10 vs 15 true, 0 vs 1 false) |
| Isolation, telemetry, other sections unchanged | the existing story 29–31 Exports suite, unchanged and passing |
| Post count in text | `LookalikeSection.test.tsx` "states each account's posts in the window in text" |
| Verdict only with `outdrew`, as totals | "prints no verdict without outdrew, even when the lookalike leads on a measure", "states the two totals for an outdrew pair, never singling out one measure" |
| No `posts` from an older API | "renders without a post count from an older server that sends none" |
| Minimum bar range 10 | "draws 1 against 0 as a short bar on the minimum range, never a full-width one", "still scales to the largest value above the minimum range" |
| NFR-001 | numbers, post counts and VERIFIED/UNVERIFIED are text (the tests above query by text) |

## Out of Scope

Controller-named lookalike pairs (exercise configuration overriding the handle-prefix heuristic), deferred
by Tom 10/16 to [story 33](33-report-named-lookalike-pairs.md). Detecting impersonation by avatar or display-name similarity; scoring participants on it.

## Dependencies

Story 31 (time window scopes the whole report).

## Tests

Backend: pair omitted when one side has no posts in the window; `posts` per account counts in-window posts only;
verdict rule boundaries (pure builder test) and `outdrew` on the wire. Frontend: post counts in text; bars at the
minimum range; no verdict sentence without `outdrew`; the sentence states the totals; no crash without `posts`.
