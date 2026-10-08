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
    /// <param name="credential">The token credential — <c>DefaultAzureCredential</c> in production.</param>
    /// <param name="clientOptions">Optional client options (tests substitute the transport).</param>
    public BlobServiceUserDelegationKeySource(
        IOptions<MediaStorageOptions> options,
        TokenCredential credential,
        BlobClientOptions? clientOptions = null)
    {
        ArgumentNullException.ThrowIfNull(options);
        ArgumentNullException.ThrowIfNull(credential);

        _serviceClient = MediaBlobServiceClientFactory.Create(options.Value, credential, clientOptions);
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
public sealed class UserDelegationKeyCache : IDisposable
{
    /// <summary>How far a fetched key is backdated to tolerate clock skew between this host and Azure.</summary>
    public static readonly TimeSpan ClockSkewAllowance = TimeSpan.FromMinutes(5);

    /// <summary>
    /// How much longer than the SAS being signed a freshly fetched key lives — the reuse window. A new key is
    /// requested at most once per this period (well inside Azure's 7-day maximum).
    /// </summary>
    public static readonly TimeSpan ReuseWindow = TimeSpan.FromHours(6);

    private readonly IUserDelegationKeySource _source;
    private readonly TimeProvider _timeProvider;
    private readonly SemaphoreSlim _refreshGate = new(1, 1);
    private UserDelegationKey? _cached;

    /// <summary>Creates the cache.</summary>
    /// <param name="source">Where keys come from.</param>
    /// <param name="timeProvider">The clock.</param>
    public UserDelegationKeyCache(IUserDelegationKeySource source, TimeProvider timeProvider)
    {
        ArgumentNullException.ThrowIfNull(source);
        ArgumentNullException.ThrowIfNull(timeProvider);

        _source = source;
        _timeProvider = timeProvider;
    }

    /// <summary>The storage account name keys are issued for.</summary>
    public string AccountName => _source.AccountName;

    /// <summary>Returns a key that is valid at least until <paramref name="sasExpiresOn"/>.</summary>
    /// <param name="sasExpiresOn">The expiry of the SAS about to be signed.</param>
    /// <param name="cancellationToken">Cancels a refresh.</param>
    /// <returns>A key whose expiry is at or after <paramref name="sasExpiresOn"/>.</returns>
    /// <exception cref="InvalidOperationException">The service issued a key that would die before the SAS.</exception>
    public async Task<UserDelegationKey> GetKeyAsync(DateTimeOffset sasExpiresOn, CancellationToken cancellationToken)
    {
        var cached = Volatile.Read(ref _cached);
        if (cached is not null && cached.SignedExpiresOn >= sasExpiresOn)
        {
            return cached;
        }

        await _refreshGate.WaitAsync(cancellationToken).ConfigureAwait(false);
        try
        {
            cached = _cached;
            if (cached is not null && cached.SignedExpiresOn >= sasExpiresOn)
            {
                return cached;
            }

            var now = _timeProvider.GetUtcNow();
            var key = await _source
                .GetUserDelegationKeyAsync(now - ClockSkewAllowance, sasExpiresOn + ReuseWindow, cancellationToken)
                .ConfigureAwait(false);

            if (key is null || key.SignedExpiresOn < sasExpiresOn)
            {
                // Never sign a SAS with a key that dies first — that URL would 403 before its stated expiry.
                throw new InvalidOperationException("The issued user delegation key does not outlive the SAS it must sign.");
            }

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

        // The whole batch is checked before ANY URL is minted.
        MediaScopeGuard.EnsureInScope(_exerciseContext, assets);

        var urls = new Dictionary<Guid, string>(assets.Count);
        if (assets.Count == 0)
        {
            return urls;
        }

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
