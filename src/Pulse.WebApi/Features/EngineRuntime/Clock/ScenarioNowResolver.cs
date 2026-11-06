namespace Pulse.WebApi.Features.EngineRuntime.Clock;

using Microsoft.EntityFrameworkCore;
using Pulse.WebApi.Data;
using Pulse.WebApi.Features.Channels.Contracts;

/// <summary>
/// The native <see cref="IScenarioNow"/> (engine-runtime/08, CLK-2): running clock → the world's latest NON-participant
/// post → wall-clock now.
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
/// <para><b>Participant posts never move the world's time (review CR-001).</b> With no clock running, a participant's
/// post carries the CLIENT's scenario instant (the frontend's mock clock sends its wall <c>new Date()</c>), so letting it
/// into this tier would let any participant drag the seed / cold-freeze start and every cold stamp to an instant of their
/// choosing — today's date in a past-dated world, or one near <see cref="DateTimeOffset.MaxValue"/>. Only staff-authored
/// and server-paced posts (controller-as-persona, engine, inject, noise) say where the world is. The predicate is
/// <c>Origin != participant</c> (the shared origin vocabulary, <see cref="ChannelVocabulary.OriginParticipant"/>).</para>
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

    /// <summary>
    /// The latest <c>CreatedScenarioTime</c> among the exercise's NON-participant posts, or <c>null</c> when it has none.
    /// </summary>
    private Task<DateTimeOffset?> LatestPostScenarioTimeAsync(Guid exerciseId, CancellationToken cancellationToken)
    {
        // IgnoreQueryFilters() + the EXPLICIT predicate on every path: the predicate is the isolation guarantee (one
        // exercise, server-resolved id), and it is identical to what the central filter would add for a same-exercise scope.
        return _dbContext.Posts
            .IgnoreQueryFilters()
            .AsNoTracking()
            .Where(post => post.ExerciseId == exerciseId && post.Origin != ChannelVocabulary.OriginParticipant)
            .MaxAsync(post => (DateTimeOffset?)post.CreatedScenarioTime, cancellationToken);
    }
}
