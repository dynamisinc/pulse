namespace Pulse.WebApi.Features.Social.Threads;

using Microsoft.EntityFrameworkCore;
using Pulse.WebApi.Data;

/// <summary>
/// The real <see cref="IReplyParentResolver"/> (demo-polish B2, DP-8): resolves a client-supplied
/// <c>parentPostId</c> to a post in the CURRENT exercise that has not been taken down. <c>POST /api/posts</c> (BP's
/// ingest) calls it; this type never writes anything.
/// </summary>
/// <remarks>
/// <para>
/// <b>Non-disclosing by construction (COR-001, DP-16).</b> An unparseable id, an unknown id, another exercise's
/// real post and a soft-deleted post all return the SAME <see cref="NotFound"/> value, so the caller cannot tell
/// them apart and a cross-exercise id never confirms that it exists. The schema's single-column self-FK does not
/// stop a reply in exercise A from naming a post in exercise B (DP-16), so this check is the guard.
/// </para>
/// <para>
/// <b>Scope comes only from <see cref="IExerciseContext"/>.</b> The lookup goes through the central exercise query
/// filter and ALSO states the <c>ExerciseId</c> predicate explicitly (the same defence in depth as
/// <c>PostAttributionResolver</c>), so it stays scoped even if a future refactor adds <c>IgnoreQueryFilters</c>. An
/// unresolved scope fails closed to <see cref="NotFound"/>. The lookup is a LINQ predicate, never
/// <c>DbSet.Find</c> (which can return a tracked entity without running the filter).
/// </para>
/// </remarks>
public sealed class ReplyParentResolver : IReplyParentResolver
{
    /// <summary>The single <c>None</c> result: no parent was requested (a top-level post).</summary>
    private static readonly ReplyParentResult None = new(ReplyParentOutcome.None, null);

    /// <summary>
    /// The single <c>NotFound</c> result, shared by every failure reason so the four cases are the same value.
    /// </summary>
    private static readonly ReplyParentResult NotFound = new(ReplyParentOutcome.NotFound, null);

    private readonly PulseDbContext _dbContext;
    private readonly IExerciseContext _exerciseContext;

    /// <summary>Creates the resolver over the request-scoped persistence context and exercise scope.</summary>
    /// <param name="dbContext">The persistence context whose global query filter scopes the lookup.</param>
    /// <param name="exerciseContext">The resolved exercise scope (COR-001), the only source of scope.</param>
    public ReplyParentResolver(PulseDbContext dbContext, IExerciseContext exerciseContext)
    {
        ArgumentNullException.ThrowIfNull(dbContext);
        ArgumentNullException.ThrowIfNull(exerciseContext);

        _dbContext = dbContext;
        _exerciseContext = exerciseContext;
    }

    /// <inheritdoc />
    /// <remarks>
    /// Returns <see cref="ReplyParentOutcome.None"/> only for a null or empty string. Whitespace or any other
    /// non-GUID text is unparseable and therefore <see cref="ReplyParentOutcome.NotFound"/>: a malformed parent must
    /// be rejected, not silently posted as a top-level post. The resolved parent is read with
    /// <c>AsNoTracking</c>, so the caller's later <c>SaveChanges</c> cannot modify it by accident.
    /// </remarks>
    public async Task<ReplyParentResult> ResolveAsync(string? parentPostId, CancellationToken cancellationToken)
    {
        if (string.IsNullOrEmpty(parentPostId))
        {
            return None;
        }

        // Fail closed: with no resolved scope, nothing can be a parent. Guid.Empty is the unset sentinel that no
        // persisted row carries (the write guard forbids it), so it is treated exactly like null.
        if (_exerciseContext.CurrentExerciseId is not { } exerciseId || exerciseId == Guid.Empty)
        {
            return NotFound;
        }

        if (!Guid.TryParse(parentPostId, out var parentId) || parentId == Guid.Empty)
        {
            return NotFound;
        }

        var parent = await _dbContext.Posts
            .AsNoTracking()
            .FirstOrDefaultAsync(
                post => post.Id == parentId && post.ExerciseId == exerciseId && post.DeletedAt == null,
                cancellationToken);

        return parent is null ? NotFound : new ReplyParentResult(ReplyParentOutcome.Resolved, parent);
    }
}
