namespace Pulse.WebApi.Features.EngineRuntime.Steering;

using System.Collections.Concurrent;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.Extensions.Logging;
using Pulse.WebApi.Features.EngineRuntime.Clock;

/// <summary>The tiered-pause state (CTL-023, D5-014/1.3) — exactly one tier is active per exercise.</summary>
public enum PauseTier
{
    /// <summary>RUNNING — the unpaused baseline; world, engine and injects all live.</summary>
    Running = 0,

    /// <summary>INJECTS PAUSED — queued inject firing halts; world + engine keep running.</summary>
    Injects = 1,

    /// <summary>ENGINE PAUSED — new engine content halts; injects + world continue.</summary>
    Engine = 2,

    /// <summary>WORLD FROZEN — everything halts AND the scenario clock stops (COR-050/052).</summary>
    Freeze = 3,
}

/// <summary>
/// A completed pause-tier transition for exercise <see cref="ExerciseId"/>. Handed to
/// <see cref="IPauseOverlayPublisher"/> on every ACTUAL transition (a no-change set produces none).
/// </summary>
/// <param name="ExerciseId">The server-resolved exercise the transition applies to (COR-001) — never client-supplied.</param>
/// <param name="From">The tier the exercise was in.</param>
/// <param name="To">The tier the exercise is now in.</param>
/// <param name="ActingHumanId">
/// The individual controller behind the shared console account (COR-018).
/// <para><b>STAFF-ONLY — MUST NEVER appear in a participant-visible payload (XC-002).</b> This record crosses a
/// seam whose implementation pushes to PARTICIPANTS (story 08's overlay broadcaster), so this field is here for
/// staff-side attribution ONLY. A participant overlay says "the exercise is paused" and nothing about who paused
/// it: projecting this into an overlay DTO would leak a controller's identity into the fiction and break the
/// two-worlds rule. Any participant-facing projection off this record must structurally omit it (see
/// <c>ParticipantPostDto.FromPost</c> for the established pattern).</para>
/// </param>
public sealed record PauseTierTransition(Guid ExerciseId, PauseTier From, PauseTier To, string ActingHumanId);

/// <summary>
/// What a clock that has never been STARTED should be started at, so a Freeze arriving before the reaction loop
/// has ever ticked can still genuinely halt the exercise (CR-001). Resolved by the endpoint from the
/// <see cref="Pulse.WebApi.Data.Entities.Exercise"/> row — server-authoritative, never client input.
/// </summary>
/// <param name="ScenarioStart">The scenario instant the clock reads as scenario minute 0.</param>
/// <param name="TimeZone">The exercise time zone the scenario instant is expressed in (XC-008).</param>
public sealed record PauseClockStart(DateTimeOffset ScenarioStart, TimeZoneInfo TimeZone);

/// <summary>The outcome of a pause-tier change — the endpoint maps it to a status, fail-closed.</summary>
public enum PauseTierOutcome
{
    /// <summary>The tier changed and every side effect (clock, overlay publish) was applied.</summary>
    Applied = 0,

    /// <summary>The requested tier was already active — nothing was touched and nothing published.</summary>
    Unchanged = 1,

    /// <summary>
    /// The tier was NOT recorded because its scenario-clock effect could not be applied. Fail closed: the
    /// console must never be told a Freeze took when the world kept moving (CR-001).
    /// </summary>
    ClockUnavailable = 2,
}

/// <summary>The result of a pause-tier change — the outcome plus the transition when one actually happened.</summary>
/// <param name="Outcome">Whether the tier was applied, unchanged, or refused.</param>
/// <param name="Transition">The completed transition, or <c>null</c> for <see cref="PauseTierOutcome.Unchanged"/>/<see cref="PauseTierOutcome.ClockUnavailable"/>.</param>
public sealed record PauseTierResult(PauseTierOutcome Outcome, PauseTierTransition? Transition);

