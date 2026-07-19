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
    /// configuration is not lost. No-op (returns null) when nothing is clamped. Returns the resulting
    /// exercise-default change to log.
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

    // ---- internals -------------------------------------------------------------------------------

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
