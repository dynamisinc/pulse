namespace Pulse.WebApi.Features.Media;

using Pulse.WebApi.Data;
using Pulse.WebApi.Data.Entities;

/// <summary>
/// Thrown when media must be signed but no store is configured (<c>Provider</c> unset/<c>None</c>, or an
/// <c>Azure</c> provider with no usable <c>ServiceUri</c>). Never results in a bogus URL.
/// </summary>
public sealed class MediaStoreUnavailableException : InvalidOperationException
{
    /// <summary>Creates the exception with a default message.</summary>
    public MediaStoreUnavailableException()
        : base("No media store is configured; no media URL can be minted.")
    {
    }

    /// <summary>Creates the exception with a caller-supplied message.</summary>
    /// <param name="message">The message.</param>
    public MediaStoreUnavailableException(string message)
        : base(message)
    {
    }

    /// <summary>Creates the exception with a caller-supplied message and inner exception.</summary>
    /// <param name="message">The message.</param>
    /// <param name="innerException">The inner exception.</param>
    public MediaStoreUnavailableException(string message, Exception innerException)
        : base(message, innerException)
    {
    }
}

/// <summary>
/// The fail-closed <see cref="IMediaStore"/> for <c>Provider</c> unset/<c>None</c> (and a misconfigured
/// <c>Azure</c>): <see cref="IsConfigured"/> is <c>false</c>, so <c>POST /api/media</c> answers 503 while the
/// rest of the API keeps working. It never stores anything.
/// </summary>
public sealed class UnconfiguredMediaStore : IMediaStore
{
    /// <inheritdoc />
    public bool IsConfigured => false;

    /// <inheritdoc />
    public Task<long> SaveAsync(string blobName, string contentType, Stream content, long maxBytes, CancellationToken cancellationToken) =>
        throw new MediaStoreUnavailableException();

    /// <inheritdoc />
    public Task DeleteAsync(string blobName, CancellationToken cancellationToken) => Task.CompletedTask;
}

/// <summary>
/// The fail-closed <see cref="IMediaUrlSigner"/> paired with <see cref="UnconfiguredMediaStore"/>. It still runs
/// the scope check first (an out-of-scope asset is <see cref="ExerciseScopeViolationException"/>, as everywhere),
/// returns an empty map for an empty batch, and otherwise throws <see cref="MediaStoreUnavailableException"/> —
/// never a fabricated URL.
/// </summary>
public sealed class UnconfiguredMediaUrlSigner : IMediaUrlSigner
{
    private readonly IExerciseContext _exerciseContext;

    /// <summary>Creates the signer.</summary>
    /// <param name="exerciseContext">The request's resolved exercise scope.</param>
    public UnconfiguredMediaUrlSigner(IExerciseContext exerciseContext)
    {
        ArgumentNullException.ThrowIfNull(exerciseContext);
        _exerciseContext = exerciseContext;
    }

    /// <inheritdoc />
    public Task<string> GetReadUrlAsync(MediaAsset asset, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(asset);

        MediaScopeGuard.EnsureInScope(_exerciseContext, [asset]);
        throw new MediaStoreUnavailableException();
    }

    /// <inheritdoc />
    public Task<IReadOnlyDictionary<Guid, string>> GetReadUrlsAsync(IReadOnlyCollection<MediaAsset> assets, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(assets);

        // Nothing to sign needs no scope and no store — the projector asks this for every media-less feed read.
        if (assets.Count == 0)
        {
            return Task.FromResult<IReadOnlyDictionary<Guid, string>>(new Dictionary<Guid, string>());
        }

        MediaScopeGuard.EnsureInScope(_exerciseContext, assets);
        throw new MediaStoreUnavailableException();
    }
}
