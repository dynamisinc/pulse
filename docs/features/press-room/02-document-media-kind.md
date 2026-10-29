# Story: `document` media kind — download-only PDF attachment (sniff, size cap, deny-list scan, safe serve)

**Feature:** Press Room  ·  **Epic:** E5  ·  **Phase:** 3 — December release (Tom, 10/21); **re-scoped 10/29 (Q-03: rich text first, PDF is a download-only attachment)**  ·  **Status:** Not Started
**Requirements:** PRS-002 (PDF as an attachment), NFR-004  ·  **Design decisions:** foundation Q3, DECEMBER-RELEASE Q-03 (Tom, 10/29)  ·  **Issue:** #739
**Stack:** backend  ·  **World:** platform (serves participant content)  ·  **Wave:** 1  ·  **Effort:** M (was L)

## Context
Tom decided on 10/29 that the release composer is **rich text first** and a PDF is only a **download-only attachment** on a release. Inline PDF rendering (story 03) and everything that depended on parsing a
PDF for display (page counts, headline suggestion, pdf.js) moved to Q1 / post-December. This story therefore shrinks to the minimum a safe download-only attachment needs: recognize a PDF by its bytes, cap
its size, scan it, and serve it so a browser can only **download** it. The media pipeline today rejects PDFs on purpose (`MediaSniffer` 415); foundation reserved `ContentMediaKind = document` and left the pipeline
change to E5 (Q3).

**Is structural inspection still required for download-only? Yes, in a reduced form — a bounded deny-list scan, not a parser.** Download-only removes *our* execution surface (the browser never renders it
in our origin), but it moves the file onto every recipient's own desktop PDF reader, outside any sandbox we control, and that reader is exactly where `/JavaScript`, `/Launch`, `/OpenAction` and embedded files act.
The existing malware-scan hook is signature-based and is not a substitute. A deny-list token scan over the file bytes is cheap, needs no renderer or native parser, and keeps a training platform from handing
hostile PDFs to a room of participants. It is **best-effort defense in depth, not a guarantee** (content inside compressed object streams is opaque to it) — the AC below says so, and the corpus pins what it does
and does not catch. What was dropped from the old story: the page-count cap and extraction, the title/first-line headline suggestion, the deep-nesting/huge-page-count parser hardening, and the inline serve variant.
If Tom wants even less, the scan is the one removable piece (sniff + size cap + malware scan + attachment-only serve would still never execute anything in our origin); the recommendation is to keep it.

## Acceptance Criteria
- [ ] **Allowlist by magic bytes.** Given an upload whose leading bytes start `%PDF-` (within the first 1024 bytes, per spec tolerance), when sniffed, then it is `Kind = document`, `ContentType = application/pdf`, extension `pdf`; the file name, extension and client `Content-Type` are never inputs, and every previously rejected type (SVG, HTML, executables, Office files) is still rejected (existing sniffer tests stay green). The accepted upload's response carries `{ mediaId, fileName, sizeBytes }` only (no page count, no text extraction).
- [ ] **Size cap.** Given a PDF larger than `MediaOptions.MaxDocumentBytes` (default 20 MB, configurable), then the upload is rejected with a readable 413 before it is stored.
- [ ] **Deny-list scan (reduced inspection).** Given the whole file's bytes, when scanned within a fixed time and memory budget, then a PDF containing any of `/JS`, `/JavaScript`, `/OpenAction`, `/AA`, `/Launch`, `/EmbeddedFile`, `/XFA`, `/SubmitForm` or `/Encrypt` — **after PDF name-escape (`#xx`) normalization**, so `/J#53` does not slip past — is rejected (422, a reason code, never the raw scanner detail); a polyglot (valid PDF header + other payload) is judged by the same whole-file scan. The scan is documented as best-effort: tokens inside compressed object streams are out of its reach and are the malware-scan hook's and the recipient's reader's problem.
- [ ] **Download-only serve.** Given a stored document, when served, then it is `application/pdf` pinned in the signed URL's response headers with `Content-Disposition: attachment; filename*=…`, `X-Content-Type-Options: nosniff` and `Content-Security-Policy: sandbox`; **there is no `inline` variant** (a request that asks for inline is served as `attachment` or refused), so a stored PDF can never render in the app origin and can never be served as HTML.
- [ ] **Malware scan.** Given the existing scan hook, then documents pass through it like images/video; a scan failure rejects the upload and nothing is stored.
- [ ] **Authorization seam and isolation (XC-001).** Given the participant document endpoint, then `IDocumentUploadAuthorizer` is called and defaults to **deny** (only story 04's implementation — PIO + org grant — allows it; staff uploads follow the existing staff media rule) and the upload is rate-limited like `MediaUploadRateLimiterPolicy`; a document is an exercise-scoped `MediaAsset`, a signed URL or id from another exercise is a 404, and the standing isolation suite includes the document read path.
- [ ] **Corpus test.** A checked-in corpus of small hostile PDFs (JS, launch, embedded file, encrypted, name-escaped tokens, truncated, oversize, polyglot) is rejected without hanging, plus one **documented known-miss** fixture (JS inside a compressed object stream) that is accepted and asserted as such so the limitation is explicit rather than assumed.

## Out of Scope
Inline rendering and any PDF viewer (story 03, post-December), page count and page cap, headline suggestion and any text extraction, structural/object-table parsing, server-side rasterization, OCR, DOCX/Office types, general-purpose document uploads for other features, server-side watermark burn-in (PDF-09).

## Technical Notes
Edits `Features/Media/{MediaSniffer,MediaUploadService,MediaDtos,MediaOptions,MediaEndpoints}.cs` additively plus `Features/Media/Documents/**`. The scan is a managed, bounded byte/token pass (no PDF library, no rendering, no native code on hostile input). `MediaKinds.Document` joins `Image`/`Video`. Existing media tests must not change behavior for images/video. Because the page cap and `DocumentInfo.pageCount` are gone, `MediaOptions.MaxDocumentPages` is not added. This story is **no longer the long pole**; it is a clean candidate to cut (see DECEMBER-RELEASE § 4: without it releases are rich text + images only and the composer hides the attach control).

## Dependencies
None (existing media pipeline). Can run with foundation 01, 02.

## Tests
`MediaSnifferTests` additions; `DocumentScanTests` over the corpus (including the known-miss fixture); endpoint tests for the cap, headers, no-inline and the authorizer default-deny; isolation test.