/// <summary>
/// The server-authoritative tiered-pause registry (feature: world-steering, story 07; CTL-023, COR-001,
/// COR-050/052). Holds ONE independently mutable tier per exercise — keyed by <c>exerciseId</c> in a
/// <see cref="ConcurrentDictionary{TKey,TValue}"/> exactly the way <see cref="ExerciseClockService"/> keys its
/// own scenario-time state — and is the single place a tier transition's SIDE EFFECTS happen:
/// <list type="bullet">
///   <item>entering <see cref="PauseTier.Freeze"/> calls the ALREADY-BUILT
///   <see cref="IExerciseClock.Freeze"/>, which is what <c>ReactionLoopHost.TickExerciseAsync</c> already reads
///   (<c>IsFrozen</c>) to skip a tick entirely — so freezing genuinely halts the engine with NO reaction-loop
///   code change;</item>
///   <item>leaving <see cref="PauseTier.Freeze"/> calls <see cref="IExerciseClock.Unfreeze"/>, which resumes at
///   exactly the scenario minute it held (COR-050 — no scenario time is lost);</item>
///   <item>every transition invokes <see cref="IPauseOverlayPublisher"/> — a no-op until story 08 replaces the
///   default registration.</item>
/// </list>
///
/// <para><b>A Freeze is never reported unless it actually took (CR-001).</b> A clock that has never been STARTED
/// cannot be frozen, and that is the DEFAULT state of a fresh host: the only production caller of
/// <see cref="IExerciseClock.Start"/> is <c>ReactionLoopHost.EnsureClockStarted</c>, which runs on the first tick
/// of a registered exercise and starts the clock UNFROZEN. So a Freeze arriving before the engine is seeded would
/// otherwise no-op forever, and a Freeze arriving before the loop's first tick would be clobbered by a running
/// clock. This registry therefore STARTS the clock itself (from the exercise row, via
/// <see cref="PauseClockStart"/>) and then freezes it — <c>EnsureClockStarted</c>'s own
/// <c>IsRunning || IsFrozen</c> guard means the loop then leaves the frozen clock alone. If the freeze cannot be
/// applied (or cannot be VERIFIED via <see cref="IExerciseClock.IsFrozen"/>), the tier is NOT recorded and
/// <see cref="PauseTierOutcome.ClockUnavailable"/> is returned so the caller fails closed and the console reverts
/// — never a success reported for a world that kept moving. The clock effect is applied BEFORE the tier is
/// recorded, so a throwing clock can never leave a recorded tier behind.</para>
///
/// <para><b>Isolation (COR-001).</b> Isolation is structural: there is no shared tier, so a Freeze on exercise A
/// records A's tier and freezes A's clock and can never touch exercise B's. This is an in-memory runtime service
/// (a singleton), not a persisted <see cref="Pulse.WebApi.Data.IExerciseScoped"/> entity — the same accepted
/// limitation <see cref="ExerciseClockService"/> already has: an App Service restart clears the tiers.</para>
///
/// <para><b>No telemetry here (XC-004).</b> The ONE <c>steering_action</c> event per transition is emitted by the
/// console (<c>usePauseState</c>, story 03) and is deliberately NOT duplicated server-side now that a live POST
/// additionally fires.</para>
/// </summary>
public sealed partial class PauseTierRegistry
{
    private readonly IExerciseClock _clock;
    private readonly IPauseOverlayPublisher _overlayPublisher;
    private readonly ILogger<PauseTierRegistry> _logger;
    private readonly ConcurrentDictionary<Guid, PauseTier> _tiers = new();

    // Serializes the read-decide-write of a tier transition (plus its clock effect) so two concurrent
    // controllers cannot interleave into a lost/duplicated clock freeze. Per-exercise state stays fully
    // independent (COR-001) — this only makes each transition atomic; last write wins, by design (no locking
    // /CRDT conflict resolution is in scope).
    private readonly Lock _gate = new();

    /// <summary>Creates the registry over the shipped exercise clock and the overlay-publisher seam.</summary>
    /// <param name="clock">The native per-exercise scenario clock a Freeze/Unfreeze drives.</param>
    /// <param name="overlayPublisher">The participant-overlay seam (no-op until story 08).</param>
    /// <param name="logger">Logs the transition and the "clock not started" edge case.</param>
    public PauseTierRegistry(
        IExerciseClock clock,
        IPauseOverlayPublisher overlayPublisher,
        ILogger<PauseTierRegistry> logger)
    {
        ArgumentNullException.ThrowIfNull(clock);
        ArgumentNullException.ThrowIfNull(overlayPublisher);
        ArgumentNullException.ThrowIfNull(logger);

        _clock = clock;
        _overlayPublisher = overlayPublisher;
        _logger = logger;
    }

    /// <summary>
    /// The tier exercise <paramref name="exerciseId"/> is currently in. An exercise that has never been paused
    /// reads <see cref="PauseTier.Running"/> — never another exercise's tier (COR-001).
    /// </summary>
    /// <param name="exerciseId">The exercise whose tier to read.</param>
    /// <returns>The active tier.</returns>
    public PauseTier GetTier(Guid exerciseId) =>
        _tiers.TryGetValue(exerciseId, out var tier) ? tier : PauseTier.Running;

