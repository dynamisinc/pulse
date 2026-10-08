# Story: Media pipeline — upload, store, read SAS, staff library

**Feature:** Demo polish  ·  **Epic:** E2  ·  **Phase:** 1  ·  **Status:** Not Started
**Requirements:** SOC-001, XC-009, COR-002, NFR-004, NFR-009, XC-001  ·  **Design decisions:** DP-3, DP-11, DP-12 (see implementation.md §0)  ·  **Issue:** #424
**Story ID:** BM  ·  **Stack:** backend  ·  **Priority:** Must  ·  **Effort:** L  ·  **Wave:** 1b  ·  **Review:** Tier-2 (Tom)
**Home story:** [`posts/01`](../posts/01-post-composition.md) (the "inline video" AC the home story deferred).

## Context
**As** a participant or controller, **I want** to upload a photo or short video and have it stored privately and
served back as a short-lived link, **so that** posts can show real media without the API proxying every byte or
any storage key existing.

Builds the server half of media: `POST /api/media`, the stores, the SAS signer and the staff library (wire
shapes: implementation.md §1.5.1). **Always-Critical at Gate 1:** an upload accepted on extension/MIME header
alone; a SAS that grants more than read on one blob or any account-key fallback; any media/SAS that resolves
outside the caller's exercise. Residual risk (DP-11): a leaked SAS is readable by anyone until it expires (≤ 13
h) — COR-002's "access-checked" is met at *mint* time. Tom signs off on this.

## Acceptance Criteria
- [ ] **Types by magic bytes only.** Given an upload, then the type is decided from the file's leading bytes
      (JPEG `FFD8FF`, PNG, GIF87a/89a, WebP `RIFF…WEBP`, MP4 `ftyp` brand, WebM `1A45DFA3` + `webm` doctype);
      the filename extension and the client `Content-Type` are ignored for the decision. SVG, HTML, executables,
      empty files and a `kind` hint that disagrees with the sniffed kind are **415**; a PNG renamed `.mp4`, an
      `.exe` renamed `.jpg` and a PNG-header/`<script>` polyglot are all rejected or stored strictly as their
      sniffed type.
- [ ] **Streaming with per-kind limits.** Image ≤ 5 MiB, video ≤ 100 MiB, enforced **while streaming** (413,
      partial blob deleted); the multipart body is read with a reader, not `IFormFile`, and is never fully
      buffered in memory (a test with a counting stream proves peak buffering ≤ one chunk); `/api/media` sets
      its own request-size limit (not Kestrel's ~30 MB default).
- [ ] **Stored scoped, returned signed.** A successful upload creates one `MediaAsset` (scope from
      `IExerciseContext`, never the body; `BlobName = {exerciseId}/{id}.{ext}`; `UploadedByHumanId` = the
      session's acting human; `CreatedScenarioTime` from the exercise clock; width/height/duration hints
      validated; `posterMediaId` accepted only for a video and only if it is an image asset in this exercise
      uploaded by the same actor) and returns **201 `MediaAssetView`** with a read URL.
- [ ] **SAS scope and expiry.** `IMediaUrlSigner` mints a **user-delegation** SAS: `sp=r`, `sr=b`, one blob,
      HTTPS only, `ContentType` overridden to the stored type with `inline` disposition; expiry is bucketed
      (`bucketStart(1 h) + 13 h`) so two mints in one bucket return **identical URLs** and every URL has ≥ 12 h
      left. Minting for an asset whose `ExerciseId` ≠ the current scope throws
      `ExerciseScopeViolationException`. The cached delegation key outlives every SAS it signs.
- [ ] **No account key, ever.** `AzureBlobMediaStore`/signer authenticate with `DefaultAzureCredential` against
      `Azure:BlobStorage:ServiceUri`; there is no connection-string or `AccountKey` code path (a test asserts
      construction fails closed without `ServiceUri`). `LocalFileMediaStore` + `/dev-media/*` (range support)
      exist **only** when `ASPNETCORE_ENVIRONMENT=Development`; in Production the route is 404 and the Local
      store is not registered. In Production with the provider unset/`None`, `POST /api/media` answers **503**
      `{error}` while every other endpoint keeps working.
- [ ] **Staff library.** `GET /api/staff/media?kind=&take=` returns the resolved exercise's assets newest-first
      (`fileName`, `uploadedAtScenario`, signed `url`, `posterUrl` for videos), excluding assets that are some
      video's poster. Assigned staff only (401 for anonymous/participant/shared sessions — no staff session; 403
      for staff not assigned to the resolved exercise); another exercise's media is never returned.
