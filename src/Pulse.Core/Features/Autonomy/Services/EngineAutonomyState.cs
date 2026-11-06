namespace Pulse.Core.Features.Autonomy.Services;

using Pulse.Core.Features.Autonomy.Models;

/// <summary>
/// The engine's autonomy state for one exercise (E8 architecture §8.1): the per-exercise default level,
/// per-storyline overrides, and the safety layer (kill switch §8.4 + degraded-mode clamp §3.5) that sits
/// on top. It is the single place the §8.2 invariants live:
/// <list type="number">
///   <item><b>Resolution:</b> a storyline override wins; otherwise the exercise default.</item>
///   <item><b>Only humans raise.</b> Setting a level is a controller action and returns a steering event
///   (<see cref="AutonomyLevelChanged"/>). The automation-facing surface
///   (<see cref="IEngineSafetySwitch"/>) exposes only <i>lowering</i> paths — there is no method by which
///   the engine escalates its own autonomy.</item>
///   <item><b>Safety only clamps down.</b> The kill switch and degraded mode impose a maximum
///   effective level (or a full stop); neither auto-recovers. A controller lifts the clamp explicitly via
///   <see cref="RestoreFromSafety"/> — base levels are preserved underneath, so a restore does not lose the
///   controller's per-storyline configuration.</item>
/// </list>
///
/// <para>Exercise-scoped (COR-001), staff-only (XC-002). Pure domain logic: every mutator <i>returns</i> the
/// event to log; nothing here depends on a telemetry sink. Not thread-safe — one instance per exercise,
/// driven by the reaction loop's single-threaded scheduler.</para>
/// </summary>
public sealed class EngineAutonomyState : IEngineSafetySwitch
{
    /// <summary>The actor recorded when the automatic degraded-mode fallback lowers autonomy.</summary>
    public const string DegradedModeActor = "degraded-mode:provider";

    private readonly Dictionary<Guid, AutonomyLevel> _overrides = [];
    private AutonomyLevel _default;
    private AutonomyLevel? _safetyClamp;
    private bool _stopped;
    private bool _swampedMode;
    private string? _degradedReason;

    private EngineAutonomyState(Guid exerciseId, AutonomyLevel initialDefault)
    {
        ExerciseId = exerciseId;
        _default = initialDefault;
    }

    /// <summary>The exercise this autonomy state belongs to (COR-001).</summary>
    public Guid ExerciseId { get; }

    /// <summary>The per-exercise default autonomy level (before any storyline override or safety clamp).</summary>
    public AutonomyLevel ExerciseDefault => _default;

    /// <summary>True when a safety control (kill switch / degraded mode) is currently clamping autonomy.</summary>
    public bool SafetyClampActive => _safetyClamp is not null || _stopped;

    /// <summary>True when the kill switch has fully stopped generation (§8.4). No generation until a human resumes.</summary>
    public bool IsGenerationStopped => _stopped;

    /// <summary>Whether swamped mode is on — the only path by which a timed draft auto-sends on expiry (§8.2, #36).</summary>
    public bool SwampedModeEnabled => _swampedMode;

    /// <summary>The reason the provider is currently degraded, or null when healthy (informational; drives the alert).</summary>
    public string? DegradedReason => _degradedReason;

    /// <summary>
    /// Creates the autonomy state for an exercise. The default starts at <see cref="AutonomyLevel.Suggest"/>
    /// (the safe floor) unless a controller chose otherwise at setup. <see cref="AutonomyLevel.Auto"/> is
    /// rejected (v1.1).
    /// </summary>
    public static EngineAutonomyState Create(Guid exerciseId, AutonomyLevel initialDefault = AutonomyLevel.Suggest)
    {
        if (exerciseId == Guid.Empty)
        {
            throw new ArgumentException("Autonomy state must belong to an exercise (COR-001).", nameof(exerciseId));
        }

        AutonomyLevels.EnsureSelectable(initialDefault);
        return new EngineAutonomyState(exerciseId, initialDefault);
    }

