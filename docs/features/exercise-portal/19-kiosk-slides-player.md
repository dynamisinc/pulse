# Story: Kiosk slides and auto-cycle player

**Feature:** Exercise portal  ·  **Epic:** E3  ·  **Phase:** 3 — December release (Tom, 10/21)  ·  **Status:** Not Started
**Requirements:** PRT-040, COR-053, NFR-001, NFR-002, NFR-008, XC-001  ·  **Design decisions:** D2 brief (kiosk), D4-010 (one headline string)  ·  **Issue:** —
**Stack:** frontend  ·  **World:** participant (display)  ·  **Wave:** 4  ·  **Effort:** L

## Context
PRT-040: clean full-screen rendering of a chosen surface (portal, a feed, a specific article/post/warning), auto-cycling playlists, and facilitator "show this next". This story is the **content of the frame (18)**: big-screen renderers for each `DisplayTargetKind` and the player that follows `GET /api/display/state`. The auto-cycle is cut-order item 4: without it the screen holds `pinned` targets and honors "show next".

## Acceptance Criteria
- [ ] **Polling.** Given a display session, then `useDisplayState` polls `GET /api/display/state` every 5 s (jittered) with `If-None-Match`, applies a change at the next slide boundary (or at once for `showNext`), and a failed poll keeps the current slide running (no error on screen).
- [ ] **Renderers.** Given each target kind, then a slide renders big and fits the viewport with no scroll: `portal` (lead story + three more, active-alert count, the weather tile at `size='display'` (R-W1), and a short trending list, composed from the module hooks `useTopStories` / `useSocialExcerpt` / press / weather summary), `feed` (six large posts), `content` (headline, hero, and the opening of the sanitized body clamped to fit; a weather product / warning renders its headline **verbatim**), `post` (one post, large), `alerts` (the active alerts list); a target whose data is missing renders nothing and the player advances.
- [ ] **Pinned and playlist.** Given `pinned`, then the slide holds indefinitely and updates live (new data re-renders in place); given `playlist`, then slides advance after `dwellSeconds` in order and loop, with a crossfade (a hard cut under `prefers-reduced-motion`) and no flashing above 3 per second (WCAG 2.3.1).
- [ ] **Show next.** Given `showNext` set by a facilitator, then the screen shows it within one poll interval for one dwell and then resumes the prior mode and position; clearing it before display removes it.
- [ ] **Live content and retractions.** Given `ContentPublished|Revised|Retracted` and `AlertsChanged` on the existing exercise stream, then the visible slide updates in place (a revised headline changes; a retracted target is dropped and the player moves on), and the shell alert bar stays the only alert surface.
- [ ] **Burst legibility (NFR-002).** Given 120 posts/min, then the `feed` slide updates at most once per 4 s, keeps a fixed footprint and never reflows mid-read (the same coalescer as 10, imported, not copied).
- [ ] **Time and watermark.** Given any slide, then every instant is a scenario-time string through `ScenarioDateline`, hero imagery carries `ExerciseBands` when required, and the frame's EXERCISE chip is never covered by a slide (z-order test).
- [ ] **A11y for a display.** Given the screen, then slides have semantic headings and landmarks and meaningful `alt`, contrast follows 18's 7:1, the player never autoplays media with sound, and the pinned mode is the documented non-moving alternative for WCAG 2.2.2 (called out for the ACR, #680).
- [ ] **Isolation.** Given a slide, then it can render only data returned to a display session of this exercise; a cross-exercise permalink in a (forged) state is a 404 and is skipped.

## Out of Scope
Facilitator controls (20), state storage (08), audio/video autoplay, interactivity, non-fiction resources (never on a kiosk).

## Technical Notes
Files: `features/portal/kiosk/{slides,player}/**`. Imports module hooks from 09-12 (not their components) and uses `SlideRegistry` keyed by `DisplayTargetKind`; `registerPortalModule`'s optional `DisplaySlide` is how a module contributes its big form later. R-S1 is foundation story 21 (barrel exports, read-only `PostCard`, `useRecentPublicPosts`); R-W1 is weather story 10's `size='display'` tile.

## Dependencies
08, 09, 10, 11, 12, 18 (frame props type), F14, F15, **F21**, weather 10 (`size='display'`). Can run with 17, 20-22.
