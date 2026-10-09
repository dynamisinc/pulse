namespace Pulse.WebApi.Features.Media;

using Azure;
using Azure.Core;
using Azure.Storage;
using Azure.Storage.Blobs;
using Azure.Storage.Blobs.Models;
using Azure.Storage.Blobs.Specialized;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;

/// <summary>
/// Builds the KEYLESS <see cref="BlobServiceClient"/> both Azure media types use: the configured
/// <c>Azure:BlobStorage:ServiceUri</c> plus a <see cref="TokenCredential"/> (the App Service's managed identity
/// in production, <see cref="MediaEndpoints.CreateCredential"/>). There is no connection-string, account-key or SAS-token
/// overload anywhere in this slice (COR-002, demo-polish BM AC "No account key, ever").
/// </summary>
public static class MediaBlobServiceClientFactory
{
    /// <summary>
    /// Creates the client, FAILING CLOSED (throws) when the service URI is missing, not absolute, not HTTPS, or
    /// carries a query string (a pasted SAS token would be a credential in configuration — refused).
    /// </summary>
    /// <param name="options">The storage options.</param>
    /// <param name="credential">The token credential (never a shared key).</param>
    /// <param name="clientOptions">Optional client options (tests substitute the transport).</param>
    /// <returns>The keyless service client.</returns>
    /// <exception cref="InvalidOperationException">The service URI is unusable.</exception>
    public static BlobServiceClient Create(MediaStorageOptions options, TokenCredential credential, BlobClientOptions? clientOptions = null)
    {
        ArgumentNullException.ThrowIfNull(options);
        ArgumentNullException.ThrowIfNull(credential);

        return new BlobServiceClient(ValidateServiceUri(options.ServiceUri), credential, clientOptions);
    }

    /// <summary>
    /// Retries per media storage call beyond the first attempt (the SDK default is 3, with exponential back-off).
    /// One retry absorbs a blip; more would only make a reader queue longer during a storage-auth outage (Wave 1b
    /// Gate-2 M-1).
    /// </summary>
    public const int MaxRetries = 1;

    /// <summary>
    /// The per-try network timeout of the key/signing client (the SDK default is 100 s). The key cache bounds the
    /// whole fetch more tightly still (<see cref="UserDelegationKeyCache.DefaultFetchTimeout"/>).
    /// </summary>
    public static readonly TimeSpan SigningNetworkTimeout = TimeSpan.FromSeconds(10);

    /// <summary>
    /// The per-try network timeout of the upload client. One try is one block PUT of at most
    /// <see cref="AzureBlobMediaStore.TransferBlockBytes"/>, buffered before it is sent, so this bounds the in-region
    /// hop to storage, never the participant's own upload speed.
    /// </summary>
    public static readonly TimeSpan UploadNetworkTimeout = TimeSpan.FromSeconds(30);

    /// <summary>The production client options: <see cref="MaxRetries"/> and the given per-try network timeout.</summary>
    /// <param name="networkTimeout">The per-try network timeout.</param>
    /// <returns>New client options (callers own them).</returns>
    public static BlobClientOptions CreateClientOptions(TimeSpan networkTimeout)
    {
        var clientOptions = new BlobClientOptions();
        clientOptions.Retry.MaxRetries = MaxRetries;
        clientOptions.Retry.NetworkTimeout = networkTimeout;
        return clientOptions;
    }

    /// <summary>Validates the configured service URI (see <see cref="Create"/>).</summary>
    /// <param name="serviceUri">The configured value.</param>
    /// <returns>The parsed URI.</returns>
    /// <exception cref="InvalidOperationException">The value is unusable.</exception>
    public static Uri ValidateServiceUri(string? serviceUri)
    {
        if (string.IsNullOrWhiteSpace(serviceUri)
            || !Uri.TryCreate(serviceUri.Trim(), UriKind.Absolute, out var uri)
            || !string.Equals(uri.Scheme, Uri.UriSchemeHttps, StringComparison.OrdinalIgnoreCase)
            || !string.IsNullOrEmpty(uri.Query)
            || !string.IsNullOrEmpty(uri.UserInfo))
        {
            throw new InvalidOperationException(
                $"{MediaStorageOptions.SectionName}:ServiceUri must be an absolute https:// blob service endpoint with no "
                + "query string. Media storage is keyless (managed identity); there is no connection-string or "
                + "account-key fallback.");
        }

        return uri;
    }

    /// <summary>Validates the configured container name (non-empty).</summary>
    /// <param name="containerName">The configured value.</param>
    /// <returns>The trimmed container name.</returns>
    /// <exception cref="InvalidOperationException">The value is empty.</exception>
    public static string ValidateContainerName(string? containerName)
    {
        if (string.IsNullOrWhiteSpace(containerName))
        {
            throw new InvalidOperationException($"{MediaStorageOptions.SectionName}:ContainerName must be set.");
        }

        return containerName.Trim();
    }
}