    // ---- Resolution (§8.1) -----------------------------------------------------------------------

    /// <summary>
    /// The configured base level for a storyline: its override if one is set, otherwise the exercise
    /// default (the resolution rule, §8.1). This is <b>before</b> the safety clamp — use
    /// <see cref="ResolveEffective"/> for what the reaction loop should actually route on.
    /// </summary>
    public AutonomyLevel ResolveBase(Guid storylineId) =>
        _overrides.TryGetValue(storylineId, out var over) ? over : _default;

    /// <summary>
    /// The effective disposition the reaction loop routes on: the base level (<see cref="ResolveBase"/>)
    /// lowered by any safety clamp, or fully stopped. Check <see cref="EffectiveAutonomy.GenerationStopped"/>
    /// first, then dispatch by level.
    /// </summary>
    public EffectiveAutonomy ResolveEffective(Guid storylineId)
    {
        if (_stopped)
        {
            return EffectiveAutonomy.Stopped;
        }

        var @base = ResolveBase(storylineId);
        var effective = _safetyClamp is { } clamp ? AutonomyLevels.Lower(@base, clamp) : @base;
        return EffectiveAutonomy.Running(effective);
    }

    /// <summary>Whether a storyline has an explicit override set.</summary>
    public bool HasOverride(Guid storylineId) => _overrides.ContainsKey(storylineId);

    // ---- Human controls (the only paths that may raise autonomy, §8.2) ---------------------------

    /// <summary>
    /// Sets the per-exercise default level (a controller action). May raise or lower — a human is the only
    /// actor permitted to raise (§8.2). Does <b>not</b> lift an active safety clamp: the base level is set
    /// underneath, but the emergency brake still holds until <see cref="RestoreFromSafety"/> is called, so a
    /// routine level tweak can never silently release a kill switch. Returns the change to log (XC-004).
    /// </summary>
    /// <exception cref="NotSupportedException"><paramref name="level"/> is <see cref="AutonomyLevel.Auto"/> (v1.1).</exception>
    public AutonomyLevelChanged SetExerciseDefault(AutonomyLevel level, string actor, int scenarioMinute)
    {
        AutonomyLevels.EnsureSelectable(level);
        var (validatedActor, minute) = ValidateActorAndMinute(actor, scenarioMinute);

        var from = _default;
        _default = level;
        return new AutonomyLevelChanged(
            ExerciseId, AutonomyScope.Exercise, null, from, level, AutonomyChangeCause.Human, validatedActor, minute);
    }

    /// <summary>
    /// Sets (or, with <paramref name="level"/> null, clears) a per-storyline override — a controller action.
    /// A cleared override falls back to the exercise default. Returns the change to log; the reported
    /// from/to are the storyline's base level before/after (override-or-default).
    /// </summary>
    /// <exception cref="NotSupportedException"><paramref name="level"/> is <see cref="AutonomyLevel.Auto"/> (v1.1).</exception>
    public AutonomyLevelChanged SetStorylineOverride(Guid storylineId, AutonomyLevel? level, string actor, int scenarioMinute)
    {
        if (storylineId == Guid.Empty)
        {
            throw new ArgumentException("A storyline override needs a storyline id.", nameof(storylineId));
        }

        if (level is { } value)
        {
            AutonomyLevels.EnsureSelectable(value);
        }

        var (validatedActor, minute) = ValidateActorAndMinute(actor, scenarioMinute);

        var from = ResolveBase(storylineId);
        if (level is { } set)
        {
            _overrides[storylineId] = set;
        }
        else
        {
            _overrides.Remove(storylineId);
        }

        var to = ResolveBase(storylineId);
        return new AutonomyLevelChanged(
            ExerciseId, AutonomyScope.Storyline, storylineId, from, to, AutonomyChangeCause.Human, validatedActor, minute);
    }

