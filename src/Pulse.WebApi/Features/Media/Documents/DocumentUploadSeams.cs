namespace Pulse.WebApi.Features.Media.Documents;

using System.Globalization;
using System.Text;
using Pulse.WebApi.Data.Entities;

/// <summary>Who is asking to upload a document — server-resolved values only, never form fields.</summary>
/// <param name="ExerciseId">The resolved exercise scope.</param>
/// <param name="ActingHumanId">The participant session's acting human (COR-018).</param>
/// <param name="PersonaId">The persona the participant session is bound to.</param>
public sealed record DocumentUploadRequest(Guid ExerciseId, string ActingHumanId, Guid PersonaId);

/// <summary>
/// The participant document-upload authorization seam (press-room story 02, XC-001). Only a PARTICIPANT upload to
/// <c>POST /api/media/documents</c> consults it; a staff upload follows the existing staff media rule (assigned planner
/// or controller). Press story 04 registers the real implementation (PIO role + an org the human may release as).
/// </summary>
public interface IDocumentUploadAuthorizer
{
    /// <summary>Whether the participant may upload a document.</summary>
    /// <param name="request">The server-resolved caller.</param>
    /// <param name="cancellationToken">Cancels the check.</param>
    /// <returns><c>true</c> to allow.</returns>
    Task<bool> CanUploadAsync(DocumentUploadRequest request, CancellationToken cancellationToken);
}

/// <summary>
/// The default <see cref="IDocumentUploadAuthorizer"/>: DENY. Until a feature registers its own rule, no participant
/// can upload a document. It is registered with <c>TryAddScoped</c>, so a feature replaces it with a plain
/// <c>AddScoped</c> (or <c>Replace</c>) in any order; a feature that also used <c>TryAdd</c> after the media slice would
/// silently stay deny-all (fail closed), so its wiring test must assert the resolved type.
/// </summary>
public sealed class DenyAllDocumentUploadAuthorizer : IDocumentUploadAuthorizer
{
    /// <inheritdoc />
    public Task<bool> CanUploadAsync(DocumentUploadRequest request, CancellationToken cancellationToken) =>
        Task.FromResult(false);
}

/// <summary>
/// A forward-only, read-only pass-through that feeds every byte it hands out to an <see cref="IDocumentScan"/> — the
/// scan sees the file exactly as the store writes it, and the pipeline never holds more than one read buffer.
/// </summary>
public sealed class ScanningReadStream : Stream
{
    private readonly Stream _inner;
    private readonly IDocumentScan _scan;

    /// <summary>Wraps <paramref name="inner"/>.</summary>
    /// <param name="inner">The stream to read from (not disposed by this wrapper).</param>
    /// <param name="scan">The scan to feed.</param>
    public ScanningReadStream(Stream inner, IDocumentScan scan)
    {
        ArgumentNullException.ThrowIfNull(inner);
        ArgumentNullException.ThrowIfNull(scan);

        _inner = inner;
        _scan = scan;
    }

    /// <inheritdoc />
    public override bool CanRead => true;

    /// <inheritdoc />
    public override bool CanSeek => false;

    /// <inheritdoc />
    public override bool CanWrite => false;

    /// <inheritdoc />
    public override long Length => throw new NotSupportedException();

    /// <inheritdoc />
    public override long Position
    {
        get => throw new NotSupportedException();
        set => throw new NotSupportedException();
    }

    /// <inheritdoc />
    public override int Read(byte[] buffer, int offset, int count) => Read(buffer.AsSpan(offset, count));

    /// <inheritdoc />
    public override int Read(Span<byte> buffer)
    {
        var read = _inner.Read(buffer);
        Inspect(buffer[..read]);
        return read;
    }

    /// <inheritdoc />
    public override Task<int> ReadAsync(byte[] buffer, int offset, int count, CancellationToken cancellationToken) =>
        ReadAsync(buffer.AsMemory(offset, count), cancellationToken).AsTask();

    /// <inheritdoc />
    public override async ValueTask<int> ReadAsync(Memory<byte> buffer, CancellationToken cancellationToken = default)
    {
        var read = await _inner.ReadAsync(buffer, cancellationToken).ConfigureAwait(false);
        Inspect(buffer.Span[..read]);
        return read;
    }

    /// <inheritdoc />
    public override void Flush()
    {
    }

    /// <inheritdoc />
    public override long Seek(long offset, SeekOrigin origin) => throw new NotSupportedException();

    /// <inheritdoc />
    public override void SetLength(long value) => throw new NotSupportedException();

    /// <inheritdoc />
    public override void Write(byte[] buffer, int offset, int count) => throw new NotSupportedException();

