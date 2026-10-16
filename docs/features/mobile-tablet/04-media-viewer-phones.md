# Story: Media viewer and composer media on phones

**Feature:** Phones and tablets  ·  **Epic:** E2  ·  **Phase:** 2  ·  **Status:** In Review
**Requirements:** NFR-001, NFR-008, NFR-004  ·  **Design decisions:** none  ·  **Issue:** #524

## Context
Photos and video are central to the scenario (customer notes). The full-screen `MediaViewer`, `MediaGrid`, `VideoPlayer`,
`PostMediaSlot` and the composer attach preview (`ComposerMedia`) must be usable on a phone. Participant world; the
"EXERCISE" watermark slot (`ExerciseBands`) must not be cropped or covered.

## Acceptance Criteria
- [x] Given a post with 1-4 images at 360/390/768, when the grid renders, then tiles keep their aspect without overflow and each tile is a tap target of at least 44x44.
- [x] Given the media viewer opened on a phone in portrait and landscape, when displayed, then the close, next and previous controls are at least 44px, sit inside the safe area, are keyboard-operable, and Escape/back closes with focus returned to the originating tile. (Hardware/Android back is not simulated; Escape and Close are.)
- [x] Given a video post, when played on a phone, then the controls are at least 44px, playback does not auto-start with sound, only one video plays at a time (`playbackCoordinator`), and fullscreen/exit works under touch. (Playwright serves a decodable clip; native-fullscreen under touch is not driven by e2e: needs a real device, MT-D7.)
- [x] Watermark slot (NFR-008): the EXERCISE band is visible and uncropped in the grid, the viewer and the composer preview at all three widths; chrome and watermark are never both off.
- [x] Content security (NFR-004): the composer attach flow on a phone (camera roll picker) still enforces the existing MIME/size validation and shows the existing error text; no new upload path is added.
- [x] Accessibility (NFR-001): images keep alt text; the viewer traps focus and announces open/close; pinch-zoom is not disabled by the page. (Open is announced via aria-describedby on the dialog; close is signalled by focus returning to the tile.)
- [x] User guide: `docs/guide/participant-guide.md` notes attaching photos/video from a phone; screenshot via story 08. (Text added; the screenshot is story 08.)

## Out of Scope
In-app camera capture (PDF-08 #531), server-side burn-in (PDF-09 #532), GIF picker (PDF-10), offline media cache (PDF-02).

## Technical Notes
Files: `features/social/components/media/*`, `components/ComposerMedia.*`. Use `core/media` helpers; mock media under
`public/mock-media`. Participant skin only. See `implementation.md` story 04.

## Dependencies
Story 01.

## Tests
`e2e/media-viewer.phone.spec.ts`; existing `ComposerMedia.bands.test.tsx` and media tests stay green.
