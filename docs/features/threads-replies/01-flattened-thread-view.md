# Story: Flattened thread view

**Feature:** Threads & replies  ·  **Epic:** E2  ·  **Phase:** 1  ·  **Status:** Complete
**Requirements:** SOC-010  ·  **Design decisions:** D1-006  ·  **Issue:** #98

## Context
Replies form branching threads of unlimited depth. Per D1-006 (open question 1 settled), the thread
renders **X-style flattened**: ancestry chain above the focused post (enlarged), replies below with
"Replying to @handle" lines. Nested/indented was built, reviewed, and rejected (truncates past ~3
levels on real content).

## Acceptance Criteria
- [x] A thread renders **flattened**: ancestor post(s) → focused post (enlarged, with stat row) →
      replies, each reply labelled "Replying to @handle" (D1-006).
- [x] Threads support unlimited reply depth without nested indentation.
- [x] A taken-down reply renders a "This post is unavailable." tombstone **in the thread** (posts
      SOC-005 / D1-009). *(Implementation note, not a deferral: ships as a minimal, plainly-commented
      INTERIM inline element — the canonical `<Tombstone>` (posts/05, soft delete) doesn't exist yet.
      Swaps in with no contract change once posts/05 lands.)*
- [x] Timestamps render in scenario time (COR-053); the view is participant-world styled (Pulse skin,
      no COBRA/default MUI).

## Out of Scope
Reply composition (posts composer, SOC-001); reply counts on feed cards (story 02); nested layout
(rejected).

## Technical Notes
Participant world. Reuses `<PostCard>` (posts/02) for every post here — ancestors, focused, and every
visible reply — never forked. Flattened is the only layout. The taken-down-reply tombstone is a
temporary, plainly-commented interim inline element (in `ThreadView.tsx`) standing in for the canonical
`<Tombstone>` (posts/05), which doesn't exist yet; swapping it in is a no-op contract change when posts/05
ships. See implementation.md (story 01).

## Dependencies
posts (PostCard, Tombstone), scenario-time (COR-053).

## Tests
- Component (RTL) — `components/ThreadView.test.tsx`: renders ancestors → focused (enlarged) → replies as
  one flat list, never nested; every reply is a direct sibling of the thread root; labels each reply
  "Replying to @handle"; renders "This post is unavailable." for a taken-down reply (never its content);
  renders every post's relative time from the injected exercise clock (never wall-clock); emits exactly
  one `'view'` telemetry event on mount; never renders origin/actingHumanId/injectId though the mock data
  carries them (XC-002); exposes the thread as a labelled region (NFR-001).
- Hook (unit) — `hooks/useThread.test.ts`: resolves the ancestor chain/focused post/replies (incl. one
  taken-down); fails closed on a malformed response; never leaks provenance fields onto the resolved
  view models.