    /// <summary>
    /// Enables or disables swamped mode — the lead-controller-gated toggle that is the <b>only</b> path by
    /// which a timed draft auto-sends on expiry (D5-014/1.1, #36). Always a human action; the engine never
    /// turns it on by itself (§8.2). The gate (who may enable it) is enforced by the cockpit; this models
    /// the flag and that only an explicit call flips it. Returns the change to log.
    /// </summary>
    public SwampedModeChanged SetSwampedMode(bool enabled, string actor, int scenarioMinute)
    {
        var (validatedActor, minute) = ValidateActorAndMinute(actor, scenarioMinute);
        _swampedMode = enabled;
        return new SwampedModeChanged(ExerciseId, enabled, validatedActor, minute);
    }

    // ---- Safety controls (one-way toward LESS autonomy, §8.2/§8.4) -------------------------------

    /// <summary>
    /// The manual kill switch (ADP-042): drops the entire engine to Suggest, or full stop, instantly. The
    /// manual sibling of the automatic degraded-mode fallback — both clamp autonomy down and neither
    /// auto-recovers. In-flight Delayed-auto countdowns are suspended as a consequence (their effective
    /// level is no longer Delayed-auto, so <see cref="AutoHoldPolicy"/> holds them instead of auto-sending).
    /// A controller restores autonomy explicitly via <see cref="RestoreFromSafety"/>. Returns the trip to log.
    /// </summary>
    public EngineKillSwitchFired EngageKillSwitch(KillSwitchMode mode, string actor, int scenarioMinute)
    {
        var (validatedActor, minute) = ValidateActorAndMinute(actor, scenarioMinute);

        ImposeClamp(AutonomyLevels.Floor);
        if (mode == KillSwitchMode.FullStop)
        {
            _stopped = true;
        }

        return new EngineKillSwitchFired(ExerciseId, mode, validatedActor, minute);
    }

    /// <summary>
    /// Lifts an active safety clamp (kill switch / degraded mode) — an explicit controller action (§8.2:
    /// automation never raises; a human restores). Base levels resume underneath, so per-storyline
    /// configuration is not lost, and the degraded alert (<see cref="DegradedReason"/>) is cleared. No-op
    /// (returns null) when nothing is clamped. Returns the resulting exercise-default change to log.
    /// </summary>
    public AutonomyLevelChanged? RestoreFromSafety(string actor, int scenarioMinute)
    {
        var (validatedActor, minute) = ValidateActorAndMinute(actor, scenarioMinute);

        if (!SafetyClampActive)
        {
            return null;
        }

        var fromDefault = ClampedDefault();
        _safetyClamp = null;
        _stopped = false;

        // An explicit restore is the controller taking over: clear the degraded alert too, so a restored
        // (possibly raised) autonomy is never shown alongside a stale "provider degraded" banner. If the
        // provider is in fact still unhealthy, the circuit breaker re-trips and re-degrades on the next call.
        _degradedReason = null;

        return new AutonomyLevelChanged(
            ExerciseId, AutonomyScope.Exercise, null, fromDefault, _default, AutonomyChangeCause.Human, validatedActor, minute);
    }

    /// <inheritdoc />
    public AutonomyLevelChanged? DegradeToSuggest(string reason, int scenarioMinute)
    {
        ArgumentOutOfRangeException.ThrowIfNegative(scenarioMinute);
        _degradedReason = string.IsNullOrWhiteSpace(reason) ? "generation provider degraded" : reason.Trim();

        var before = ClampedDefault();
        ImposeClamp(AutonomyLevels.Floor);
        var after = ClampedDefault();

        // ImposeClamp only ever lowers, so after <= before. If the effective default was already at the
        // floor there is no change to log; otherwise record the (lowering) degrade transition.
        return before == after
            ? null
            : new AutonomyLevelChanged(
                ExerciseId, AutonomyScope.Exercise, null, before, after, AutonomyChangeCause.DegradedMode,
                DegradedModeActor, scenarioMinute);
    }

    /// <inheritdoc />
    public AutonomyLevelChanged? MarkProviderRecovered(int scenarioMinute)
    {
        ArgumentOutOfRangeException.ThrowIfNegative(scenarioMinute);

        // Recovery clears the degraded cause but NEVER raises autonomy (§8.2). The clamp remains until a
        // controller restores it explicitly, so recovery is not an automatic escalation path.
        _degradedReason = null;
        return null;
    }

