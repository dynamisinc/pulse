namespace Pulse.WebApi.Features.Media;

using System.Globalization;
using Microsoft.EntityFrameworkCore;
using Pulse.WebApi.Data;
using Pulse.WebApi.Data.Entities;

/// <summary>The fail-closed outcomes of a library read.</summary>
public enum MediaLibraryOutcome
{
    /// <summary>200 — the resolved exercise's assets.</summary>
    Ok,

    /// <summary>400 — a bad <c>kind</c> or <c>take</c>.</summary>
    Invalid,

    /// <summary>401 — no exercise scope is resolved.</summary>
    ScopeUnresolved,
}

/// <summary>The result of <see cref="MediaLibraryService.ListAsync"/>.</summary>
public sealed class MediaLibraryResult
{
    private MediaLibraryResult(MediaLibraryOutcome outcome, IReadOnlyList<StaffMediaAssetView>? items, string? error)
    {
        Outcome = outcome;
        Items = items;
        Error = error;
    }

    /// <summary>The outcome.</summary>
    public MediaLibraryOutcome Outcome { get; }

    /// <summary>The library rows, newest first, on <see cref="MediaLibraryOutcome.Ok"/>.</summary>
    public IReadOnlyList<StaffMediaAssetView>? Items { get; }

    /// <summary>The client-facing message for a 400.</summary>
    public string? Error { get; }

    /// <summary>A successful read.</summary>
    /// <param name="items">The rows.</param>
    /// <returns>The result.</returns>
    public static MediaLibraryResult Ok(IReadOnlyList<StaffMediaAssetView> items) => new(MediaLibraryOutcome.Ok, items, null);

    /// <summary>A failed read.</summary>
    /// <param name="outcome">The failure outcome.</param>
    /// <param name="error">The client-facing message, if any.</param>
    /// <returns>The result.</returns>
    public static MediaLibraryResult Failed(MediaLibraryOutcome outcome, string? error = null) => new(outcome, null, error);
}

/// <summary>
/// <c>GET /api/staff/media</c>'s service (demo-polish BM AC "Staff library"): the RESOLVED exercise's assets,
/// newest first by upload time (<see cref="MediaAsset.CreatedWallClock"/>, the one consistent time base), with
/// signed URLs — excluding images that are some video's poster (DP-3). The
/// staff/assignment gate is the endpoint filter's job (<c>EngineCockpitStaffAuthorizationFilter</c>); scope comes
/// only from <see cref="IExerciseContext"/> (COR-001), so another exercise's media is never returned.
/// </summary>
public sealed class MediaLibraryService
{
    /// <summary>The default page size.</summary>
    public const int DefaultTake = 100;

    /// <summary>The largest page size.</summary>
    public const int MaxTake = 200;

    private readonly PulseDbContext _dbContext;
    private readonly IExerciseContext _exerciseContext;
    private readonly IMediaUrlSigner _signer;

    /// <summary>Creates the service.</summary>
    /// <param name="dbContext">The persistence context (exercise-filtered).</param>
    /// <param name="exerciseContext">The resolved exercise scope — the ONLY scoping source.</param>
    /// <param name="signer">The read-URL signer.</param>
    public MediaLibraryService(PulseDbContext dbContext, IExerciseContext exerciseContext, IMediaUrlSigner signer)
    {
        ArgumentNullException.ThrowIfNull(dbContext);
        ArgumentNullException.ThrowIfNull(exerciseContext);
        ArgumentNullException.ThrowIfNull(signer);

        _dbContext = dbContext;
        _exerciseContext = exerciseContext;
        _signer = signer;
    }

    /// <summary>Lists the library.</summary>
    /// <param name="kind">Optional filter: <c>image</c> or <c>video</c>.</param>
    /// <param name="take">Optional page size, 1..<see cref="MaxTake"/> (default <see cref="DefaultTake"/>).</param>
    /// <param name="cancellationToken">Cancellation token.</param>
    /// <returns>The outcome.</returns>
    public async Task<MediaLibraryResult> ListAsync(string? kind, string? take, CancellationToken cancellationToken = default)
    {
        var scope = _exerciseContext.CurrentExerciseId;
        if (scope is null || scope.Value == Guid.Empty)
        {
            return MediaLibraryResult.Failed(MediaLibraryOutcome.ScopeUnresolved);
        }

        var exerciseId = scope.Value;

        if (!string.IsNullOrEmpty(kind) && kind != MediaKinds.Image && kind != MediaKinds.Video)
        {
            return MediaLibraryResult.Failed(MediaLibraryOutcome.Invalid, "kind must be 'image' or 'video'.");
        }

        var pageSize = DefaultTake;
        if (!string.IsNullOrEmpty(take)
            && (!int.TryParse(take, NumberStyles.None, CultureInfo.InvariantCulture, out pageSize) || pageSize < 1 || pageSize > MaxTake))
        {
            return MediaLibraryResult.Failed(MediaLibraryOutcome.Invalid, $"take must be a whole number from 1 to {MaxTake}.");
        }

        // The central filter confines both sets to the scope; the explicit ExerciseId predicates keep the isolation
        // visible at the call site (defense in depth, COR-001).
        var posterIds = _dbContext.MediaAssets
            .Where(asset => asset.ExerciseId == exerciseId && asset.PosterMediaAssetId != null)
            .Select(asset => asset.PosterMediaAssetId!.Value);

        var query = _dbContext.MediaAssets
            .AsNoTracking()
            .Where(asset => asset.ExerciseId == exerciseId && !posterIds.Contains(asset.Id));

        if (!string.IsNullOrEmpty(kind))
        {
            query = query.Where(asset => asset.Kind == kind);
        }

        // Newest first by the WALL clock — the authoritative upload order. CreatedScenarioTime may come from three
        // different time bases (running clock / persisted scenario time / wall clock: the DP-18a staff-metadata
        // exception documented on MediaUploadService), so sorting by it could interleave them; it is only DISPLAYED
        // (uploadedAtScenario). Id breaks ties deterministically.
        var assets = await query
            .OrderByDescending(asset => asset.CreatedWallClock)
            .ThenBy(asset => asset.Id)
            .Take(pageSize)
            .ToListAsync(cancellationToken);

        if (assets.Count == 0)
        {
            return MediaLibraryResult.Ok([]);
        }

        var wantedPosterIds = assets
            .Where(asset => asset.PosterMediaAssetId is not null)
            .Select(asset => asset.PosterMediaAssetId!.Value)
            .Distinct()
            .ToList();

        var posters = wantedPosterIds.Count == 0
            ? []
            : await _dbContext.MediaAssets
                .AsNoTracking()
                .Where(asset => asset.ExerciseId == exerciseId && wantedPosterIds.Contains(asset.Id))
                .ToListAsync(cancellationToken);

        var urls = await _signer.GetReadUrlsAsync([.. assets, .. posters], cancellationToken);

        var items = assets
            .Select(asset => StaffMediaAssetView.FromAsset(
                asset,
                urls[asset.Id],
                asset.PosterMediaAssetId is { } posterId && urls.TryGetValue(posterId, out var posterUrl) ? posterUrl : null))
            .ToList();

        return MediaLibraryResult.Ok(items);
    }
}