- [ ] **Abuse resistance and gating (NFR-009).** Named policy `media-upload` partitions by **session** (not IP),
      default 30/min (`Media:Upload:PermitPerMinute`), answers 429 with `Retry-After`; `POST /api/media` is
      mapped inside `DenyReadOnlySessions()` (read-only → 403); `/api/media` is added to
      `ExerciseLifecycleGatedRoutes.Paths` (archived/build → 403 for participants); participant uploads require
      a persona-bound session of kind `participant` (positive allowlist; staff are identified through
      `ICurrentStaffSessionAccessor`).

## Out of Scope
Malware scanning (Defender, post-demo — NFR-004 half), transcoding/thumbnails, direct-to-Blob upload, codec
inspection (MP4 may be non-H.264; the UI hints H.264), captions (DP-12), deleting blobs on takedown, telemetry
for upload (logged only), the Plan-B SWA media store.

## Technical Notes
- Staff-infra/participant API; no UI. Files: implementation.md §4.1 row BM. Add `Azure.Storage.Blobs` to
  `Pulse.WebApi.csproj` (`Azure.Identity` already flows from `Pulse.Core`). Implements the frozen
  `IMediaStore`/`IMediaUrlSigner` (created by B1 — do not edit them). Ships
  `AddMedia(IConfiguration)`/`MapMedia()` for the orchestrator to wire in `Program.cs`, plus the
  Development-only static-file mapping for `/dev-media` (mapped before auth; **never** by adding to
  `PreAuthAllowlist`).
- Reuse: `PostAttributionResolver`'s acting-human sources (participant: `ICurrentSessionPersonaAccessor`; staff:
  `ICurrentStaffSessionAccessor` → `StaffUserId`), `EngineCockpitStaffAuthorizationFilter` for the library,
  `IExerciseClock` for scenario time, `PostSanitizer.Sanitize` for the file name, the `Follow*` endpoint pattern
  for the read-only group. The orchestrator's UAT smoke test (Sat 10/10): upload an MP4, play it, seek (206),
  read the SAS — in Chrome **and Safari** (Safari will not play non-H.264).
- App Service has a 230 s request timeout; keep demo clips ≤ 30 s / ≤ 20 MB.

## Dependencies
B1 (entities + frozen interfaces). I1 is needed only for UAT (develop against the Local provider). Runs with BP,
B2, B3, B6. PE-BE and S1 depend on this.

## Tests
- **Upload magic-byte validation (first):** a matrix over every allowed type, every disallowed type, mismatched
  extension/MIME/kind hint, polyglot, zero-byte, truncated header —
  `Pulse.WebApi.Tests/Features/Media/MediaSniffingTests.cs`.
- **Limits and streaming:** oversize image/video → 413 + blob deleted; counting-stream buffering bound.
- **SAS scope/expiry:** parse the minted URL — `sp=r`, `sr=b`, `spr=https`, single-blob path, identical URL
  within a bucket, ≥ 12 h remaining, delegation-key (`skoid`) present, cross-exercise asset throws; Azurite is
  optional.
- **Isolation (real SQL/HTTP):** exercise B's session cannot list, mint or attach exercise A's asset; the
  library is scoped; extend the standing suite by adding `MediaIsolationTests.cs`.
- **Production fail-closed:** unset provider → 503 and other routes 200; `/dev-media` 404 outside Development;
  read-only 403; archived exercise 403; rate-limit 429 + `Retry-After`; wiring test file
  `MediaCompositionRootWiringTests.cs` (route answers 401, not 404).