    // ---- Persistence seams (engine-runtime story 07) ----------------------------------------------

    /// <summary>
    /// Copies the live state into an immutable <see cref="EngineAutonomySnapshot"/> for the write-through store
    /// (engine-runtime story 07). A pure read: no event, no mutation. The copy is exact — including the raises — so
    /// the persisted row can carry them as "previous" for a later human restore.
    /// </summary>
    /// <returns>The snapshot of this exercise's autonomy/safety state.</returns>
    public EngineAutonomySnapshot ToSnapshot() =>
        new(
            ExerciseId,
            _default,
            new Dictionary<Guid, AutonomyLevel>(_overrides),
            _swampedMode,
            _safetyClamp,
            _stopped,
            _degradedReason);

    /// <summary>
    /// Applies a persisted <paramref name="snapshot"/> at startup (engine-runtime story 07, decision Q1), under the
    /// fail-closed rule: state that LOWERS the engine's reach is restored exactly; state that RAISES it is withheld,
    /// left at the floor, and returned as <see cref="EngineHeldRaises"/> for a later human restore.
    /// </summary>
    /// <remarks>
    /// <para><b>Restored (lowering, automatically, no human step):</b></para>
    /// <list type="bullet">
    ///   <item>the safety clamp — imposed at <see cref="AutonomyLevels.Floor"/>, the only clamp any safety path sets;</item>
    ///   <item>the kill switch's full stop (<c>FullStop</c>) — and its clamp, as <see cref="EngageKillSwitch"/> sets both;</item>
    ///   <item>the degraded reason, plus the clamp the degrade imposed (<see cref="DegradeToSuggest"/> sets both);</item>
    ///   <item>a <see cref="AutonomyLevel.Suggest"/> storyline override (the floor, so never a raise).</item>
    /// </list>
    /// <para><b>Withheld (raises, never applied here):</b> a <see cref="AutonomyLevel.DelayedAuto"/> exercise default or
    /// storyline override, and swamped mode ON. They are returned in <see cref="EngineHeldRaises"/>; the state keeps its
    /// floor values. Automation never raises its own autonomy (E8 §8.2), and a boot is not a human.</para>
    /// <para><b>Only ever lowers — never a backdoor to clear.</b> Every write here goes through the same one-way
    /// primitives as the safety controls (<see cref="ImposeClamp"/> only lowers; the stop and the degraded reason are
    /// only ever set, never unset), so applying a snapshot onto a state that a controller clamped while the load was in
    /// flight keeps the clamp (story 07 "A kill switch that races the load is not lost"). A newer live value wins over
    /// the snapshot wherever both exist: a live degraded reason is kept, and a live storyline override is not replaced.
    /// Only a human <see cref="RestoreFromSafety"/> clears the clamp or the stop. The exercise default and swamped mode
    /// are never written: the floor is what a fresh state already holds, and a live human value is newer.</para>
    /// <para><b>No audit event.</b> Nothing is returned to log: a restore is not a transition a human or the engine
    /// made. The rehydrator emits one <c>engine.state_restored</c> event per exercise instead (story 07, XC-004).</para>
    /// <para><b>Validated before anything is applied.</b> An invalid snapshot throws and changes nothing; the caller
    /// (the rehydrator) treats any throw as unreadable and boots the exercise at the most restrictive reading (Q7).</para>
    /// </remarks>
    /// <param name="snapshot">The persisted state for THIS exercise.</param>
    /// <returns>The raises the restore withheld (<see cref="EngineHeldRaises.None"/> when there were none).</returns>
    /// <exception cref="ArgumentNullException"><paramref name="snapshot"/> is null.</exception>
    /// <exception cref="ArgumentException">The snapshot belongs to another exercise (COR-001), carries an empty storyline id, or a level that is not a defined <see cref="AutonomyLevel"/>.</exception>
    /// <exception cref="NotSupportedException">The snapshot carries <see cref="AutonomyLevel.Auto"/> anywhere (v1.1).</exception>
    internal EngineHeldRaises Restore(EngineAutonomySnapshot snapshot)
    {
        ArgumentNullException.ThrowIfNull(snapshot);
        ValidateSnapshot(snapshot);

        // ---- Lowering state: restored exactly, through the one-way primitives only. ----
        if (snapshot.SafetyClamp is not null || snapshot.Stopped || snapshot.DegradedReason is not null)
        {
            // Every safety path clamps at the floor; a stop or a degrade always carries that clamp.
            ImposeClamp(AutonomyLevels.Floor);
        }

        if (snapshot.Stopped)
        {
            _stopped = true;
        }

        if (!string.IsNullOrWhiteSpace(snapshot.DegradedReason) && _degradedReason is null)
        {
            _degradedReason = snapshot.DegradedReason.Trim();
        }

        // ---- Overrides: floor overrides restored (a live override is newer and wins); raises withheld. ----
        var heldOverrides = new Dictionary<Guid, AutonomyLevel>();
        foreach (var (storylineId, level) in snapshot.StorylineOverrides)
        {
            if (level == AutonomyLevels.Floor)
            {
                _overrides.TryAdd(storylineId, level);
            }
            else
            {
                heldOverrides[storylineId] = level;
            }
        }

        // ---- Default and swamped mode: never written; a raise is withheld. ----
        var heldDefault = snapshot.ExerciseDefault == AutonomyLevels.Floor ? (AutonomyLevel?)null : snapshot.ExerciseDefault;
        var held = new EngineHeldRaises(heldDefault, heldOverrides, snapshot.SwampedMode);
        return held.IsEmpty ? EngineHeldRaises.None : held;
    }

