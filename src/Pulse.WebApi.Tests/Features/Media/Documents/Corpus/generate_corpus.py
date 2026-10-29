"""Regenerates the press-room story 02 PDF test corpus (deterministic; run from this directory).

    python generate_corpus.py

Every file is small and INERT: the "hostile" constructs carry harmless payloads (an alert string, a .txt name).
They exist only to prove the deny-list scan rejects each construct. The expected verdict per file lives in
DocumentScanCorpusTests.cs (and README.md); keep the three in step when adding a file.
"""
import random
import zlib

HEADER = b"%PDF-1.7\n%\xe2\xe3\xcf\xd3\n"


def build(objects, trailer_extra=b"", header=HEADER):
    """A classic xref-table PDF from {number: body-bytes}, with object 1 as the catalog."""
    out = bytearray(header)
    offsets = {}
    for number in sorted(objects):
        offsets[number] = len(out)
        out += b"%d 0 obj\n" % number + objects[number] + b"\nendobj\n"
    xref = len(out)
    size = max(objects) + 1
    out += b"xref\n0 %d\n0000000000 65535 f \n" % size
    for number in range(1, size):
        out += b"%010d 00000 n \n" % offsets.get(number, 0)
    out += b"trailer\n<< /Size %d /Root 1 0 R" % size + trailer_extra + b" >>\nstartxref\n%d\n%%%%EOF\n" % xref
    return bytes(out)


def stream(dictionary, data):
    return dictionary.rstrip(b">") + b" /Length %d >>\nstream\n" % len(data) + data + b"\nendstream"


PAGE_CONTENT = b"BT /F1 24 Tf 72 720 Td (Fulton County EM - News Release) Tj ET"


def page_objects(page_extra=b"", catalog_extra=b"", extra=None):
    objects = {
        1: b"<< /Type /Catalog /Pages 2 0 R" + catalog_extra + b" >>",
        2: b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        3: b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R"
           b" /Resources << /Font << /F1 5 0 R >> >>" + page_extra + b" >>",
        4: stream(b"<< >>", PAGE_CONTENT),
        5: b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    }
    objects.update(extra or {})
    return objects


def link_annotation(action):
    return {3: b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R"
               b" /Resources << /Font << /F1 5 0 R >> >> /Annots [6 0 R] >>",
            6: b"<< /Type /Annot /Subtype /Link /Rect [72 700 300 730] /A " + action + b" >>"}


def benign_binary_streams():
    """Accepted: 256 KiB of compressed-looking (random) image data — the false-positive guard."""
    rng = random.Random(20261029)
    data = bytes(rng.getrandbits(8) for _ in range(256 * 1024))
    image = stream(b"<< /Type /XObject /Subtype /Image /Width 512 /Height 512 /ColorSpace /DeviceRGB"
                   b" /BitsPerComponent 8 /Filter /FlateDecode >>", data)
    objects = page_objects(extra={6: image})
    objects[3] = objects[3].replace(b"/Font << /F1 5 0 R >>", b"/Font << /F1 5 0 R >> /XObject << /Im1 6 0 R >>")
    return build(objects)


def known_miss_objstm_js():
    """ACCEPTED (documented known miss): catalog + /OpenAction JS action inside a COMPRESSED object stream."""
    inner = {
        1: b"<< /Type /Catalog /Pages 2 0 R /OpenAction 7 0 R >>",
        2: b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        3: b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] >>",
        7: b"<< /Type /Action /S /JavaScript /JS (app.alert\\('corpus known miss'\\)) >>",
    }
    numbers = sorted(inner)
    bodies = b""
    index = b""
    for number in numbers:
        index += b"%d %d " % (number, len(bodies))
        bodies += inner[number] + b"\n"
    payload = zlib.compress(index + bodies)
    out = bytearray(HEADER)
    objstm_offset = len(out)
    out += b"8 0 obj\n" + stream(b"<< /Type /ObjStm /N %d /First %d /Filter /FlateDecode >>" % (len(numbers), len(index)),
                                 payload) + b"\nendobj\n"
    xref_offset = len(out)
    # Cross-reference STREAM: type 2 entries point into object stream 8; 8 and 9 are type 1.
    rows = [(0, 0, 0xFFFF)]
    for number in range(1, 10):
        if number in inner:
            rows.append((2, 8, numbers.index(number)))
        elif number == 8:
            rows.append((1, objstm_offset, 0))
        elif number == 9:
            rows.append((1, xref_offset, 0))
        else:
            rows.append((0, 0, 0))
    raw = b"".join(bytes([t]) + f2.to_bytes(4, "big") + f3.to_bytes(2, "big") for t, f2, f3 in rows)
    xref_data = zlib.compress(raw)
    out += b"9 0 obj\n" + stream(b"<< /Type /XRef /Size 10 /Root 1 0 R /W [1 4 2] /Filter /FlateDecode >>",
                                 xref_data) + b"\nendobj\n"
    out += b"startxref\n%d\n%%%%EOF\n" % xref_offset
    return bytes(out)


