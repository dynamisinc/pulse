// FROZEN — demo-polish implementation.md §1.4. Change via the orchestrator only.
namespace Pulse.WebApi.Features.Media;

using Pulse.WebApi.Data;
using Pulse.WebApi.Data.Entities;

/// <summary>
/// The read-URL seam for stored media (demo-polish B1 freezes it; BM implements it as <c>BlobMediaUrlSigner</c>
/// and the Development-only <c>LocalMediaUrlSigner</c>). Interface only — no behaviour and no DI registration
/// here.
/// </summary>
/// <remarks>
/// <para>
/// Returns an absolute URL a browser can GET with no credentials: read-only, single blob, HTTPS (Development:
/// http). No account-key path.
/// </para>
/// <para>
/// Expiry is BUCKETED: <c>bucketStart = floor(now, 1 h)</c>; <c>expiresOn = bucketStart + 13 h</c>, so any URL
/// minted inside one bucket is byte-identical (the browser cache works) and has at least 12 h left.
/// </para>
/// <para>
/// <b>Isolation (COR-001/COR-002).</b> THROWS <see cref="ExerciseScopeViolationException"/> when
/// <c>asset.ExerciseId != IExerciseContext.CurrentExerciseId</c> — a URL is never minted outside the scope.
/// </para>
/// </remarks>
public interface IMediaUrlSigner
{
    /// <summary>Mints the read URL for one in-scope asset.</summary>
    /// <param name="asset">The asset to sign; must belong to the current exercise scope.</param>
    /// <param name="cancellationToken">Cancels the operation.</param>
    /// <returns>The absolute, credential-free read URL.</returns>
    /// <exception cref="ExerciseScopeViolationException">The asset is outside the current exercise scope.</exception>
    Task<string> GetReadUrlAsync(MediaAsset asset, CancellationToken cancellationToken);

    /// <summary>Mints read URLs for many in-scope assets, keyed by <see cref="MediaAsset.Id"/>.</summary>
    /// <param name="assets">The assets to sign; every one must belong to the current exercise scope.</param>
    /// <param name="cancellationToken">Cancels the operation.</param>
    /// <returns>The read URL per asset id.</returns>
    /// <exception cref="ExerciseScopeViolationException">Any asset is outside the current exercise scope.</exception>
    Task<IReadOnlyDictionary<Guid, string>> GetReadUrlsAsync(IReadOnlyCollection<MediaAsset> assets, CancellationToken cancellationToken);
}
