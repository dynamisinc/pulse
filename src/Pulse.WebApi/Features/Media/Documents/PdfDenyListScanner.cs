namespace Pulse.WebApi.Features.Media.Documents;

/// <summary>
/// The closed vocabulary of reason codes a rejected document upload carries (press-room story 02). A code is the
/// ONLY scanner output a client ever sees: never the matched token, its offset, or any other scanner detail.
/// </summary>
public static class DocumentRejectionReasons
{
    /// <summary>The PDF carries an action, script or form-submission construct (<c>/JS</c>, <c>/OpenAction</c>, …).</summary>
    public const string ActiveContent = "pdf-active-content";

    /// <summary>The PDF carries an embedded file.</summary>
    public const string EmbeddedFile = "pdf-embedded-file";

    /// <summary>The PDF is encrypted, so its contents cannot be inspected.</summary>
    public const string Encrypted = "pdf-encrypted";

    /// <summary>The PDF does not end with an end-of-file marker (truncated, or trailed by another payload).</summary>
    public const string Truncated = "pdf-truncated";
}

/// <summary>The verdict of one document scan.</summary>
/// <param name="Accepted">Whether the document passed.</param>
/// <param name="Reason">One of <see cref="DocumentRejectionReasons"/> when rejected; <c>null</c> when accepted.</param>
public sealed record DocumentScanResult(bool Accepted, string? Reason)
{
    /// <summary>The accepting verdict.</summary>
    public static DocumentScanResult Pass { get; } = new(true, null);

    /// <summary>A rejecting verdict.</summary>
    /// <param name="reason">The reason code.</param>
    /// <returns>The verdict.</returns>
    public static DocumentScanResult Reject(string reason) => new(false, reason);
}

/// <summary>
/// The document structural-scan seam (press-room story 02, <c>IDocumentScanner</c>). A scanner hands out one
/// <see cref="IDocumentScan"/> per upload; the upload pipeline feeds it the bytes AS THEY STREAM to the store, so the
/// file is never buffered whole.
/// </summary>
public interface IDocumentScanner
{
    /// <summary>Starts a scan for one upload.</summary>
    /// <returns>A fresh, single-use scan.</returns>
    IDocumentScan Begin();
}

/// <summary>One in-progress, forward-only document scan. Not thread-safe; one upload owns it.</summary>
public interface IDocumentScan
{
    /// <summary>Feeds the next bytes of the file, in order.</summary>
    /// <param name="bytes">The next chunk.</param>
    void Append(ReadOnlySpan<byte> bytes);

    /// <summary>Ends the scan (the whole file has been appended) and returns the verdict.</summary>
    /// <returns>The verdict.</returns>
    DocumentScanResult Complete();
}