    /// <summary>
    /// Whether exercise <paramref name="exerciseId"/>'s scenario clock is actually frozen — read straight off
    /// the shipped clock, so the console can tell a recorded tier from a genuinely halted engine.
    /// </summary>
    /// <param name="exerciseId">The exercise to inspect.</param>
    /// <returns><c>true</c> when the exercise clock is frozen.</returns>
    public bool IsClockFrozen(Guid exerciseId) => _clock.IsFrozen(exerciseId);

    /// <summary>
    /// Applies the Freeze/Unfreeze clock effect, records <paramref name="tier"/> for exercise
    /// <paramref name="exerciseId"/>, and publishes the transition to <see cref="IPauseOverlayPublisher"/>.
    /// Setting the already-active tier is a no-op (<see cref="PauseTierOutcome.Unchanged"/>): no clock call, no
    /// publish. A Freeze whose clock effect cannot be applied and verified records NOTHING and returns
    /// <see cref="PauseTierOutcome.ClockUnavailable"/> — never a success for a world that kept moving (CR-001).
    /// </summary>
    /// <param name="exerciseId">The server-resolved exercise (COR-001); must not be <see cref="Guid.Empty"/>.</param>
    /// <param name="tier">The tier to enter.</param>
    /// <param name="actingHumanId">The controller behind the shared account (COR-018).</param>
    /// <param name="clockStart">
    /// Where to START a clock that has never been started, so a Freeze before the engine's first tick still
    /// genuinely halts the exercise. <c>null</c> means "cannot be started" — a Freeze then fails closed.
    /// </param>
    /// <param name="cancellationToken">Cancels the overlay publish.</param>
    /// <returns>The outcome plus the completed transition when one happened.</returns>
    public async Task<PauseTierResult> SetTierAsync(
        Guid exerciseId,
        PauseTier tier,
        string actingHumanId,
        PauseClockStart? clockStart = null,
        CancellationToken cancellationToken = default)
    {
        if (exerciseId == Guid.Empty)
        {
            throw new ArgumentException("A pause-tier change must name an exercise (COR-001).", nameof(exerciseId));
        }

        ArgumentException.ThrowIfNullOrWhiteSpace(actingHumanId);

        PauseTierTransition transition;
        lock (_gate)
        {
            var from = GetTier(exerciseId);
            if (from == tier)
            {
                return new PauseTierResult(PauseTierOutcome.Unchanged, null);
            }

            // SG-002 + CR-001: the clock effect happens FIRST and must succeed. A refused or unverifiable
            // freeze/unfreeze leaves NO recorded tier behind, so the console can never render a pause state the
            // server did not apply.
            if (!TryApplyClockEffect(exerciseId, from, tier, clockStart))
            {
                return new PauseTierResult(PauseTierOutcome.ClockUnavailable, null);
            }

            _tiers[exerciseId] = tier;
            transition = new PauseTierTransition(exerciseId, from, tier, actingHumanId);
        }

        LogTierChanged(transition.ExerciseId, transition.From, transition.To, transition.ActingHumanId);

        // WR-004: the overlay publish is BEST-EFFORT and must never undo an applied tier. The interface documents
        // that implementations swallow their own transport failures, but documentation is not enforcement — story
        // 08's real SignalR publisher lands on this seam next, and a throw here would 500 a request whose clock
        // was already frozen, making the client revert to RUNNING while the server's world stays FROZEN.
        //
        // NOTE for story 08 (SG-206, carried into its brief): the publish happens deliberately OUTSIDE `_gate`
        // (you cannot await inside a lock), so two rapid transitions on the same exercise can be PUBLISHED out of
        // order even though the tier state itself is serialized and correct. A real publisher that participants
        // see should therefore carry its own ordering signal (a sequence/timestamp) rather than trusting arrival
        // order.
        try
        {
            await _overlayPublisher.PublishAsync(transition, cancellationToken).ConfigureAwait(false);
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            LogOverlayPublishFailed(ex, transition.ExerciseId, transition.To);
        }

        return new PauseTierResult(PauseTierOutcome.Applied, transition);
    }

    /// <summary>
    /// TEST-ONLY reset: clears every exercise's recorded tier. Production has one long-lived registry per host.
    /// </summary>
    internal void ResetForTests() => _tiers.Clear();

