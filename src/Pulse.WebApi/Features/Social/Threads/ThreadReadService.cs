namespace Pulse.WebApi.Features.Social.Threads;

using Microsoft.EntityFrameworkCore;
using Pulse.WebApi.Data;
using Pulse.WebApi.Data.Entities;
using Pulse.WebApi.Features.Social.Follows;

/// <summary>
/// The read behind <c>GET /api/threads/{postId}</c> (SOC-010, SOC-012, D1-006, D1-009). Returns the flattened
/// thread around a focused post: its ancestors from root to parent, the post itself, and its direct replies, oldest
/// first. Soft-deleted replies come back as tombstones.
/// </summary>
/// <remarks>
/// <para>
/// <b>Isolation (COR-001, always-Critical).</b> Every read goes through the central exercise query filter AND
/// states the <c>ExerciseId</c> predicate explicitly. A focused id that is unparseable, unknown, in another
/// exercise or soft-deleted returns the shared <see cref="ThreadResponseDto.NotFound"/> instance, so all four
/// serialize to the same bytes. The ancestor walk stops at the first parent that is not in scope, so a chain
/// never crosses into another exercise. Replies are read with the same scope, so another exercise's post whose
/// <c>ParentPostId</c> names this post is never listed.
/// </para>
/// <para>
/// <b>Projection.</b> Ancestors, the focused post and the visible replies go through ONE
/// <see cref="IParticipantPostProjector.ProjectAsync"/> call, which supplies media, counts (baseline + real),
/// <c>inReplyTo</c> and, for a participant session with a bound persona, <c>viewer</c>. Tombstones are NOT
/// projected (<see cref="ThreadReplyDto.TakenDown"/>), so the projector never reads a taken-down post's media or
/// engagement. The projector is a required dependency (Gate-2 integration, B2 M-2): there is no
/// <see cref="ParticipantPostDto.FromPost"/> fallback, so a thread can never be served with zero counts and no media
/// while the feed serves the real ones.
/// </para>
/// <para>
/// <b>Time.</b> Replies are ordered by <see cref="Post.CreatedScenarioTime"/> (COR-053), never wall-clock, with
/// the id as a stable tie-break. Ancestors are ordered by the parent chain itself.
/// </para>
/// </remarks>
public sealed class ThreadReadService
{
    /// <summary>
    /// The most parent hops the ancestor walk takes (implementation.md §1.5.3). Each hop is one query, so this caps
    /// the work a deep or malformed chain can cause. Soft-deleted ancestors count as hops even though they are
    /// omitted from the response.
    /// </summary>
    public const int MaxAncestorDepth = 50;

    /// <summary>
    /// The only session kind that gets <c>viewer</c> state: a participant acting as their own bound persona. This
    /// is an allowlist, as in <c>PostAttributionResolver</c>, because a staff session can carry a persona binding
    /// too and staff never get <c>viewer</c> (implementation.md §1.5.3).
    /// </summary>
    private const string ParticipantSessionKind = "participant";

    private readonly PulseDbContext _dbContext;
    private readonly IExerciseContext _exerciseContext;
    private readonly ICurrentSessionPersonaAccessor _sessionPersonaAccessor;
    private readonly IParticipantPostProjector _projector;

    /// <summary>Creates the service over the request's persistence context, scope, session and projector.</summary>
    /// <param name="dbContext">The persistence context whose global query filter scopes every read.</param>
    /// <param name="exerciseContext">The resolved exercise scope (COR-001), the only source of scope.</param>
    /// <param name="sessionPersonaAccessor">Resolves the caller's session-bound persona for <c>viewer</c> state.</param>
    /// <param name="projector">The participant projector (BP) every ancestor, focused post and visible reply goes through.</param>
    public ThreadReadService(
        PulseDbContext dbContext,
        IExerciseContext exerciseContext,
        ICurrentSessionPersonaAccessor sessionPersonaAccessor,
        IParticipantPostProjector projector)
    {
        ArgumentNullException.ThrowIfNull(dbContext);
        ArgumentNullException.ThrowIfNull(exerciseContext);
        ArgumentNullException.ThrowIfNull(sessionPersonaAccessor);
        ArgumentNullException.ThrowIfNull(projector);

        _dbContext = dbContext;
        _exerciseContext = exerciseContext;
        _sessionPersonaAccessor = sessionPersonaAccessor;
        _projector = projector;
    }