/// <summary>
/// The default <see cref="IDocumentScanner"/>: a bounded, managed deny-list TOKEN scan over every byte of a PDF —
/// not a parser, no renderer, no native code on hostile input (press-room story 02, Tom 10/29).
/// </summary>
/// <remarks>
/// <para>
/// <b>What it rejects.</b> Any PDF NAME token (ISO 32000-1 §7.3.5: a <c>/</c> followed by regular characters up to the
/// next whitespace or delimiter) that, after <c>#xx</c> name-escape decoding, is exactly one of the deny-listed names
/// (so <c>/J#53</c> and <c>/#4A#53</c> are <c>/JS</c>); and a file with no <c>%%EOF</c> within its last 1024 bytes
/// (truncated, or a PDF with another payload appended — a polyglot). Names are case-sensitive, as the spec and every
/// reader treat them. Tokens are matched EVERYWHERE — inside strings, comments and stream data too — so a name a reader
/// might act on is never skipped because the scanner thought it was "only text"; over-matching costs a false
/// rejection, never a miss.
/// </para>
/// <para>
/// <b>The one relaxation, and why.</b> Inside a stream body (entered at a <c>&gt;&gt; stream</c> keyword followed by an
/// end-of-line, outside any comment or string; left at <c>endstream</c>) the two-character names <c>/JS</c> and
/// <c>/AA</c> count only when they sit in a run of text (the eight bytes before the <c>/</c> and the byte after the name
/// are printable ASCII or whitespace). Compressed stream data is effectively random, and a random three-byte
/// <c>/JS</c>/<c>/AA</c> followed by a delimiter occurs about once every ~130 MB per name; without this rule a 20 MB
/// photo-heavy PDF would be falsely rejected roughly one time in seven. Every longer deny-listed name is matched in
/// stream data unconditionally.
/// </para>
/// <para>
/// <b>Best-effort, by decision (known misses).</b> Content inside a COMPRESSED stream — notably a compressed object
/// stream (<c>/Type /ObjStm</c>, PDF 1.5+) holding a <c>/JS</c> action — is opaque to a byte scan and is ACCEPTED; the
/// test corpus pins that miss so it is explicit. A <c>/JS</c> or <c>/AA</c> written into an uncompressed stream body
/// surrounded by binary bytes is likewise missed. Those cases are the recipient's reader's problem (and a future
/// malware-scan hook's); the scan exists to keep ordinary hostile PDFs out of a room of participants, not to be a
/// guarantee.
/// </para>
/// <para>
/// <b>Bounded.</b> One pass, O(1) state (a 32-byte name buffer and a few counters), constant work per byte; the
/// caller's per-kind size ceiling bounds the pass. Once a deny-listed token is found, the rest of the file is only
/// counted.
/// </para>
/// </remarks>
public sealed class PdfDenyListScanner : IDocumentScanner
{
    /// <summary>How close to the end of the file the last <c>%%EOF</c> must be (the spec's reader tolerance).</summary>
    public const int EofWindowBytes = 1024;

    /// <summary>
    /// The deny-listed names (without the leading <c>/</c>) and the reason each maps to. <c>/JS</c>,
    /// <c>/JavaScript</c>, <c>/OpenAction</c>, <c>/AA</c>, <c>/Launch</c>, <c>/XFA</c>, <c>/SubmitForm</c>,
    /// <c>/EmbeddedFile</c> and <c>/Encrypt</c> are the story's list; <c>/EmbeddedFiles</c> (the name-tree key),
    /// <c>/RichMedia</c>, <c>/ImportData</c> and <c>/GoToE</c> are the same constructs under their other names.
    /// </summary>
    public static IReadOnlyDictionary<string, string> DeniedNames { get; } = new Dictionary<string, string>(StringComparer.Ordinal)
    {
        ["JS"] = DocumentRejectionReasons.ActiveContent,
        ["JavaScript"] = DocumentRejectionReasons.ActiveContent,
        ["OpenAction"] = DocumentRejectionReasons.ActiveContent,
        ["AA"] = DocumentRejectionReasons.ActiveContent,
        ["Launch"] = DocumentRejectionReasons.ActiveContent,
        ["XFA"] = DocumentRejectionReasons.ActiveContent,
        ["SubmitForm"] = DocumentRejectionReasons.ActiveContent,
        ["ImportData"] = DocumentRejectionReasons.ActiveContent,
        ["RichMedia"] = DocumentRejectionReasons.ActiveContent,
        ["GoToE"] = DocumentRejectionReasons.ActiveContent,
        ["EmbeddedFile"] = DocumentRejectionReasons.EmbeddedFile,
        ["EmbeddedFiles"] = DocumentRejectionReasons.EmbeddedFile,
        ["Encrypt"] = DocumentRejectionReasons.Encrypted,
    };

    /// <inheritdoc />
    public IDocumentScan Begin() => new PdfDenyListScan();

