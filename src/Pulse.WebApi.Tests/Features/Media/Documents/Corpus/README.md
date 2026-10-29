# Hostile-PDF corpus (press-room story 02)

Small, **inert** PDFs that pin what the document deny-list scan (`PdfDenyListScanner`) rejects, accepts, and
knowingly misses. Every "hostile" construct carries a harmless payload (an alert string, a `.txt` name).

Regenerate deterministically with `python generate_corpus.py` (run from this directory). The pinned verdicts live in
`DocumentScanCorpusTests.cs`; a file without a verdict, or a verdict without a file, fails the suite.

| File | Construct | Verdict |
|---|---|---|
| `benign-minimal.pdf` | one page of text | accepted |
| `benign-binary-streams.pdf` | 256 KiB of random "compressed image" data | accepted (false-positive guard) |
| `benign-pjl-prefix.pdf` | PJL print-job prefix before `%PDF-` | accepted |
| `js-openaction.pdf` | catalog `/OpenAction` → `/S /JavaScript /JS` | `pdf-active-content` |
| `js-names-tree.pdf` | `/Names << /JavaScript … >>` | `pdf-active-content` |
| `js-link-rendition.pdf` | link `/A << /S /Rendition /JS … >>` (no `/JavaScript`) | `pdf-active-content` |
| `aa-page.pdf` | page `/AA` additional actions | `pdf-active-content` |
| `launch.pdf` | link `/S /Launch` | `pdf-active-content` |
| `submitform.pdf` | link `/S /SubmitForm` | `pdf-active-content` |
| `importdata.pdf` | link `/S /ImportData` | `pdf-active-content` |
| `gotoe.pdf` | link `/S /GoToE` | `pdf-active-content` |
| `richmedia.pdf` | `/Subtype /RichMedia` annotation | `pdf-active-content` |
| `xfa.pdf` | `/AcroForm << /XFA … >>` | `pdf-active-content` |
| `embedded-file.pdf` | `/EmbeddedFiles` name tree + `/Type /EmbeddedFile` | `pdf-embedded-file` |
| `encrypted.pdf` | trailer `/Encrypt` | `pdf-encrypted` |
| `escaped-js.pdf` | `/J#53` | `pdf-active-content` |
| `escaped-js-lowercase-hex.pdf` | `/#4a#53` | `pdf-active-content` |
| `escaped-javascript-all-hex.pdf` | `/#4A#61#76#61…` | `pdf-active-content` |
| `escaped-openaction.pdf` | `/Open#41ction` | `pdf-active-content` |
| `js-in-text-stream.pdf` | `/JS` as text inside an uncompressed stream | `pdf-active-content` |
| `truncated.pdf` | first half of a PDF (no `%%EOF`) | `pdf-truncated` |
| `polyglot-appended-zip.pdf` | PDF + 4 KiB ZIP appended after `%%EOF` | `pdf-truncated` |
| `polyglot-html-trailer-with-js.pdf` | PDF + HTML trailer mentioning `/JavaScript` | `pdf-active-content` |
| `polyglot-html-prefix.pdf` | `<html>` before `%PDF-` | not a PDF (415 at the sniff) |
| `ef-without-type.pdf` | filespec `/EF` with an untyped stream (`/Type /EmbeddedFile` is optional) | `pdf-embedded-file` |
| `fileattachment-annotation.pdf` | `/Subtype /FileAttachment` annotation | `pdf-embedded-file` |
| `gotor-unc.pdf` | link `/S /GoToR` to a UNC path (NTLM leak) | `pdf-active-content` |
| `polyglot-small-trailer.pdf` | PDF + a 40-byte `<script>` after `%%EOF` | `pdf-truncated` |
| `aa-after-binary-in-unfiltered-objstm.pdf` | `/AA` after a binary string, in an UNFILTERED object stream | `pdf-active-content` |
| `known-miss-objstm-js.pdf` | `/OpenAction` + `/JS` inside a **FlateDecode `/ObjStm`** | **accepted — documented known miss** |
| `known-miss-objstm-asciihex-js.pdf` | the same inside an **ASCIIHexDecode `/ObjStm`** (any filter hides names) | **accepted — documented known miss** |
| `known-miss-filter-junk-desync-aa.pdf` | unreferenced junk `<</Filter/X>>stream` before a page whose `/AA` follows binary bytes | **accepted — documented known miss** |

The oversize case is not checked in (a 20 MB file); `DocumentUploadServiceTests` and `DocumentEndpointTests` cover the
413 with a lowered cap.

**False rejections are the safe direction.** Names are matched inside strings too, so a link such as
`/URI (https://host/AA/page)` or text containing `/Launch` rejects a benign file as `pdf-active-content`.

**The known misses are deliberate.** A byte scan cannot see inside encoded data (any filter, not only Flate), and the
scan is best-effort friction by decision (Tom, 10/29), not a defence against a deliberate attacker: the default-deny
upload authorizer, attachment-only serving and the recipient's reader are. The fixtures are accepted and asserted as
such so the limitations are explicit.
