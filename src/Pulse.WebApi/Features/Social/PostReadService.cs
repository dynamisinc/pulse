namespace Pulse.WebApi.Features.Social;

using Microsoft.EntityFrameworkCore;
using Pulse.WebApi.Data;

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
/// Scoped lifetime (registered by <see cref="FeedEndpoints.AddSocialFeedRead"/>) so it shares the request's
/// <see cref="PulseDbContext"/> and <see cref="IExerciseContext"/>. Scenario time is emitted exactly as
/// persisted (<see cref="ParticipantPostDto.FromPost"/> reads <c>CreatedScenarioTime</c> round-trip) — the
/// read path never substitutes or re-derives it from the server clock (COR-053).
/// </remarks>
public sealed class PostReadService
{
    private readonly PulseDbContext _dbContext;
    private readonly IExerciseContext _exerciseContext;

    /// <summary>Creates the service over the request-scoped persistence context and exercise scope.</summary>
    /// <param name="dbContext">The persistence context whose global query filter scopes every read.</param>
    /// <param name="exerciseContext">The resolved exercise scope, read for a defense-in-depth fail-closed guard.</param>
    public PostReadService(PulseDbContext dbContext, IExerciseContext exerciseContext)
    {
        ArgumentNullException.ThrowIfNull(dbContext);
        ArgumentNullException.ThrowIfNull(exerciseContext);

        _dbContext = dbContext;
        _exerciseContext = exerciseContext;
    }

    /// <summary>
    /// Reads the current exercise's public feed: every non-soft-deleted post in scope
    /// (<see cref="Data.Entities.Post.DeletedAt"/> is <c>null</c>), newest-first by
    /// <see cref="Data.Entities.Post.CreatedScenarioTime"/> (COR-053), each narrowed to the participant-safe
    /// <see cref="ParticipantPostDto"/>. The central query filter supplies the exercise scope (COR-001) — no
    /// client-supplied <c>exerciseId</c> is ever consulted.
    /// </summary>
    /// <param name="cancellationToken">Cancellation token.</param>
    /// <returns>The in-scope participant-safe post set, newest scenario time first.</returns>
    public async Task<IReadOnlyList<ParticipantPostDto>> GetFeedAsync(CancellationToken cancellationToken)
    {
        // Defense in depth (COR-001, fail closed): the endpoint already 401s on an unresolved scope and the
        // PulseDbContext global query filter independently collapses an unset scope to zero rows. Reading the
        // scope here too means any future/alternate caller reaching this service without the endpoint guard
        // still gets nothing, never an accidental unscoped read.
        if (_exerciseContext.CurrentExerciseId is null)
        {
            return Array.Empty<ParticipantPostDto>();
        }

        var posts = await _dbContext.Posts
            .Where(post => post.DeletedAt == null)
            .OrderByDescending(post => post.CreatedScenarioTime)
            .ToListAsync(cancellationToken);

        return posts.Select(ParticipantPostDto.FromPost).ToArray();
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
            .FirstOrDefaultAsync(candidate => candidate.Id == postId && candidate.DeletedAt == null, cancellationToken);

        return post is null ? null : ParticipantPostDto.FromPost(post);
    }
}