    /// <summary>Source-generated tier-transition audit log (CA1848: no per-call allocation).</summary>
    [LoggerMessage(
        Level = LogLevel.Information,
        Message = "Pause tier for exercise {ExerciseId} moved {From} -> {To} by {ActingHumanId}.")]
    private partial void LogTierChanged(Guid exerciseId, PauseTier from, PauseTier to, string actingHumanId);

    /// <summary>Source-generated "a Freeze had no clock to start" warning (CA1848) — the fail-closed case.</summary>
    [LoggerMessage(
        Level = LogLevel.Warning,
        Message = "Pause tier {Tier} for exercise {ExerciseId} was REFUSED: its scenario clock has never been " +
                  "started and no start point could be resolved, so the freeze could not be applied.")]
    private partial void LogClockUnavailable(PauseTier tier, Guid exerciseId);

    /// <summary>Source-generated "the clock was started by a Freeze" audit log (CA1848).</summary>
    [LoggerMessage(
        Level = LogLevel.Information,
        Message = "Pause tier Freeze for exercise {ExerciseId} started its scenario clock at {ScenarioStart} " +
                  "({TimeZoneId}) before freezing — the reaction loop had not ticked it yet.")]
    private partial void LogClockStartedForFreeze(Guid exerciseId, DateTimeOffset scenarioStart, string timeZoneId);

    /// <summary>Source-generated clock-effect failure warning (CA1848) — the fail-closed case.</summary>
    [LoggerMessage(
        Level = LogLevel.Warning,
        Message = "Pause tier {Tier} for exercise {ExerciseId} was REFUSED: the scenario-clock effect failed.")]
    private partial void LogClockEffectFailed(Exception exception, PauseTier tier, Guid exerciseId);

    /// <summary>Source-generated "a refused freeze still started the clock" warning (CA1848, SG-201).</summary>
    [LoggerMessage(
        Level = LogLevel.Warning,
        Message = "A REFUSED Freeze for exercise {ExerciseId} had already started its scenario clock, and " +
                  "IExerciseClock offers no un-start: the clock now runs from the start point resolved for the " +
                  "freeze rather than the reaction loop's own.")]
    private partial void LogClockStartLeaked(Guid exerciseId);

    /// <summary>Source-generated best-effort overlay-publish failure warning (CA1848).</summary>
    [LoggerMessage(
        Level = LogLevel.Warning,
        Message = "The pause overlay publish for exercise {ExerciseId} (tier {Tier}) failed; the tier and its " +
                  "clock effect STAND — participants may not have been notified.")]
    private partial void LogOverlayPublishFailed(Exception exception, Guid exerciseId, PauseTier tier);

    /// <summary>
    /// Applies the tier's scenario-clock effect, returning whether it took. The clock is touched on
    /// entering/leaving <see cref="PauseTier.Freeze"/> and ONLY there — Injects-paused and Engine-paused leave
    /// scenario time advancing exactly as when running (the story-03 safety invariant, now enforced server-side).
    ///
    /// <para><b>Entering Freeze STARTS an unstarted clock first (CR-001).</b> An unstarted clock is the default
    /// state of a fresh host, so simply skipping the freeze would silently no-op the controller's safety action
    /// forever (and a later reaction-loop tick would start a RUNNING clock under a console reading WORLD FROZEN).
    /// The freeze is then VERIFIED via <see cref="IExerciseClock.IsFrozen"/> — this method returns
    /// <c>false</c> if it cannot be applied or cannot be verified, and the caller records nothing.</para>
    ///
    /// <para><b>Leaving Freeze must also really take.</b> A Resume that cannot unfreeze would leave the world
    /// frozen under a console reading RUNNING — the same class of lie — so it fails closed too. An exercise with
    /// no started clock at all has nothing to unfreeze and succeeds trivially.</para>
    /// </summary>
    private bool TryApplyClockEffect(Guid exerciseId, PauseTier from, PauseTier to, PauseClockStart? clockStart)
    {
        var entering = to == PauseTier.Freeze;
        var leaving = from == PauseTier.Freeze;
        if (!entering && !leaving)
        {
            return true;
        }

        var started = _clock.IsRunning(exerciseId) || _clock.IsFrozen(exerciseId);

        if (leaving && !started)
        {
            // Nothing was ever ticking, so there is nothing to resume. Never block a Resume on this.
            return true;
        }

        var startedHere = false;
        try
        {
            if (entering && !started)
            {
                if (clockStart is null)
                {
                    LogClockUnavailable(to, exerciseId);
                    return false;
                }

                // ReactionLoopHost.ShouldStartClock only starts a clock that is neither running NOR frozen, so
                // starting-then-freezing here is safe: the loop will leave this frozen clock exactly as it is.
                _clock.Start(exerciseId, clockStart.ScenarioStart, clockStart.TimeZone);
                startedHere = true;
                LogClockStartedForFreeze(exerciseId, clockStart.ScenarioStart, clockStart.TimeZone.Id);
            }

            if (entering)
            {
                _clock.Freeze(exerciseId);

                // Verify, never assume — the console must not be told a freeze took when it did not.
                if (!_clock.IsFrozen(exerciseId))
                {
                    // SG-202: a clock that ACCEPTED Freeze but reports itself unfrozen is non-conforming. Since we
                    // are about to refuse the tier, compensate so we cannot leave it half-frozen either — a frozen
                    // clock under a console reading RUNNING is the mirror-image lie.
                    CompensateFailedFreeze(exerciseId, startedHere);
                    LogClockUnavailable(to, exerciseId);
                    return false;
                }

                return true;
            }

            _clock.Unfreeze(exerciseId);
            return !_clock.IsFrozen(exerciseId);
        }
        catch (Exception ex) when (ex is ArgumentException or InvalidOperationException)
        {
            if (entering)
            {
                CompensateFailedFreeze(exerciseId, startedHere);
            }

            LogClockEffectFailed(ex, to, exerciseId);
            return false;
        }
    }

