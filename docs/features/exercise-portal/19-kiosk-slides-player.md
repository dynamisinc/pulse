# Story: Kiosk-lite portal board (big-screen portal composition)

**Feature:** Exercise portal  ·  **Epic:** E3  ·  **Phase:** 3 — December release (Tom, 10/21); **re-scoped 10/29 (Q-35: kiosk-lite only; playlist/remote parts moved to post-December)**  ·  **Status:** Not Started
**Requirements:** PRT-040 (kiosk-lite subset), COR-053, NFR-001, NFR-002, NFR-008, XC-001  ·  **Design decisions:** D2 brief (kiosk), D4-010 (one headline string), Q-35  ·  **Issue:** #783
**Stack:** frontend  ·  **World:** participant (display)  ·  **Wave:** 4 (E3-local; combined **CW5**)  ·  **Effort:** M (was L)

## Context
This story is the **content of the frame (18)** for kiosk-lite: one big-screen composition of the portal that updates live as the exercise runs. The original story also covered a per-target slide renderer registry
(`portal`, `feed`, `content`, `post`, `alerts`), a polled `GET /api/display/state`, pinned/playlist modes, an auto-cycle and the facilitator's "show this next". **Tom moved all of the playlist/remote parts to
post-December on 10/29 (Q-35)**: with no display credential and no display state (stories 05/08, Deferred) nothing can steer the screen, so it simply shows the portal and follows live content — the facilitator
changes what the room sees by publishing or pinning content (F17/22), exactly as the portal itself does.

## Acceptance Criteria
- [ ] **One big portal composition.** Given the frame (18) on `/portal?display=1`, then a single board renders big and fits the viewport with no scroll: the lead story (headline, hero) plus three more, the active-alert count, the weather tile at `size='display'` (R-W1) and a short trending list, composed from the module hooks `useTopStories` / `useSocialExcerpt` / press latest / weather summary; a module whose source channel is disabled is absent and the board reflows (F08 rule).
- [ ] **Live updates and retractions.** Given `ContentPublished|Revised|Retracted` and `AlertsChanged` on the existing exercise stream, then the board updates in place (a revised headline changes; a retracted lead is dropped and the next story leads), a weather product or warning headline renders **verbatim** (D4-010), and the shell alert bar stays the only alert surface.
- [ ] **Burst legibility (NFR-002).** Given 120 posts/min, then the trending/social excerpt updates at most once per 4 s, keeps a fixed footprint and never reflows mid-read (the same coalescer as story 10, imported, not copied).
- [ ] **No auto-cycle, no motion hazards.** Given the board, then it is a single non-moving composition (the documented non-moving alternative for WCAG 2.2.2, called out for the ACR #680); any in-place change uses a short fade, a hard cut under `prefers-reduced-motion`, and never flashes above 3 per second (WCAG 2.3.1); media never autoplays with sound.
- [ ] **Time and watermark.** Given the board, then every instant is a scenario-time string through `ScenarioDateline`, hero imagery carries `ExerciseBands` when required, and the frame's EXERCISE chip is never covered by the board (z-order test).
- [ ] **A11y for a display (NFR-001).** Given the screen, then the board has semantic headings and landmarks and meaningful `alt`, contrast follows 18's 7:1, and the severity of any alert state is never color-only.
- [ ] **Isolation (XC-001).** Given the board, then it can render only data returned to a session of this exercise; a forged cross-exercise permalink is a 404 and is skipped.

## Out of Scope
**Deferred (post-December, Q-35):** `useDisplayState` and the 5 s `GET /api/display/state` poll, `pinned` / `playlist` modes, the auto-cycle and dwell, "show this next", the per-kind slide renderers (`feed`, `content`, `post`, `alerts`) and the `SlideRegistry` / `DisplaySlide` extension point, the console (20) and the state API (08). Also: interactivity, audio/video autoplay, non-fiction resources (never on a kiosk).

## Technical Notes
Files: `features/portal/kiosk/board/**` (`KioskPortalBoard`, a big-screen layout over the module hooks). Imports module hooks from 09-12 (not their components); R-S1 is foundation story 21 (barrel exports, read-only `PostCard`, `useRecentPublicPosts`); R-W1 is weather story 10's `size='display'` tile. `registerPortalModule`'s optional `DisplaySlide` stays in the registry type but is unused in December. Replaces the old `kiosk/{slides,player}/**` footprint.

## Dependencies
09, 10, 11, 12 (hooks), 18 (frame props type; same wave, 18 publishes `kiosk/frame/types.ts` first), F14, F15, **F21**, weather 10 (`size='display'`). **No longer depends on 08 (Deferred).** Can run with 17, 21, 22.
