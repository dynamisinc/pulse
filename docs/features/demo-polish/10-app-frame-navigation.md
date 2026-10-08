# Story: App frame and navigation

**Feature:** Demo polish  ·  **Epic:** E2  ·  **Phase:** 1  ·  **Status:** In Progress
**Requirements:** COR-004, SOC-053, SOC-083, XC-007, NFR-001  ·  **Design decisions:** D1-013 (frame), D1-011 (absent, not disabled), D1-R1 ("Who to follow")  ·  **Issue:** #429
**Story ID:** F1  ·  **Stack:** frontend  ·  **Priority:** Must  ·  **Effort:** L  ·  **Wave:** 2
**Home stories:** D1-013 ([`D1-social-app/README.md`](../../design/D1-social-app/README.md)), [`participant-shell/03`](../participant-shell/03-channel-nav.md), [`app-shell/01`](../app-shell/01-global-nav.md).

## Context
**As** a PIO signing in, **I want** the app to look like X — a logo, a nav rail, a feed column and a sidebar —
with working URLs and a working Back button, **so that** the first screen reads as a finished product (demo beat
1). Today the social channel is a single 600 px column pinned left with blank space to the right and local
`useState` navigation (`SocialChannel.tsx:163`): no deep links, and Back leaves the app. **World: participant**
— Pulse skin only, **no COBRA, no default MUI look**. The D1 design is `240 nav | 600 main | 344 sidebar`,
left-anchored. Desktop-first (plan decision 5); the mobile bottom tab bar is Could and is **not** built here.

## Acceptance Criteria
- [ ] **Three-column frame.** At ≥ 1184 px the frame is `240 | 600 | 344`, left-anchored (D1-013); below that
      the right rail hides, then the nav rail collapses to an icon rail; the page never scrolls horizontally
      from 390 px to 1440 px. Sticky rail offsets honour the shell's `--pulse-chrome-top/bottom` insets so the
      two EXERCISE banners are never overlapped.
- [ ] **Nav rail.** Pulse heartbeat logomark (brand accent), pill links **Home · Explore · Profile**
      (`aria-current="page"` on the active one; Profile only for a persona-bound session), a **Post** button
      that opens the composer in a modal (focus-trapped, Esc closes, focus returns to the button), and an
      account card (avatar, display name, `@handle`) with **Sign out** via `endSession()` then the login
      redirect. Notifications/Messages are **absent** (not disabled) in this story.
- [ ] **Real URLs and Back.** `/` redirects to `/home`; routes `/home`, `/explore`, `/hashtag/:tag`, `/:handle`,
      `/:handle/status/:id` render the existing feed, explore stub, hashtag feed, profile and thread; browser
      Back/Forward move between them and a reload on any deep link works. An unknown path (e.g. a participant
      typing `/staff/console`) renders `/home` — a participant never reaches or reads a staff route (COR-004),
      and `participantLocationBlindness.test.ts` stays green because the router lives in `SocialChannel`, not in
      `RoleAwareEntry`.
- [ ] **State survives Back.** Returning to `/home` with Back keeps the feed's frozen baseline, the compose
      draft and scroll position (feed stays mounted-hidden or scroll is restored) with no refetch and no
      duplicate feed-view telemetry.
- [ ] **Right rail.** `RightRail` exposes `searchSlot` and `trendingSlot` (empty until F6) and "Who to follow"
      moves into it from the feed column (titled exactly **Who to follow** — never "official", D1-R1);
      in-channel opens (thread, profile, hashtag) are `navigate()` calls supplied to
      `Feed`/`ThreadView`/`HashtagFeed`/`PostCard` through `useSocialNavigation()`.
- [ ] **Navigation adapter (for C6).** All in-channel navigation and route matching go through
      `useSocialNavigation()` from a `SocialNavigationProvider`:
      - The default provider wraps React Router (real URLs, Back).
      - `MemorySocialNavigationProvider` keeps the location in memory and never touches browser history.
      - `SocialRoutes` matches against the adapter's location (`<Routes location={…}>`), so the channel
        never reads or writes `window.location` directly. C6's staff preview mounts the channel under the
        memory provider.
- [ ] **Accessibility (NFR-001).** Landmarks `nav[aria-label=Primary]`, `main`, `aside[aria-label=Sidebar]`; a
      "Skip to main content" link; on every route change focus moves to the main region heading (replaces the
      old feed↔detail focus effect); all controls keyboard-operable with visible focus; nothing is conveyed by
      color alone.
- [ ] **No enterprise look.** Pure CSS Modules reading `--pc-*`/`--pulse-*` tokens; FontAwesome icons; no
      `@mui/*`, no `@/theme/styledComponents`; light only (F5 owns the tokens sweep).

## Out of Scope
Explore/trending/search content (F6; `/explore` shows F0's stub), notifications and messages nav (F7 may add
Notifications), the mobile bottom tab bar, dark-mode toggle, settings menu, PIO column mode, edit-profile,
removing the shell's duplicate sign-out row (orchestrator).

## Technical Notes
- Files: implementation.md §4.1 row F1 (`social/SocialChannel.*`, `social/layout/**`). Mount `<Routes>`
  **inside** `SocialChannel` under the existing `*` catch-all (`createRoleAwareRoutes`); do **not** edit
  `App.tsx` or anything in `features/app-shell` (location-blindness is asserted structurally for
  `RoleAwareEntry.tsx`/`RouteFocusScope.tsx` only). Reserved first segments: `home`, `explore`, `hashtag`,
  `login`, `staff`; `/:handle` resolves case-insensitively through `usePersonas()` and an unknown handle shows
  the existing "This account doesn't exist" state.
- `ComposeModal` wraps the existing `<Composer onPosted={close}>`; F4 makes `onPosted` fire in live mode, so
  auto-close in live mode is verified at Gate 2. `RightRailContent.tsx` is created with "Who to follow" only and
  is **orchestrator-edited** later to mount F6's search/trending. The shell still renders
  `ParticipantSignOutControl`; the orchestrator hides that row once this account card ships.
- Migrate the five existing `SocialChannel*.test.tsx` to `MemoryRouter`; keep their assertions. Scenario time:
  nothing new renders time here.

## Dependencies
F0 (stubs for `ExplorePage`, `FeedSkeleton`; PostCard parts). Runs with F2–F6. Live check: none (no new
backend).

## Tests
- Route table (MemoryRouter): each route renders its page; unknown/staff-like path renders Home; `/:handle`
  unknown handle state; Back/forward; deep link on first render.
- Layout breakpoints via class/width assertions; nav `aria-current`; Post → modal opens, traps focus, Esc
  restores focus; sign-out calls `endSession` and redirects.
- Focus moves to the heading on route change; skip link; landmarks present (axe-style `getByRole`).
- Regression: `participantLocationBlindness.test.ts`, `RoleAwareEntry*.test.tsx`, existing feed tests green; no
  COBRA/MUI import in `social/layout/**` (a grep-style test like `twoWorldsSeparation.test.ts`).