    // ---- internals -------------------------------------------------------------------------------

    /// <summary>Rejects a snapshot for another exercise, an empty storyline id, an undefined level, or Auto (v1.1).</summary>
    private void ValidateSnapshot(EngineAutonomySnapshot snapshot)
    {
        if (snapshot.ExerciseId != ExerciseId)
        {
            throw new ArgumentException(
                "An autonomy snapshot can only be restored onto its own exercise's state (COR-001).", nameof(snapshot));
        }

        ArgumentNullException.ThrowIfNull(snapshot.StorylineOverrides, nameof(snapshot));
        EnsureRestorable(snapshot.ExerciseDefault);
        if (snapshot.SafetyClamp is { } clamp)
        {
            EnsureRestorable(clamp);
        }

        foreach (var (storylineId, level) in snapshot.StorylineOverrides)
        {
            if (storylineId == Guid.Empty)
            {
                throw new ArgumentException("A persisted storyline override needs a storyline id.", nameof(snapshot));
            }

            EnsureRestorable(level);
        }
    }

    private static void EnsureRestorable(AutonomyLevel level)
    {
        if (!Enum.IsDefined(level))
        {
            throw new ArgumentException($"'{(int)level}' is not a defined autonomy level.", nameof(level));
        }

        AutonomyLevels.EnsureSelectable(level);
    }

    /// <summary>Lowers the clamp toward <paramref name="max"/>; never raises an existing clamp.</summary>
    private void ImposeClamp(AutonomyLevel max) =>
        _safetyClamp = _safetyClamp is { } current ? AutonomyLevels.Lower(current, max) : max;

    /// <summary>The exercise default after the current clamp — the representative effective default for logs.</summary>
    private AutonomyLevel ClampedDefault() =>
        _safetyClamp is { } clamp ? AutonomyLevels.Lower(_default, clamp) : _default;

    private static (string Actor, int Minute) ValidateActorAndMinute(string actor, int scenarioMinute)
    {
        if (string.IsNullOrWhiteSpace(actor))
        {
            throw new ArgumentException("An autonomy change must record the actor (COR-018).", nameof(actor));
        }

        ArgumentOutOfRangeException.ThrowIfNegative(scenarioMinute);
        return (actor.Trim(), scenarioMinute);
    }
}
