namespace Pulse.WebApi.Features.EngineRuntime.Clock;

using Microsoft.EntityFrameworkCore;
using Pulse.WebApi.Data;

/// <summary>
/// The native <see cref="IScenarioNow"/> (engine-runtime/08, CLK-2): running clock → latest post → wall-clock now.
/// Scoped, matching the <see cref="PulseDbContext"/> unit of work it reads posts through.
/// </summary>
/// <remarks>
/// <para><b>How the post read stays inside one exercise (COR-001).</b> The read is ONE shape on every path:
/// <c>IgnoreQueryFilters()</c> PLUS an explicit <c>ExerciseId == exerciseId</c> predicate (the same pattern as the
/// demo-feedback/18 rehydrator and the ops seeders). The explicit predicate is the guarantee: it names exactly one
/// exercise whatever the request scope is. Going through the scoped set when the request happens to be scoped to that
/// same exercise would add the central filter's <c>ExerciseId == scope</c>, which is the identical predicate, so the
/// result is the same; and on every other path (an ops path with no request scope, a session refresh, a staff switch to
/// another exercise) the request's filter would wrongly hide the exercise's rows. One branch means one query shape to
/// review and test. Safe because the id is server-resolved (see <see cref="IScenarioNow"/>), never a client field, and
/// the query returns one aggregate instant of that exercise only. <see cref="Guid.Empty"/> reads nothing.</para>
/// <para>Soft-deleted posts count: the report's "now" already takes the latest of every post, and a takedown does not
/// move the world's time back.</para>
/// </remarks>
public sealed class ScenarioNowResolver : IScenarioNow
{
    private readonly PulseDbContext _dbContext;
    private readonly IExerciseClock _clock;
    private readonly TimeProvider _timeProvider;

    /// <summary>Creates the resolver.</summary>
    /// <param name="dbContext">The request's persistence context (read only when no clock is running).</param>
    /// <param name="clock">The native exercise clock (tier one).</param>
    /// <param name="timeProvider">The server wall clock (the last fallback).</param>
    public ScenarioNowResolver(
        PulseDbContext dbContext,
        IExerciseClock clock,
        TimeProvider timeProvider)
    {
        ArgumentNullException.ThrowIfNull(dbContext);
        ArgumentNullException.ThrowIfNull(clock);
        ArgumentNullException.ThrowIfNull(timeProvider);

        _dbContext = dbContext;
        _clock = clock;
        _timeProvider = timeProvider;
    }

    /// <inheritdoc />
    public async Task<DateTimeOffset?> FindAsync(Guid exerciseId, CancellationToken cancellationToken = default)
    {
        if (exerciseId == Guid.Empty)
        {
            return null;
        }

        // Tier one, in memory: a running (or frozen, or rehydrated) clock answers without touching the database.
        if (_clock.CurrentScenarioTime(exerciseId) is { } clockTime)
        {
            return clockTime;
        }

        return await LatestPostScenarioTimeAsync(exerciseId, cancellationToken).ConfigureAwait(false);
    }

    /// <inheritdoc />
    public async Task<DateTimeOffset> GetAsync(
        Guid exerciseId,
        DateTimeOffset wallClockNow,
        CancellationToken cancellationToken = default) =>
        await FindAsync(exerciseId, cancellationToken).ConfigureAwait(false) ?? wallClockNow;

    /// <inheritdoc />
    public async Task<DateTimeOffset> GetAsync(Guid exerciseId, CancellationToken cancellationToken = default) =>
        await FindAsync(exerciseId, cancellationToken).ConfigureAwait(false) ?? _timeProvider.GetUtcNow();

    /// <summary>The latest <c>CreatedScenarioTime</c> among the exercise's posts, or <c>null</c> when it has none.</summary>
    private Task<DateTimeOffset?> LatestPostScenarioTimeAsync(Guid exerciseId, CancellationToken cancellationToken)
    {
        // IgnoreQueryFilters() + the EXPLICIT predicate on every path: the predicate is the isolation guarantee (one
        // exercise, server-resolved id), and it is identical to what the central filter would add for a same-exercise scope.
        return _dbContext.Posts
            .IgnoreQueryFilters()
            .AsNoTracking()
            .Where(post => post.ExerciseId == exerciseId)
            .MaxAsync(post => (DateTimeOffset?)post.CreatedScenarioTime, cancellationToken);
    }
}
