namespace Pulse.WebApi.Features.Media;

using System.Buffers;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using Pulse.WebApi.Data;
using Pulse.WebApi.Data.Entities;

/// <summary>
/// The DEVELOPMENT-ONLY <see cref="IMediaStore"/>: writes uploads under <c>Azure:BlobStorage:LocalRootPath</c>
/// (relative paths resolve against the content root) so a developer can work without Azure. Its files are served
/// by the Development-only <c>/dev-media</c> static mapping (<see cref="DevMediaStartupFilter"/>).
/// </summary>
/// <remarks>
/// Never selected outside Development (<see cref="MediaEndpoints.AddMedia"/>), and its constructor refuses to run
/// outside Development as a second lock. Same streaming contract as the Azure store: the ceiling is enforced while
/// copying (<see cref="MaxLengthReadStream"/>), the file is created exclusively (never overwrites), and any failure
/// deletes the partial file.
/// </remarks>
public sealed partial class LocalFileMediaStore : IMediaStore
{
    /// <summary>The copy buffer — the most of an upload this store holds in memory at once.</summary>
    public const int CopyBufferBytes = 64 * 1024;

    private readonly string _root;
    private readonly ILogger<LocalFileMediaStore> _logger;

    /// <summary>Creates the store. Throws outside Development.</summary>
    /// <param name="options">The storage options (<c>LocalRootPath</c>).</param>
    /// <param name="environment">The host environment (must be Development).</param>
    /// <param name="logger">Diagnostics logger.</param>
    public LocalFileMediaStore(IOptions<MediaStorageOptions> options, IHostEnvironment environment, ILogger<LocalFileMediaStore> logger)
    {
        ArgumentNullException.ThrowIfNull(options);
        ArgumentNullException.ThrowIfNull(environment);
        ArgumentNullException.ThrowIfNull(logger);

        if (!environment.IsDevelopment())
        {
            throw new InvalidOperationException("The local media store is Development-only.");
        }

        _root = ResolveRoot(options.Value, environment);
        _logger = logger;
    }

    /// <inheritdoc />
    public bool IsConfigured => true;

    /// <summary>The absolute directory files are written under.</summary>
    public string RootPath => _root;

    /// <summary>Resolves the absolute local root for <paramref name="options"/> (shared with the static mapping).</summary>
    /// <param name="options">The storage options.</param>
    /// <param name="environment">The host environment (its content root anchors relative paths).</param>
    /// <returns>The absolute root directory.</returns>
    public static string ResolveRoot(MediaStorageOptions options, IHostEnvironment environment)
    {
        ArgumentNullException.ThrowIfNull(options);
        ArgumentNullException.ThrowIfNull(environment);

        var configured = string.IsNullOrWhiteSpace(options.LocalRootPath)
            ? MediaStorageOptions.DefaultLocalRootPath
            : options.LocalRootPath;
        return Path.GetFullPath(Path.Combine(environment.ContentRootPath, configured));
    }

    /// <inheritdoc />
    public async Task<long> SaveAsync(string blobName, string contentType, Stream content, long maxBytes, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(content);
        var path = ResolvePath(blobName);
        Directory.CreateDirectory(Path.GetDirectoryName(path)!);

        // CreateNew: never overwrite. If the name already exists this throws BEFORE the try below, so the cleanup
        // can only ever delete a file this call created.
        var file = new FileStream(path, FileMode.CreateNew, FileAccess.Write, FileShare.None, bufferSize: 1, FileOptions.Asynchronous);
        var limited = new MaxLengthReadStream(content, maxBytes);
        var buffer = ArrayPool<byte>.Shared.Rent(CopyBufferBytes);
        try
        {
            await using (file)
            {
                int read;
                while ((read = await limited.ReadAsync(buffer.AsMemory(0, CopyBufferBytes), cancellationToken).ConfigureAwait(false)) > 0)
                {
                    await file.WriteAsync(buffer.AsMemory(0, read), cancellationToken).ConfigureAwait(false);
                }
            }

            return limited.BytesRead;
        }
        catch
        {
            await DeleteAsync(blobName, CancellationToken.None).ConfigureAwait(false);
            throw;
        }
        finally
        {
            ArrayPool<byte>.Shared.Return(buffer);
        }
    }

