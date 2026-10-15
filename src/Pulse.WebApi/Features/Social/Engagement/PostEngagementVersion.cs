namespace Pulse.WebApi.Features.Social.Engagement;

using Microsoft.EntityFrameworkCore;
using Pulse.WebApi.Data;
using Pulse.WebApi.Data.Entities;

/// <summary>
/// Reads what a <c>PostEngagementChanged</c> push carries (demo-feedback DF-17 / DF-18): the post's database-derived
/// <see cref="PostEngagementChangedDto.Version"/> and, for callers that do not already hold them, its shown counts.
/// Static helpers over the caller's own <see cref="PulseDbContext"/> and <see cref="IPostEngagementReader"/>, so the
/// write paths that push (<c>ReactionService</c>, <c>PostIngestService</c>) need no new DI registration.
/// </summary>
/// <remarks>
/// <para>
/// <b>Isolation (COR-001).</b> Every read runs through the exercise-scoped <c>Posts</c> / <c>PostReactions</c> sets, so
/// the central query filter supplies the exercise predicate: a post outside the scope reads as absent (<c>null</c>), and
/// no other exercise's row can move a version or a count.
/// </para>
/// <para>
/// <b>Read the version BEFORE the counts.</b> The two are separate reads. Reading the version first means the counts
/// in a frame are never OLDER than its version claims: if another write commits between the two reads, the frame
/// carries newer counts under an older version, and that write's own frame (a strictly higher version) still lands.
/// The other order could pair stale counts with a high version that then blocks the correct frame on the client.
/// </para>
/// </remarks>
public static class PostEngagementVersion
{
    /// <summary>
    /// The post's version: <c>R + Rd + P + Pd</c> (see <see cref="PostEngagementChangedDto"/>), or <c>null</c> when the
    /// post is not in the current exercise scope. One round trip.
    /// </summary>
    /// <param name="dbContext">The request's exercise-scoped persistence context.</param>
    /// <param name="postId">The post to read.</param>
    /// <param name="cancellationToken">Cancels the read.</param>
    /// <returns>The version, or <c>null</c> when the post does not resolve in scope.</returns>
    public static async Task<long?> ReadAsync(
        PulseDbContext dbContext, Guid postId, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(dbContext);

        var parts = await dbContext.Posts
            .AsNoTracking()
            .Where(post => post.Id == postId)
            .Select(post => new
            {
                Reactions = dbContext.PostReactions.Count(reaction => reaction.PostId == post.Id
                    && (reaction.Kind == ReactionKinds.Like || reaction.Kind == ReactionKinds.Repost)),
                EndedReactions = dbContext.PostReactions.Count(reaction => reaction.PostId == post.Id
                    && (reaction.Kind == ReactionKinds.Like || reaction.Kind == ReactionKinds.Repost)
                    && reaction.DeletedAt != null),
                Replies = dbContext.Posts.Count(reply => reply.ParentPostId == post.Id),
                RemovedReplies = dbContext.Posts.Count(reply => reply.ParentPostId == post.Id && reply.DeletedAt != null),
            })
            .FirstOrDefaultAsync(cancellationToken);

        return parts is null
            ? null
            : (long)parts.Reactions + parts.EndedReactions + parts.Replies + parts.RemovedReplies;
    }

    /// <summary>
    /// The whole <c>PostEngagementChanged</c> payload for a live post: the version (read first, see the type remarks),
    /// then the shown counts = the post's seeded baseline + its real engagement from <paramref name="engagementReader"/>
    /// (the same reader the feed projection uses, so the numbers match the next feed read). <c>null</c> when the post
    /// is not in scope or is taken down (there is no card left to update).
    /// </summary>
    /// <param name="dbContext">The request's exercise-scoped persistence context.</param>
    /// <param name="engagementReader">The engagement read the feed projection uses.</param>
    /// <param name="postId">The post to read.</param>
    /// <param name="cancellationToken">Cancels the reads.</param>
    /// <returns>The payload, or <c>null</c> when there is nothing to push.</returns>
    public static async Task<PostEngagementChangedDto?> ReadChangeAsync(
        PulseDbContext dbContext,
        IPostEngagementReader engagementReader,
        Guid postId,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(dbContext);
        ArgumentNullException.ThrowIfNull(engagementReader);

        var version = await ReadAsync(dbContext, postId, cancellationToken);
        if (version is null)
        {
            return null;
        }

        var baseline = await dbContext.Posts
            .AsNoTracking()
            .Where(post => post.Id == postId && post.DeletedAt == null)
            .Select(post => new { post.BaselineReplyCount, post.BaselineRepostCount, post.BaselineLikeCount })
            .FirstOrDefaultAsync(cancellationToken);
        if (baseline is null)
        {
            return null;
        }

        var engagement = await engagementReader.GetAsync([postId], viewerPersonaId: null, cancellationToken);
        var real = engagement.TryGetValue(postId, out var found)
            ? found
            : new PostEngagement(0, 0, 0, ViewerLiked: false, ViewerReposted: false);

        return PostEngagementChangedDto.For(
            postId,
            new ParticipantPostCounts(
                Reply: baseline.BaselineReplyCount + real.RealReply,
                Repost: baseline.BaselineRepostCount + real.RealRepost,
                Like: baseline.BaselineLikeCount + real.RealLike),
            version.Value);
    }
}
