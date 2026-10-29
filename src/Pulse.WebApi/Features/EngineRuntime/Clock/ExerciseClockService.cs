namespace Pulse.WebApi.Features.EngineRuntime.Clock;

using System.Collections.Concurrent;

/// <summary>
/// The native COR-050 exercise clock — the v1 <see cref="IExerciseClock"/> provider. Holds one independently
/// mutable scenario-time state per exercise (keyed by <c>exerciseId</c>) so a freeze or jump on one exercise
/// can never move another's minute (COR-001); isolation is structural — there is no shared clock.
///
/// <para>Scenario time is derived from a monotonic <see cref="TimeProvider"/> timestamp so it advances on its
/// own (COR-053: wall time drives the clock, never an engine timer directly). Freeze banks the elapsed
/// scenario time and stops accruing; unfreeze re-anchors so it resumes exactly where it stopped; a jump adds a
/// discrete offset. Registered as a singleton — it is the one clock the whole host reads.</para>
///
/// <para><b>Survives a restart (demo-feedback story 18, DF-24/DF-25).</b> Every anchor change
/// (<see cref="Start"/>, <see cref="Freeze"/>, <see cref="Unfreeze"/>, <see cref="Jump"/>) also records the matching
/// UTC wall instant beside the monotonic one and then tells the <see cref="IExerciseClockChangeSink"/>, which QUEUES
/// a write of the anchor to the exercise's <c>ExerciseRuntimeStates</c> row (fire-and-observe). The readers stay
/// synchronous and in-memory: <see cref="CurrentScenarioMinute"/> never waits on SQL. At startup the rehydrator
/// rebuilds each clock through <see cref="Restore"/> (<see cref="IExerciseClockPersistence"/>), which is not a
/// <see cref="Start"/> — the reaction loop's <c>ShouldStartClock</c> then sees a running or frozen clock and leaves
/// it alone.</para>
/// </summary>
public sealed class ExerciseClockService : IExerciseClock, IExerciseClockPersistence
{
    private readonly TimeProvider _timeProvider;
    private readonly IExerciseClockChangeSink _changeSink;
    private readonly IExerciseClockChangeObserver[] _observers;
    private readonly ConcurrentDictionary<Guid, ExerciseClockState> _clocks = new();

    /// <summary>Creates the native clock over <paramref name="timeProvider"/> with no persistence hook.</summary>
    /// <param name="timeProvider">The time source scenario time advances against; injected for testability.</param>
    public ExerciseClockService(TimeProvider timeProvider)
        : this(timeProvider, new NullExerciseClockChangeSink())
    {
    }

    /// <summary>
    /// Creates the native clock over <paramref name="timeProvider"/>, telling <paramref name="changeSink"/> after
    /// every anchor change (story 18's write-through).
    /// </summary>
    /// <param name="timeProvider">The time source scenario time advances against; injected for testability.</param>
    /// <param name="changeSink">Told after every Start/Freeze/Unfreeze/Jump; must never block or throw.</param>
    public ExerciseClockService(TimeProvider timeProvider, IExerciseClockChangeSink changeSink)
        : this(timeProvider, changeSink, [])
    {
    }

    /// <summary>
    /// Creates the native clock over <paramref name="timeProvider"/>, telling <paramref name="changeSink"/> after
    /// every anchor change and every <paramref name="observers"/> entry after every state change (including a
    /// <see cref="Restore"/> and a <see cref="Clear"/>; fix/noise-new-posts-clock's <c>ScenarioClockChanged</c> push).
    /// </summary>
    /// <param name="timeProvider">The time source scenario time advances against; injected for testability.</param>
    /// <param name="changeSink">Told after every Start/Freeze/Unfreeze/Jump; must never block or throw.</param>
    /// <param name="observers">Told after every state change; each must never block or throw.</param>
    public ExerciseClockService(
        TimeProvider timeProvider,
        IExerciseClockChangeSink changeSink,
        IEnumerable<IExerciseClockChangeObserver> observers)
    {
        ArgumentNullException.ThrowIfNull(timeProvider);
        ArgumentNullException.ThrowIfNull(changeSink);
        ArgumentNullException.ThrowIfNull(observers);
        _timeProvider = timeProvider;
        _changeSink = changeSink;
        _observers = [.. observers];
    }

    /// <inheritdoc />
    public void Start(Guid exerciseId, DateTimeOffset scenarioStart, TimeZoneInfo timeZone)
    {
        RequireExercise(exerciseId);
        ArgumentNullException.ThrowIfNull(timeZone);

        _clocks[exerciseId] = new ExerciseClockState(
            scenarioStart,
            timeZone,
            TimeSpan.Zero,
            _timeProvider.GetTimestamp(),
            _timeProvider.GetUtcNow(),
            frozen: false);
        NotifyChanged(exerciseId);
    }

    /// <inheritdoc />
    public void Freeze(Guid exerciseId)
    {
        Require(exerciseId).Freeze(_timeProvider);
        NotifyChanged(exerciseId);
    }

    /// <inheritdoc />
    public void Unfreeze(Guid exerciseId)
    {
        Require(exerciseId).Unfreeze(_timeProvider);
        NotifyChanged(exerciseId);
    }

