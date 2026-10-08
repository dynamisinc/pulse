namespace Pulse.WebApi.Features.Social;

using Microsoft.EntityFrameworkCore;
using Pulse.WebApi.Data;
using Pulse.WebApi.Data.Entities;
using Pulse.WebApi.Features.Social.Follows;

/// <summary>
/// The participant read path behind <c>GET /api/feed</c> and <c>GET /api/threads/{postId}</c> (SOC-080,
/// SOC-010). Queries <see cref="PulseDbContext.Posts"/> — which the central exercise-scoping global query
/// filter confines to the current run automatically (COR-001) — and narrows every row through the FROZEN
/// <see cref="ParticipantPostDto.FromPost"/>, the sole server-side XC-002 projection. Provenance
/// (<c>origin</c>/<c>actingHumanId</c>/<c>createdWallClock</c>/<c>injectId</c>) is dropped BEFORE
/// serialization, not merely unread by the client — this is the retirement of finding S2-2: a bypassed or
/// compromised client can never recover it because it is never on the wire.
/// </summary>
/// <remarks>
/// <para>
/// Scoped lifetime (registered by <see cref="FeedEndpoints.AddSocialFeedRead"/>) so it shares the request's
/// <see cref="PulseDbContext"/> and <see cref="IExerciseContext"/>. Scenario time is emitted exactly as
/// persisted (<c>CreatedScenarioTime</c> round-trip) — the read path never substitutes or re-derives it from the
/// server clock (COR-053), and the feed is ordered by it, never by wall-clock.
/// </para>
/// <para>
/// <b>demo-polish BP.</b> The two feeds are projected through <see cref="IParticipantPostProjector"/> (counts =
/// baseline + real, media URLs, <c>inReplyTo</c>, and <c>viewer</c> for a persona-bound participant session).
/// They are top-level only unless <c>includeReplies</c> is set (DP-5), and capped at <see cref="FeedTake"/>.
/// </para>
/// </remarks>
public sealed class PostReadService
{
    /// <summary>The most posts one feed read returns (the newest by scenario time).</summary>
    public const int FeedTake = 200;

    /// <summary>The only session kind whose persona gets <c>viewer</c> state — never staff (DP-10).</summary>
    private const string ParticipantSessionKind = "participant";

    private readonly PulseDbContext _dbContext;
    private readonly IExerciseContext _exerciseContext;
    private readonly ICurrentSessionPersonaAccessor _sessionPersonaAccessor;
    private readonly FollowService _followService;
    private readonly IParticipantPostProjector _projector;

    /// <summary>Creates the service over the request-scoped persistence context, exercise scope, and follow graph.</summary>
    /// <param name="dbContext">The persistence context whose global query filter scopes every read.</param>
    /// <param name="exerciseContext">The resolved exercise scope, read for a defense-in-depth fail-closed guard.</param>
    /// <param name="sessionPersonaAccessor">Resolves the caller's session-bound persona (Following scope, viewer state).</param>
    /// <param name="followService">The follow graph the Following scope filters authors by.</param>
    /// <param name="projector">The participant projection every feed row goes through (XC-002).</param>
    public PostReadService(
        PulseDbContext dbContext,
        IExerciseContext exerciseContext,
        ICurrentSessionPersonaAccessor sessionPersonaAccessor,
        FollowService followService,
        IParticipantPostProjector projector)
    {
        ArgumentNullException.ThrowIfNull(dbContext);
        ArgumentNullException.ThrowIfNull(exerciseContext);
        ArgumentNullException.ThrowIfNull(sessionPersonaAccessor);
        ArgumentNullException.ThrowIfNull(followService);
        ArgumentNullException.ThrowIfNull(projector);

        _dbContext = dbContext;
        _exerciseContext = exerciseContext;
        _sessionPersonaAccessor = sessionPersonaAccessor;
        _followService = followService;
        _projector = projector;
    }

    /// <summary>
    /// Reads the current exercise's public feed: the newest <see cref="FeedTake"/> non-soft-deleted posts in
    /// scope (<see cref="Post.DeletedAt"/> is <c>null</c>), top-level only unless
    /// <paramref name="includeReplies"/>, newest-first by <see cref="Post.CreatedScenarioTime"/> (COR-053), each
    /// projected to the participant-safe <see cref="ParticipantPostDto"/>. The central query filter supplies the
    /// exercise scope (COR-001) — no client-supplied <c>exerciseId</c> is ever consulted.
    /// </summary>
    /// <param name="includeReplies">Whether replies are included too (DP-5); top-level only when <c>false</c>.</param>
    /// <param name="cancellationToken">Cancellation token.</param>
    /// <returns>The in-scope participant-safe post set, newest scenario time first.</returns>
    public async Task<IReadOnlyList<ParticipantPostDto>> GetFeedAsync(bool includeReplies, CancellationToken cancellationToken)
    {
        // Defense in depth (COR-001, fail closed): the endpoint already 401s on an unresolved scope and the
        // PulseDbContext global query filter independently collapses an unset scope to zero rows. Reading the
        // scope here too means any future/alternate caller reaching this service without the endpoint guard
        // still gets nothing, never an accidental unscoped read.
        if (_exerciseContext.CurrentExerciseId is not { } scope)
        {
            return Array.Empty<ParticipantPostDto>();
        }

        var sessionPersona = await _sessionPersonaAccessor.GetCurrentSessionPersonaAsync(cancellationToken);

        var posts = await NewestFirst(VisiblePosts(includeReplies)).ToListAsync(cancellationToken);

        return await _projector.ProjectAsync(posts, ViewerOptionsFor(sessionPersona, scope), cancellationToken);
    }

