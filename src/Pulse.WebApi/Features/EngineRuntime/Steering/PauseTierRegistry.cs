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
/// <param name="ActingHumanId">The individual controller behind the shared console account (COR-018).</param>
public sealed record PauseTierTransition(Guid ExerciseId, PauseTier From, PauseTier To, string ActingHumanId);

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
    /// Records <paramref name="tier"/> for exercise <paramref name="exerciseId"/>, applies the Freeze/Unfreeze
    /// clock effect, and publishes the transition to <see cref="IPauseOverlayPublisher"/>. Setting the
    /// already-active tier is a no-op: no clock call, no publish, and <c>null</c> is returned.
    /// </summary>
    /// <param name="exerciseId">The server-resolved exercise (COR-001); must not be <see cref="Guid.Empty"/>.</param>
    /// <param name="tier">The tier to enter.</param>
    /// <param name="actingHumanId">The controller behind the shared account (COR-018).</param>
    /// <param name="cancellationToken">Cancels the overlay publish.</param>
    /// <returns>The completed transition, or <c>null</c> when the tier was already active.</returns>
    public async Task<PauseTierTransition?> SetTierAsync(
        Guid exerciseId,
        PauseTier tier,
        string actingHumanId,
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
                return null;
            }

            _tiers[exerciseId] = tier;
            ApplyClockEffect(exerciseId, from, tier);
            transition = new PauseTierTransition(exerciseId, from, tier, actingHumanId);
        }

        LogTierChanged(transition.ExerciseId, transition.From, transition.To, transition.ActingHumanId);

        await _overlayPublisher.PublishAsync(transition, cancellationToken).ConfigureAwait(false);
        return transition;
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

    /// <summary>Source-generated "the Freeze never reached a started clock" warning (CA1848).</summary>
    [LoggerMessage(
        Level = LogLevel.Warning,
        Message = "Pause tier {Tier} for exercise {ExerciseId} did not reach the scenario clock: no clock has " +
                  "been started for it (no reaction loop has ticked), so there is no scenario time to hold.")]
    private partial void LogClockNotStarted(PauseTier tier, Guid exerciseId);

    /// <summary>
    /// The clock is touched on entering/leaving <see cref="PauseTier.Freeze"/> and ONLY there — Injects-paused
    /// and Engine-paused leave scenario time advancing exactly as when running (the story-03 safety invariant,
    /// now enforced server-side).
    ///
    /// <para>An exercise whose clock has never been STARTED cannot be frozen (<c>ExerciseClockService</c>
    /// throws for an unstarted clock, and <c>ReactionLoopHost</c> starts it lazily on its first tick for a
    /// registered exercise). Rather than 500 on a controller's safety action, the tier is still recorded and the
    /// clock call is skipped + logged: with no started clock the engine is not ticking that exercise at all, so
    /// there is no scenario time to hold.</para>
    /// </summary>
    private void ApplyClockEffect(Guid exerciseId, PauseTier from, PauseTier to)
    {
        var entering = to == PauseTier.Freeze;
        var leaving = from == PauseTier.Freeze;
        if (!entering && !leaving)
        {
            return;
        }

        if (!_clock.IsRunning(exerciseId) && !_clock.IsFrozen(exerciseId))
        {
            LogClockNotStarted(to, exerciseId);
            return;
        }

        if (entering)
        {
            _clock.Freeze(exerciseId);
        }
        else
        {
            _clock.Unfreeze(exerciseId);
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
