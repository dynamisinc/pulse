# Story: Inline PDF page rendering

**Feature:** Press Room  ·  **Epic:** E5  ·  **Phase:** 3 — **Deferred to Q1 / post-December (Tom, 10/29, Q-03)**  ·  **Status:** Deferred (post-December)
**Requirements:** PRS-002 (rendered inline as pages, plus download), NFR-001, NFR-004  ·  **Design decisions:** D4-001  ·  **Issue:** —
**Stack:** frontend  ·  **World:** participant  ·  **Wave:** 2  ·  **Effort:** M

> **Deferred (post-December).** Tom decided on 10/29 (Q-03) that the December composer is rich text first and a PDF is a **download-only attachment** (story 02, narrowed). Inline PDF rendering is Q1 work. **No GitHub issue is created for this story**; it is listed on the Press feature issue. The December stand-ins are small components inside stories 07 (composer attachment chip) and 09 (release-page attachment block): a file name, size and a "Download PDF" link. The text below is kept as the Q1 starting point; when it is scheduled, re-check it against story 02's download-only serve (an `inline` variant and `pageCount`/`suggestedHeadline` would have to be added back there).

## Context
A dropped PDF must read as the release's body, page by page, on a phone and on a desktop, in the composer and on the release page. One reusable component, no data fetching beyond the signed URL it is given.
The design mocked this; real rendering is build work (D4 STORY-UPDATES §D).

## Acceptance Criteria
- [ ] **Pages render.** Given a signed PDF URL and `pageCount`, when mounted, then pages render in order as images/canvas at container width, lazily (only near-viewport pages render), with a visible per-page label "Page 2 of 5".
- [ ] **Inert document.** Given a PDF with scripts/forms/links, then none execute or navigate: the viewer runs with scripting, XFA and `eval` disabled, in a worker, and makes no network request other than the signed URL; link annotations are not clickable.
- [ ] **Download.** Given a rendered document, then a visible "Download PDF" link (`download` of the signed attachment URL, filename from payload) is always present, including when rendering fails.
- [ ] **Honest failure.** Given a corrupt or unrenderable file, then the component shows an in-fiction-neutral "This document couldn't be displayed — download it instead" with the download link, never a stack trace or library error.
- [ ] **Accessibility (NFR-001).** Each page has a text alternative ("Page 2 of 5 of {fileName}"); the container is a labelled region; keyboard users can reach download and page-jump (PageUp/PageDown scrolls pages); focus is never trapped; reduced-motion respected; touch targets ≥ 44px on coarse pointers; axe clean (#680).
- [ ] **Mobile-first.** Given a 360px viewport, then pages fit width without horizontal scroll, pinch-zoom of the page is allowed, and 60 pages do not exhaust memory (virtualized, off-screen canvases released).
- [ ] **No-enterprise-look.** The viewer chrome uses the wire-room skin tokens via `useOutletSkin`; no COBRA, no default MUI look.
- [ ] **Bundle.** The PDF library is a dynamic import; the participant shell's initial bundle does not grow (checked by the existing bundle-size check or a manual size note).
- [ ] **Watermark (NFR-008).** The viewer is composed inside `WatermarkSlot`/`ExerciseBands` by its parent when `isWatermarkRequired`; the component exposes no way to hide them.

## Out of Scope
Upload (04/07), headline suggestion (07), text selection/search/annotation, print layout, server-side rasterization, zoom controls beyond native pinch.

## Technical Notes
Files: `features/press/pdf/**`. pdf.js (or equivalent) worker with `isEvalSupported: false`, `enableScripting: false`, no XFA, `disableAutoFetch`. Mock PDF fixtures in `features/press/mocks/` (story 01 provides the shape; until then a local fixture). No `Date.now()`/`toLocale*`.

## Dependencies
Story 02's contract (`document` kind + `DocumentInfo`) only — mock-first. Can run with foundation 03, 04, 08, 09, 10, 13, 14.

## Tests
RTL with a mocked worker; an axe test; a hostile-fixture test asserting no navigation; manual mobile check noted.
