# Story: Brand and profile finish

**Feature:** Demo polish  ·  **Epic:** E2  ·  **Phase:** 1  ·  **Status:** In Progress
**Requirements:** SOC-050, SOC-002, SOC-052, COR-030, COR-024, NFR-001, COR-053  ·  **Design decisions:** D1-003/R-001 (seal `#2D9CDB` fixed), D1-012 (magnitude counts), D1-011  ·  **Issue:** #433
**Story ID:** F5  ·  **Stack:** frontend  ·  **Priority:** Must  ·  **Effort:** M  ·  **Wave:** 2 (**merges last**)
**Home stories:** the D1 backlog and [`profiles-social-graph/01`](../profiles-social-graph/01-profile-page.md) (profile page).

## Context
**As** a viewer, **I want** the app to look like one finished brand — real font, real avatars, a banner, honest
tabs, no half-dark page, no "Simulator" in the tab title — **so that** nothing breaks the fiction (demo beat 1).
Known defects: Figtree is referenced but never loaded; the tab title reads "Pulse - Media Environment
Simulator"; the social CSS reads `--pulse-ac` which nothing sets, so brand colours never reach the feed; a
dark-mode OS gives a half-dark page; profile "Posts & replies" repeats Posts, Media is empty and Likes is
hard-coded `[]` (`Profile.tsx:366-377`). **World: participant** — no COBRA/MUI.

## Acceptance Criteria
- [ ] **Font and document.** Figtree is loaded (self-hosted `@fontsource-variable/figtree`, imported once from
      `main.tsx`; the only new npm dependency in the push) and the social font stack resolves to it;
      `index.html` title is **"Pulse"**, the description contains no "simulator"/"exercise" wording, and an SVG
      favicon (heartbeat mark) + `theme-color` are set.
- [ ] **Brand accent wired.** The social root sets `--pulse-ac` from the resolved brand accent
      (`useBrand()`/`--pulse-brand-accent`), so the Follow button, hashtags, active tab underline and focus
      rings change when the brand accent changes (test with a non-default brand); the verified seal stays the
      fixed `#2D9CDB` (regression test).
- [ ] **Forced light.** `color-scheme: light` and the `@media (prefers-color-scheme: dark)` /
      `[data-theme='dark']` blocks are removed from the social CSS modules this story owns plus the orphan
      modules (`FollowerList`, `WhoToFollow`, `NewPostsPill`, `FollowButton`); as the **last Wave-2 merge**, the
      builder re-runs the sweep on the integrated umbrella for modules the other stories own. A guard test
      scanning `features/social/**/*.css` (via `import.meta.glob ?raw`) finds no dark-mode rule. Under a dark OS
      the page is fully light.
- [ ] **Skeletons.** `FeedSkeleton` (≥ 3 post-shaped placeholders, `role="status"`, `aria-busy`, "Loading posts"
      for assistive tech) and `ProfileSkeleton` replace the plain "Loading…" text, with no layout jump when
      content arrives.
- [ ] **Avatars.** `Avatar` renders `persona.avatarUrl` as a circular `<img alt="" loading="lazy">` (still
      decorative: the name/handle carry identity) and falls back to the monogram/silhouette on error or when
      absent; an unverified lookalike with a similar avatar is allowed and gets **no** extra cue (SOC-052).
- [ ] **Profile.** Banner image from `bannerUrl` (accent-tint fallback), `location` row when present, joined
      date in scenario time (dateline), and real tabs: **Posts** (authored, top-level), **Posts & replies**
      (authored incl. replies via `includeReplies`), **Media** (F2's `MediaTabGrid` over authored media posts),
      **Likes** (own profile only: posts with `viewer.liked`; other profiles show an honest "Likes are private"
      empty state, never fake entries); `Profile` forwards `onOpenThread`/`onHashtagOpen` to its cards.
- [ ] **Tests prove the defects are gone.** Title/favicon/meta assertions on `index.html`; dark-OS emulation
      test; `--pulse-ac` propagation test.

## Out of Scope
Dark mode (deferred; forced light), brand-theme authoring UI, the follower-list redesign, edit profile (PE is
staff-side), notifications, search, per-persona accent, the mobile layout.

## Technical Notes
- Files: implementation.md §4.1 row F5 — `index.html`, `public/favicon.svg` (new),
  `package.json`/`package-lock.json`, `main.tsx`, `index.css`, `social/theme/**`, `components/Avatar.*`,
  `pages/Profile.*`, `components/{FeedSkeleton,ProfileSkeleton}.*`, the orphan CSS modules (force-light only).
  `pages/Feed.tsx` is **not yours** (F4 owns it; F0 already mounts `FeedSkeleton`). Import `MediaTabGrid` from
  F2's file (F0 stub until F2 merges).
- `AvatarPersona` is a `Pick<Persona, …>`; add `avatarUrl` to the pick (the staff world reuses `Avatar` verbatim
  — both worlds get images). The brand tokens come from `participant-shell/brandTokens.ts`; do not edit
  participant-shell.
- Scenario time only (`useScenarioTime`/`formatScenarioTime`); no `new Date()`.

## Dependencies
F0 (types, skeleton/MediaTabGrid stubs, split CSS). Runs with F1–F4, F6 but **merges last** (it sweeps their
CSS). Live check once BP is deployed: avatars/banners/location arrive from `GET /api/personas`.

## Tests
- `Avatar.test.tsx` extended (image, error fallback, org vs human fallback, lookalike parity),
  `Profile.test.tsx` (tabs: Replies uses includeReplies, Likes own-only, banner/location), skeleton a11y roles,
  `--pulse-ac` propagation, seal colour invariant, guard test for no dark-mode CSS, document-head assertions
  (read `index.html` raw).
- Regression: existing `Profile*.test.tsx`, `Avatar.test.tsx`.
