namespace Pulse.WebApi.Features.Media;

using Azure.Core;
using Azure.Storage.Blobs;
using Azure.Storage.Blobs.Models;
using Azure.Storage.Sas;
using Microsoft.Extensions.Options;
using Pulse.WebApi.Data;
using Pulse.WebApi.Data.Entities;

/// <summary>
/// The source of Azure user-delegation keys — the ONLY key material a read SAS is ever signed with. A user
/// delegation key is issued to the app's Entra identity (managed identity) by the storage service; it is not the
/// storage account key, and the account key is never read anywhere (COR-002).
/// </summary>
public interface IUserDelegationKeySource
{
    /// <summary>The storage account name (part of the SAS's canonicalized resource).</summary>
    string AccountName { get; }

    /// <summary>Requests a user delegation key valid over the given window.</summary>
    /// <param name="startsOn">The key's start.</param>
    /// <param name="expiresOn">The key's expiry (at most 7 days after the request).</param>
    /// <param name="cancellationToken">Cancels the request.</param>
    /// <returns>The key.</returns>
    Task<UserDelegationKey> GetUserDelegationKeyAsync(DateTimeOffset startsOn, DateTimeOffset expiresOn, CancellationToken cancellationToken);
}

/// <summary>The production <see cref="IUserDelegationKeySource"/>: <c>Get User Delegation Key</c> on the keyless service client.</summary>
public sealed class BlobServiceUserDelegationKeySource : IUserDelegationKeySource
{
    private readonly BlobServiceClient _serviceClient;

    /// <summary>Creates the source. Throws (fails closed) without a usable <c>ServiceUri</c>.</summary>
    /// <param name="options">The storage options.</param>
    /// <param name="credential">The token credential — the managed identity in production (<see cref="MediaEndpoints.CreateCredential"/>).</param>
    /// <param name="clientOptions">
    /// Optional client options (tests substitute the transport). When omitted, the production options:
    /// <see cref="MediaBlobServiceClientFactory.MaxRetries"/> and <see cref="MediaBlobServiceClientFactory.SigningNetworkTimeout"/>.
    /// </param>
    public BlobServiceUserDelegationKeySource(
        IOptions<MediaStorageOptions> options,
        TokenCredential credential,
        BlobClientOptions? clientOptions = null)
    {
        ArgumentNullException.ThrowIfNull(options);
        ArgumentNullException.ThrowIfNull(credential);

        _serviceClient = MediaBlobServiceClientFactory.Create(
            options.Value,
            credential,
            clientOptions ?? MediaBlobServiceClientFactory.CreateClientOptions(MediaBlobServiceClientFactory.SigningNetworkTimeout));
    }

    /// <inheritdoc />
    public string AccountName => _serviceClient.AccountName;

    /// <inheritdoc />
    public async Task<UserDelegationKey> GetUserDelegationKeyAsync(
        DateTimeOffset startsOn, DateTimeOffset expiresOn, CancellationToken cancellationToken)
    {
        var response = await _serviceClient
            .GetUserDelegationKeyAsync(startsOn, expiresOn, cancellationToken)
            .ConfigureAwait(false);
        return response.Value;
    }
}

/// <summary>
/// The process-wide user-delegation-key cache (Singleton). A key is reused while it OUTLIVES the SAS about to be
/// signed with it, and is refreshed otherwise — so the key always outlives every SAS it signs, and (because the
/// SAS expiry only changes at bucket boundaries) every mint inside one bucket uses the same key and yields a
/// byte-identical URL.
/// </summary>
/// <remarks>
/// <para>
/// <b>A storage-auth outage fails fast (Wave 1b Gate-2 M-1).</b> Fetches are serialized behind one gate, so
/// without a bound every reader during an outage (RBAC still propagating, a bad <c>ServiceUri</c>, Entra hiccups)
/// would queue behind the previous reader's slow failure: the N-th reader waits about N × the attempt time. So:
/// </para>
/// <list type="bullet">
/// <item>each fetch is bounded by <see cref="DefaultFetchTimeout"/> (a linked token, so the caller's cancellation
/// still applies); hitting the bound is a failure, never a cancellation the caller did not ask for;</item>
/// <item>a failed fetch is remembered for <see cref="FailureBackoff"/> (a NEGATIVE cache): inside that window every
/// call — including the ones that were already queued at the gate — throws
/// <see cref="MediaStoreUnavailableException"/> immediately, without calling the key source; the first call after
/// the window retries.</item>
/// </list>
/// <para>
/// A cached key that still outlives the SAS is ALWAYS served first, so a failed refresh never takes away a key
/// that is still good. A caller's own cancellation is not a failure and opens no window. Every consumer degrades
/// on the exception (the feed, threads and personas omit media; upload and the staff library answer 503).
/// </para>
/// </remarks>
public sealed class UserDelegationKeyCache : IDisposable
{
    /// <summary>How far a fetched key is backdated to tolerate clock skew between this host and Azure.</summary>
    public static readonly TimeSpan ClockSkewAllowance = TimeSpan.FromMinutes(5);

