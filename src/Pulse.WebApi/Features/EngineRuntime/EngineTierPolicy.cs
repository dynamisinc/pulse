namespace Pulse.WebApi.Features.EngineRuntime;

using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using Pulse.Core.Features.Generation.Models;

/// <summary>
/// The per-exercise model-tier posture a controller may choose at runtime (autonomy-safety story 05). It
/// selects only WHICH <see cref="GenerationTier"/> ROLE a burst is generated at — never the concrete
/// deployment/model that role resolves to. That mapping stays governed <c>Generation:Tiers:*</c>
/// configuration behind <see cref="Pulse.Core.Features.Generation.Services.GenerationGovernance"/>'s
/// fail-closed startup gate (NFR-005 / ADP-025), so an operator can never route traffic to an unattested
/// endpoint from an HTTP call.
/// </summary>
public enum TierPolicyMode
{
    /// <summary>
    /// No per-exercise override: the purpose-based static map decides (today
    /// <c>IntentComposer.TierFor</c>'s trigger-kind mapping — ambient floor → Ambient, else Standard). The
    /// default for every exercise, and what setting <c>auto</c> restores.
    /// </summary>
    Auto = 0,

    /// <summary>Force every burst to <see cref="GenerationTier.Standard"/> (top voice quality, higher cost).</summary>
    Standard = 1,

    /// <summary>Force every burst to <see cref="GenerationTier.Ambient"/> (bulk/cheap tier).</summary>
    Ambient = 2,
}

/// <summary>
/// The wire literals for <see cref="TierPolicyMode"/> (<c>auto</c> / <c>standard</c> / <c>ambient</c>) and the
/// parse used by the settings endpoint. Deliberately an explicit hand-maintained map, matching
/// <see cref="MappedEnumJsonConverter{TEnum}"/>'s rationale: every wire literal is pinned by name and asserted
/// by test rather than inferred from a casing policy a later rename could silently shift.
/// </summary>
public static class TierPolicyModes
{
    private static readonly Dictionary<TierPolicyMode, string> ToWire = new()
    {
        [TierPolicyMode.Auto] = "auto",
        [TierPolicyMode.Standard] = "standard",
        [TierPolicyMode.Ambient] = "ambient",
    };

    /// <summary>The exhaustive <see cref="TierPolicyMode"/> → wire-literal map.</summary>
    public static IReadOnlyDictionary<TierPolicyMode, string> Wire => ToWire;

    /// <summary>The wire literal for <paramref name="mode"/>.</summary>
    /// <param name="mode">The mode to format.</param>
    /// <returns>The kebab/lowercase wire literal.</returns>
    public static string ToLiteral(TierPolicyMode mode) =>
        ToWire.TryGetValue(mode, out var wire) ? wire : ToWire[TierPolicyMode.Auto];

    /// <summary>
    /// The concrete <see cref="GenerationTier"/> a non-<see cref="TierPolicyMode.Auto"/> mode forces, or false
    /// for <see cref="TierPolicyMode.Auto"/> (which forces nothing). The returned tier's
    /// <see cref="Enum.ToString()"/> is EXACTLY the <c>Generation:Tiers:{key}</c> configuration key the
    /// providers look a deployment up by, so a caller can validate the binding before accepting a mode.
    /// </summary>
    /// <param name="mode">The tier-policy mode.</param>
    /// <param name="tier">The forced tier when the mode is not <see cref="TierPolicyMode.Auto"/>.</param>
    /// <returns><c>true</c> when the mode forces a specific tier.</returns>
    public static bool TryGetForcedTier(TierPolicyMode mode, out GenerationTier tier)
    {
        switch (mode)
        {
            case TierPolicyMode.Standard:
                tier = GenerationTier.Standard;
                return true;
            case TierPolicyMode.Ambient:
                tier = GenerationTier.Ambient;
                return true;
            default:
                tier = GenerationTier.Standard;
                return false;
        }
    }

    /// <summary>
    /// Parses a client-supplied tier-policy literal. Returns false for anything outside
    /// <c>{auto, standard, ambient}</c> so the endpoint rejects it with a 400 — never a silent default.
    /// </summary>
    /// <param name="raw">The raw request literal.</param>
    /// <param name="mode">The parsed mode when the literal is valid.</param>
    /// <returns><c>true</c> when <paramref name="raw"/> is a known literal.</returns>
    public static bool TryParse(string? raw, out TierPolicyMode mode)
    {
        switch (raw)
        {
            case "auto":
                mode = TierPolicyMode.Auto;
                return true;
            case "standard":
                mode = TierPolicyMode.Standard;
                return true;
            case "ambient":
                mode = TierPolicyMode.Ambient;
                return true;
            default:
                mode = TierPolicyMode.Auto;
                return false;
        }
    }
}

