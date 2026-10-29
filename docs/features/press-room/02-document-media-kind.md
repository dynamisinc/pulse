# Story: `document` media kind — PDF sniff, size cap, inspection, sandboxed serve

**Feature:** Press Room  ·  **Epic:** E5  ·  **Phase:** 3 — December release (Tom, 10/21)  ·  **Status:** Not Started
**Requirements:** PRS-002, NFR-004  ·  **Design decisions:** D4-001 (headline auto-suggest from the PDF), foundation Q3  ·  **Issue:** —
**Stack:** backend  ·  **World:** platform (serves participant content)  ·  **Wave:** 1  ·  **Effort:** L

## Context
PIOs mostly drop finished PDFs (PRS-002), but the media pipeline today allows only JPEG/PNG/GIF/WebP/MP4/WebM and rejects PDFs on purpose (`MediaSniffer` 415). A PDF is the
riskiest upload class here (scripts, forms, launch actions), so this story adds the `document` kind **narrowly** (PDF only) with structural inspection and a serve path that cannot execute anything.
Foundation reserved `ContentMediaKind = document` and left the pipeline change to E5 (Q3). **December-date risk: this is the long pole and a security surface; it starts in Wave 1.**

## Acceptance Criteria
- [ ] **Allowlist by magic bytes.** Given an upload whose leading bytes start `%PDF-` (within the first 1024 bytes, per spec tolerance), when sniffed, then it is `Kind = document`, `ContentType = application/pdf`, extension `pdf`; the file name, extension and client `Content-Type` are never inputs, and every previously rejected type (SVG, HTML, executables, Office files) is still rejected (existing sniffer tests stay green).
- [ ] **Size and page caps.** Given a PDF larger than `MediaOptions.MaxDocumentBytes` (default 20 MB) or with more than `MaxDocumentPages` (default 60), then the upload is rejected with a readable 413/422 before it is stored; both are configurable.
- [ ] **Structural inspection.** Given a PDF containing JavaScript (`/JS`, `/JavaScript`), `/OpenAction`, `/AA`, `/Launch`, `/EmbeddedFile`, `/XFA`, a submit-form action, or encryption, then the upload is rejected (422, reason code, never the raw parser error), and a polyglot (valid PDF header + other payload) is judged by the inspector, not the sniffer.
- [ ] **Document info.** Given an accepted PDF, then the response carries `DocumentInfo { pageCount, suggestedHeadline }` where the suggestion is the metadata title if sane, else the first non-empty first-page text line (≤ 140 chars, plain text), or `null`; the suggestion is never auto-applied (D4-001: one-click accept is the composer's job).
- [ ] **Sandboxed serve.** Given a stored document, when served, then it is `application/pdf` pinned in the signed URL's response headers, with `X-Content-Type-Options: nosniff`, `Content-Security-Policy: sandbox`, and `Content-Disposition: inline; filename*=` for the viewer or `attachment` for the download link; a stored PDF can never be served as HTML.
- [ ] **Malware scan.** Given the existing scan hook, then documents pass through it like images/video; a scan failure rejects the upload and nothing is stored.
- [ ] **Authorization seam.** Given the participant document endpoint, then `IDocumentUploadAuthorizer` is called and defaults to **deny**; only story 04's implementation (PIO + org grant) allows it, staff uploads follow the existing staff media rule, and the upload is rate-limited like `MediaUploadRateLimiterPolicy`.
- [ ] **Isolation (XC-001).** A document is an exercise-scoped `MediaAsset`; a signed URL or id from another exercise is a 404, and the standing isolation suite includes the document read path.
- [ ] **Corpus test.** A checked-in corpus of small hostile PDFs (JS, launch, embedded file, encrypted, truncated, oversize, polyglot, huge page count, deeply nested objects) is rejected without hanging; inspection has a time and memory budget.

## Out of Scope
Rendering (story 03), headline UI (07), page thumbnails/rasterization server-side, OCR, DOCX/Office types, general-purpose document uploads for other features, server-side watermark burn-in (PDF-09).

## Technical Notes
Edits `Features/Media/{MediaSniffer,MediaUploadService,MediaDtos,MediaOptions,MediaEndpoints}.cs` additively plus `Features/Media/Documents/**`. Inspect with a managed, no-render PDF structure reader (token scan of the object table, not a full renderer) so no native rendering code processes hostile input. `MediaKinds.Document` joins `Image`/`Video`. Existing media tests must not change behavior for images/video.

## Dependencies
None (existing media pipeline). Can run with foundation 01, 02.

## Tests
`MediaSnifferTests` additions; `DocumentInspectorTests` over the corpus; endpoint tests for caps, headers and the authorizer default-deny; isolation test.
