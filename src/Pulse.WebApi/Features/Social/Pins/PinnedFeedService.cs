namespace Pulse.WebApi.Features.Social.Pins;

using Microsoft.EntityFrameworkCore;
using Pulse.WebApi.Data;
using Pulse.WebApi.Data.Entities;
using Pulse.WebApi.Features.Social.Follows;

/// <summary>
/// The Pinned tab read behind <c>GET /api/feed/pinned</c> (demo-feedback DF-5, story 04). Scoped lifetime, matching
/// the request's <see cref="PulseDbContext"/> and <see cref="IExerciseContext"/>.
/// </summary>
/// <remarks>
/// <para>
/// <b>Order (DF-5).</b> Exercise pins first, newest pin first (<see cref="Post.PinnedForAllAt"/>); then the caller's own
/// <c>pin</c> and <c>like</c> reactions merged, newest reaction first. Each post appears once, with reason precedence
/// <c>exercise</c> &gt; <c>pin</c> &gt; <c>like</c>; a post the caller both pinned and liked sits where its newest
/// reaction puts it. Replies are included, taken-down posts are excluded, and the list holds at most
/// <see cref="MaxItems"/> items. Only scenario instants order it, never the wall clock (COR-053).
/// </para>
/// <para>
/// <b>Who gets what.</b> Only a PARTICIPANT session bound to a persona in this exercise has personal pins and likes
/// (the same positive allowlist the feed's viewer state uses, DP-10). Every other caller in scope (a staff session,
/// a shared read-only session, a session with no persona) gets the exercise pins only, with no <c>viewer</c>.
/// </para>
/// <para>
/// <b>Isolation (COR-001).</b> Every read goes through the exercise-scoped <c>Posts</c> / <c>PostReactions</c> sets,
/// plus explicit <c>ExerciseId</c> predicates as defense in depth, so no post, persona or reaction from another
/// exercise can contribute. An unresolved scope reads nothing.
/// </para>
/// <para>
/// <b>Two worlds (XC-002).</b> Items are projected through <see cref="IParticipantPostProjector"/>, the same
/// participant-safe projection as the feed: no provenance and never who pinned a post for everyone.
/// </para>
/// </remarks>
public sealed class PinnedFeedService
{
    /// <summary>The most items one Pinned read returns (DF-5).</summary>
    public const int MaxItems = 200;

    /// <summary>The only session kind whose persona has personal pins and likes on this tab (DP-10).</summary>
    private const string ParticipantSessionKind = "participant";

    private readonly PulseDbContext _dbContext;
    private readonly IExerciseContext _exerciseContext;
    private readonly ICurrentSessionPersonaAccessor _sessionPersonaAccessor;
    private readonly IParticipantPostProjector _projector;

