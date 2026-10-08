# Story: Live world column

**Feature:** Demo polish  ·  **Epic:** E7  ·  **Phase:** 1  ·  **Status:** Not Started
**Requirements:** CTL-030, CTL-031 (lite), CTL-001, NFR-001, COR-001  ·  **Design decisions:** D5-016/D5-017 (continuous-watch surfaces get permanent space), CTL-033 (steering controls absent, not disabled)  ·  **Issue:** #437
**Story ID:** C2  ·  **Stack:** frontend  ·  **Priority:** Must  ·  **Effort:** M  ·  **Wave:** 3
**Home stories:** [`live-monitoring/01`](../live-monitoring/01-monitoring-board.md), [`/02`](../live-monitoring/02-watchlist-columns.md) (lite).

## Context
**As** a controller, **I want** the console to show the live feed itself, **so that** I can watch what
participants see and react to it without opening a second participant tab (demo beat 2). The console's main area
today is nearly empty and carries dev copy. **World: staff (COBRA)** — dense-on-purpose. This column shows
**participant content inside staff chrome**: it must be **never confusable with a participant view** (labelled
panel, monospaced metadata, tight rows, no `PostCard`, no participant skin).

## Acceptance Criteria
- [ ] **Mirror of the world.** `LiveWorldColumn` lists the exercise's posts **including replies**, newest first,
      one dense row each: display name, `@handle`, verified mark as **text + icon**, scenario time
      (`formatScenarioTime`), body text, a media thumbnail (video: poster + "VIDEO 0:24"), the four counts, and
      a "↳ replying to @x" marker — read through `resolveFeed('all', { includeReplies: true })` and the shared
      realtime feed (a staff session reads the same participant-safe payload, without `viewer`); staff styling
      only.
- [ ] **Unmistakably staff.** The column has a titled header "LIVE WORLD" with a visible transport status
      ("REALTIME" / "POLLING" as text), a bordered panel on the console surface, monospaced meta, and **no**
      participant colours, avatars-as-photos hero treatment or `PostCard` component; a test asserts no import
      from `@/features/social/components/post` or `social.module.css`.
- [ ] **Real time without disorientation.** New posts arrive via the realtime feed without a manual refresh;
      when the controller has scrolled down, arrivals buffer behind a "N new" control instead of shifting the
      list; at the top, they insert in place. No wall-clock is shown in a participant-time column (staff may see
      wall-clock in a tooltip).
- [ ] **Filters.** All (default) / hashtag (select from tags seen) / persona (picker over `usePersonas()`); the
      chosen filter survives re-render and shows an active-filter chip with a clear control; counts of matching
      rows are announced politely.
- [ ] **Row actions.** Each row exposes **Reply as…** (calls `onReplyAs(target: ReplyTarget)`) and an optional
      `renderRowActions(post)` slot (C5 mounts **Take down** through it — absent, not disabled, for
      non-controllers); full keyboard: `J`/`K` move the row focus, `R` triggers Reply as…, actions reachable by
      Tab.
- [ ] **Isolation and scope.** Uses only the session's exercise-scoped feed; no `exerciseId` parameter; a feed
      fetch failure shows an inline error with Retry, never an empty "all quiet".

## Out of Scope
Takedown (C5 — only the slot), watchlist columns beyond the three filters, multi-column TweetDeck layout,
storyline/rumor boards, evaluator read-only variant, provenance/origin display (the feed API is
participant-safe), the composer itself (C1), mounting in the console (orchestrator via C4's slot).

## Technical Notes
- Files: implementation.md §4.1 row C2 — `controller/liveWorld/**` (new; not `TakedownAction.tsx`). Props:
  `LiveWorldColumnProps { onReplyAs(target: ReplyTarget): void; renderRowActions?(post: LiveWorldPost):
  ReactNode }` (implementation.md §1.11). The orchestrator mounts it through C4's `liveWorldSlot` and implements
  `onReplyAs` → `ctx.openComposer({ replyTo })`.
- Reuse `resolveFeed`/`assembleFeedView`/`usePersonas`/`realtimeFeed` (services, not UI), COBRA primitives from
  `@/theme/styledComponents` and `staffShellTokens`, `formatMagnitude` for counts, FontAwesome icons. Use
  `role="log"` with `aria-live="off"` (a visible, keyboard-reachable "N new" control instead of a chatty live
  region on a dense staff surface).

## Dependencies
F0 (mocks, types, `ReplyTarget`). Runs with C1, C3, C4, PE-FE. C5 adds the takedown action later. **Live check**
once BP is deployed (media thumbnails, replies).

## Tests
- Row rendering (reply marker, video poster, counts, verified as text), filter behaviour, buffer-vs-insert when
  scrolled, transport label, error + retry, `onReplyAs` payload (`ReplyTarget` with excerpt ≤ 140), keyboard
  shortcuts.
- Two-worlds guard (no participant component/CSS import) and COBRA-only styling; scenario-time rendering; fetch
  uses no `exerciseId`.