    /// <summary>
    /// Reads the FOLLOWING-scoped feed (SOC-081, <c>feeds-discovery/02</c>): the in-scope, non-soft-deleted
    /// posts authored by personas the caller's session-bound persona actually follows, newest scenario time
    /// first, each narrowed to the participant-safe <see cref="ParticipantPostDto"/>.
    /// </summary>
    /// <remarks>
    /// <para>
    /// <b>An empty follow set yields an EMPTY feed — never the All-Posts fallback.</b> A caller who follows
    /// nobody (or whose session carries no persona at all) gets an empty list, not the unfiltered feed: a
    /// silent widening would be indistinguishable from the All Posts channel and would misrepresent the
    /// participant's own graph. The same is true of an unresolved scope, where the endpoint refuses first
    /// anyway.
    /// </para>
    /// <para>
    /// Exercise isolation is unchanged: the author filter is composed ON TOP of the central query filter
    /// (COR-001), and the followed-id set itself comes from the same scoped <c>Follows</c> read — so a followed
    /// persona from another exercise cannot exist to widen this result.
    /// </para>
    /// <para>
    /// The same feed rules apply as for the All Posts feed (demo-polish BP): top-level only unless
    /// <paramref name="includeReplies"/>, capped at <see cref="FeedTake"/>, projected with viewer state.
    /// </para>
    /// </remarks>
    /// <param name="includeReplies">Whether replies are included too (DP-5); top-level only when <c>false</c>.</param>
    /// <param name="cancellationToken">Cancellation token.</param>
    /// <returns>The in-scope posts authored by followed personas, newest scenario time first.</returns>
    public async Task<IReadOnlyList<ParticipantPostDto>> GetFollowingFeedAsync(bool includeReplies, CancellationToken cancellationToken)
    {
        if (_exerciseContext.CurrentExerciseId is not { } scope)
        {
            return Array.Empty<ParticipantPostDto>();
        }

        var sessionPersona = await _sessionPersonaAccessor.GetCurrentSessionPersonaAsync(cancellationToken);
        if (sessionPersona is null)
        {
            // No session-bound persona → no follow graph of one's own → an honest empty feed.
            return Array.Empty<ParticipantPostDto>();
        }

        var followedPersonaIds = await _followService.GetFollowingAsync(sessionPersona.PersonaId, cancellationToken);
        if (followedPersonaIds.Count == 0)
        {
            return Array.Empty<ParticipantPostDto>();
        }

        var followedSet = followedPersonaIds.ToArray();

        var posts = await NewestFirst(
                VisiblePosts(includeReplies).Where(post => followedSet.Contains(post.AuthorPersonaId)))
            .ToListAsync(cancellationToken);

        return await _projector.ProjectAsync(posts, ViewerOptionsFor(sessionPersona, scope), cancellationToken);
    }

    /// <summary>
    /// Reads the focused post of a thread — the in-scope, non-soft-deleted post with id
    /// <paramref name="postId"/>, narrowed to <see cref="ParticipantPostDto"/>, or <c>null</c> when no such
    /// post is in scope. B1 has NO parent/reply model (a <see cref="Data.Entities.Post"/> is post-only this
    /// phase), so the thread's ancestors and replies are always empty; the endpoint assembles them around
    /// this focused value. The lookup runs through the global query filter (a LINQ predicate, NOT
    /// <c>DbSet.Find</c>), so a cross-exercise id is simply not found — indistinguishable from an unknown id.
    /// </summary>
    /// <param name="postId">The focused post id.</param>
    /// <param name="cancellationToken">Cancellation token.</param>
    /// <returns>The participant-safe focused post, or <c>null</c> if it is not in scope.</returns>
    public async Task<ParticipantPostDto?> GetThreadAsync(Guid postId, CancellationToken cancellationToken)
    {
        if (_exerciseContext.CurrentExerciseId is null)
        {
            return null;
        }

        var post = await _dbContext.Posts
            .AsNoTracking()
            .FirstOrDefaultAsync(candidate => candidate.Id == postId && candidate.DeletedAt == null, cancellationToken);

        return post is null ? null : ParticipantPostDto.FromPost(post);
    }

    /// <summary>
    /// Viewer state only for a PARTICIPANT session bound to a persona in this exercise. A staff session (even
    /// one operating a persona) and a session with no persona get none (implementation.md §1.5.3).
    /// </summary>
    private static PostProjectionOptions ViewerOptionsFor(CurrentSessionPersona? sessionPersona, Guid scope) =>
        sessionPersona is not null
        && string.Equals(sessionPersona.Kind, ParticipantSessionKind, StringComparison.Ordinal)
        && sessionPersona.ExerciseId == scope
            ? new PostProjectionOptions(sessionPersona.PersonaId, IncludeViewerState: true)
            : new PostProjectionOptions();

    /// <summary>
    /// Newest scenario time first (COR-053 — never wall-clock), then <see cref="FeedTake"/>. The id tie-break
    /// keeps the cut-off stable when two posts share a scenario instant.
    /// </summary>
    private static IQueryable<Post> NewestFirst(IQueryable<Post> posts) =>
        posts
            .OrderByDescending(post => post.CreatedScenarioTime)
            .ThenByDescending(post => post.Id)
            .Take(FeedTake);

    /// <summary>The in-scope, non-soft-deleted posts; top-level only unless replies are asked for (DP-5).</summary>
    private IQueryable<Post> VisiblePosts(bool includeReplies)
    {
        var posts = _dbContext.Posts.AsNoTracking().Where(post => post.DeletedAt == null);
        return includeReplies ? posts : posts.Where(post => post.ParentPostId == null);
    }
}