    /// <summary>Scans a whole in-memory file (tests and small callers).</summary>
    /// <param name="file">The file's bytes.</param>
    /// <returns>The verdict.</returns>
    public static DocumentScanResult Scan(ReadOnlySpan<byte> file)
    {
        var scan = new PdfDenyListScan();
        scan.Append(file);
        return scan.Complete();
    }
}

/// <summary>The single-use state machine behind <see cref="PdfDenyListScanner"/>. See its remarks for the rules.</summary>
internal sealed class PdfDenyListScan : IDocumentScan
{
    /// <summary>Longer than every deny-listed name; a longer name can match nothing and is only consumed.</summary>
    private const int MaxNameBytes = 32;

    /// <summary>How many text bytes must precede a short name inside a stream body for it to count.</summary>
    private const int StreamTextRun = 8;

    /// <summary>Longest keyword the lexer needs to recognize (<c>endstream</c>).</summary>
    private const int MaxKeywordBytes = 9;

    private static readonly int MinDeniedNameLength = PdfDenyListScanner.DeniedNames.Keys.Min(name => name.Length);
    private static readonly int MaxDeniedNameLength = PdfDenyListScanner.DeniedNames.Keys.Max(name => name.Length);
    private static readonly byte[] EofMarker = "%%EOF"u8.ToArray();
    private static readonly byte[] EndStreamMarker = "endstream"u8.ToArray();
    private static readonly int[] EofFailure = Failure(EofMarker);
    private static readonly int[] EndStreamFailure = Failure(EndStreamMarker);

    private readonly byte[] _name = new byte[MaxNameBytes];
    private readonly byte[] _keyword = new byte[MaxKeywordBytes];

    private long _position;
    private string? _rejection;
    private bool _completed;

    // ---- name tokenizer (runs over every byte, in every lexer state) ----
    private bool _inName;
    private int _nameLength;
    private bool _nameOverflow;
    private int _escape; // 0 = none, 1 = saw '#', 2 = saw '#' + one hex digit
    private byte _escapeHigh;
    private bool _nameStartedInStream;
    private int _textRunAtSlash;
    private int _textRun;

    // ---- lexer (only decides where stream bodies are) ----
    private LexState _state = LexState.Normal;
    private int _stringDepth;
    private bool _stringEscape;
    private bool _pendingLessThan;
    private bool _pendingGreaterThan;
    private bool _lastTokenWasDictionaryEnd;
    private int _keywordLength;
    private bool _keywordOverflow;
    private int _endStreamMatched;

    // ---- trailer ----
    private int _eofMatched;
    private long _lastEofEnd = -1;

    private enum LexState
    {
        Normal,
        Comment,
        LiteralString,
        HexString,
        StreamBody,
    }

    /// <inheritdoc />
    public void Append(ReadOnlySpan<byte> bytes)
    {
        if (_completed)
        {
            throw new InvalidOperationException("The scan is complete.");
        }

        foreach (var value in bytes)
        {
            Step(value);
        }
    }

    /// <inheritdoc />
    public DocumentScanResult Complete()
    {
        if (!_completed)
        {
            _completed = true;
            if (_rejection is null && _inName)
            {
                // End of file terminates a name like any delimiter (and is "text" for the stream-body rule).
                EndName(terminatorIsText: true);
            }

            if (_rejection is null && (_lastEofEnd < 0 || _position - _lastEofEnd > PdfDenyListScanner.EofWindowBytes))
            {
                _rejection = DocumentRejectionReasons.Truncated;
            }
        }

        return _rejection is null ? DocumentScanResult.Pass : DocumentScanResult.Reject(_rejection);
    }

    private static bool IsWhitespace(byte value) =>
        value is 0x00 or 0x09 or 0x0A or 0x0C or 0x0D or 0x20;

    private static bool IsDelimiter(byte value) =>
        value is (byte)'(' or (byte)')' or (byte)'<' or (byte)'>' or (byte)'[' or (byte)']' or (byte)'{' or (byte)'}'
            or (byte)'/' or (byte)'%';

