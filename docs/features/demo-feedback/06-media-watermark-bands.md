# Story: EXERCISE bands on all participant media

**Feature:** Demo feedback cut (10/20)  ·  **Phase:** 1  ·  **Status:** Not Started
**Requirements:** NFR-008  ·  **Decisions:** DF-3, DF-4  ·  **Issue:** #502 (closes #456 item 1)
**Stack:** frontend  ·  **World:** participant  ·  **Review:** Tier-1  ·  **Priority:** Must  ·  **Wave:** 2  ·  **Effort:** M

## Context

"EVERYTHING must be watermarked: a still marking on top and bottom of video." Today the video player shows one
"EXERCISE" label only when the banner is off or the video is full screen, and images show nothing (#456). This story
draws a top band and a bottom band reading `EXERCISE EXERCISE EXERCISE` over every image and video a participant
sees, whenever the exercise's watermark switch is on (DF-3). Story 01 adds `watermark` to `GET /api/chrome-config`.

## Acceptance Criteria

- [ ] `ChromeConfig` gains `watermark: boolean` (type, live parse, mocks; the mock defaults to `true`). A missing field
      from an older API parses as `true` (fail toward marking).
- [ ] `isWatermarkRequired(config)` becomes `config.watermark || !config.enabled` (DF-3); every existing caller keeps
      working, and its tests are updated.
- [ ] One shared `ExerciseBands` overlay draws a band across the top and the bottom of its media box: text
      `EXERCISE EXERCISE EXERCISE`, uppercase, centred, on a semi-opaque dark strip, at least 4.5:1 contrast, scaling
      with the box (readable on a 2-up grid tile, not dominant on a full-screen video). `aria-hidden` (the alt text and
      the compliance banner already carry the meaning); `pointer-events: none`.
- [ ] Bands appear, when required, on: feed and thread image tiles (`MediaGrid`), the inline video player, the
      `MediaViewer` (images and video) **including full screen**, the profile Media tab (`MediaTabGrid`, images and
      video), and the participant composer previews (`ComposerMedia`). The video player's top controls row (duration,
      mute, expand) stays visible and clickable; the old single "EXERCISE" slot is replaced by the bands.
- [ ] When not required (watermark off and banner on), no band renders and nothing shifts layout.
- [ ] No path shows bare media: the existing "fullscreen the wrapper, not the `<video>`" rule still holds.

### Cross-cutting
- [ ] **Two worlds:** no COBRA import on any of these files; the bands use the participant skin tokens.
- [ ] **Accessibility (NFR-001):** keyboard operation of the player and viewer unchanged (existing tests stay green).

## Out of Scope

Staff surfaces (Live world thumbnails, controller pickers). Burned-in media (C1). Server-side marking.

## Tests

`isWatermarkRequired` truth table; each surface renders bands when required and not otherwise; full-screen viewer keeps
them; player controls still reachable; chrome-config parse with the field missing.

Where they live (`src/frontend/src/features/`):

- `isWatermarkRequired` truth table; parse with the field missing (older API), explicit `false`, malformed values;
  mock default `true`: [`participant-shell/chromeConfig.test.tsx`](../../../src/frontend/src/features/participant-shell/chromeConfig.test.tsx),
  [`participant-shell/chromeConfig.default.test.tsx`](../../../src/frontend/src/features/participant-shell/chromeConfig.default.test.tsx),
  [`planner/services/chromeConfigWireContract.test.tsx`](../../../src/frontend/src/features/planner/services/chromeConfigWireContract.test.tsx) (body now carries `watermark`)
- The shared overlay (when / text / `aria-hidden` / click-through / centred uppercase / container-scaled clamp /
  computed >= 4.5:1 over white media / skin tokens / no COBRA or MUI on any banded file; fail toward marking outside
  the providers; shipped default draws them):
  [`social/components/media/ExerciseBands.test.tsx`](../../../src/frontend/src/features/social/components/media/ExerciseBands.test.tsx),
  [`social/components/media/ExerciseBands.default.test.tsx`](../../../src/frontend/src/features/social/components/media/ExerciseBands.default.test.tsx)
- Feed and thread image tiles: [`social/components/media/MediaGrid.bands.test.tsx`](../../../src/frontend/src/features/social/components/media/MediaGrid.bands.test.tsx)
- Inline player (bands both ways, old slot gone, controls row and Play visible and clickable, keyboard unchanged,
  full screen keeps / forces them, bare-`<video>` full screen still routed to the modal):
  [`social/components/media/VideoPlayer.test.tsx`](../../../src/frontend/src/features/social/components/media/VideoPlayer.test.tsx)
- Viewer, images and video (bands hug the image, kept while paging, none when not required, Esc + focus return):
  [`social/components/media/MediaViewer.test.tsx`](../../../src/frontend/src/features/social/components/media/MediaViewer.test.tsx),
  [`social/components/post/PostMediaSlot.test.tsx`](../../../src/frontend/src/features/social/components/post/PostMediaSlot.test.tsx) (Expand fallback modal)
- Profile Media tab: [`social/components/media/MediaTabGrid.bands.test.tsx`](../../../src/frontend/src/features/social/components/media/MediaTabGrid.bands.test.tsx)
- Composer previews: [`social/components/ComposerMedia.bands.test.tsx`](../../../src/frontend/src/features/social/components/ComposerMedia.bands.test.tsx)
- Gate-1 fold-ins: real hooks under the real providers (`watermark: false` + chrome on => no bands after success; no
  providers => bands): [`social/components/media/ExerciseBands.live.test.tsx`](../../../src/frontend/src/features/social/components/media/ExerciseBands.live.test.tsx);
  link-preview photo: [`social/components/post/PostLinkCard.bands.test.tsx`](../../../src/frontend/src/features/social/components/post/PostLinkCard.bands.test.tsx);
  persona banner photo: [`social/pages/Profile.bannerBands.test.tsx`](../../../src/frontend/src/features/social/pages/Profile.bannerBands.test.tsx);
  in-fiction pause/EndEx slot back on the D7 chrome-off rule (chrome on + watermark on => no slot):
  [`participant-shell/components/OverlayLayer/OverlayLayer.test.tsx`](../../../src/frontend/src/features/participant-shell/components/OverlayLayer/OverlayLayer.test.tsx);
  stacking / isolation / span-only markup: `ExerciseBands.test.tsx`
