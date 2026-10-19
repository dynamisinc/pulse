namespace Pulse.WebApi.Features.EngineRuntime.Steering;

using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Pulse.WebApi.Features.ExerciseConfiguration.Lifecycle;
using Pulse.WebApi.Features.Identity.EasyLogin;

/// <summary>
/// The ONE answer to "are participant sim writes refused in this exercise right now?" (#379; CTL-023 tiered pause,
/// COR-032 lifecycle). A write is refused when the pause tier is <see cref="PauseTier.Freeze"/>, or when the
/// exercise's lifecycle state does not accept participant writes
/// (<see cref="ExerciseLifecycleBehaviour.ParticipantWritesAccepted"/>: <c>paused</c>, <c>build</c>,
/// <c>completed</c>, <c>archived</c>, or an unreadable/unknown state — fail closed). Scoped, matching the
/// <see cref="ExerciseFactsReader"/> unit of work it reads the status through.
/// </summary>
/// <remarks>
/// <para>
/// <b>Consumers.</b> <c>ParticipantWritePauseFilter</c> (<c>.RefuseWhenWritesPaused()</c>) applies it to every
/// participant write route before its handler runs, and <c>PostEditService</c> asks it too. There is no second copy
/// of this rule anywhere.
/// </para>
/// <para>
/// <b>No separate frozen-clock condition.</b> The Freeze tier is what refuses, and it refuses whatever the clock
/// reads; the <see cref="PauseTierRegistry"/> only records Freeze once the clock is actually frozen. A clock frozen
/// WITHOUT a Freeze tier (a test pinning scenario time, a clock not yet started) does not refuse participant writes.
/// </para>
/// <para>
/// <b>Injects / Engine tiers do not refuse.</b> They hold staff injects and engine content only; the world stays open.
/// </para>
/// </remarks>
public sealed class ParticipantWriteGate
{
    /// <summary>The refusal reason a held world returns on the wire (<c>409 {"reason":"frozen"}</c>).</summary>
    public const string FrozenReason = "frozen";

    private readonly ExerciseFactsReader _exerciseFacts;
    private readonly PauseTierRegistry? _pauseTiers;

    /// <summary>Creates the gate.</summary>
    /// <param name="exerciseFacts">Reads the exercise's stored lifecycle status.</param>
    /// <param name="pauseTiers">The pause-tier registry, when the host runs one (optional, as it is for edits).</param>
    public ParticipantWriteGate(ExerciseFactsReader exerciseFacts, PauseTierRegistry? pauseTiers = null)
    {
        ArgumentNullException.ThrowIfNull(exerciseFacts);
        _exerciseFacts = exerciseFacts;
        _pauseTiers = pauseTiers;
    }

    /// <summary>Whether participant writes are refused in <paramref name="exerciseId"/> right now.</summary>
    /// <param name="exerciseId">The SERVER-resolved exercise scope (never a client value).</param>
    /// <param name="cancellationToken">Cancellation token.</param>
    /// <returns><c>true</c> when the write must be refused.</returns>
    public async Task<bool> IsRefusedAsync(Guid exerciseId, CancellationToken cancellationToken = default)
    {
        // The Freeze tier is an in-memory read: no query needed to refuse.
        if (IsFrozenTier(exerciseId))
        {
            return true;
        }

        var facts = await _exerciseFacts.GetAsync(exerciseId, cancellationToken);
        return IsRefused(exerciseId, facts?.Status);
    }

    /// <summary>
    /// The same decision for a caller that has ALREADY read the exercise's status (so it is not read twice).
    /// </summary>
    /// <param name="exerciseId">The SERVER-resolved exercise scope.</param>
    /// <param name="lifecycleStatus">The stored status, or <c>null</c> when the exercise row could not be read.</param>
    /// <returns><c>true</c> when the write must be refused.</returns>
    public bool IsRefused(Guid exerciseId, string? lifecycleStatus) =>
        IsFrozenTier(exerciseId) || !ExerciseLifecycleStates.BehaviourOf(lifecycleStatus).ParticipantWritesAccepted;

    private bool IsFrozenTier(Guid exerciseId) => _pauseTiers?.GetTier(exerciseId) == PauseTier.Freeze;
}

/// <summary>Registration for <see cref="ParticipantWriteGate"/>, idempotent so every write slice can call it.</summary>
public static class ParticipantWriteGateServiceCollectionExtensions
{
    /// <summary>
    /// <c>TryAdd</c>s <see cref="ParticipantWriteGate"/> (Scoped) and the <see cref="ExerciseFactsReader"/> it reads
    /// through. The pause-tier registry is NOT registered here (the steering slice owns it; it is optional).
    /// </summary>
    /// <param name="services">The service collection.</param>
    /// <returns>The same collection, for chaining.</returns>
    public static IServiceCollection TryAddParticipantWriteGate(this IServiceCollection services)
    {
        ArgumentNullException.ThrowIfNull(services);
        services.TryAddScoped<ExerciseFactsReader>();
        services.TryAddScoped<ParticipantWriteGate>();
        return services;
    }
}