    private static bool IsText(byte value) => value is 0x09 or 0x0A or 0x0C or 0x0D || (value >= 0x20 && value <= 0x7E);

    private static int HexValue(byte value) => value switch
    {
        >= (byte)'0' and <= (byte)'9' => value - '0',
        >= (byte)'a' and <= (byte)'f' => value - 'a' + 10,
        >= (byte)'A' and <= (byte)'F' => value - 'A' + 10,
        _ => -1,
    };

    /// <summary>The KMP failure table of <paramref name="pattern"/>, so a rolling match never skips an overlap.</summary>
    private static int[] Failure(byte[] pattern)
    {
        var failure = new int[pattern.Length];
        var k = 0;
        for (var i = 1; i < pattern.Length; i++)
        {
            while (k > 0 && pattern[i] != pattern[k])
            {
                k = failure[k - 1];
            }

            if (pattern[i] == pattern[k])
            {
                k++;
            }

            failure[i] = k;
        }

        return failure;
    }

    private static int Advance(int matched, byte value, byte[] pattern, int[] failure)
    {
        if (matched == pattern.Length)
        {
            matched = failure[matched - 1];
        }

        while (matched > 0 && pattern[matched] != value)
        {
            matched = failure[matched - 1];
        }

        return pattern[matched] == value ? matched + 1 : 0;
    }

    private void Step(byte value)
    {
        _position++;

        // The trailer marker is tracked even after a rejection (cheap), everything else stops.
        _eofMatched = Advance(_eofMatched, value, EofMarker, EofFailure);
        if (_eofMatched == EofMarker.Length)
        {
            _lastEofEnd = _position;
        }

        if (_rejection is not null)
        {
            return;
        }

        var inStream = _state == LexState.StreamBody;
        StepName(value, inStream);
        StepLexer(value);
        _textRun = IsText(value) ? _textRun + 1 : 0;
    }

    private void StepName(byte value, bool inStream)
    {
        if (_inName)
        {
            if (_escape == 1)
            {
                var high = HexValue(value);
                if (high >= 0)
                {
                    _escapeHigh = (byte)high;
                    _escape = 2;
                    return;
                }

                // '#' not followed by two hex digits is a literal '#' (lenient readers); reprocess this byte.
                _escape = 0;
                AppendNameByte((byte)'#');
            }
            else if (_escape == 2)
            {
                var low = HexValue(value);
                if (low >= 0)
                {
                    _escape = 0;
                    AppendNameByte((byte)((_escapeHigh << 4) | low));
                    return;
                }

                _escape = 0;
                AppendNameByte((byte)'#');
                AppendNameByte((byte)(_escapeHigh < 10 ? '0' + _escapeHigh : 'A' + _escapeHigh - 10));
            }

            if (IsWhitespace(value) || IsDelimiter(value))
            {
                EndName(terminatorIsText: IsText(value));
                if (_rejection is not null)
                {
                    return;
                }
            }
            else if (value == (byte)'#')
            {
                _escape = 1;
                return;
            }
            else
            {
                AppendNameByte(value);
                return;
            }
        }

        if (value == (byte)'/')
        {
            _inName = true;
            _nameLength = 0;
            _nameOverflow = false;
            _escape = 0;
            _nameStartedInStream = inStream;
            _textRunAtSlash = _textRun;
        }
    }

    private void AppendNameByte(byte value)
    {
        if (_nameLength < MaxNameBytes)
        {
            _name[_nameLength++] = value;
        }
        else
        {
            _nameOverflow = true;
        }
    }

