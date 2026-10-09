namespace Pulse.WebApi.Features.Media;

/// <summary>
/// A forward-only, read-only wrapper that counts the bytes it hands out and throws
/// <see cref="MediaTooLargeException"/> the moment the total would pass <c>maxBytes</c> — the "enforced while
/// streaming" half of the upload ceiling. It never buffers: each read is passed straight through to the inner
/// stream, so the only bytes in memory are the caller's own read buffer.
/// </summary>
/// <remarks>
/// The over-limit read THROWS rather than returning its bytes, so a consumer (a store) never writes past the
/// ceiling; whatever it already wrote is a partial blob the store deletes.
/// </remarks>
public sealed class MaxLengthReadStream : Stream
{
    private readonly Stream _inner;
    private readonly long _maxBytes;

    /// <summary>Wraps <paramref name="inner"/> with a ceiling of <paramref name="maxBytes"/>.</summary>
    /// <param name="inner">The stream to read from (not disposed by this wrapper).</param>
    /// <param name="maxBytes">The largest total the stream may yield; must be positive.</param>
    public MaxLengthReadStream(Stream inner, long maxBytes)
    {
        ArgumentNullException.ThrowIfNull(inner);
        ArgumentOutOfRangeException.ThrowIfNegativeOrZero(maxBytes);

        _inner = inner;
        _maxBytes = maxBytes;
    }

    /// <summary>The number of bytes handed out so far.</summary>
    public long BytesRead { get; private set; }

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
    public override int Read(Span<byte> buffer) => Account(_inner.Read(buffer));

    /// <inheritdoc />
    public override Task<int> ReadAsync(byte[] buffer, int offset, int count, CancellationToken cancellationToken) =>
        ReadAsync(buffer.AsMemory(offset, count), cancellationToken).AsTask();

    /// <inheritdoc />
    public override async ValueTask<int> ReadAsync(Memory<byte> buffer, CancellationToken cancellationToken = default) =>
        Account(await _inner.ReadAsync(buffer, cancellationToken).ConfigureAwait(false));

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

    private int Account(int read)
    {
        if (read > 0)
        {
            BytesRead += read;
            if (BytesRead > _maxBytes)
            {
                throw new MediaTooLargeException(_maxBytes);
            }
        }

        return read;
    }
}

/// <summary>
/// A forward-only, read-only stream that first yields an already-read prefix (the magic-byte sniff head) and then
/// continues with the rest of the inner stream — so the sniffer can look at the leading bytes without the upload
/// pipeline ever holding more than that small head plus one read buffer.
/// </summary>
public sealed class PrefixedReadStream : Stream
{
    private readonly ReadOnlyMemory<byte> _prefix;
    private readonly Stream _inner;
    private int _prefixOffset;

    /// <summary>Creates the stream.</summary>
    /// <param name="prefix">The bytes to yield first.</param>
    /// <param name="inner">The stream to continue with (not disposed by this wrapper).</param>
    public PrefixedReadStream(ReadOnlyMemory<byte> prefix, Stream inner)
    {
        ArgumentNullException.ThrowIfNull(inner);

        _prefix = prefix;
        _inner = inner;
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
        var fromPrefix = CopyFromPrefix(buffer);
        return fromPrefix > 0 ? fromPrefix : _inner.Read(buffer);
    }

    /// <inheritdoc />
    public override Task<int> ReadAsync(byte[] buffer, int offset, int count, CancellationToken cancellationToken) =>
        ReadAsync(buffer.AsMemory(offset, count), cancellationToken).AsTask();

    /// <inheritdoc />
    public override ValueTask<int> ReadAsync(Memory<byte> buffer, CancellationToken cancellationToken = default)
    {
        var fromPrefix = CopyFromPrefix(buffer.Span);
        return fromPrefix > 0 ? ValueTask.FromResult(fromPrefix) : _inner.ReadAsync(buffer, cancellationToken);
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

    private int CopyFromPrefix(Span<byte> destination)
    {
        var remaining = _prefix.Length - _prefixOffset;
        if (remaining <= 0 || destination.IsEmpty)
        {
            return 0;
        }

        var count = Math.Min(remaining, destination.Length);
        _prefix.Span.Slice(_prefixOffset, count).CopyTo(destination);
        _prefixOffset += count;
        return count;
    }
}
