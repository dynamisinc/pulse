# Story: Image re-encode and EXIF strip (SkiaSharp)

**Feature:** Identity, auth & roles  ·  **Epic:** E1  ·  **Phase:** 1  ·  **Status:** Not Started
**Requirements:** NFR-004, NFR-009  ·  **Design decisions:** ADMIN-IDENTITY-MODEL §4.1 (Q3 signed off)  ·  **Issue:** #579
**Stack:** backend  ·  **Review tier:** Tier-2 (content security)  ·  **Wave:** A2

## Context
Phone photos carry GPS EXIF and are stored byte-for-byte today. All image uploads are decoded and re-encoded to WebP with metadata dropped ([`docs/design/ADMIN-IDENTITY-MODEL.md`](../../design/ADMIN-IDENTITY-MODEL.md) §4.1). Library: **SkiaSharp** (MIT) + `SkiaSharp.NativeAssets.Linux.NoDependencies`; ImageSharp and Magick.NET rejected.

## Acceptance Criteria
- [ ] **Strip.** Given an upload with GPS EXIF, when processed, then the stored asset has no EXIF/XMP/ICC metadata (asserted by re-reading the blob).
- [ ] **Re-encode.** Every image upload through `MediaUploadService` is decoded and stored as WebP; avatars are capped at 1024 px on the long edge, other images at the existing cap.
- [ ] **Reject.** Undecodable, mismatched-MIME, over-size or decompression-bomb images (pixel-count cap) are refused with a specific error; nothing is stored.
- [ ] **Runs on App Service Linux** with the NoDependencies native assets (smoke test in CI container).
- [ ] Non-image media paths (video, audio) are unchanged.
- [ ] Isolation: blob prefixes are unchanged (exercise prefix, or the org people prefix); a foreign-exercise and a foreign-org media id return the bare 404 on every upload/serve route touched.
- [ ] Telemetry: upload emits its existing XC-004 event and now records the re-encode outcome (no filenames/EXIF content).
- [ ] Content security (NFR-004): the output carries no active content; a stored script in metadata cannot execute in another session.
- [ ] User guide (C5): `docs/guide/planner-guide.md` notes that uploads are converted to WebP and location data is removed, or the PR states "no guide impact".

## Out of Scope
Video transcoding; server-side watermark burn-in; the avatar routes (23).

## Technical Notes
Backend only. `MediaUploadService.cs`, new `ImageNormalizer`. Package licences recorded in `docs/` third-party notes. **Orchestrator clearance first:** the wave EF migration, `Program.cs` route-group lines, and `App.tsx` / `staffRouteRegistry.tsx` additive lines go through the orchestrator's end-of-wave wiring commit; builders export one `Add*()`/`Map*()` line and do not edit them.

## Dependencies
Wave A2, first (blocks 23, and persona-management 06 media).

## Tests
Golden-image tests (EXIF GPS fixture), bomb fixture, MIME mismatch, linux-container smoke test.