    /// <summary>Creates the service over the request-scoped persistence context, scope, session identity and projector.</summary>
    /// <param name="dbContext">The persistence context whose global query filter scopes every read.</param>
    /// <param name="exerciseContext">The resolved exercise scope (COR-001), the only scoping source.</param>
    /// <param name="sessionPersonaAccessor">Resolves the caller's session-bound persona (personal pins and likes).</param>
    /// <param name="projector">The participant projection every item goes through (XC-002).</param>
    public PinnedFeedService(
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

    /// <summary>Reads the caller's Pinned tab in DF-5 order.</summary>
    /// <param name="cancellationToken">Cancellation token.</param>
    /// <returns>The items; empty (never unscoped) when the exercise scope is unresolved.</returns>
    public async Task<PinnedFeedResponse> GetAsync(CancellationToken cancellationToken = default)
    {
        // Defense in depth (COR-001): the endpoint already 401s an unresolved scope, and the central filter would
        // match zero rows; any other caller still gets nothing rather than an unscoped read.
        var scope = _exerciseContext.CurrentExerciseId;
        if (scope is null || scope.Value == Guid.Empty)
        {
            return new PinnedFeedResponse([]);
        }

        var exerciseId = scope.Value;
        var viewerPersonaId = await ResolveViewerAsync(exerciseId, cancellationToken);

        // 1. Exercise pins, newest pin first.
        var exercisePins = await _dbContext.Posts
            .AsNoTracking()
            .Where(post => post.ExerciseId == exerciseId && post.PinnedForAllAt != null && post.DeletedAt == null)
            .OrderByDescending(post => post.PinnedForAllAt)
            .ThenByDescending(post => post.Id)
            .Select(post => post.Id)
            .Take(MaxItems)
            .ToListAsync(cancellationToken);

        var ordered = new List<(Guid PostId, string Reason)>(MaxItems);
        var seen = new HashSet<Guid>();
        foreach (var postId in exercisePins)
        {
            if (seen.Add(postId))
            {
                ordered.Add((postId, PinnedFeedReasons.Exercise));
            }
        }

        // 2. The caller's own pins and likes, newest reaction first, folded to one entry per post.
        if (viewerPersonaId is { } viewer && ordered.Count < MaxItems)
        {
            foreach (var entry in await ReadPersonalAsync(exerciseId, viewer, cancellationToken))
            {
                if (ordered.Count == MaxItems)
                {
                    break;
                }

                if (seen.Add(entry.PostId))
                {
                    ordered.Add(entry);
                }
            }
        }

        if (ordered.Count == 0)
        {
            return new PinnedFeedResponse([]);
        }

        // 3. Load the posts (still live, still in scope) and project them like the feed does.
        var ids = ordered.Select(entry => entry.PostId).ToArray();
        var posts = await _dbContext.Posts
            .AsNoTracking()
            .Where(post => post.ExerciseId == exerciseId && ids.Contains(post.Id) && post.DeletedAt == null)
            .ToListAsync(cancellationToken);
        var postsById = posts.ToDictionary(post => post.Id);

        // A post taken down between step 1/2 and here is simply dropped (the PostRemoved push covers clients).
        var kept = ordered.Where(entry => postsById.ContainsKey(entry.PostId)).ToArray();
        var options = viewerPersonaId is { } persona
            ? new PostProjectionOptions(persona, IncludeViewerState: true)
            : new PostProjectionOptions();
        var projected = await _projector.ProjectAsync(
            kept.Select(entry => postsById[entry.PostId]).ToArray(), options, cancellationToken);

        return new PinnedFeedResponse(
            kept.Zip(projected, (entry, post) => new PinnedFeedItemDto(entry.Reason, post)).ToArray());
    }

    /// <summary>
    /// The caller's active <c>pin</c> and <c>like</c> reactions on live posts in this exercise, newest reaction first,
    /// one entry per post (a pin outranks a like on the same post; the post sits at its newest reaction).
    /// </summary>
    /// <remarks>
    /// The filtered unique index holds at most one active row per (post, persona, kind), so a post contributes at most
    /// two rows here; reading <c>2 × MaxItems</c> rows therefore always yields at least <see cref="MaxItems"/>
    /// distinct posts when that many exist.
    /// </remarks>
    private async Task<IReadOnlyList<(Guid PostId, string Reason)>> ReadPersonalAsync(
        Guid exerciseId, Guid viewerPersonaId, CancellationToken cancellationToken)
    {
        var rows = await (
                from reaction in _dbContext.PostReactions.AsNoTracking()
                where reaction.ExerciseId == exerciseId
                    && reaction.PersonaId == viewerPersonaId
                    && reaction.DeletedAt == null
                    && (reaction.Kind == ReactionKinds.Pin || reaction.Kind == ReactionKinds.Like)
                join post in _dbContext.Posts.AsNoTracking() on reaction.PostId equals post.Id
                where post.ExerciseId == exerciseId && post.DeletedAt == null
                orderby reaction.CreatedScenarioTime descending, reaction.Id descending
                select new { reaction.PostId, reaction.Kind })
            .Take(MaxItems * 2)
            .ToListAsync(cancellationToken);

        var pinned = rows
            .Where(row => string.Equals(row.Kind, ReactionKinds.Pin, StringComparison.Ordinal))
            .Select(row => row.PostId)
            .ToHashSet();

        var result = new List<(Guid PostId, string Reason)>();
        var seen = new HashSet<Guid>();
        foreach (var row in rows)
        {
            if (seen.Add(row.PostId))
            {
                result.Add((row.PostId, pinned.Contains(row.PostId) ? PinnedFeedReasons.Pin : PinnedFeedReasons.Like));
            }
        }

        return result;
    }

    /// <summary>
    /// The viewing persona when the caller is a PARTICIPANT session bound to a persona in this exercise; otherwise
    /// <c>null</c> (exercise pins only, no viewer state).
    /// </summary>
    private async Task<Guid?> ResolveViewerAsync(Guid exerciseId, CancellationToken cancellationToken)
    {
        var sessionPersona = await _sessionPersonaAccessor.GetCurrentSessionPersonaAsync(cancellationToken);
        return sessionPersona is not null
            && string.Equals(sessionPersona.Kind, ParticipantSessionKind, StringComparison.Ordinal)
            && sessionPersona.ExerciseId == exerciseId
                ? sessionPersona.PersonaId
                : null;
    }
}