/// <summary>
/// The production <see cref="IMediaStore"/>: streams uploads into the PRIVATE Azure Blob container, authenticated
/// with a <see cref="TokenCredential"/> only (managed identity). Never an account key.
/// </summary>
/// <remarks>
/// <para>
/// <b>Bounded memory.</b> The SDK uploads a non-seekable stream in 4 MiB blocks with a concurrency of two, so at
/// most ~8 MiB of a body is in memory at once (a block has to be replayable for the SDK's retry) — never the whole
/// 100 MiB video. The per-kind ceiling is enforced while streaming by <see cref="MaxLengthReadStream"/>.
/// </para>
/// <para>
/// <b>Partial blobs.</b> A block blob only becomes visible when its block list is committed, which happens after
/// the last block; an upload that dies on the ceiling (or anything else) has committed nothing. The store still
/// issues a best-effort <c>DeleteIfExists</c> on every failure so a single-shot partial can never linger.
/// Uploads never overwrite (<c>If-None-Match: *</c>).
/// </para>
/// </remarks>
public sealed partial class AzureBlobMediaStore : IMediaStore
{
    /// <summary>The block size (and single-shot threshold) for uploads.</summary>
    public const int TransferBlockBytes = 4 * 1024 * 1024;

    private readonly BlobContainerClient _container;
    private readonly ILogger<AzureBlobMediaStore> _logger;

    /// <summary>Creates the store. Throws (fails closed) without a usable <c>ServiceUri</c>.</summary>
    /// <param name="options">The storage options (<c>ServiceUri</c>, <c>ContainerName</c>).</param>
    /// <param name="credential">The token credential — the managed identity in production (<see cref="MediaEndpoints.CreateCredential"/>).</param>
    /// <param name="logger">Diagnostics logger.</param>
    /// <param name="clientOptions">
    /// Optional client options (tests substitute the transport). When omitted, the production options:
    /// <see cref="MediaBlobServiceClientFactory.MaxRetries"/> and <see cref="MediaBlobServiceClientFactory.UploadNetworkTimeout"/>.
    /// </param>
    public AzureBlobMediaStore(
        IOptions<MediaStorageOptions> options,
        TokenCredential credential,
        ILogger<AzureBlobMediaStore> logger,
        BlobClientOptions? clientOptions = null)
    {
        ArgumentNullException.ThrowIfNull(options);
        ArgumentNullException.ThrowIfNull(credential);
        ArgumentNullException.ThrowIfNull(logger);

        var storage = options.Value;
        var containerName = MediaBlobServiceClientFactory.ValidateContainerName(storage.ContainerName);
        _container = MediaBlobServiceClientFactory
            .Create(storage, credential, clientOptions ?? MediaBlobServiceClientFactory.CreateClientOptions(MediaBlobServiceClientFactory.UploadNetworkTimeout))
            .GetBlobContainerClient(containerName);
        _logger = logger;
    }

    /// <inheritdoc />
    public bool IsConfigured => true;

    /// <inheritdoc />
    public async Task<long> SaveAsync(string blobName, string contentType, Stream content, long maxBytes, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(content);
        ArgumentException.ThrowIfNullOrEmpty(contentType);
        if (!MediaBlobNames.IsValid(blobName))
        {
            throw new ArgumentException("Not a media blob name.", nameof(blobName));
        }

        var blob = _container.GetBlockBlobClient(blobName);
        var limited = new MaxLengthReadStream(content, maxBytes);
        var uploadOptions = new BlobUploadOptions
        {
            HttpHeaders = new BlobHttpHeaders { ContentType = contentType },
            Conditions = new BlobRequestConditions { IfNoneMatch = ETag.All },
            TransferOptions = new StorageTransferOptions
            {
                InitialTransferSize = TransferBlockBytes,
                MaximumTransferSize = TransferBlockBytes,
                MaximumConcurrency = 2,
            },
        };

        try
        {
            await blob.UploadAsync(limited, uploadOptions, cancellationToken).ConfigureAwait(false);
            return limited.BytesRead;
        }
        catch (RequestFailedException exception)
            when (exception.Status is StatusCodes.Status409Conflict or StatusCodes.Status412PreconditionFailed)
        {
            // If-None-Match refused: a blob with this name already exists and this upload committed nothing. It is
            // NOT ours to delete — rethrow without cleanup.
            throw;
        }
        catch (Exception exception)
        {
            await DeleteAsync(blobName, CancellationToken.None).ConfigureAwait(false);

            // The SDK may surface the stream's exception wrapped (parallel block staging); the caller's contract is
            // MediaTooLargeException, so unwrap it.
            if (FindTooLarge(exception) is { } tooLarge && !ReferenceEquals(tooLarge, exception))
            {
                throw tooLarge;
            }

            throw;
        }
    }

    /// <inheritdoc />
    public async Task DeleteAsync(string blobName, CancellationToken cancellationToken)
    {
        if (!MediaBlobNames.IsValid(blobName))
        {
            return;
        }

        try
        {
            await _container.GetBlobClient(blobName)
                .DeleteIfExistsAsync(DeleteSnapshotsOption.IncludeSnapshots, cancellationToken: cancellationToken)
                .ConfigureAwait(false);
        }
#pragma warning disable CA1031 // Best-effort cleanup by contract: a failed delete must never mask the original outcome.
        catch (Exception exception)
#pragma warning restore CA1031
        {
            LogDeleteFailed(exception, blobName);
        }
    }

    private static MediaTooLargeException? FindTooLarge(Exception? exception)
    {
        for (var current = exception; current is not null; current = current.InnerException)
        {
            if (current is MediaTooLargeException tooLarge)
            {
                return tooLarge;
            }

            if (current is AggregateException aggregate)
            {
                foreach (var inner in aggregate.InnerExceptions)
                {
                    if (FindTooLarge(inner) is { } found)
                    {
                        return found;
                    }
                }
            }
        }

        return null;
    }

    [LoggerMessage(EventId = 1, Level = LogLevel.Warning, Message = "Best-effort delete of media blob {BlobName} failed.")]
    private partial void LogDeleteFailed(Exception exception, string blobName);
}