    /// <summary>
    /// Best-effort cleanup after a REFUSED freeze, so a rejected transition leaves as little behind as the
    /// <see cref="IExerciseClock"/> contract allows:
    /// <list type="bullet">
    ///   <item>an <see cref="IExerciseClock.Unfreeze"/> in case the freeze partially took (SG-202) — the refusal
    ///   means the console will show RUNNING, so the clock must not stay held;</item>
    ///   <item>a LOG when this call had already STARTED the clock (SG-201). The interface has no "un-start", so
    ///   the started clock is a real, unavoidable side effect of a refused freeze: it now runs from the start
    ///   point resolved here rather than the one the reaction loop would have supplied. It is logged loudly
    ///   rather than left silent.</item>
    /// </list>
    /// </summary>
    private void CompensateFailedFreeze(Guid exerciseId, bool startedHere)
    {
        try
        {
            _clock.Unfreeze(exerciseId);
        }
        catch (Exception ex) when (ex is ArgumentException or InvalidOperationException)
        {
            LogClockEffectFailed(ex, PauseTier.Running, exerciseId);
        }

        if (startedHere)
        {
            LogClockStartLeaked(exerciseId);
        }
    }
}

/// <summary>
/// The wire vocabulary for <see cref="PauseTier"/> — the kebab/lowercase literals the console's frozen
/// <c>PauseTier</c> TypeScript union already uses (<c>'running' | 'injects' | 'engine' | 'freeze'</c>). The
/// frozen client is the seam: these literals match it field-for-field.
/// </summary>
public static class PauseTierWire
{
    /// <summary><c>running</c> — the unpaused baseline.</summary>
    public const string Running = "running";

    /// <summary><c>injects</c> — INJECTS PAUSED.</summary>
    public const string Injects = "injects";

    /// <summary><c>engine</c> — ENGINE PAUSED.</summary>
    public const string Engine = "engine";

    /// <summary><c>freeze</c> — WORLD FROZEN.</summary>
    public const string Freeze = "freeze";

    /// <summary>Formats <paramref name="tier"/> as its wire literal.</summary>
    /// <param name="tier">The tier to format.</param>
    /// <returns>The wire literal the console reads.</returns>
    public static string ToWire(PauseTier tier) => tier switch
    {
        PauseTier.Injects => Injects,
        PauseTier.Engine => Engine,
        PauseTier.Freeze => Freeze,
        _ => Running,
    };

    /// <summary>Parses a wire literal to its <see cref="PauseTier"/>; anything else is rejected (a 400).</summary>
    /// <param name="raw">The client-supplied literal.</param>
    /// <param name="tier">The parsed tier when recognised.</param>
    /// <returns><c>true</c> when <paramref name="raw"/> is one of the four literals.</returns>
    public static bool TryParse(string? raw, out PauseTier tier)
    {
        switch (raw)
        {
            case Running:
                tier = PauseTier.Running;
                return true;
            case Injects:
                tier = PauseTier.Injects;
                return true;
            case Engine:
                tier = PauseTier.Engine;
                return true;
            case Freeze:
                tier = PauseTier.Freeze;
                return true;
            default:
                tier = PauseTier.Running;
                return false;
        }
    }
}