    /// <summary>
    /// How much longer than the SAS being signed a freshly fetched key lives — the reuse window. A new key is
    /// requested at most once per this period (well inside Azure's 7-day maximum).
    /// </summary>
    public static readonly TimeSpan ReuseWindow = TimeSpan.FromHours(6);

    /// <summary>The upper bound on one key fetch (the SDK's own retry and network timeout run inside it).</summary>
    public static readonly TimeSpan DefaultFetchTimeout = TimeSpan.FromSeconds(5);

    /// <summary>How long a failed fetch is remembered; calls inside this window fail fast without fetching.</summary>
    public static readonly TimeSpan FailureBackoff = TimeSpan.FromSeconds(30);

    private readonly IUserDelegationKeySource _source;
    private readonly TimeProvider _timeProvider;
    private readonly TimeSpan _fetchTimeout;
    private readonly SemaphoreSlim _refreshGate = new(1, 1);
    private UserDelegationKey? _cached;
    private FailedFetch? _failure;

    /// <summary>Creates the cache.</summary>
    /// <param name="source">Where keys come from.</param>
    /// <param name="timeProvider">The clock (the back-off window and the fetch timeout both run on it).</param>
    /// <param name="fetchTimeout">The bound on one fetch; <see cref="DefaultFetchTimeout"/> when omitted.</param>
    public UserDelegationKeyCache(IUserDelegationKeySource source, TimeProvider timeProvider, TimeSpan? fetchTimeout = null)
    {
        ArgumentNullException.ThrowIfNull(source);
        ArgumentNullException.ThrowIfNull(timeProvider);
        if (fetchTimeout is { } bound && bound <= TimeSpan.Zero)
        {
            throw new ArgumentOutOfRangeException(nameof(fetchTimeout), "The fetch timeout must be positive.");
        }

        _source = source;
        _timeProvider = timeProvider;
        _fetchTimeout = fetchTimeout ?? DefaultFetchTimeout;
    }

    /// <summary>The storage account name keys are issued for.</summary>
    public string AccountName => _source.AccountName;

    /// <summary>Returns a key that is valid at least until <paramref name="sasExpiresOn"/>.</summary>
    /// <param name="sasExpiresOn">The expiry of the SAS about to be signed.</param>
    /// <param name="cancellationToken">Cancels a refresh.</param>
    /// <returns>A key whose expiry is at or after <paramref name="sasExpiresOn"/>.</returns>
    /// <exception cref="MediaStoreUnavailableException">
    /// A fetch failed within the last <see cref="FailureBackoff"/> (fail fast), or this fetch exceeded its bound.
    /// </exception>
    /// <exception cref="InvalidOperationException">The service issued a key that would die before the SAS.</exception>
    public async Task<UserDelegationKey> GetKeyAsync(DateTimeOffset sasExpiresOn, CancellationToken cancellationToken)
    {
        var cached = Volatile.Read(ref _cached);
        if (cached is not null && cached.SignedExpiresOn >= sasExpiresOn)
        {
            return cached;
        }

        // Fail fast BEFORE queuing at the gate: during an outage no reader waits on another reader's failure.
        ThrowIfBackingOff();

        await _refreshGate.WaitAsync(cancellationToken).ConfigureAwait(false);
        try
        {
            cached = _cached;
            if (cached is not null && cached.SignedExpiresOn >= sasExpiresOn)
            {
                return cached;
            }

            // A caller that queued behind a fetch which just failed fails fast too, instead of fetching again.
            ThrowIfBackingOff();

            var key = await FetchAsync(sasExpiresOn, cancellationToken).ConfigureAwait(false);

            if (key is null || key.SignedExpiresOn < sasExpiresOn)
            {
                // Never sign a SAS with a key that dies first — that URL would 403 before its stated expiry.
                throw RecordFailure(new InvalidOperationException("The issued user delegation key does not outlive the SAS it must sign."));
            }

            Volatile.Write(ref _failure, null);
            Volatile.Write(ref _cached, key);
            return key;
        }
        finally
        {
            _refreshGate.Release();
        }
    }