    /// <summary>
    /// Feeds the scan and, the moment it can only reject, THROWS instead of handing the bytes on — so a hostile file
    /// stops streaming at the first deny-listed token and the store deletes its own partial (the
    /// <see cref="MaxLengthReadStream"/> pattern).
    /// </summary>
    private void Inspect(ReadOnlySpan<byte> bytes)
    {
        _scan.Append(bytes);
        if (_scan.IsRejected)
        {
            throw new DocumentRejectedException();
        }
    }
}

/// <summary>
/// Thrown by <see cref="ScanningReadStream"/> once its scan has found a deny-listed construct. Carries no detail: the
/// upload pipeline reads the reason code from the scan itself.
/// </summary>
public sealed class DocumentRejectedException : Exception
{
    /// <summary>Creates the exception.</summary>
    public DocumentRejectedException()
        : base("The document was rejected by the structural scan.")
    {
    }

    /// <summary>Creates the exception with a message.</summary>
    /// <param name="message">The message.</param>
    public DocumentRejectedException(string message)
        : base(message)
    {
    }

    /// <summary>Creates the exception with a message and inner exception.</summary>
    /// <param name="message">The message.</param>
    /// <param name="innerException">The inner exception.</param>
    public DocumentRejectedException(string message, Exception innerException)
        : base(message, innerException)
    {
    }

    /// <summary>
    /// Whether <paramref name="exception"/> is, or wraps, a <see cref="DocumentRejectedException"/> — a store's SDK may
    /// surface the stream's exception wrapped (parallel block staging).
    /// </summary>
    /// <param name="exception">The caught exception.</param>
    /// <returns><c>true</c> when the scan aborted the stream.</returns>
    public static bool IsIn(Exception? exception)
    {
        for (var current = exception; current is not null; current = current.InnerException)
        {
            if (current is DocumentRejectedException)
            {
                return true;
            }

            if (current is AggregateException aggregate && aggregate.InnerExceptions.Any(IsIn))
            {
                return true;
            }
        }

        return false;
    }
}

/// <summary>
/// The download name of a document and the <c>Content-Disposition</c> it is served with. A document is NEVER
/// served inline: every signed URL pins <c>attachment</c>.
/// </summary>
public static class DocumentDownload
{
    /// <summary>The only content type a document is stored and served as.</summary>
    public const string ContentType = "application/pdf";

    /// <summary>The extension every document's download name ends with.</summary>
    public const string Extension = ".pdf";

    /// <summary>
    /// Normalizes an already-sanitized file name for a document: Unicode format characters (bidi overrides such as
    /// U+202E, which can make <c>cod.exe</c> display as <c>exe.doc</c>) are removed, and the name is forced to end in
    /// <c>.pdf</c> (bounded to the column), so a PDF/executable polyglot can never be saved under an executable
    /// extension.
    /// </summary>
    /// <param name="sanitized">The output of <c>MediaUploadService.SanitizeFileName</c>.</param>
    /// <returns>The download name.</returns>
    public static string NormalizeFileName(string sanitized)
    {
        ArgumentNullException.ThrowIfNull(sanitized);

        var builder = new StringBuilder(sanitized.Length);
        foreach (var character in sanitized)
        {
            if (char.GetUnicodeCategory(character) != UnicodeCategory.Format)
            {
                builder.Append(character);
            }
        }

        var stem = builder.ToString().Trim();
        var extension = Extension;
        if (stem.EndsWith(Extension, StringComparison.OrdinalIgnoreCase))
        {
            // Keep the client's own casing of an existing .pdf extension.
            extension = stem[^Extension.Length..];
            stem = stem[..^Extension.Length];
        }

        stem = stem.TrimEnd().TrimEnd('.');
        if (stem.Length > MediaAsset.MaxOriginalFileNameLength - Extension.Length)
        {
            stem = stem[..(MediaAsset.MaxOriginalFileNameLength - Extension.Length)];
            if (char.IsHighSurrogate(stem[^1]))
            {
                stem = stem[..^1];
            }
        }

        return (stem.Length == 0 ? "document" : stem) + extension;
    }

    /// <summary>
    /// The <c>Content-Disposition</c> for a document's signed URL: <c>attachment</c> with an ASCII <c>filename</c>
    /// fallback and the RFC 5987 <c>filename*</c>.
    /// </summary>
    /// <param name="fileName">The stored (already normalized) download name.</param>
    /// <returns>The header value.</returns>
    public static string ContentDisposition(string? fileName)
    {
        var header = new Microsoft.Net.Http.Headers.ContentDispositionHeaderValue("attachment");
        header.SetHttpFileName(NormalizeFileName(fileName ?? string.Empty));
        return header.ToString();
    }
}
