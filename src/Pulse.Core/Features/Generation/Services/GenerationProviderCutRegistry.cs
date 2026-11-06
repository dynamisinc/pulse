namespace Pulse.Core.Features.Generation.Services;

using System.Collections.Concurrent;

/// <summary>
/// The per-exercise "cut generation to the Fake provider" state (autonomy-safety story 07, ADP-042) — the
/// runtime EGRESS safety lever, read by <see cref="GenerationProviderSelector"/> on every burst.
/// <para>
/// <b>This is a BINARY between the startup-configured provider and Fake — never a provider chooser.</b> There
/// is no member here that names a provider, so nothing built on this seam can make an endpoint reachable that
/// <see cref="GenerationGovernance.Validate"/> did not already sign off at startup (NFR-005 / ADP-025).
/// Cutting only ever REDUCES egress; restoring returns to exactly the signed startup configuration and can
/// never exceed it (architecture §8.2 — the same shape as the kill switch and the circuit-breaker degraded
/// path).
/// </para>
/// </summary>
public interface IGenerationProviderCutRegistry
{
    /// <summary>Whether <paramref name="exerciseId"/> is currently cut to the Fake provider.</summary>
    /// <param name="exerciseId">The exercise whose cut state to read (COR-001).</param>
    /// <returns><c>true</c> when a cut is active for that exercise.</returns>
    bool IsCutToFake(Guid exerciseId);

    /// <summary>Cuts <paramref name="exerciseId"/> to the Fake provider (idempotent).</summary>
    /// <param name="exerciseId">The exercise to cut (COR-001); must not be empty.</param>
    /// <returns><c>true</c> when this call actually changed the state; <c>false</c> when a cut was already active.</returns>
    bool Cut(Guid exerciseId);

    /// <summary>Restores <paramref name="exerciseId"/> to the startup-configured provider (idempotent).</summary>
    /// <param name="exerciseId">The exercise to restore (COR-001); must not be empty.</param>
    /// <returns><c>true</c> when this call actually changed the state; <c>false</c> when no cut was active.</returns>
    bool Restore(Guid exerciseId);
}

/// <summary>
/// The startup-only seam that re-marks an exercise as cut to Fake from a persisted row (engine-runtime story 07,
/// inventory row 1) — WITHOUT the controller audit that accompanies <see cref="IGenerationProviderCutRegistry.Cut"/>.
/// </summary>
/// <remarks>
/// <para>
/// <b>Why a separate, internal interface.</b> <see cref="IGenerationProviderCutRegistry.Cut"/>'s contract is "returns
/// <c>true</c> on the one call that changed the state", and its caller emits exactly ONE XC-004 audit event for that
/// transition. A restore at boot is not a controller cutting the provider, so it must not reuse <c>Cut</c> (a caller
/// could reasonably audit its <c>true</c>). <c>Seed</c> only ever LOWERS egress (it can add a cut, never remove one),
/// so it cannot be used to re-enable a live provider. Kept off the public interface so the existing implementers
/// (test doubles) are unaffected and so only <c>Pulse.WebApi</c>'s rehydrator (via <c>InternalsVisibleTo</c>) can reach
/// it; it resolves by pattern-matching the registered <see cref="IGenerationProviderCutRegistry"/>.
/// </para>
/// </remarks>
internal interface IGenerationProviderCutSeed
{
    /// <summary>
    /// Marks <paramref name="exerciseId"/> as cut to Fake (idempotent) from persisted state at startup. Emits nothing and
    /// returns nothing to audit; the rehydrator records the restore in its single <c>engine.state_restored</c> event.
    /// </summary>
    /// <param name="exerciseId">The exercise to mark cut (COR-001); must not be empty.</param>
    void Seed(Guid exerciseId);
}

/// <summary>
/// The default in-memory <see cref="IGenerationProviderCutRegistry"/> — one independently-settable cut per
/// exercise, keyed by <c>exerciseId</c>, so a cut on one exercise can never move another's provider resolution
/// (COR-001). Registered as a singleton by <c>AddEngineGeneration</c>, the sibling of
/// <c>EngineAutonomyRegistry</c>/<c>EngineTierPolicyRegistry</c> for the provider axis.
/// </summary>
/// <remarks>
/// <para>
/// <b>Absence IS "not cut."</b> Only cuts are stored, so "restore" and "was never cut" are the same state —
/// there is no third, subtly-different resting position to reason about (the same rule the tier-policy store
/// follows for <c>auto</c>).
/// </para>
/// <para>
/// <b>Process memory, honestly.</b> Like every other autonomy/tier lever it sits beside, this state does NOT
/// survive a restart on its own: an App Service recycle returns every exercise to its startup-configured provider.
/// <c>GET /api/engine/settings</c> reports that fact explicitly rather than pretending the value is durable.
/// Engine-runtime story 07 adds the startup <see cref="IGenerationProviderCutSeed"/> seam its rehydrator uses to
/// re-mark persisted cuts (the store and rehydrator themselves live in <c>Pulse.WebApi</c>).
/// </para>
/// </remarks>
public sealed class GenerationProviderCutRegistry : IGenerationProviderCutRegistry, IGenerationProviderCutSeed
{
    private readonly ConcurrentDictionary<Guid, byte> _cuts = new();

    /// <inheritdoc />
    /// <remarks>
    /// Deliberately does NOT throw on <see cref="Guid.Empty"/>: this is the per-burst read on the generation
    /// path, and the fail-closed decision for an unscoped request belongs to
    /// <see cref="GenerationProviderSelector"/> (which routes it to Fake so it can never egress), not to a
    /// throw inside the reaction loop's per-exercise catch.
    /// </remarks>
    public bool IsCutToFake(Guid exerciseId) => _cuts.ContainsKey(exerciseId);

    /// <inheritdoc />
    public bool Cut(Guid exerciseId)
    {
        EnsureScoped(exerciseId);

        // TryAdd reports the transition atomically, so a concurrent double-cut produces exactly ONE
        // "state changed" — and therefore exactly one XC-004 audit event (no spurious duplicate).
        return _cuts.TryAdd(exerciseId, 0);
    }

    /// <inheritdoc />
    public bool Restore(Guid exerciseId)
    {
        EnsureScoped(exerciseId);
        return _cuts.TryRemove(exerciseId, out _);
    }

    /// <inheritdoc />
    /// <remarks>
    /// Engine-runtime story 07: the same idempotent add as <see cref="Cut"/>, but explicitly NOT a controller transition
    /// — <see cref="Cut"/>'s one-audit-event-per-transition contract is unchanged. A later controller <see cref="Cut"/>
    /// on a seeded exercise reports <c>false</c> (already cut), and only <see cref="Restore"/> lifts it.
    /// </remarks>
    void IGenerationProviderCutSeed.Seed(Guid exerciseId)
    {
        EnsureScoped(exerciseId);
        _cuts.TryAdd(exerciseId, 0);
    }

    private static void EnsureScoped(Guid exerciseId)
    {
        if (exerciseId == Guid.Empty)
        {
            throw new ArgumentException("The generation-provider cut is exercise-scoped (COR-001).", nameof(exerciseId));
        }
    }
}