    /// <inheritdoc />
    public void Dispose() => _refreshGate.Dispose();

    /// <summary>One bounded fetch. Any failure that is not the caller's own cancellation opens the back-off window.</summary>
    private async Task<UserDelegationKey?> FetchAsync(DateTimeOffset sasExpiresOn, CancellationToken cancellationToken)
    {
        var now = _timeProvider.GetUtcNow();
        using var timeout = new CancellationTokenSource(_fetchTimeout, _timeProvider);
        using var linked = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken, timeout.Token);

        try
        {
            return await _source
                .GetUserDelegationKeyAsync(now - ClockSkewAllowance, sasExpiresOn + ReuseWindow, linked.Token)
                .ConfigureAwait(false);
        }
        catch (OperationCanceledException exception) when (!cancellationToken.IsCancellationRequested)
        {
            // The bound fired (or the SDK gave up on its own): a storage failure, NOT a cancellation the caller asked
            // for — surfaced as one, a consumer would let it escape and fail the whole read.
            throw RecordFailure(new MediaStoreUnavailableException(
                $"The user delegation key request did not complete within {_fetchTimeout.TotalSeconds:0.###} s.", exception));
        }
        catch (Exception exception) when (exception is not OperationCanceledException)
        {
            RecordFailure(exception);
            throw;
        }
    }

    /// <summary>Throws <see cref="MediaStoreUnavailableException"/> while a recent failure's window is open.</summary>
    private void ThrowIfBackingOff()
    {
        var failure = Volatile.Read(ref _failure);
        if (failure is not null && _timeProvider.GetUtcNow() < failure.RetryAfter)
        {
            throw new MediaStoreUnavailableException(
                "Media signing is unavailable: a user delegation key request failed recently and is not retried until "
                + "the back-off window closes.",
                failure.Cause);
        }
    }

    /// <summary>Opens the back-off window for <paramref name="cause"/> and returns it (for <c>throw</c>).</summary>
    private Exception RecordFailure(Exception cause)
    {
        Volatile.Write(ref _failure, new FailedFetch(_timeProvider.GetUtcNow() + FailureBackoff, cause));
        return cause;
    }

    /// <summary>A remembered failed fetch: when the next fetch may run, and why the last one failed.</summary>
    private sealed record FailedFetch(DateTimeOffset RetryAfter, Exception Cause);
}

/// <summary>
/// The production <see cref="IMediaUrlSigner"/>: a USER-DELEGATION read SAS for exactly one blob — <c>sp=r</c>,
/// <c>sr=b</c>, <c>spr=https</c>, the response <c>Content-Type</c> pinned to the stored (sniffed) type with an
/// <c>inline</c> disposition, and the bucketed expiry (<see cref="MediaSasExpiry"/>). Scoped (it reads the
/// request's <see cref="IExerciseContext"/>); the key cache it signs with is a singleton.
/// </summary>
/// <remarks>
/// <para>
/// <b>Isolation (COR-001/COR-002, DP-11).</b> Every asset is checked against the resolved scope BEFORE anything is
/// minted; one out-of-scope asset in a batch throws <see cref="ExerciseScopeViolationException"/> and mints nothing.
/// </para>
/// <para>
/// <b>Residual risk (DP-11, Tier-2).</b> A minted URL is a bearer capability: anyone holding it can read that ONE
/// blob until it expires (at most <c>BucketMinutes + LifetimeHours</c>, 13 h by default). COR-002's access check
/// happens at mint time; Azure cannot re-check it per request.
/// </para>
/// </remarks>
public sealed class BlobMediaUrlSigner : IMediaUrlSigner
{
    /// <summary>The response disposition every read SAS pins.</summary>
    public const string InlineDisposition = "inline";

