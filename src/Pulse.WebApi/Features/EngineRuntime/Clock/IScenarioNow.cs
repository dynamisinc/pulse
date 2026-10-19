namespace Pulse.WebApi.Features.EngineRuntime.Clock;

/// <summary>
/// The ONE source of an exercise's "scenario now" (engine-runtime/08, decision CLK-2; COR-053). In order:
/// <list type="number">
///   <item><description>the running exercise clock (<see cref="IExerciseClock.CurrentScenarioTime"/>: live, or
///   rehydrated after a restart by demo-feedback/18);</description></item>
///   <item><description>else the latest <c>CreatedScenarioTime</c> among THAT exercise's posts (where the world
///   is);</description></item>
///   <item><description>else wall-clock now.</description></item>
/// </list>
/// Every former reader of the retired <c>Exercise.CurrentScenarioTime</c> placeholder reads this instead, and a cold
/// clock is started at its value (CLK-1: the engine content seed, a Freeze on a never-started clock).
/// </summary>
/// <remarks>
/// <para><b>Cost.</b> The database is touched only when no clock is running: then ONE <c>MAX(CreatedScenarioTime)</c>
/// query over the exercise's posts. With a running clock the answer is in memory.</para>
/// <para><b>Isolation (COR-001).</b> Callers pass a SERVER-resolved exercise id only (the request's
/// <c>IExerciseContext</c> scope, a server-issued session's bound exercise, an ops-resolved exercise), never a client
/// field. The post read is confined to that one exercise, so another exercise's posts never inform its scenario
/// now.</para>
/// </remarks>
public interface IScenarioNow
{
    /// <summary>
    /// The exercise's scenario now when it has one: the running clock, else its latest post's scenario time, else
    /// <c>null</c> (no clock and no posts). For callers whose own last fallback is not wall-clock now.
    /// </summary>
    /// <param name="exerciseId">A server-resolved exercise id. <see cref="Guid.Empty"/> yields <c>null</c>.</param>
    /// <param name="cancellationToken">Cancellation token.</param>
    /// <returns>The scenario instant, or <c>null</c>.</returns>
    Task<DateTimeOffset?> FindAsync(Guid exerciseId, CancellationToken cancellationToken = default);

    /// <summary>
    /// The exercise's scenario now: the running clock, else its latest post's scenario time, else
    /// <paramref name="wallClockNow"/> — the caller's ONE server clock read for the operation, so an exercise with no
    /// clock and no posts stamps exactly the instant it stamped before this resolver existed.
    /// </summary>
    /// <param name="exerciseId">A server-resolved exercise id.</param>
    /// <param name="wallClockNow">The operation's server wall-clock read (the final fallback).</param>
    /// <param name="cancellationToken">Cancellation token.</param>
    /// <returns>The scenario instant.</returns>
    Task<DateTimeOffset> GetAsync(Guid exerciseId, DateTimeOffset wallClockNow, CancellationToken cancellationToken = default);

    /// <summary>
    /// The exercise's scenario now, falling back to the host <see cref="TimeProvider"/>'s now when the exercise has
    /// neither a running clock nor posts.
    /// </summary>
    /// <param name="exerciseId">A server-resolved exercise id.</param>
    /// <param name="cancellationToken">Cancellation token.</param>
    /// <returns>The scenario instant.</returns>
    Task<DateTimeOffset> GetAsync(Guid exerciseId, CancellationToken cancellationToken = default);
}
