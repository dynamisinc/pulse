# Story: Participant core screens on phones (feed, thread, composer, profile, Explore, Pinned)

**Feature:** Phones and tablets  ·  **Epic:** E2 (cross-cutting)  ·  **Phase:** 2  ·  **Status:** Not Started
**Requirements:** NFR-001, NFR-002, COR-053, D0 §4.6 (mobile-first)  ·  **Design decisions:** none  ·  **Issue:** #524

## Context
Audit and fix every core participant social screen at 360, 390 and 768 px. Participant world: per-brand skin, mobile-first,
scenario time only. Surfaces: Feed, ThreadView, Composer/ReplyComposer/ComposeModal, Profile, ExplorePage, PinnedFeed,
the bottom tab bar. Existing breakpoints are 840/1184/1280 (`SocialChannel.module.css`); this story documents and, where
needed, adds phone breakpoints rather than a parallel layout system.

### Audit findings (10/16, mock server, Chromium touch, 360/390/768)
- **G3:** thread view (`/i/status/:id`) at 360/390. The focused post card overflows its column, so the media and the
  Pin action clip at the right edge (`_focusedWrap` / `_postCard` / `_content` / `_openable`). No page-level
  horizontal scroll hides it, because the overflow is clipped.
- **G4:** touch targets under 44 px on a coarse pointer:
  - post action row: Reply, Repost and Like are about 41–60×23; Pin is 27×23 (every card: feed, thread, profile, hashtag)
  - composer: attach and emoji are 36×36; Post is 71×34; Reply is 79×34
  - `DetailHeader` Back is 36×36; participant Sign out is 40×40
  - `ChannelNav` strip link is 43×28 at 768; the profile "N Followers" link is 101×19

  Inline text links (author names, "Sign in here.") are exempt under the WCAG 2.5.8 inline exception.
- At 360/390 the shell uses the left `NavRail`, not a bottom tab bar. D1 does not specify either pattern, so the rail stays.

## Acceptance Criteria
- [ ] Given each of feed, thread, composer (modal), profile, Explore (search + trending) and Pinned at 360, 390 and 768 px, when loaded with mock data, then `expectNoHorizontalScroll` passes and no text or media is clipped or overlaps the bottom tab bar or the alert bar.
- [ ] G3 (audit): Given the thread view (`/i/status/:id`) at 360 and 390, when the focused post has media and the Pin action, then the card stays inside the column (media and Pin no longer clip at the right edge; offenders were `_focusedWrap`, `_postCard`, `_content`, `_openable`, header) and `expectNoHorizontalScroll` plus a per-element bounding-box check pass.
- [ ] Hit areas (44px) on these screens are delivered by story 18, which runs after this one; this story must not shrink any control below its current size and leaves the post action row, composer buttons, Back and Followers link to 18.
- [ ] Given the Explore tab on a phone, when opened, then Trending is reachable as the mobile tab (D1) and search results rows are tappable at 44px.
- [ ] Given the composer is open on a phone and the on-screen keyboard is up, when typing, then the caret line and the Post button stay visible (visual-viewport aware) and respect safe-area insets (`env(safe-area-inset-*)`).
- [ ] Scenario time (COR-053): every visible timestamp on these screens is scenario time in the exercise time zone (`expectNoWallClock`).
- [ ] No-enterprise-look (D0 §2): no COBRA theme import and no default MUI look is introduced; verified by `social/**` not importing `@/theme/styledComponents`.
- [ ] Accessibility (NFR-001): focus order and landmarks unchanged on collapse; focus indicator visible at 360 px; verified/not-color-only states unchanged; text reflows at 200% zoom without two-dimensional scrolling.
- [ ] User guide: `docs/guide/participant-guide.md` states phone and tablet support and any changed navigation wording; screenshots recaptured by story 08.

## Out of Scope
Media viewer (story 04), alert bar (05), entry/holding screens (03), burst performance (07), new features (DMs, quote-post),
any desktop layout change beyond keeping it intact, PWA.

## Technical Notes
Participant world; CSS Modules under `features/social`. `NavRail`/`RightRail` collapse and `frameMetrics.ts` are the first suspects.
Specs live in `src/frontend/e2e/participant-*.spec.ts` using the story 01 kit. Reuse `--pulse-touch-min: 44px` defined on the social
root. Do not touch `participant-shell/*` (stories 05, 17) or `login/*` (03). Hit-area work in this area is story 18. See `implementation.md` story 02.

## Dependencies
Story 01.

## Tests
`e2e/participant-screens.phone.spec.ts` (new, per screen x viewport); existing `SocialChannel.layout.test.tsx` kept green.