    /// <inheritdoc />
    public Task DeleteAsync(string blobName, CancellationToken cancellationToken)
    {
        if (!MediaBlobNames.IsValid(blobName))
        {
            return Task.CompletedTask;
        }

        try
        {
            File.Delete(ResolvePath(blobName));
        }
        catch (IOException exception)
        {
            LogDeleteFailed(exception, blobName);
        }
        catch (UnauthorizedAccessException exception)
        {
            LogDeleteFailed(exception, blobName);
        }

        return Task.CompletedTask;
    }

    /// <summary>Maps a validated blob name to a path that provably stays under the root.</summary>
    private string ResolvePath(string blobName)
    {
        if (!MediaBlobNames.IsValid(blobName))
        {
            throw new ArgumentException("Not a media blob name.", nameof(blobName));
        }

        var path = Path.GetFullPath(Path.Combine(_root, blobName.Replace('/', Path.DirectorySeparatorChar)));
        if (!path.StartsWith(_root + Path.DirectorySeparatorChar, StringComparison.Ordinal))
        {
            throw new ArgumentException("The blob name resolves outside the local media root.", nameof(blobName));
        }

        return path;
    }

    [LoggerMessage(EventId = 1, Level = LogLevel.Warning, Message = "Best-effort delete of local media file {BlobName} failed.")]
    private partial void LogDeleteFailed(Exception exception, string blobName);
}

/// <summary>
/// The DEVELOPMENT-ONLY <see cref="IMediaUrlSigner"/>: an absolute <c>http(s)://{api-host}/dev-media/{blobName}</c>
/// URL served by the Development-only static mapping. Enforces the same scope check as the production signer
/// (<see cref="ExerciseScopeViolationException"/> on a mismatch) — Development must not teach a different contract.
/// </summary>
public sealed class LocalMediaUrlSigner : IMediaUrlSigner
{
    /// <summary>The request path the Development-only static mapping serves.</summary>
    public const string DevMediaPath = "/dev-media";

    private readonly IExerciseContext _exerciseContext;
    private readonly IHttpContextAccessor _httpContextAccessor;

    /// <summary>Creates the signer.</summary>
    /// <param name="exerciseContext">The request's resolved exercise scope.</param>
    /// <param name="httpContextAccessor">The current request (its scheme/host form the URL base).</param>
    public LocalMediaUrlSigner(IExerciseContext exerciseContext, IHttpContextAccessor httpContextAccessor)
    {
        ArgumentNullException.ThrowIfNull(exerciseContext);
        ArgumentNullException.ThrowIfNull(httpContextAccessor);

        _exerciseContext = exerciseContext;
        _httpContextAccessor = httpContextAccessor;
    }

    /// <inheritdoc />
    public async Task<string> GetReadUrlAsync(MediaAsset asset, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(asset);

        var urls = await GetReadUrlsAsync([asset], cancellationToken).ConfigureAwait(false);
        return urls[asset.Id];
    }

    /// <inheritdoc />
    public Task<IReadOnlyDictionary<Guid, string>> GetReadUrlsAsync(IReadOnlyCollection<MediaAsset> assets, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(assets);

        MediaScopeGuard.EnsureInScope(_exerciseContext, assets);

        var urls = new Dictionary<Guid, string>(assets.Count);
        if (assets.Count == 0)
        {
            return Task.FromResult<IReadOnlyDictionary<Guid, string>>(urls);
        }

        var request = _httpContextAccessor.HttpContext?.Request
            ?? throw new InvalidOperationException("The Development media signer needs the current request to build an absolute URL.");
        var baseUrl = $"{request.Scheme}://{request.Host.ToUriComponent()}{request.PathBase.ToUriComponent()}{DevMediaPath}/";

        foreach (var asset in assets)
        {
            if (!MediaBlobNames.IsValid(asset.BlobName))
            {
                throw new InvalidOperationException("Refusing to sign a malformed media blob name.");
            }

            urls[asset.Id] = baseUrl + asset.BlobName;
        }

        return Task.FromResult<IReadOnlyDictionary<Guid, string>>(urls);
    }
}
