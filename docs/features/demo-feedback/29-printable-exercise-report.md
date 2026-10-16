# Story: Printable exercise report (posts, metrics and charts, saved as PDF)

**Feature:** Demo feedback cut (10/20)  ·  **Phase:** 1  ·  **Status:** In Review
**Requirements:** EVL-030 (lite), COR-053, NFR-001  ·  **Decisions:** DF-40, DF-41, DF-42  ·  **Issue:** #550
**Stack:** backend + frontend  ·  **Review:** Tier-1  ·  **Priority:** Must  ·  **Wave:** 3  ·  **Effort:** M

## Context

At the 10/15 internal demo the `.xlsx` export (story 02) was judged useful, but "pretty sells": the ask is a
Word/PDF-style report that **looks like the posts and has the images**, a list of posts in time order with summary
metrics at the top. An AI-written summary was ruled out (it would put clients off); a human-written narrative is
backlogged as [aar-export 03](../aar-export/03-controller-notes.md).

Approved mockup (10/15): `Pulse Exercise Media Record`, private claude.ai artifact (ask Tom for the link).

Staff world (XC-002): the report carries provenance (origin, posted by, inject #) that never reaches a participant.
It is a **printed document**, not a console view: a neutral print stylesheet, no COBRA chrome on the sheet itself
and no participant brand skin. The on-screen toolbar above the sheet uses COBRA and is hidden in print.

## Decisions

- **DF-40 · PDF through the browser.** The page renders the report and the controller uses the browser's
  Print → Save as PDF (same approach as the participant card sheet). No server-side PDF or `.docx` library this cut;
  white-labeling and a Word export come later.
- **DF-41 · Noise out of the list, in the numbers.** White-noise posts are left out of the post record by default
  (a toolbar checkbox puts them back) and are always counted in the metrics and the activity chart. Engine posts are
  always listed, tagged `Engine`.
- **DF-42 · Inject response rule.** For each delivered inject (fired, not deleted, with at least one post), the first
  response is the earliest **participant** post (origin `participant`) within 30 scenario minutes of the inject's
  first post that either replies directly to one of the inject's posts or mentions the `@handle` of one of their
  authors. Shared hashtags do not count (one storyline hashtag would match everything). The rule is printed under
  the table.

## Acceptance Criteria

**Endpoint** — `GET /api/staff/exports/report` (staff gate as story 02; JSON, contract below)

- [ ] Returns the exercise header, summary, activity bins, inject responses, lookalike pairs and the post record for
      the resolved exercise only. `?includeNoise=true` adds noise posts to `posts`; metrics are identical either way.
- [ ] Posts are ordered by scenario time (ties: wall clock, then id), taken-down posts included with their takedown
      time; counts are the **shown** counts (baseline + real), as participants saw them.
- [ ] Each image carries a signed URL and its alt text. Each video carries its **poster** (the post item's poster,
      else the asset's) as a signed URL, its duration and its alt text; a video with no poster has `posterUrl: null`.
      Avatars are signed URLs or `null`.
- [ ] Activity: 5-minute bins (wider for a long span, at most 300, never dropping a post) from the first to the last post's scenario minute, each split into participant
      (incl. controller-as-persona), scripted, engine and noise.
- [ ] Inject responses follow DF-42; an inject with no response has `firstResponseAt: null`. Median response
      minutes covers responded injects only (`null` when none).
- [ ] Lookalikes: an unverified persona is paired with a verified one when its handle starts with the verified
      handle (case-insensitive, longer), and both authored posts in the exercise. Engagement = shown likes and
      reposts summed over that persona's posts.
- [ ] `editCount` is `null` on every post and `summary.postsEdited` is `null` until post editing lands.
- [ ] Isolation (XC-001/COR-001): an unresolved scope returns 401 before any read; every read goes through the
      scoped sets or is bounded explicitly as in `PostExportService`; a cross-exercise attempt cannot see another
      exercise's posts, personas or media.
- [ ] Telemetry (XC-004): one `export.report.viewed` event per request, payload `{ posts }` only.
- [ ] Over 5,000 listed posts returns 413 with a readable reason (the print page is not built for more).

**Page** — `/console/report` (staff), opened in a new tab from an **Exercise report** button beside Export

- [ ] Renders the approved mockup layout: EXERCISE marking band, header, At a glance (with the source split),
      activity chart (stacked by source, inject markers), inject response times, verified vs. lookalike (omitted
      when there are no pairs), post record grouped by scenario half-hour, and a footer.
- [ ] Images and video posters render at print-friendly size; videos show a `VIDEO` label, play glyph and duration;
      every media item prints its alt text under an `ALT TEXT` label. A poster-less video prints a plain tile.
- [ ] Source, edited, taken-down and participant states are labeled in text, never color-only (NFR-001); the charts
      have text equivalents (`aria-label` and a visible legend).
- [ ] All times are scenario time in the exercise zone (COR-053); no wall clock is printed.
- [ ] Toolbar (screen only): Include background noise, and **Print / Save as PDF** (`window.print()`). Printing waits
      for nothing extra: images are plain `<img>` with `loading="eager"`.
- [ ] Print: US Letter, posts never split across pages, no app chrome, colors preserved
      (`print-color-adjust: exact`). The `@page` rule is injected only while the page is mounted (as the card sheet
      does).
- [ ] Loading, error (401/404/413) and empty-exercise states are designed.

## Contract (frozen for this story)

Times are **exercise-zone scenario times preformatted by the server** (as in story 02): `"yyyy-MM-dd HH:mm"`
(`*At`, `start`) or `"HH:mm"` (`*Time` labels). The client never converts time zones. The one exception to
"scenario time" is `exercise.preparedAt`, the server's wall clock when the report was built, formatted the same way
in the exercise's zone (W-003: never UTC, which reads as tomorrow on a US evening print).

```ts
interface ExerciseReport {
  exercise: { name: string; timeZone: string; scenarioStart: string | null; scenarioEnd: string | null;
              conductedDate: string | null /* "yyyy-MM-dd" of scenarioStart */; preparedAt: string /* "yyyy-MM-dd HH:mm", exercise zone */ }
  summary: {
    participants: number            // participant accounts that signed in at least once
    posts: number                   // top-level + replies, all sources, taken-down included
    replies: number
    injectsDelivered: number
    medianResponseMinutes: number | null
    busiestWindow: { start: string; posts: number } | null   // the max 5-minute bin
    postsEdited: number | null      // null until editing lands
    postsTakenDown: number
    bySource: { participant: number; scripted: number; engine: number; noise: number }
  }
  activity: {
    binMinutes: number   // 5; wider (10 min … whole days) when the span needs more than 300 bins
    bins: { start: string; participant: number; scripted: number; engine: number; noise: number }[]
    injectMarkers: { ref: string; title: string; at: string; binIndex: number }[]
  }
  injectResponses: { ref: string; title: string; deliveredAt: string; firstResponseAt: string | null;
                     responseMinutes: number | null; respondedAsHandle: string | null }[]
  lookalikes: { verified: ReportAccount; lookalike: ReportAccount }[]
  posts: ReportPost[]
  omittedNoiseCount: number         // 0 when includeNoise=true
}
interface ReportAccount { handle: string; displayName: string; verified: boolean; likes: number; reposts: number }
type ReportSource = 'participant' | 'controller-as-persona' | 'scripted' | 'engine' | 'noise'
interface ReportPost {
  id: string; scenarioAt: string; scenarioTime: string
  author: { handle: string; displayName: string; verified: boolean; avatarUrl: string | null }
  source: ReportSource; postedBy: string | null; injectRef: string | null
  replyToHandle: string | null; parentPostId: string | null
  text: string
  media: { kind: 'image' | 'video'; url: string | null /* image URL, or the video's poster URL */;
           alt: string; durationSec: number | null; width: number | null; height: number | null }[]
  likes: number; reposts: number; replies: number
  pinnedForAll: boolean; takenDownAt: string | null; editCount: number | null
}
```

`source` maps from `Post.Origin`: `participant`, `controller-as-persona`, `inject` → `scripted`, `engine`, `noise`.
Handles are returned with the `@` prefix (`PostExportLabels.Handle`).

## Out of Scope

Server-side PDF or `.docx`, white-labeling (logo, cover page, client branding), HSEEP AAR appendix format,
controller notes (aar-export 03), per-participant scoring, rumor/correction chart, edit history detail.

## Technical Notes

- Backend: new `Features/Exports/ExerciseReport*` beside `PostExportService`; reuse its lookups (personas, humans,
  inject refs), `PostEngagementReader` (concrete, not the interface — see story 02), `ExerciseFactsReader`,
  `PostExportLabels` and `IMediaUrlSigner`. Pure functions for binning, the DF-42 rule, lookalike pairing and the
  median, so each is unit-testable. `Program.cs` wiring is orchestrator-owned.
- Frontend: `features/controller/report/` (page, components, service, hook, types). Charts are inline SVG, no
  chart library. The button sits beside `ExportPostsButton` in `ControllerConsole`.
- Videos: posters already exist (captured in the browser at upload, `captureVideoPoster`), so no server work.

## Dependencies

Story 02 (export service and gate). Post editing (tomorrow) fills `editCount` in a follow-up.

## Tests

Backend: report builder unit tests (bins, DF-42, lookalikes, median, noise toggle), endpoint isolation (cross-exercise),
401/413, telemetry payload.

Backend tests (`src/Pulse.WebApi.Tests/Features/Exports/`):
- `ExerciseReportBuilderTests` — bins, source split, busiest window, cap (AC activity); DF-42 reply, @mention,
  hashtag-only, 30-minute cutoff, non-participant ignored (AC inject responses); median incl. none responded;
  lookalike pairing (AC lookalikes).
- `ExerciseReportEndpointTests.Report_CarriesEverySection_PerTheFrozenContract` (AC endpoint, posts order/counts,
  media/posters/avatars, activity, DF-42, lookalikes, editCount null);
  `.IncludeNoise_ListsNoise_AndTheMetricsAreIdentical` (AC endpoint, DF-41);
  `.ASigningFailure_DegradesToNullUrls_NotA500` (AC media);
  `.UnresolvedScope_Returns401_AndRecordsNothing`, `.Anonymous_And_Participant_Return401_UnassignedStaff403`,
  `.ReportFromA_NeverShowsBsPostsPersonasMediaOrInjects` (AC isolation);
  `.OneViewedEvent_PerRequest_StaffActor_PostsOnly` (AC telemetry);
  `.MoreThanFiveThousandListedPosts_Returns413_WithAReadableReason_AndNoTelemetry` (AC 413);
  `.EmptyExercise_Returns200_WithEmptySections`; `.PreparedAt_IsTheServerClock_InTheExerciseZone_NotUtc` (W-003).

Frontend: page renders each section from a fixture; noise toggle refetches; alt text
printed for every media item; poster-less video tile; never color-only labels.