def files():
    minimal = build(page_objects())
    yield "benign-minimal.pdf", minimal
    yield "benign-binary-streams.pdf", benign_binary_streams()
    yield "benign-pjl-prefix.pdf", b"\x1b%-12345X@PJL JOB\r\n" + minimal

    # One file per deny-listed construct.
    js_action = b"<< /Type /Action /S /JavaScript /JS (app.alert\\('corpus'\\)) >>"
    yield "js-openaction.pdf", build(page_objects(catalog_extra=b" /OpenAction 6 0 R", extra={6: js_action}))
    yield "js-names-tree.pdf", build(page_objects(
        catalog_extra=b" /Names << /JavaScript 6 0 R >>",
        extra={6: b"<< /Names [(init) 7 0 R] >>", 7: js_action}))
    yield "js-link-rendition.pdf", build(page_objects(extra=link_annotation(b"<< /S /Rendition /JS (app.alert\\(1\\)) >>")))
    yield "aa-page.pdf", build(page_objects(page_extra=b" /AA << /O 6 0 R >>",
                                            extra={6: b"<< /S /URI /URI (https://example.invalid/) >>"}))
    yield "launch.pdf", build(page_objects(extra=link_annotation(b"<< /S /Launch /F (readme.txt) >>")))
    yield "submitform.pdf", build(page_objects(extra=link_annotation(
        b"<< /S /SubmitForm /F << /FS /URL /F (https://example.invalid/collect) >> >>")))
    yield "importdata.pdf", build(page_objects(extra=link_annotation(b"<< /S /ImportData /F (data.fdf) >>")))
    yield "gotoe.pdf", build(page_objects(extra=link_annotation(b"<< /S /GoToE /T << /R /C /N (a.pdf) >> /D [0 /Fit] >>")))
    yield "richmedia.pdf", build(page_objects(extra=link_annotation(b"<< /S /URI /URI (x) >>") | {
        6: b"<< /Type /Annot /Subtype /RichMedia /Rect [0 0 10 10] >>"}))
    yield "xfa.pdf", build(page_objects(catalog_extra=b" /AcroForm << /Fields [] /XFA 6 0 R >>",
                                        extra={6: stream(b"<< >>", b"<xdp:xdp/>")}))
    yield "embedded-file.pdf", build(page_objects(
        catalog_extra=b" /Names << /EmbeddedFiles 6 0 R >>",
        extra={6: b"<< /Names [(readme.txt) 7 0 R] >>",
               7: b"<< /Type /Filespec /F (readme.txt) /EF << /F 8 0 R >> >>",
               8: stream(b"<< /Type /EmbeddedFile >>", b"corpus attachment")}))
    yield "encrypted.pdf", build(page_objects(extra={
        6: b"<< /Filter /Standard /V 1 /R 2 /O <00> /U <00> /P -4 >>"}), trailer_extra=b" /Encrypt 6 0 R /ID [<00><00>]")

    # #xx name-escape normalization: each must be read as the deny-listed name.
    yield "escaped-js.pdf", build(page_objects(extra=link_annotation(b"<< /S /Rendition /J#53 (app.alert\\(1\\)) >>")))
    yield "escaped-javascript-all-hex.pdf", build(page_objects(
        catalog_extra=b" /Names << /#4A#61#76#61#53#63#72#69#70#74 6 0 R >>",
        extra={6: b"<< /Names [(x) 7 0 R] >>", 7: b"<< /S /URI /URI (x) >>"}))
    yield "escaped-openaction.pdf", build(page_objects(
        catalog_extra=b" /Open#41ction 6 0 R", extra={6: b"<< /S /URI /URI (x) >>"}))
    yield "escaped-js-lowercase-hex.pdf", build(page_objects(extra=link_annotation(
        b"<< /S /Rendition /#4a#53 (app.alert\\(1\\)) >>")))

    # A /JS written into an UNCOMPRESSED stream as text is still caught (the stream relaxation is binary-only).
    yield "js-in-text-stream.pdf", build(page_objects(extra={
        6: stream(b"<< >>", b"7 0 obj << /S /Rendition /JS (app.alert\\(1\\)) >> endobj")}))

    # Truncated / polyglot.
    yield "truncated.pdf", minimal[: len(minimal) // 2]
    zip_payload = b"PK\x03\x04" + bytes(random.Random(7).getrandbits(8) for _ in range(4096))
    yield "polyglot-appended-zip.pdf", minimal + zip_payload
    yield "polyglot-html-trailer-with-js.pdf", minimal + b"<html><script>/JavaScript</script></html>\n"
    yield "polyglot-html-prefix.pdf", b"<html><body>" + minimal

    yield "known-miss-objstm-js.pdf", known_miss_objstm_js()


if __name__ == "__main__":
    for name, data in files():
        with open(name, "wb") as handle:
            handle.write(data)
        print(f"{name}: {len(data)} bytes")
