namespace Pulse.WebApi.Features.EngineRuntime.Clock;

using System.Collections.Concurrent;

/// <summary>
/// The native COR-050 exercise clock — the v1 <see cref="IExerciseClock"/> provider. Holds one independently
/// mutable scenario-time state per exercise (keyed by <c>exerciseId</c>) so a freeze or jump on one exercise
/// can never move another's minute (COR-001); isolation is structural — there is no shared clock and this is
/// an in-memory runtime service, not a persisted <see cref="Pulse.WebApi.Data.IExerciseScoped"/> entity.
///
/// <para>Scenario time is derived from a monotonic <see cref="TimeProvider"/> timestamp so it advances on its
/// own (COR-053: wall time drives the clock, never an engine timer directly). Freeze banks the elapsed
/// scenario time and stops accruing; unfreeze re-anchors so it resumes exactly where it stopped; a jump adds a
/// discrete offset. Registered as a singleton — it is the one clock the whole host reads.</para>
/// </summary>
public sealed class ExerciseClockService : IExerciseClock
{
    private readonly TimeProvider _timeProvider;
    private readonly ConcurrentDictionary<Guid, ExerciseClockState> _clocks = new();

    /// <summary>Creates the native clock over <paramref name="timeProvider"/> (the monotonic time source).</summary>
    /// <param name="timeProvider">The time source scenario time advances against; injected for testability.</param>
    public ExerciseClockService(TimeProvider timeProvider)
    {
        ArgumentNullException.ThrowIfNull(timeProvider);
        _timeProvider = timeProvider;
    }

    /// <inheritdoc />
    public void Start(Guid exerciseId, DateTimeOffset scenarioStart, TimeZoneInfo timeZone)
    {
        RequireExercise(exerciseId);
        ArgumentNullException.ThrowIfNull(timeZone);

        _clocks[exerciseId] = new ExerciseClockState(scenarioStart, timeZone, _timeProvider.GetTimestamp());
    }

    /// <inheritdoc />
    public void Freeze(Guid exerciseId) => Require(exerciseId).Freeze(_timeProvider);

    /// <inheritdoc />
    public void Unfreeze(Guid exerciseId) => Require(exerciseId).Unfreeze(_timeProvider);

    /// <inheritdoc />
    public void Jump(Guid exerciseId, int scenarioMinutes)
    {
        ArgumentOutOfRangeException.ThrowIfNegative(scenarioMinutes);
        Require(exerciseId).Jump(_timeProvider, scenarioMinutes);
    }

    /// <inheritdoc />
    public int CurrentScenarioMinute(Guid exerciseId) =>
        _clocks.TryGetValue(exerciseId, out var state) ? state.CurrentScenarioMinute(_timeProvider) : 0;

    /// <inheritdoc />
    public DateTimeOffset? CurrentScenarioTime(Guid exerciseId) =>
        _clocks.TryGetValue(exerciseId, out var state) ? state.CurrentScenarioTime(_timeProvider) : null;

    /// <inheritdoc />
    public bool IsFrozen(Guid exerciseId) =>
        _clocks.TryGetValue(exerciseId, out var state) && state.IsFrozen;

    /// <inheritdoc />
    public bool IsRunning(Guid exerciseId) =>
        _clocks.TryGetValue(exerciseId, out var state) && !state.IsFrozen;

    private ExerciseClockState Require(Guid exerciseId)
    {
        RequireExercise(exerciseId);

        if (!_clocks.TryGetValue(exerciseId, out var state))
        {
            throw new InvalidOperationException(
                $"Exercise {exerciseId} has no started clock; call Start before Freeze/Unfreeze/Jump.");
        }

        return state;
    }

    private static void RequireExercise(Guid exerciseId)
    {
        if (exerciseId == Guid.Empty)
        {
            throw new ArgumentException("A clock operation must name an exercise (COR-001).", nameof(exerciseId));
        }
    }

    /// <summary>
    /// One exercise's scenario-time state. Scenario elapsed time is <c>_scenarioElapsedAtAnchor</c> plus the
    /// wall time since <c>_wallAnchor</c> while running (0 while frozen). Freeze/unfreeze/jump re-bank the
    /// anchor so the minute stays monotonic across suspensions and leaps. Guarded by a lock so a controller's
    /// freeze/jump and the loop's reads stay consistent under concurrency.
    /// </summary>
    private sealed class ExerciseClockState
    {
        private readonly Lock _gate = new();
        private readonly DateTimeOffset _scenarioStart;
        private readonly TimeZoneInfo _timeZone;
        private TimeSpan _scenarioElapsedAtAnchor;
        private long _wallAnchor;
        private bool _frozen;

        public ExerciseClockState(DateTimeOffset scenarioStart, TimeZoneInfo timeZone, long wallAnchor)
        {
            _scenarioStart = scenarioStart;
            _timeZone = timeZone;
            _scenarioElapsedAtAnchor = TimeSpan.Zero;
            _wallAnchor = wallAnchor;
            _frozen = false;
        }

        public bool IsFrozen
        {
            get
            {
                lock (_gate)
                {
                    return _frozen;
                }
            }
        }

        public void Freeze(TimeProvider timeProvider)
        {
            lock (_gate)
            {
                if (_frozen)
                {
                    return;
                }

                _scenarioElapsedAtAnchor = ElapsedNoLock(timeProvider);
                _frozen = true;
            }
        }

        public void Unfreeze(TimeProvider timeProvider)
        {
            lock (_gate)
            {
                if (!_frozen)
                {
                    return;
                }

                _wallAnchor = timeProvider.GetTimestamp();
                _frozen = false;
            }
        }

        public void Jump(TimeProvider timeProvider, int scenarioMinutes)
        {
            lock (_gate)
            {
                _scenarioElapsedAtAnchor = ElapsedNoLock(timeProvider) + TimeSpan.FromMinutes(scenarioMinutes);
                _wallAnchor = timeProvider.GetTimestamp();
            }
        }

        public int CurrentScenarioMinute(TimeProvider timeProvider)
        {
            lock (_gate)
            {
                return (int)Math.Floor(ElapsedNoLock(timeProvider).TotalMinutes);
            }
        }

        public DateTimeOffset CurrentScenarioTime(TimeProvider timeProvider)
        {
            lock (_gate)
            {
                return TimeZoneInfo.ConvertTime(_scenarioStart + ElapsedNoLock(timeProvider), _timeZone);
            }
        }

        private TimeSpan ElapsedNoLock(TimeProvider timeProvider) =>
            _frozen
                ? _scenarioElapsedAtAnchor
                : _scenarioElapsedAtAnchor + timeProvider.GetElapsedTime(_wallAnchor);
    }
}
