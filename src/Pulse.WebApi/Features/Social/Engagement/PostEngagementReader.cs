namespace Pulse.WebApi.Features.Social.Engagement;

using Microsoft.EntityFrameworkCore;
using Pulse.WebApi.Data;
using Pulse.WebApi.Data.Entities;

/// <summary>
/// The real engagement read (demo-polish B3, SOC-030 / SOC-021): REAL like and repost counts from ACTIVE
/// <see cref="PostReaction"/> rows, REAL reply counts from non-deleted direct replies, and the viewing persona's own
/// like/repost state, for a whole batch of posts at once. Scoped lifetime, matching the
/// <see cref="PulseDbContext"/> unit of work it reads through. The seeded baseline is NOT added here; the projector
/// and the reaction endpoint add it (implementation.md §1.4).
/// </summary>
/// <remarks>
/// <para>
/// <b>Isolation (COR-001).</b> Every query runs through the exercise-scoped <c>Posts</c> / <c>PostReactions</c>
/// sets, so the central query filter supplies the exercise predicate. The result is keyed by the posts that
/// resolve IN SCOPE: an id naming another exercise's post (or no post at all) is simply absent from the result,
/// and no count can ever include another exercise's rows, not even a stray reaction that a buggy write in another
/// exercise pointed at one of this exercise's posts (DP-16). An unresolved scope reads nothing.
/// </para>
/// <para>
/// <b>Soft delete (DP-15, XC-010).</b> Only ACTIVE reactions count (<c>DeletedAt IS NULL</c>); un-liked history
/// rows are ignored by the counts and by the viewer flags. Only replies that are not taken down count.
/// </para>
/// <para>
/// <b>Batched, no N+1.</b> At most four round trips regardless of how many ids are asked for: the in-scope post
/// set, one grouped aggregate over the reactions (both kinds), one grouped aggregate over the direct replies, and
/// (only when there is a viewer) one read of the viewer's own active reactions.
/// </para>
/// </remarks>
public sealed class PostEngagementReader : IPostEngagementReader
{
    private static readonly IReadOnlyDictionary<Guid, PostEngagement> Empty = new Dictionary<Guid, PostEngagement>();

    private readonly PulseDbContext _dbContext;
    private readonly IExerciseContext _exerciseContext;

    /// <summary>Creates the reader over its persistence context and the request's exercise scope.</summary>
    /// <param name="dbContext">The request-scoped persistence context the reads run through.</param>
    /// <param name="exerciseContext">The server-authoritative exercise scope (COR-001).</param>
    public PostEngagementReader(PulseDbContext dbContext, IExerciseContext exerciseContext)
    {
        ArgumentNullException.ThrowIfNull(dbContext);
        ArgumentNullException.ThrowIfNull(exerciseContext);

        _dbContext = dbContext;
        _exerciseContext = exerciseContext;
    }

    /// <inheritdoc />
    public async Task<IReadOnlyDictionary<Guid, PostEngagement>> GetAsync(
        IReadOnlyCollection<Guid> postIds, Guid? viewerPersonaId, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(postIds);

        // Fail closed: an unset scope (or the Guid.Empty sentinel) reads nothing. The central filter would already
        // match zero rows; returning early also saves the round trips.
        var scope = _exerciseContext.CurrentExerciseId;
        if (scope is null || scope.Value == Guid.Empty)
        {
            return Empty;
        }

        var ids = postIds.Where(id => id != Guid.Empty).Distinct().ToArray();
        if (ids.Length == 0)
        {
            return Empty;
        }

        // 1. The key set: the requested posts that resolve IN THIS EXERCISE. Everything below is reported only
        //    for these ids, so an out-of-scope id is absent rather than present with zeros.
        var inScopePostIds = await _dbContext.Posts
            .AsNoTracking()
            .Where(post => ids.Contains(post.Id))
            .Select(post => post.Id)
            .ToListAsync(cancellationToken);

        if (inScopePostIds.Count == 0)
        {
            return Empty;
        }

        // 2. Active reactions per (post, kind): one grouped aggregate for both kinds.
        var reactionCounts = await _dbContext.PostReactions
            .AsNoTracking()
            .Where(reaction => inScopePostIds.Contains(reaction.PostId) && reaction.DeletedAt == null)
            .GroupBy(reaction => new { reaction.PostId, reaction.Kind })
            .Select(group => new { group.Key.PostId, group.Key.Kind, Count = group.Count() })
            .ToListAsync(cancellationToken);

        // 3. Non-deleted DIRECT replies per parent (a reply-to-a-reply counts for its own parent only).
        var replyCounts = await _dbContext.Posts
            .AsNoTracking()
            .Where(reply => reply.ParentPostId != null
                && inScopePostIds.Contains(reply.ParentPostId.Value)
                && reply.DeletedAt == null)
            .GroupBy(reply => reply.ParentPostId!.Value)
            .Select(group => new { ParentPostId = group.Key, Count = group.Count() })
            .ToListAsync(cancellationToken);

        // 4. The viewer's own ACTIVE reactions, only when there is a viewer.
        var viewerReactions = viewerPersonaId is { } viewer
            ? await _dbContext.PostReactions
                .AsNoTracking()
                .Where(reaction => inScopePostIds.Contains(reaction.PostId)
                    && reaction.PersonaId == viewer
                    && reaction.DeletedAt == null)
                .Select(reaction => new { reaction.PostId, reaction.Kind })
                .ToListAsync(cancellationToken)
            : [];

        var likes = reactionCounts
            .Where(row => string.Equals(row.Kind, ReactionKinds.Like, StringComparison.Ordinal))
            .ToDictionary(row => row.PostId, row => row.Count);
        var reposts = reactionCounts
            .Where(row => string.Equals(row.Kind, ReactionKinds.Repost, StringComparison.Ordinal))
            .ToDictionary(row => row.PostId, row => row.Count);
        var replies = replyCounts.ToDictionary(row => row.ParentPostId, row => row.Count);
        var viewerLiked = viewerReactions
            .Where(row => string.Equals(row.Kind, ReactionKinds.Like, StringComparison.Ordinal))
            .Select(row => row.PostId)
            .ToHashSet();
        var viewerReposted = viewerReactions
            .Where(row => string.Equals(row.Kind, ReactionKinds.Repost, StringComparison.Ordinal))
            .Select(row => row.PostId)
            .ToHashSet();

        return inScopePostIds.ToDictionary(
            postId => postId,
            postId => new PostEngagement(
                RealLike: likes.GetValueOrDefault(postId),
                RealRepost: reposts.GetValueOrDefault(postId),
                RealReply: replies.GetValueOrDefault(postId),
                ViewerLiked: viewerLiked.Contains(postId),
                ViewerReposted: viewerReposted.Contains(postId)));
    }
}