    /// <summary>
    /// Reads the thread focused on <paramref name="postId"/>. The raw route value is passed in unparsed, so an
    /// unparseable id takes the same not-found path as an unknown one.
    /// </summary>
    /// <param name="postId">The raw focused post id from the route.</param>
    /// <param name="cancellationToken">Cancellation token.</param>
    /// <returns>
    /// The thread, or the shared <see cref="ThreadResponseDto.NotFound"/> when the focused post is unparseable,
    /// unknown, in another exercise, soft-deleted, or the scope is unresolved.
    /// </returns>
    public async Task<ThreadResponseDto> GetThreadAsync(string? postId, CancellationToken cancellationToken)
    {
        // Defence in depth: the endpoint already answers 401 for an unresolved scope, and the query filter would
        // match zero rows anyway.
        if (_exerciseContext.CurrentExerciseId is not { } exerciseId || exerciseId == Guid.Empty)
        {
            return ThreadResponseDto.NotFound;
        }

        if (!Guid.TryParse(postId, out var focusedId) || focusedId == Guid.Empty)
        {
            return ThreadResponseDto.NotFound;
        }

        var focused = await _dbContext.Posts
            .AsNoTracking()
            .FirstOrDefaultAsync(
                post => post.Id == focusedId && post.ExerciseId == exerciseId && post.DeletedAt == null,
                cancellationToken);

        if (focused is null)
        {
            return ThreadResponseDto.NotFound;
        }

        var ancestors = await ReadAncestorsAsync(focused, exerciseId, cancellationToken);

        // Direct replies, INCLUDING soft-deleted ones (they become tombstones). Scenario-time order (COR-053).
        var replies = await _dbContext.Posts
            .AsNoTracking()
            .Where(post => post.ParentPostId == focused.Id && post.ExerciseId == exerciseId)
            .OrderBy(post => post.CreatedScenarioTime)
            .ThenBy(post => post.Id)
            .ToListAsync(cancellationToken);

        // Each post is projected once. In a malformed cycle (the focused post's parent is also one of its replies)
        // the same post is both an ancestor and a reply, so the batch is de-duplicated by id.
        var toProject = new List<Post>(ancestors.Count + 1 + replies.Count);
        var queued = new HashSet<Guid>();
        foreach (var post in ancestors.Append(focused).Concat(replies.Where(reply => reply.DeletedAt is null)))
        {
            if (queued.Add(post.Id))
            {
                toProject.Add(post);
            }
        }

        var projected = await ProjectAsync(toProject, exerciseId, cancellationToken);
        var projectedById = new Dictionary<Guid, ParticipantPostDto>(toProject.Count);
        for (var index = 0; index < toProject.Count; index++)
        {
            projectedById.Add(toProject[index].Id, projected[index]);
        }

        var replyDtos = new List<ThreadReplyDto>(replies.Count);
        foreach (var reply in replies)
        {
            // A soft-deleted reply is a tombstone built from its id, author and scenario time only (D1-009).
            replyDtos.Add(reply.DeletedAt is null
                ? ThreadReplyDto.Visible(projectedById[reply.Id], focused.AuthorPersonaId)
                : ThreadReplyDto.TakenDown(reply, focused.AuthorPersonaId));
        }

        return new ThreadResponseDto(
            ancestors.Select(ancestor => projectedById[ancestor.Id]).ToList(),
            projectedById[focused.Id],
            replyDtos);
    }