    /// <inheritdoc />
    public void Jump(Guid exerciseId, int scenarioMinutes)
    {
        ArgumentOutOfRangeException.ThrowIfNegative(scenarioMinutes);
        Require(exerciseId).Jump(_timeProvider, scenarioMinutes);
        NotifyChanged(exerciseId);
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

    /// <inheritdoc />
    public ExerciseClockAnchor? GetAnchor(Guid exerciseId) =>
        _clocks.TryGetValue(exerciseId, out var state) ? state.Anchor() : null;

    /// <inheritdoc />
    public void Restore(Guid exerciseId, ExerciseClockAnchor anchor)
    {
        RequireExercise(exerciseId);
        ArgumentNullException.ThrowIfNull(anchor);
        ArgumentNullException.ThrowIfNull(anchor.TimeZone);

        // DF-25: a running clock kept advancing through the downtime; a frozen one held its minute. A wall anchor in
        // the FUTURE (clock skew between instances) must never move scenario time backwards, so the downtime is
        // floored at zero, as is a corrupt negative banked elapsed.
        var utcNow = _timeProvider.GetUtcNow();
        var banked = anchor.ElapsedAtAnchor < TimeSpan.Zero ? TimeSpan.Zero : anchor.ElapsedAtAnchor;
        var downtime = utcNow - anchor.WallAnchorUtc;
        var elapsed = anchor.Frozen || downtime < TimeSpan.Zero ? banked : banked + downtime;

        // Re-anchored at NOW in this process (monotonic + UTC together); deliberately no SINK notification (the row
        // it came from is already current) — only the observers hear it, so connected clients learn the restored state.
        _clocks[exerciseId] = new ExerciseClockState(
            anchor.ScenarioStart,
            anchor.TimeZone,
            elapsed,
            _timeProvider.GetTimestamp(),
            utcNow,
            anchor.Frozen);
        NotifyObservers(exerciseId);
    }

    /// <inheritdoc />
    public bool Clear(Guid exerciseId)
    {
        // No sink notification (the reset deletes the row itself); observers hear the clock go back to unstarted.
        var cleared = _clocks.TryRemove(exerciseId, out _);
        if (cleared)
        {
            NotifyObservers(exerciseId);
        }

        return cleared;
    }

    /// <summary>An anchor change: the persistence sink first, then the observers.</summary>
    private void NotifyChanged(Guid exerciseId)
    {
        _changeSink.ClockChanged(exerciseId);
        NotifyObservers(exerciseId);
    }

    /// <summary>
    /// Tells every observer. An observer is contracted never to throw; a misbehaving one is still contained here so
    /// it can never fail a mutator that has ALREADY applied (nor starve the observers after it).
    /// </summary>
    private void NotifyObservers(Guid exerciseId)
    {
        foreach (var observer in _observers)
        {
            try
            {
                observer.ClockChanged(exerciseId);
            }
#pragma warning disable CA1031 // The clock change has applied; an observer fault must never surface through the mutator.
            catch (Exception)
            {
            }
#pragma warning restore CA1031
        }
    }

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
    ///
    /// <para>Two wall anchors are kept in step: the monotonic <c>_wallAnchor</c> the live clock computes from, and
    /// the UTC <c>_wallAnchorUtc</c> that is the only one that can be persisted (DF-25).</para>
    /// </summary>
    private sealed class ExerciseClockState
    {
        private readonly Lock _gate = new();
        private readonly DateTimeOffset _scenarioStart;
        private readonly TimeZoneInfo _timeZone;
        private TimeSpan _scenarioElapsedAtAnchor;
        private long _wallAnchor;
        private DateTimeOffset _wallAnchorUtc;
        private bool _frozen;

        public ExerciseClockState(
            DateTimeOffset scenarioStart,
            TimeZoneInfo timeZone,
            TimeSpan elapsedAtAnchor,
            long wallAnchor,
            DateTimeOffset wallAnchorUtc,
            bool frozen)
        {
            _scenarioStart = scenarioStart;
            _timeZone = timeZone;
            _scenarioElapsedAtAnchor = elapsedAtAnchor;
            _wallAnchor = wallAnchor;
            _wallAnchorUtc = wallAnchorUtc;
            _frozen = frozen;
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

        public ExerciseClockAnchor Anchor()
        {
            lock (_gate)
            {
                return new ExerciseClockAnchor(
                    _scenarioStart, _timeZone, _scenarioElapsedAtAnchor, _wallAnchorUtc, _frozen);
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
                ReanchorNoLock(timeProvider);
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

                ReanchorNoLock(timeProvider);
                _frozen = false;
            }
        }

        public void Jump(TimeProvider timeProvider, int scenarioMinutes)
        {
            lock (_gate)
            {
                _scenarioElapsedAtAnchor = ElapsedNoLock(timeProvider) + TimeSpan.FromMinutes(scenarioMinutes);
                ReanchorNoLock(timeProvider);
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

        private void ReanchorNoLock(TimeProvider timeProvider)
        {
            _wallAnchor = timeProvider.GetTimestamp();
            _wallAnchorUtc = timeProvider.GetUtcNow();
        }

        private TimeSpan ElapsedNoLock(TimeProvider timeProvider) =>
            _frozen
                ? _scenarioElapsedAtAnchor
                : _scenarioElapsedAtAnchor + timeProvider.GetElapsedTime(_wallAnchor);
    }
}