/// <summary>
/// Serializes <see cref="TierPolicyMode"/> as the <c>auto</c> / <c>standard</c> / <c>ambient</c> wire literals.
/// </summary>
public sealed class TierPolicyModeJsonConverter : MappedEnumJsonConverter<TierPolicyMode>
{
    /// <summary>Creates the <see cref="TierPolicyMode"/> converter.</summary>
    public TierPolicyModeJsonConverter()
        : base(TierPolicyModes.Wire)
    {
    }
}

/// <summary>
/// The per-exercise <see cref="TierPolicyMode"/> store (singleton) — the sibling of
/// <see cref="EngineAutonomyRegistry"/> for the model-tier posture. One independently-settable mode per
/// exercise, keyed by <c>exerciseId</c>, so a tier choice on one exercise can never move another's (COR-001).
/// Read by the reaction loop at <see cref="ReactionLoopDriver"/>'s existing
/// <c>IntentComposer</c> call site, so a change takes effect on the next generated burst with no redeploy.
/// </summary>
/// <remarks>
/// <b>Process memory, honestly (out of scope: persistence).</b> Like the autonomy registry it sits beside,
/// this state does NOT survive a process restart — an App Service recycle resets every exercise to
/// <see cref="TierPolicyMode.Auto"/>. <c>GET /api/engine/settings</c> reports that fact explicitly rather than
/// pretending the value is durable.
/// </remarks>
public sealed class EngineTierPolicyRegistry
{
    // Only OVERRIDES are stored: Auto is the absence of an entry, so "clear the override" and "no override was
    // ever set" are the same state (there is no third, subtly-different resting position to reason about).
    private readonly ConcurrentDictionary<Guid, TierPolicyMode> _modes = new();

    /// <summary>The exercise's current mode, or <see cref="TierPolicyMode.Auto"/> when no override is set.</summary>
    /// <param name="exerciseId">The exercise whose mode to read (COR-001); must not be empty.</param>
    /// <returns>The exercise's tier-policy mode.</returns>
    public TierPolicyMode GetMode(Guid exerciseId)
    {
        EnsureScoped(exerciseId);
        return _modes.TryGetValue(exerciseId, out var mode) ? mode : TierPolicyMode.Auto;
    }

    /// <summary>
    /// Records the exercise's tier-policy override, or CLEARS it when <paramref name="mode"/> is
    /// <see cref="TierPolicyMode.Auto"/> (restoring the purpose-based static map's role).
    /// </summary>
    /// <param name="exerciseId">The exercise whose mode to set (COR-001); must not be empty.</param>
    /// <param name="mode">The mode to record, or <see cref="TierPolicyMode.Auto"/> to clear the override.</param>
    /// <returns>The mode that was in effect BEFORE this call (for the XC-004 from→to audit record).</returns>
    public TierPolicyMode SetMode(Guid exerciseId, TierPolicyMode mode)
    {
        EnsureScoped(exerciseId);

        var previous = GetMode(exerciseId);
        if (mode == TierPolicyMode.Auto)
        {
            _modes.TryRemove(exerciseId, out _);
        }
        else
        {
            _modes[exerciseId] = mode;
        }

        return previous;
    }

    /// <summary>
    /// Applies the exercise's mode to a composed intent's tier: the exercise's forced tier when an override is
    /// set, otherwise <paramref name="composedTier"/> unchanged (the purpose-based decision the decide stage
    /// already made). This is the ONE read the reaction loop performs per burst.
    /// </summary>
    /// <param name="exerciseId">The tick's server-authoritative exercise scope (COR-001).</param>
    /// <param name="composedTier">The tier the decide stage's intent carried.</param>
    /// <returns>The tier the burst should actually be generated at.</returns>
    public GenerationTier ResolveTier(Guid exerciseId, GenerationTier composedTier) => GetMode(exerciseId) switch
    {
        TierPolicyMode.Standard => GenerationTier.Standard,
        TierPolicyMode.Ambient => GenerationTier.Ambient,
        _ => composedTier,
    };

    private static void EnsureScoped(Guid exerciseId)
    {
        if (exerciseId == Guid.Empty)
        {
            throw new ArgumentException("Tier policy is exercise-scoped (COR-001).", nameof(exerciseId));
        }
    }
}
