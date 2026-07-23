# Story: Real-time updates — "new posts" pill (no auto-scroll)

**Feature:** Feeds & discovery  ·  **Epic:** E2  ·  **Phase:** 1  ·  **Status:** Complete
**Requirements:** SOC-083 (SOC-071, NFR-002, NFR-001)  ·  **Design decisions:** D1-005  ·  **Issue:** #123

## Context
Feeds update in real time without manual refresh (SOC-083). The D1 design settles **how**: incoming
posts are **buffered behind a sticky "▲ N new posts" pill** (`aria-live=polite`). The feed **never
live-inserts or auto-scrolls** into the reading stream — the reader's scroll position is never moved for
them. Tapping the pill loads the buffered posts and jumps to the top. This is a deliberate
burst-legibility (SOC-071/NFR-002) and accessibility (NFR-001) decision (D1-005). *(This is the answer
to "does the feed auto-scroll to keep the latest on top?" — no: it buffers behind a pill.)*

## Acceptance Criteria
- [x] New posts arriving in real time are **buffered**; a sticky "▲ N new posts" pill shows the count —
      posts do **not** insert into or scroll the feed the user is reading.
- [x] Tapping the pill loads the buffered posts and scrolls to the top; until tapped, the reader's
      position is untouched.
- [x] The pill is an `aria-live=polite` region so assistive tech is notified without focus being
      hijacked (NFR-001); the count stays legible at NFR-002 burst load (buffer, don't render all).
- [x] Real-time transport uses the shared SignalR connection, **falling back to polling** if it
      degrades (NFR-003); observer/read-only mode hides the pill (D1-011).

## Out of Scope
A true "auto-scroll while idle" behavior (explicitly rejected by D1-005 — would require an amendment);
notification aggregation (notifications SOC-071, shares the burst strategy); the feed lists themselves
(stories 01/02).

## Technical Notes
Participant world. A buffer + pill over the feed; SignalR-fed with polling fallback. Shares the burst
approach with notification aggregation. See implementation.md (story 04). **If the product later wants
idle-auto-scroll, log it as an amendment to D1-005 first.**

## Dependencies
stories 01/02 (feeds); the SignalR real-time host; notifications (shared burst strategy). Realizes
SOC-071/NFR-002 legibility.

## Tests
- `src/frontend/src/features/social/hooks/useFeedStream.test.ts` — bounded-ring buffer (count never exceeds cap, keep-newest/evict-oldest), drain-newest-first, disabled=inert (observer), COR-001 no-scope-arg, XC-002 no provenance keys.
- `src/frontend/src/features/social/components/NewPostsPill.test.tsx` — persistent `aria-live="polite"` region (present at count 0, never assertive), real button, `99+` display cap, pluralisation.
- `src/frontend/src/features/social/services/feedStreamSource.test.ts` — realtime source passthrough + live `mode`; mock source baselines on start, narrows via `toParticipantView` (XC-002), COR-001 no-scope-arg.
- `src/frontend/src/features/social/pages/Feed.streamVisibility.test.tsx` — observer/read-only + preview HIDE the pill and the stream is inert (D1-011); full session shows it.
- `src/frontend/src/features/social/pages/Feed.liveAppend.test.tsx` — arrivals buffer behind the pill (no auto-insert/scroll); tap loads at top + clears the pill; list stays polite.
- `src/frontend/src/features/social/hooks/useFeed.test.ts` + `useFeed.race.test.ts` — the reading stream is frozen (baseline resolved once; later appends do not insert), XC-002 preserved.