    /// <summary>
    /// Walks up from <paramref name="focused"/> one parent at a time and returns the visible ancestors, root first.
    /// The walk is iterative and keeps a visited set, so a cycle cannot loop. It takes at most
    /// <see cref="MaxAncestorDepth"/> hops. It stops at the first parent that is unknown or outside
    /// <paramref name="exerciseId"/>, so it never crosses into another exercise. A soft-deleted ancestor is
    /// omitted, but the walk continues through it to its own parent.
    /// </summary>
    /// <param name="focused">The focused post.</param>
    /// <param name="exerciseId">The resolved exercise scope.</param>
    /// <param name="cancellationToken">Cancellation token.</param>
    /// <returns>The visible ancestors, root first and the direct parent last.</returns>
    private async Task<List<Post>> ReadAncestorsAsync(Post focused, Guid exerciseId, CancellationToken cancellationToken)
    {
        var nearestFirst = new List<Post>();
        var visited = new HashSet<Guid> { focused.Id };
        var nextParentId = focused.ParentPostId;
        var hops = 0;

        while (nextParentId is { } parentId && hops < MaxAncestorDepth && visited.Add(parentId))
        {
            hops++;

            var parent = await _dbContext.Posts
                .AsNoTracking()
                .FirstOrDefaultAsync(post => post.Id == parentId && post.ExerciseId == exerciseId, cancellationToken);

            if (parent is null)
            {
                break;
            }

            if (parent.DeletedAt is null)
            {
                nearestFirst.Add(parent);
            }

            nextParentId = parent.ParentPostId;
        }

        nearestFirst.Reverse();
        return nearestFirst;
    }

    /// <summary>Projects <paramref name="posts"/> in one batch through the participant projector.</summary>
    /// <param name="posts">The non-deleted posts to project.</param>
    /// <param name="exerciseId">The resolved exercise scope, matched against the session's own exercise.</param>
    /// <param name="cancellationToken">Cancellation token.</param>
    /// <returns>One participant DTO per post, in input order.</returns>
    /// <exception cref="InvalidOperationException">The projector broke its same-count, same-order contract.</exception>
    private async Task<IReadOnlyList<ParticipantPostDto>> ProjectAsync(
        List<Post> posts, Guid exerciseId, CancellationToken cancellationToken)
    {
        var options = await BuildProjectionOptionsAsync(exerciseId, cancellationToken);
        var projected = await _projector.ProjectAsync(posts, options, cancellationToken);

        // The projector promises one DTO per post, in input order. If that is ever broken, fail loudly rather than
        // attach one post's content to another post's id.
        if (projected.Count != posts.Count)
        {
            throw new InvalidOperationException(
                $"IParticipantPostProjector returned {projected.Count} posts for {posts.Count} inputs.");
        }

        for (var index = 0; index < posts.Count; index++)
        {
            if (!string.Equals(projected[index].Id, posts[index].Id.ToString(), StringComparison.OrdinalIgnoreCase))
            {
                throw new InvalidOperationException(
                    "IParticipantPostProjector returned its posts out of input order.");
            }
        }

        return projected;
    }

    /// <summary>
    /// Builds the projector options. <c>viewer</c> state is requested only for a live participant session whose
    /// bound persona belongs to the resolved exercise. Staff, read-only and persona-less sessions get none.
    /// </summary>
    /// <param name="exerciseId">The resolved exercise scope.</param>
    /// <param name="cancellationToken">Cancellation token.</param>
    /// <returns>The projection options for this request.</returns>
    private async Task<PostProjectionOptions> BuildProjectionOptionsAsync(Guid exerciseId, CancellationToken cancellationToken)
    {
        var sessionPersona = await _sessionPersonaAccessor.GetCurrentSessionPersonaAsync(cancellationToken);

        if (sessionPersona is not null
            && string.Equals(sessionPersona.Kind, ParticipantSessionKind, StringComparison.Ordinal)
            && sessionPersona.ExerciseId == exerciseId)
        {
            return new PostProjectionOptions(sessionPersona.PersonaId, IncludeViewerState: true);
        }

        return new PostProjectionOptions();
    }
}