    private void EndName(bool terminatorIsText)
    {
        _inName = false;
        if (_escape != 0)
        {
            // A name that ends inside an escape keeps the raw characters (they cannot form a deny-listed name).
            _escape = 0;
            return;
        }

        // Every dictionary key is a name, so most names are checked; the length gate skips the allocation for the
        // many that cannot be on the list.
        if (_nameOverflow || _nameLength < MinDeniedNameLength || _nameLength > MaxDeniedNameLength)
        {
            return;
        }

        var name = System.Text.Encoding.Latin1.GetString(_name, 0, _nameLength);
        if (!PdfDenyListScanner.DeniedNames.TryGetValue(name, out var reason))
        {
            return;
        }

        if (_nameStartedInStream && name.Length == 2 && (_textRunAtSlash < StreamTextRun || !terminatorIsText))
        {
            // Two-character name inside stream data with binary around it: compressed-data noise (see remarks).
            return;
        }

        _rejection = reason;
    }

    private void StepLexer(byte value)
    {
        switch (_state)
        {
            case LexState.Comment:
                if (value is 0x0A or 0x0D)
                {
                    _state = LexState.Normal;
                }

                return;

            case LexState.LiteralString:
                if (_stringEscape)
                {
                    _stringEscape = false;
                }
                else if (value == (byte)'\\')
                {
                    _stringEscape = true;
                }
                else if (value == (byte)'(')
                {
                    _stringDepth++;
                }
                else if (value == (byte)')' && --_stringDepth == 0)
                {
                    _state = LexState.Normal;
                }

                return;

            case LexState.HexString:
                if (value == (byte)'>')
                {
                    _state = LexState.Normal;
                }

                return;

            case LexState.StreamBody:
                _endStreamMatched = Advance(_endStreamMatched, value, EndStreamMarker, EndStreamFailure);
                if (_endStreamMatched == EndStreamMarker.Length)
                {
                    _endStreamMatched = 0;
                    _state = LexState.Normal;
                    _lastTokenWasDictionaryEnd = false;
                }

                return;

            default:
                StepNormal(value);
                return;
        }
    }

    private void StepNormal(byte value)
    {
        if (_pendingLessThan)
        {
            _pendingLessThan = false;
            if (value == (byte)'<')
            {
                _lastTokenWasDictionaryEnd = false; // "<<"
                return;
            }

            // A single '<' opened a hex string; this byte is its first content byte (or its end).
            _state = value == (byte)'>' ? LexState.Normal : LexState.HexString;
            _lastTokenWasDictionaryEnd = false;
            return;
        }

        if (_pendingGreaterThan)
        {
            _pendingGreaterThan = false;
            if (value == (byte)'>')
            {
                _lastTokenWasDictionaryEnd = true; // ">>"
                return;
            }
        }

        if (IsWhitespace(value))
        {
            EndKeyword(value);
            return;
        }

        if (IsDelimiter(value))
        {
            EndKeyword(value);
            _lastTokenWasDictionaryEnd = false;
            switch (value)
            {
                case (byte)'%':
                    _state = LexState.Comment;
                    break;
                case (byte)'(':
                    _state = LexState.LiteralString;
                    _stringDepth = 1;
                    _stringEscape = false;
                    break;
                case (byte)'<':
                    _pendingLessThan = true;
                    break;
                case (byte)'>':
                    _pendingGreaterThan = true;
                    break;
            }

            return;
        }

        // A regular character: part of a keyword/number token.
        if (_keywordLength < MaxKeywordBytes)
        {
            _keyword[_keywordLength++] = value;
        }
        else
        {
            _keywordOverflow = true;
        }
    }

    private void EndKeyword(byte terminator)
    {
        if (_keywordLength == 0)
        {
            return;
        }

        var isStream = !_keywordOverflow && _keyword.AsSpan(0, _keywordLength).SequenceEqual("stream"u8);
        var opensBody = isStream && _lastTokenWasDictionaryEnd && terminator is 0x0A or 0x0D;
        _keywordLength = 0;
        _keywordOverflow = false;
        _lastTokenWasDictionaryEnd = false;

        if (opensBody)
        {
            _state = LexState.StreamBody;
            _endStreamMatched = 0;
        }
    }
}
