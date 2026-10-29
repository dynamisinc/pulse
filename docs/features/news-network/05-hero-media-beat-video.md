# Story: Hero media, Beat video player and watermark chip

**Feature:** News network  ·  **Epic:** E4  ·  **Phase:** 3 — December release (Tom, 10/21)  ·  **Status:** Not Started
**Requirements:** NWS-014, NWS-032, NWS-010, NFR-008, NFR-001  ·  **Design decisions:** D3-P1 (slot 6), D3-P2, D2-008  ·  **Issue:** #722
**Stack:** frontend  ·  **World:** participant  ·  **Wave:** E4-1  ·  **Effort:** M

## Context
Slot 6: hero image or inline Beat video with a broadcast-style player. This is the primary Utube-replacement surface (NWS-014). One shared player and one hero slot; **tint, crop aggression and
caption style are skin tokens**, playback anatomy is shared. Articles are a high-risk leak class (NWS-032), so the EXERCISE chip slot, **bottom-right of the hero**, is reserved from day one and
is skin-proof (CANNOT list). Beat clips arrive as ordinary `video` media in the existing pipeline; picking Beat assets via E9 is Phase 4 (upload only now).

## Acceptance Criteria
- [ ] **Hero slot.** Given `item.hero` (image), then it renders via `ContentMedia` (foundation 14) with `alt`, optional caption per `skin.media.captionStyle`, and crop from `skin.media.cropAggression` (CSS `object-fit`/aspect only; the source is never altered); with no hero the slot collapses with no gap and no placeholder art.
- [ ] **Broadcast-style player (NWS-014).** Given a `video` hero, then one shared player renders inline with poster, play/pause, scrub, elapsed/total, mute, captions toggle when tracks exist, and fullscreen of the **wrapper** (not the `<video>`, so overlays survive); chrome tint comes only from `skin.media.playerTint`; Newsline 7's ● LIVE chip is **not** a player feature (it is masthead branding, 03). Playback does not autoplay with sound.
- [ ] **Watermark chip (NWS-032 / NFR-008).** Given `isWatermarkRequired(chromeConfig)`, then `WatermarkSlot` shows the "EXERCISE" chip bottom-right of the hero image **and** of the video frame (not overlapping the control row); when not required the slot's space is still reserved (no layout shift); chrome and watermark are never both off; `ExerciseBands` apply to the media when required. No token key can move, hide or restyle the chip (a test sets hostile `skinOverrides` and asserts the chip is unchanged).
- [ ] **Mobile-first.** Given 360px, the hero is full-bleed to the content edge at its aspect ratio with the player controls ≥ 44px on coarse pointers; the hero never forces horizontal scroll; the poster loads before the video bytes (lazy `preload="metadata"`).
- [ ] **Accessibility.** The player is fully keyboard-operable with visible focus and a labelled control group; reduced-motion pauses any auto-animating poster treatment; captions/transcript affordance is shown if the media provides it, otherwise the player exposes the caption text as the accessible description; contrast of chrome over poster is ≥ 3:1 via a scrim (NFR-001).
- [ ] **Isolation.** Media URLs are the signed URLs from `ContentMediaDto`; a URL for another exercise's asset 403/404s at the media endpoint (extended in the standing isolation suite via story 20); no absolute host is hard-coded (FC-9.3).

## Out of Scope
Beat asset picker (E9, Phase 4); server-side watermark burn-in (PDF-09); live streaming; playlists; a standalone video page (epic §4); player telemetry events (19).

## Technical Notes
Participant world. Files: `src/frontend/src/features/news/hero/{HeroSlot,BroadcastPlayer,PlayerControls}.tsx` + tests. Wrap the existing media/inline-player components under `core/media` and `features/social/components/media` rather than building a second video stack; the inline player is imported from `core/media` (F14 extracts it from the Social components if it is not already there, news FU-9 resolved), so this story never copies it or pulls Social chrome. MUI 9 `sx`-only; FontAwesome icons.

## Dependencies
Foundation 14 (`ContentMedia`, `WatermarkSlot`), 13 (tokens), 02 (fixtures). Can run with 01, 03, 06–14.
