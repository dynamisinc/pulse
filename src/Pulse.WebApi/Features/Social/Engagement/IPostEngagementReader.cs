// FROZEN — demo-polish implementation.md §1.4. Change via the orchestrator only.
namespace Pulse.WebApi.Features.Social.Engagement;

/// <summary>
/// The REAL engagement on one post — counts from rows only (the seeded baseline is added by the projector) plus
/// the viewing persona's own reaction state.
/// </summary>
/// <param name="RealLike">Real like reactions.</param>
/// <param name="RealRepost">Real repost reactions.</param>
/// <param name="RealReply">Non-deleted direct replies.</param>
/// <param name="ViewerLiked">Whether the viewer persona has liked the post (false when there is no viewer).</param>
/// <param name="ViewerReposted">Whether the viewer persona has reposted the post (false when there is no viewer).</param>
public sealed record PostEngagement(int RealLike, int RealRepost, int RealReply, bool ViewerLiked, bool ViewerReposted);

/// <summary>
/// The engagement read seam (demo-polish B1 freezes it; B3 implements it as <c>PostEngagementReader</c>).
/// Interface only — no behaviour and no DI registration here.
/// </summary>
public interface IPostEngagementReader
{
    /// <summary>
    /// Reads REAL counts only (baseline is added by the projector). <c>RealReply</c> = non-deleted direct replies.
    /// Ids outside the current exercise scope are simply absent from the result. <c>ViewerLiked</c>/
    /// <c>ViewerReposted</c> are false when <paramref name="viewerPersonaId"/> is null.
    /// </summary>
    /// <param name="postIds">The posts to read engagement for.</param>
    /// <param name="viewerPersonaId">The viewing persona, or null for no viewer state.</param>
    /// <param name="cancellationToken">Cancels the read.</param>
    /// <returns>The engagement per in-scope post id.</returns>
    Task<IReadOnlyDictionary<Guid, PostEngagement>> GetAsync(
        IReadOnlyCollection<Guid> postIds, Guid? viewerPersonaId, CancellationToken cancellationToken);
}
