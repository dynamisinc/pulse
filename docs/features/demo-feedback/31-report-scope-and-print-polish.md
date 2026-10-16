# Story: Exercise report: time window scopes the whole report, print polish, threads

**Feature:** Demo feedback cut (10/20)  ·  **Phase:** 1  ·  **Status:** Not Started
**Requirements:** EVL-030 (lite), COR-053, NFR-001  ·  **Decisions:** DF-45, DF-46, DF-47  ·  **Issue:** #568
**Stack:** backend + frontend  ·  **Review:** Tier-1  ·  **Priority:** Must  ·  **Wave:** 4  ·  **Effort:** M

## Context

Two UAT PDFs of the report on "Pulse UAT Pilot" (10/16), after stories 29 and 30, showed:

- **The report contradicts itself.** With From/To set to 10-14 09:30 – 10-15 09:30, the post record lists 13 posts,
  but the header (scenario window 2026-07-24 – 2026-10-16), At a glance (5,985 posts), the activity chart (12-hour
  bins over three months), the inject table and the lookalikes all still cover the whole exercise (DF-43 built them
  over every post). A reader cannot tell which numbers belong to the posts shown.
- Inject names print twice ("Test test Test test"): `ref` falls back to the title when there is no MSEL number, and
  the table prints `ref` and `title`.
- Inject marker labels overlap on the chart when several injects fall close together.
- Times have no dates on a multi-day span (inject table "06:39"; "Taken down at 09:43").
- Six pages for 13 posts: images print about 3 in. tall, and page 2 is half empty because the record's first post
  did not fit under its heading.
- The browser's print header and footer (date, title, URL, page x/y) print on every page.
- Replies print as flat siblings ("Do tell!", "Replying to my reply…") instead of a thread.

The lookalike section's own rules are split out to [32](32-report-lookalike-section-rules.md).

## Decisions

- **DF-45 · The time window scopes the whole report.** `from`/`to` now filter every section: header (scenario window
  and conducted date show the window), At a glance, source split, activity chart, inject responses (an inject is in
  the window when its first post is), lookalikes and the post record. **Sources** stay record-only (DF-44): they
  change what is printed, not what happened. This supersedes DF-43's "summary over every post" for the time window
  only; with no window, behaviour is unchanged. The 50,000-post ceiling still counts the whole exercise.
  - A **"Latest scenario day"** preset sets From/To to 00:00–23:59 of the scenario date of the latest post (exercise
    zone), so a long-running exercise opens on something meaningful in one click.
  - Inject responses near the window's end still look for a response up to 30 minutes past `to` (DF-42's window is
    a property of the inject, not of the filter).
- **DF-46 · Print density and chrome.** Media prints at most 2.5 in. tall (contain, centered), the poster-less video
  tile at 1.25 in.; a section heading may sit at a page bottom only with its first item; the post record's first
  group starts on the heading's page when its first post fits. The page sets `@page { margin: 0 }` and the sheet
  draws its own 0.5 in. margins, which removes the browser's header and footer in Chromium and Edge. Target: the
  10/16 13-post report in about three pages, not six.
- **DF-47 · Threads.** A reply whose parent is in the listed record prints indented under that parent (one level of
  indent at any depth, with "Replying to @x" kept), in the parent's position; siblings stay in scenario-time order.
  A reply whose parent is not listed (outside the window, filtered out, or noise) prints at its own time, as today.
  Grouping by half-hour follows the thread root's time.

## Acceptance Criteria

**Backend** (`GET /api/staff/exports/report`)

- [ ] With `from`/`to`, every section is built from the posts inside the window (summary, `bySource`, bins, busiest
      window, inject responses and markers, lookalikes, `exercise.scenarioStart/End`, `conductedDate`). With no
      window, the output is byte-identical to today's (regression test).
- [ ] An inject is in the window when its first post is; its response search still runs 30 minutes past `to`.
- [ ] `injectResponses[].ref` and markers carry the MSEL `ExternalRef` only (`null` when there is none);
      `title` is always the item's title. No other contract change for the ref.
- [ ] New `exercise.latestDay: { from, to } | null`: the latest post's scenario date, 00:00–23:59, exercise zone.
- [ ] New `exercise.spansMultipleDays: boolean` for the window in effect (drives date display).
- [ ] Each post carries `threadRootId` (its top-most ancestor inside the listed set, else its own id) and
      `depth` (0 for a root, 1 for any listed descendant). Ordering of `posts` is: roots by scenario time, each followed
      by its listed descendants by scenario time.
- [ ] Isolation, telemetry, 400s, 413 and the 5,000 withheld rule unchanged (the 5,000 counts listed posts).

**Page**

- [ ] Toolbar: a **Latest scenario day** button fills From/To from `exercise.latestDay` and applies; disabled when
      `null`.
- [ ] Header scenario window and conducted date reflect the window; a "Scenario window" line notes "filtered" when a
      window is set.
- [ ] Inject table: title once; MSEL number shown before it only when `ref` is non-null.
- [ ] Chart: inject markers are small numbered badges (1, 2, 3…) at the dashed lines; a key under the chart lists
      "1 · 06:39 · Impersonator: brown water". No overlapping text at any marker density (collision test).
- [ ] When `spansMultipleDays`, every printed time outside the half-hour group headings carries its date
      (inject table delivered/response times, "Taken down at", "Edited · last at").
- [ ] Threads per DF-47: replies indented with a left rule under their listed parent; a reply to an unlisted parent
      prints at its own time; never more than one indent level.
- [ ] Print per DF-46: media ≤ 2.5 in., poster-less tile ≤ 1.25 in., no orphaned section headings, no browser
      header/footer in Chromium/Edge. Screen layout unchanged except threading.
- [ ] NFR-001: thread structure is conveyed in text ("Replying to @x") as well as indentation; the numbered chart key
      is real text; dates are in the text, not only in tooltips.

## Out of Scope

Lookalike rules (story 32); collapsible threads on screen; multi-level indentation; page numbers (need server-side
PDF); a Word export (aar-export 04).

## Technical Notes

- Backend: `ExerciseReportService` already holds every post's facts; apply the window to the fact list before the
  summary/bins/injects/lookalikes, keep the unfiltered count for the 50,000 ceiling, and compute `latestDay` from the
  unfiltered list. Threading: build parent links within the listed set; `threadRootId` walks up while the parent is
  listed.
- Frontend: `features/controller/report/`. Chart markers in `ActivityChart.tsx`; the key can reuse the inject
  response rows. `@page` rule is injected while mounted (story 29 pattern) — change its margin to 0 and move the
  margin into `.sheet` print padding.
- Check the 10/16 UAT PDFs' scenario (Pulse UAT Pilot, window 10-14 09:30 – 10-15 09:30) in the mock or a seeded
  local exercise: replies to The Scoop and to @tom_bull should thread.

## Dependencies

Stories 29 and 30 (merged).

## Tests

Backend: window scoping of each section; no-window regression (byte-identical); inject in/out of window by first
post; response search past `to`; `ref` null without ExternalRef; `latestDay` in a non-UTC zone; `spansMultipleDays`;
`threadRootId`/`depth`/order for nested replies, a reply to an unlisted parent, and a reply to a noise post.
Frontend: Latest scenario day preset; header reflects window; inject title once; numbered markers and key with dense
markers; dates on multi-day spans; thread indentation; print CSS rules (media max height, `@page` margin 0 only while
mounted).
