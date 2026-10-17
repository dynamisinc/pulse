# Story: Exercise report: a denser printed post record, with engine repeats merged

**Feature:** Demo feedback cut (10/20)  ·  **Phase:** 1 (post-demo)  ·  **Status:** In Review
**Requirements:** EVL-030 (lite), NFR-001  ·  **Decisions:** DF-50  ·  **Issue:** #632
**Stack:** frontend  ·  **Review:** Tier-1  ·  **Priority:** Should  ·  **Effort:** S

## Context

Tom's 10/17 UAT PDF of "Pulse UAT Pilot" (window 10-15 09:30 – 10-17 09:30) ran to 25 pages for 135 posts. About 20
pages were 108 engine posts from one 5-minute burst at 14:45. The engine repeats a few lines per author, interleaved
by author (Tom, Marisol, Marisol, Tom…), and each card printed avatar, counts and source chip on separate lines,
about 6 cards per page.

## Decisions

- **DF-50 · Merge engine repeats; compact print card (Tom, 10/17).**
  - **Merge.** Within one half-hour group, ENGINE posts by the same author with identical text print once, at the
    first one's position. Interleaved repeats merge too. The card says how many posts it stands for, in text:
    "Posted 3 times, 14:45–14:49". A note above the record says how many posts appear as how many cards.
  - **Never merged.** Each of these keeps its own card:
    - participant, controller-as-persona and scripted inject posts;
    - any post with likes, reposts, replies or media;
    - any edited or taken-down post;
    - any thread member (a reply, a nested post, or a root with a listed reply).
  - **Compact card, print only.** A 52 px time column and a 24 px avatar. Counts and tags share one line. Rows are
    5 px apart. That fits about 14 plain cards on a Letter page. Screen layout is unchanged.

## Acceptance Criteria

- [x] Identical engine repeats (same author and text) in a half-hour group print as one card, at the first one's
      position, including interleaved repeats. Nothing is dropped.
- [x] A merged card carries "Posted N times, HH:mm–HH:mm" as text. Dates appear on a multi-day report, and both ends
      are dated when the run crosses midnight.
- [x] A note above the record states "these N posts appear as M cards" whenever anything merged.
- [x] None of the protected posts listed under DF-50 are ever merged.
- [x] Print: the compact card is used (about 12 or more plain posts per Letter page); the screen card is unchanged;
      threads (DF-47), media caps and `@page` rules (DF-46) are unchanged.

## Test coverage (AC → test)

| AC | Tests |
|---|---|
| Merge, interleaved, nothing dropped | `services/mergeRepeats.test.ts` "merges interleaved repeats by author and text, at the first one's position", "never merges the same text from two different authors" |
| "Posted N times" label | `mergeRepeats.test.ts` "states the count and the span", "says "at" when every repeat shares a minute, and dates both ends across midnight"; `pages/ExerciseReportPage.test.tsx` "renders every section from the fixture" (two merged cards) |
| Merged note | `ExerciseReportPage.test.tsx` "renders every section from the fixture" |
| Protected posts | `mergeRepeats.test.ts` "keeps %s as its own card" (10 cases), "keeps thread members whole" |
| Compact print card, screen unchanged | `components/ReportStory31.test.tsx` "prints a compact card: small avatar, tight rows, counts and tags on one line" |

Headless Edge print-to-PDF of the dev mock: plain cards measure about 0.7 in (about 14 per page, previously about
6), the merged cards print "Posted 3 times, 15 Oct 10:10–10:12", and the text layer is intact.

## Out of Scope

Merging noise posts (they are left out of the record by default); a server-side merge; a screen-only "expand repeats"
control.
