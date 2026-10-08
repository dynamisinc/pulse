namespace Pulse.WebApi.Features.Media;

using System.Text.RegularExpressions;
using Pulse.WebApi.Data;
using Pulse.WebApi.Data.Entities;

/// <summary>
/// The one shape a media blob name may take — <c>{ExerciseId:D}/{Id:N}.{ext}</c> (implementation.md §1.2). Built
/// only from server-generated GUIDs and a sniffed extension, so no client byte ever reaches a blob path; the
/// stores re-validate it as defense in depth (no traversal, no other container path).
/// </summary>
public static partial class MediaBlobNames
{
    /// <summary>Builds the blob name for a new asset.</summary>
    /// <param name="exerciseId">The owning exercise (from the resolved scope).</param>
    /// <param name="assetId">The new asset's id.</param>
    /// <param name="extension">The sniffed extension (no dot).</param>
    /// <returns>The blob name.</returns>
    public static string Build(Guid exerciseId, Guid assetId, string extension)
    {
        ArgumentException.ThrowIfNullOrEmpty(extension);
        return $"{exerciseId:D}/{assetId:N}.{extension}";
    }

    /// <summary>Whether <paramref name="blobName"/> has the exact shape <see cref="Build"/> produces.</summary>
    /// <param name="blobName">The candidate blob name.</param>
    /// <returns><c>true</c> for a well-formed media blob name.</returns>
    public static bool IsValid(string? blobName) => blobName is not null && BlobNameRegex().IsMatch(blobName);

    [GeneratedRegex(
        "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{32}\\.(jpg|png|gif|webp|mp4|webm)$",
        RegexOptions.CultureInvariant)]
    private static partial Regex BlobNameRegex();
}

/// <summary>
/// The signer-side isolation check every <see cref="IMediaUrlSigner"/> runs BEFORE minting anything (COR-001 /
/// COR-002, DP-11): a URL is only ever minted for an asset whose <see cref="MediaAsset.ExerciseId"/> equals the
/// request's resolved scope. An unresolved scope fails closed too.
/// </summary>
public static class MediaScopeGuard
{
    /// <summary>
    /// Throws <see cref="ExerciseScopeViolationException"/> unless every asset belongs to the current scope.
    /// Checks the WHOLE batch first, so a mixed batch mints nothing at all.
    /// </summary>
    /// <param name="exerciseContext">The request's resolved scope.</param>
    /// <param name="assets">The assets about to be signed.</param>
    /// <exception cref="ExerciseScopeViolationException">The scope is unresolved or an asset is out of scope.</exception>
    public static void EnsureInScope(IExerciseContext exerciseContext, IEnumerable<MediaAsset> assets)
    {
        ArgumentNullException.ThrowIfNull(exerciseContext);
        ArgumentNullException.ThrowIfNull(assets);

        var scope = exerciseContext.CurrentExerciseId;
        if (scope is null || scope.Value == Guid.Empty)
        {
            throw new ExerciseScopeViolationException(
                "Refusing to mint a media URL with no resolved exercise scope (COR-001, fail closed).");
        }

        foreach (var asset in assets)
        {
            ArgumentNullException.ThrowIfNull(asset);
            if (asset.ExerciseId != scope.Value)
            {
                // Never names the other exercise — the message must not disclose anything about it.
                throw new ExerciseScopeViolationException(
                    "Refusing to mint a media URL for an asset outside the current exercise scope (COR-001/COR-002).");
            }
        }
    }
}

/// <summary>
/// The bucketed read-SAS expiry (implementation.md §1.4): <c>bucketStart = floor(now, BucketMinutes)</c>,
/// <c>expiresOn = bucketStart + BucketMinutes + LifetimeHours</c> (13 h with the defaults) — so every URL minted
/// inside one bucket is byte-identical (the browser cache works) and has at least <c>LifetimeHours</c> left.
/// </summary>
public static class MediaSasExpiry
{
    /// <summary>The start of the bucket <paramref name="now"/> falls in (UTC).</summary>
    /// <param name="now">The current instant.</param>
    /// <param name="options">The bucketing options.</param>
    /// <returns>The bucket start.</returns>
    public static DateTimeOffset BucketStart(DateTimeOffset now, MediaSasOptions options)
    {
        ArgumentNullException.ThrowIfNull(options);

        var bucket = TimeSpan.FromMinutes(Math.Max(1, options.BucketMinutes));
        var utcTicks = now.UtcTicks;
        return new DateTimeOffset(utcTicks - (utcTicks % bucket.Ticks), TimeSpan.Zero);
    }

    /// <summary>The expiry of any URL minted at <paramref name="now"/>.</summary>
    /// <param name="now">The current instant.</param>
    /// <param name="options">The bucketing options.</param>
    /// <returns>The bucketed expiry.</returns>
    public static DateTimeOffset ExpiresOn(DateTimeOffset now, MediaSasOptions options)
    {
        ArgumentNullException.ThrowIfNull(options);

        return BucketStart(now, options)
            + TimeSpan.FromMinutes(Math.Max(1, options.BucketMinutes))
            + TimeSpan.FromHours(Math.Max(1, options.LifetimeHours));
    }
}