    private readonly IExerciseContext _exerciseContext;
    private readonly UserDelegationKeyCache _keyCache;
    private readonly TimeProvider _timeProvider;
    private readonly MediaSasOptions _sasOptions;
    private readonly Uri _serviceUri;
    private readonly string _containerName;

    /// <summary>Creates the signer.</summary>
    /// <param name="exerciseContext">The request's resolved exercise scope.</param>
    /// <param name="keyCache">The process-wide user delegation key cache.</param>
    /// <param name="storageOptions">The storage options (<c>ServiceUri</c>, <c>ContainerName</c>).</param>
    /// <param name="sasOptions">The expiry bucketing.</param>
    /// <param name="timeProvider">The clock.</param>
    public BlobMediaUrlSigner(
        IExerciseContext exerciseContext,
        UserDelegationKeyCache keyCache,
        IOptions<MediaStorageOptions> storageOptions,
        IOptions<MediaSasOptions> sasOptions,
        TimeProvider timeProvider)
    {
        ArgumentNullException.ThrowIfNull(exerciseContext);
        ArgumentNullException.ThrowIfNull(keyCache);
        ArgumentNullException.ThrowIfNull(storageOptions);
        ArgumentNullException.ThrowIfNull(sasOptions);
        ArgumentNullException.ThrowIfNull(timeProvider);

        _exerciseContext = exerciseContext;
        _keyCache = keyCache;
        _timeProvider = timeProvider;
        _sasOptions = sasOptions.Value;
        _serviceUri = MediaBlobServiceClientFactory.ValidateServiceUri(storageOptions.Value.ServiceUri);
        _containerName = MediaBlobServiceClientFactory.ValidateContainerName(storageOptions.Value.ContainerName);
    }

    /// <inheritdoc />
    public async Task<string> GetReadUrlAsync(MediaAsset asset, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(asset);

        var urls = await GetReadUrlsAsync([asset], cancellationToken).ConfigureAwait(false);
        return urls[asset.Id];
    }

    /// <inheritdoc />
    public async Task<IReadOnlyDictionary<Guid, string>> GetReadUrlsAsync(
        IReadOnlyCollection<MediaAsset> assets, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(assets);

        // Nothing to sign needs no scope (a feed with no media must not fail on an unresolved scope).
        if (assets.Count == 0)
        {
            return new Dictionary<Guid, string>();
        }

        // The whole batch is checked before ANY URL is minted.
        MediaScopeGuard.EnsureInScope(_exerciseContext, assets);

        var urls = new Dictionary<Guid, string>(assets.Count);

        // One clock read per call, so every URL in a batch shares the same bucket.
        var expiresOn = MediaSasExpiry.ExpiresOn(_timeProvider.GetUtcNow(), _sasOptions);
        var key = await _keyCache.GetKeyAsync(expiresOn, cancellationToken).ConfigureAwait(false);

        foreach (var asset in assets)
        {
            urls[asset.Id] = Sign(asset, key, expiresOn);
        }

        return urls;
    }

    private string Sign(MediaAsset asset, UserDelegationKey key, DateTimeOffset expiresOn)
    {
        if (!MediaBlobNames.IsValid(asset.BlobName))
        {
            throw new InvalidOperationException("Refusing to sign a malformed media blob name.");
        }

        var sas = new BlobSasBuilder
        {
            BlobContainerName = _containerName,
            BlobName = asset.BlobName,
            Resource = "b",
            ExpiresOn = expiresOn,
            Protocol = SasProtocol.Https,
            ContentType = asset.ContentType,
            ContentDisposition = InlineDisposition,
        };
        sas.SetPermissions(BlobSasPermissions.Read);

        var builder = new BlobUriBuilder(_serviceUri)
        {
            BlobContainerName = _containerName,
            BlobName = asset.BlobName,
            Sas = sas.ToSasQueryParameters(key, _keyCache.AccountName),
        };

        return builder.ToUri().AbsoluteUri;
    }
}
