# Story: Profile page

**Feature:** Profiles & social graph  ·  **Epic:** E2  ·  **Phase:** 1  ·  **Status:** Complete
**Requirements:** SOC-050  ·  **Design decisions:** none  ·  **Issue:** #109

## Context
A profile page per persona/participant: banner, avatar, bio, join date, follower/following counts, and
tabs for Posts / Posts & replies / Media / Likes (SOC-050).

## Acceptance Criteria
- [x] A profile renders banner, avatar (interim R-004 treatment: duotone silhouette for humans,
      monogram for orgs, until COR-024), display name + verified mark when applicable (story 03),
      handle, bio, meta row (location/link/joined), and follower/following counts (magnitude, story 05).
- [x] Tabs show Posts / Posts & replies / Media / Likes, each exercise-scoped (COR-001).
- [x] Join date and post timestamps render in scenario time (COR-053); backdated history (E1 COR-023)
      renders correctly.
- [x] Participant-world styled (Pulse skin, accent-tinted banner per COR-030); no COBRA/default MUI.

## Out of Scope
Follow button behavior (story 02); verification rules (story 03); magnitude math (story 05); suggested
follows (story 04).

## Deferred (tracked follow-ups, Gate-2)
- **WR-003 — RESOLVED (#88).** `Profile` and `ThreadView` (`threads-replies/01`) now read the shell's
  mount variant via `useShellContext()`/`affordancesAvailable()` and thread the resulting `'full'` |
  `'readOnly'` `variant` through to every `<PostCard>` they render — `Profile` via `ProfilePostList`
  across all four tabs, `ThreadView` via its internal `ThreadCard` wrapper for ancestors, the focused
  post, and every visible reply. This mirrors `<Feed>`'s existing pattern exactly (same local
  `CardVariant` shape), so an observer/read-only session now sees the controls genuinely ABSENT (not
  disabled) on all three surfaces, matching D1-011. Counts and post content remain fully visible.
  Covered by new cases in `Profile.test.tsx` and `ThreadView.test.tsx` (mirroring
  `Feed.actions.test.tsx`'s read-only assertions); the pre-existing suites for both were updated to
  wrap a `<ShellContextProvider>` (previously implicit/undeclared) so `useShellContext()` doesn't
  throw outside a shell mount.
- **SUG-001 — RESOLVED (#88, final integration pass).** The detail-to-detail path this entry
  anticipated now exists: an author tap-through (`onOpenProfile`, threaded `SocialChannel` → `<Feed>` /
  `<ThreadView>` / `<HashtagFeed>` → `<PostCard>`) opens an author's profile from inside an already-open
  thread or hashtag feed. `SocialChannel`'s view-swap effect was widened in the same pass: it now moves
  focus into the newly-shown detail region on ANY transition that opens **or replaces** one
  (feed→detail *and* detail→detail), and still returns focus to the feed region on close — so focus is
  never stranded on a control the swap just unmounted (NFR-001). Verified end-to-end in
  `SocialChannel.authorTapThrough.test.tsx` (thread → profile and hashtag feed → profile both assert
  `social-profile-region` has focus). The same fix closes the cross-referenced entries in
  `hashtags-trending/01` and `threads-replies/01`, which describe the other directions of the same
  transition (thread → hashtag feed, hashtag feed → thread).

## Technical Notes
Participant world. Reuses `<PostCard>` for the tabs. Accent-tinted banner uses `--pulse-ac`. See
implementation.md (story 01).

## Dependencies
posts (PostCard); scenario-time (COR-053); persona/participant model.

## Tests
- Component (RTL) — `pages/Profile.test.tsx`:
  - identity hero (SOC-050): banner, R-004 avatar (org monogram), display name, handle, bio, and
    follower count render for a resolved persona — covers AC1.
  - verified signal (SOC-052): the mark renders for `@FairhavenWater` and is absent for the
    `@FairhavenWaterUpd` lookalike — covers AC1's "verified mark when applicable" clause (full
    verification-signal coverage is story 03).
  - tabs (COR-001): all four tabs render and switch; Posts lists only the persona's own posts via
    `<PostCard>`; Media filters to media-bearing posts; Likes/no-posts personas show an honest empty
    state, never fabricated entries (D1-012) — covers AC2.
  - scenario time (COR-053): the joined date renders through the scenario-time formatter in the
    exercise zone from a backdated (pre-exercise, E1 COR-023) `joinedAt` — covers AC3.
  - telemetry (XC-004): exactly one `'view'` event fires on resolve, profile-targeted, scenario-time
    stamped.
  - unknown persona: fails gracefully in-fiction (no crash, no COBRA leak), with no telemetry emitted.
- Component (RTL) — `SocialChannel.navigation.test.tsx` ("profile reachability"): "View my profile"
  opens the session's own persona profile in-channel and "Back to feed" returns — end-to-end
  reachability proof alongside AC4 (participant-world styled, in-channel, no COBRA/default MUI).
- Component (RTL) — `components/PostCard.authorTarget.test.tsx` (#88): the author tap-through target —
  accessible name, author persona id, keyboard activation, never nested in (nor shadowing) the card's
  body-open overlay, and absent entirely when `onOpenProfile` isn't wired (WR-002).
- Component (RTL) — `SocialChannel.authorTapThrough.test.tsx` (#88): tapping an author opens THAT
  author's profile from the feed, from an open thread, and from a hashtag feed; the card's thread-open
  still works; focus lands in the newly-opened detail region on a detail→detail swap (SUG-001).
