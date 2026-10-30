# Story: `document` media kind — download-only PDF attachment (sniff, size cap, deny-list scan, safe serve)

**Feature:** Press Room  ·  **Epic:** E5  ·  **Phase:** 3 — December release (Tom, 10/21); **re-scoped 10/29 (Q-03: rich text first, PDF is a download-only attachment)**  ·  **Status:** In Review
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
- [x] **Allowlist by magic bytes.** Given an upload whose leading bytes start `%PDF-` (within the first 1024 bytes, per spec tolerance), when sniffed, then it is `Kind = document`, `ContentType = application/pdf`, extension `pdf`; the file name, extension and client `Content-Type` are never inputs, and every previously rejected type (SVG, HTML, executables, Office files) is still rejected (existing sniffer tests stay green). The accepted upload's response carries `{ mediaId, fileName, sizeBytes }` only (no page count, no text extraction).
- [x] **Size cap.** Given a PDF larger than `MediaOptions.MaxDocumentBytes` (default 20 MB, configurable), then the upload is rejected with a readable 413 before it is stored.
- [x] **Deny-list scan (reduced inspection).** Given the whole file's bytes, when scanned within a fixed time and memory budget, then a PDF containing any of `/JS`, `/JavaScript`, `/OpenAction`, `/AA`, `/Launch`, `/EmbeddedFile`, `/XFA`, `/SubmitForm` or `/Encrypt` — **after PDF name-escape (`#xx`) normalization**, so `/J#53` does not slip past — is rejected (422, a reason code, never the raw scanner detail); a polyglot (valid PDF header + other payload) is judged by the same whole-file scan. The scan is documented as best-effort: tokens inside compressed object streams are out of its reach and are the malware-scan hook's and the recipient's reader's problem.
- [~] **Download-only serve.** *(Partially met: attachment + pinned type everywhere; `nosniff` + `CSP: sandbox` on `/dev-media` only — on Azure see Implementation notes 2. Needs Tom's acceptance or the Front Door follow-up before Complete.)* Given a stored document, when served, then it is `application/pdf` pinned in the signed URL's response headers with `Content-Disposition: attachment; filename*=…`, `X-Content-Type-Options: nosniff` and `Content-Security-Policy: sandbox`; **there is no `inline` variant** (a request that asks for inline is served as `attachment` or refused), so a stored PDF can never render in the app origin and can never be served as HTML.
- [ ] **Malware scan.** *(Not met as written — see Implementation notes 1; blocks Complete until Tom decides.)* Given the existing scan hook, then documents pass through it like images/video; a scan failure rejects the upload and nothing is stored.
- [x] **Authorization seam and isolation (XC-001).** Given the participant document endpoint, then `IDocumentUploadAuthorizer` is called and defaults to **deny** (only story 04's implementation — PIO + org grant — allows it; staff uploads follow the existing staff media rule) and the upload is rate-limited like `MediaUploadRateLimiterPolicy`; a document is an exercise-scoped `MediaAsset`, a signed URL or id from another exercise is a 404, and the standing isolation suite includes the document read path.
- [x] **Corpus test.** A checked-in corpus of small hostile PDFs (JS, launch, embedded file, encrypted, name-escaped tokens, truncated, oversize, polyglot) is rejected without hanging, plus one **documented known-miss** fixture (JS inside a compressed object stream) that is accepted and asserted as such so the limitation is explicit rather than assumed.

## Out of Scope
Inline rendering and any PDF viewer (story 03, post-December), page count and page cap, headline suggestion and any text extraction, structural/object-table parsing, server-side rasterization, OCR, DOCX/Office types, general-purpose document uploads for other features, server-side watermark burn-in (PDF-09).

## Technical Notes
Edits `Features/Media/{MediaSniffer,MediaUploadService,MediaDtos,MediaOptions,MediaEndpoints}.cs` additively plus `Features/Media/Documents/**`. The scan is a managed, bounded byte/token pass (no PDF library, no rendering, no native code on hostile input). `MediaKinds.Document` joins `Image`/`Video`. Existing media tests must not change behavior for images/video. Because the page cap and `DocumentInfo.pageCount` are gone, `MediaOptions.MaxDocumentPages` is not added. This story is **no longer the long pole**; it is a clean candidate to cut (see DECEMBER-RELEASE § 4: without it releases are rich text + images only and the composer hides the attach control).

## Dependencies
None (existing media pipeline). Can run with foundation 01, 02.

## Implementation notes (build, 10/29)
Built in `Features/Media/Documents/**` plus additive edits to the media files listed above, `BlobMediaUrlSigner`
(attachment disposition), `DevMediaStartupFilter` (`.pdf` headers), `MediaBlobNames` (`pdf` extension),
`MediaLibraryService` (`kind=document`) and the shared `MediaCallerResolution`. No migration (`Kind` is `nvarchar(16)`).

1. **Malware scan: there is no existing hook.** The AC assumes a malware-scan hook that images/videos pass through;
   none exists (Defender for Storage was deferred post-demo, demo-polish 01/05). Documents take exactly the path
   images/videos take, so a hook added later covers them at the same point. Until then the deny-list scan is the only
   content check on a PDF. **Open for Tom:** accept, or add Defender for Storage as a December infra item.
2. **`nosniff` and `CSP: sandbox` on Azure.** A blob SAS can pin only the standard response headers. The signed URL
   pins `rsct=application/pdf` and `rscd=attachment; filename*=…` inside the signature (editing either breaks the
   URL, so there is no inline variant to ask for), and the file is served from the storage account's origin, never
   the app's. Azure Blob Storage cannot add `X-Content-Type-Options` or `Content-Security-Policy` to a SAS response.
   The Development `/dev-media` mapping, which serves from the API's own origin, sends all three headers.
   **Follow-up if wanted:** a Front Door / CDN rule on the media origin that adds both headers.
3. **Routes.** `POST /api/media/documents` is the only way a PDF enters; `POST /api/media` still answers 415 for one.
   `GET /api/media/documents/{id}` returns `{ mediaId, fileName, sizeBytes, url }` to the uploader or assigned staff;
   every other id (unknown, another exercise's, another participant's, not a document) is the same empty 404.
   Story 04's `/api/press/documents` can wrap the service or alias the route.
4. **Config name.** The cap is `Media:Upload:DocumentMaxBytes` (default 20 MiB), named like its siblings
   `ImageMaxBytes`/`VideoMaxBytes` rather than `MaxDocumentBytes`.
5. **Sniff tightened.** A `%PDF-n.n` header may start anywhere in the first 1024 bytes, but only after an inert
   prefix (printable ASCII, whitespace or ESC; never `<` or `>`). An HTML/SVG/XML or executable polyglot with a PDF
   header near its start is still 415.
6. **Download name.** Stored as the sanitized client name with Unicode format characters (bidi overrides) removed and
   forced to end in `.pdf`, so a PDF/executable polyglot can never be saved under an executable extension.
7. **Scan design — friction, not a defence against a deliberate attacker.** The scan runs while the file streams to
   the store (no buffering) and aborts the stream at the first deny-listed token; a hostile file is 422, the partial blob
   is deleted, no row. Names are matched everywhere, including strings, comments and streams (so a link such as
   `https://host/AA/…` can falsely reject a benign file). One relaxation: `/JS`, `/AA` and `/EF` inside an ENCODED
   (`/Filter`) stream body count only in a run of text, because random compressed data would otherwise falsely reject a
   large photo-heavy PDF. After the last `%%EOF` only whitespace may follow (≤ 1024 bytes). **Known misses** (documented
   on `PdfDenyListScanner`, pinned by the corpus): anything inside an encoded stream — any filter, not only Flate — so one
   encoded object stream evades the scan; and a crafted junk `<</Filter …>> stream` that switches the relaxation on.
   The controls that hold against a deliberate attacker are the default-deny authorizer, attachment-only serving and
   the recipient's reader. `/URI`, `/Named`, `/Rendition`, `/Movie`, `/Sound`, `/SetOCGState` and image codecs are not
   deny-listed by decision; `/GoToR` (NTLM leak via UNC), `/EF`, `/FileAttachment` and `/Collection` are.
8. **Library.** `GET /api/staff/media` lists documents only for `?kind=document`, so the image/video pickers never see
   one; the MSEL import's library read excludes documents too.

## Tests
`MediaSnifferTests` additions; `DocumentScanTests` over the corpus (including the known-miss fixture); endpoint tests for the cap, headers, no-inline and the authorizer default-deny; isolation test.
