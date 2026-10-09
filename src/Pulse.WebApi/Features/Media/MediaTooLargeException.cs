namespace Pulse.WebApi.Features.Media;

/// <summary>
/// Thrown by an <see cref="IMediaStore"/> (through <see cref="MaxLengthReadStream"/>) the moment a streamed upload
/// exceeds its per-kind ceiling. The store deletes the partial blob before letting it escape; the upload endpoint
/// maps it to <c>413</c>.
/// </summary>
public sealed class MediaTooLargeException : Exception
{
    /// <summary>Creates the exception with a default message.</summary>
    public MediaTooLargeException()
        : base("The upload exceeds the size limit for its media kind.")
    {
    }

    /// <summary>Creates the exception with a caller-supplied message.</summary>
    /// <param name="message">The message.</param>
    public MediaTooLargeException(string message)
        : base(message)
    {
    }

    /// <summary>Creates the exception with a caller-supplied message and inner exception.</summary>
    /// <param name="message">The message.</param>
    /// <param name="innerException">The inner exception.</param>
    public MediaTooLargeException(string message, Exception innerException)
        : base(message, innerException)
    {
    }

    /// <summary>Creates the exception for a specific ceiling.</summary>
    /// <param name="maxBytes">The ceiling that was exceeded.</param>
    public MediaTooLargeException(long maxBytes)
        : base($"The upload exceeds the {maxBytes}-byte limit for its media kind.")
    {
        MaxBytes = maxBytes;
    }

    /// <summary>The ceiling that was exceeded, when known.</summary>
    public long? MaxBytes { get; }
}
