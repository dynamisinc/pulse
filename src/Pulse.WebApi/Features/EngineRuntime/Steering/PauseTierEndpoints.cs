namespace Pulse.WebApi.Features.EngineRuntime.Steering;

using System.Text.Json.Serialization;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Pulse.WebApi.Data;
using Pulse.WebApi.Features.EngineRuntime.Clock;

/// <summary>
/// The SERVER-AUTHORITATIVE tiered-pause API (feature: world-steering, story 07; CTL-023, COR-001, COR-050/052,
/// XC-002, XC-004) on <c>/api/steering/pause-tier</c>: a <c>POST</c> that records the controller's tier and, on
/// the Freeze transition, calls the ALREADY-BUILT <see cref="IExerciseClock.Freeze"/> — which
/// <c>ReactionLoopHost.TickExerciseAsync</c> already reads to skip a tick entirely, so a Freeze genuinely halts
/// the engine with NO reaction-loop change — plus a <c>GET</c> the console reads to resync its tier.
///
/// <para><b>Minimal-API <c>Add*</c>/<c>Map*</c> convention.</b> The orchestrator wires the single
/// <see cref="AddPauseTierSteering"/> / <see cref="MapPauseTierSteering"/> pair into <c>Program.cs</c> serially
/// after this story is Gate-2 clean; no builder edits <c>Program.cs</c>. A merged-but-unwired slice is invisible
/// until someone hits it in UAT (the #310→#317 lesson), so this pair is the one thing that must be confirmed
/// wired.</para>
///
/// <para><b>STAFF world only (XC-002).</b> Both routes sit behind the SHIPPED, unmodified
/// <see cref="EngineCockpitStaffAuthorizationFilter"/> — the same staff-plus-assigned-exercise gate the review
/// cockpit uses (COR-005): no staff session or an unresolved scope → <c>401</c>; a staff session not assigned to
/// the resolved exercise → <c>403</c>. This slice invents no authorization of its own. The response projection
/// carries only the tier + whether the clock is frozen: no participant content, no provenance.</para>
///
/// <para><b>Scope is server-resolved (COR-001).</b> The exercise comes ONLY from
/// <see cref="IExerciseContext.CurrentExerciseId"/> and fails closed (<c>401</c>) when unresolved — never a
/// default/empty <c>200</c>. The request body carries NO <c>exerciseId</c> (mirroring
/// <c>liveEngineControlActions.ts</c>), so a Freeze on exercise A can never touch exercise B's clock.</para>
///
/// <para><b>No telemetry here (XC-004).</b> The ONE <c>steering_action</c> event per transition is emitted by
/// the console (<c>usePauseState</c>, story 03, unchanged shape) and is deliberately NOT duplicated server-side
/// now that a live POST additionally fires.</para>
/// </summary>
public static class PauseTierEndpoints
{
    /// <summary>
    /// Registers the pause-tier services: the per-exercise <see cref="PauseTierRegistry"/> (Singleton — it is
    /// in-memory runtime state, like <see cref="ExerciseClockService"/>) and the
    /// <see cref="IPauseOverlayPublisher"/> seam's no-op default via <c>TryAddSingleton</c>, so story 08 can
    /// replace it (<c>RemoveAll</c> + <c>AddSingleton</c>) in either wiring order without a conflict.
    /// Prerequisites the orchestrator wires first: <c>AddExerciseScoping()</c> (COR-001 scope),
    /// <c>AddExerciseClock()</c> (<see cref="IExerciseClock"/>), and B2's <c>AddStaffIdentity()</c> (the gate).
    /// </summary>
    /// <param name="services">The service collection.</param>
    /// <returns>The same collection, for chaining.</returns>
    public static IServiceCollection AddPauseTierSteering(this IServiceCollection services)
    {
        ArgumentNullException.ThrowIfNull(services);

        services.TryAddSingleton<PauseTierRegistry>();
        services.TryAddSingleton<IPauseOverlayPublisher, NullPauseOverlayPublisher>();

        return services;
    }

    /// <summary>Maps the tiered-pause endpoints under <c>/api/steering</c>, behind the staff cockpit gate.</summary>
    /// <param name="endpoints">The route builder to map onto.</param>
    /// <returns>The same route builder, for chaining.</returns>
    public static IEndpointRouteBuilder MapPauseTierSteering(this IEndpointRouteBuilder endpoints)
    {
        ArgumentNullException.ThrowIfNull(endpoints);

        // The SAME shared staff-plus-assigned-exercise filter the review cockpit uses, reused unmodified. The
        // group carries an EMPTY prefix so the absolute route templates read exactly as the console calls them.
        var steering = endpoints
            .MapGroup(string.Empty)
            .AddEndpointFilter<EngineCockpitStaffAuthorizationFilter>();

        steering.MapGet("/api/steering/pause-tier", GetPauseTier);
        steering.MapPost("/api/steering/pause-tier", SetPauseTierAsync);

        return endpoints;
    }

    /// <summary>
    /// <c>GET /api/steering/pause-tier</c> — the resolved exercise's current pause tier (the console's resync
    /// read). Fails closed with <c>401</c> on an unresolved scope (COR-001).
    /// </summary>
    private static IResult GetPauseTier(PauseTierRegistry registry, IExerciseContext exerciseContext)
    {
        var scope = exerciseContext.CurrentExerciseId;
        if (scope is null || scope.Value == Guid.Empty)
        {
            return Results.Unauthorized();
        }

        return Results.Ok(PauseTierStateDto.From(registry, scope.Value));
    }

    /// <summary>
    /// <c>POST /api/steering/pause-tier</c> — records the tier for the resolved exercise and, on the Freeze
    /// transition, freezes/unfreezes that exercise's scenario clock. Idempotent: re-selecting the active tier
    /// returns the same <c>200</c> state without touching the clock or publishing an overlay change.
    /// </summary>
    private static async Task<IResult> SetPauseTierAsync(
        PauseTierRequest? request,
        PauseTierRegistry registry,
        IExerciseContext exerciseContext,
        CancellationToken cancellationToken)
    {
        if (request is null)
        {
            return Results.BadRequest("A JSON pause-tier body is required.");
        }

        // Scope FIRST and fail closed — never act on a client-supplied exercise (COR-001).
        var scope = exerciseContext.CurrentExerciseId;
        if (scope is null || scope.Value == Guid.Empty)
        {
            return Results.Unauthorized();
        }

        if (string.IsNullOrWhiteSpace(request.ActingHumanId))
        {
            return Results.BadRequest("actingHumanId is required (COR-018).");
        }

        if (!PauseTierWire.TryParse(request.Tier, out var tier))
        {
            return Results.BadRequest("tier must be one of 'running', 'injects', 'engine' or 'freeze'.");
        }

        await registry.SetTierAsync(scope.Value, tier, request.ActingHumanId, cancellationToken);
        return Results.Ok(PauseTierStateDto.From(registry, scope.Value));
    }
}

/// <summary>
/// The pause-tier request body (camelCase JSON). Every field is nullable so a missing one is a validation
/// <c>400</c>, never a deserialization failure. Carries NO <c>exerciseId</c> — the scope is server-authoritative
/// from <see cref="IExerciseContext"/> (COR-001), matching <c>liveEngineControlActions.ts</c>.
/// </summary>
public sealed class PauseTierRequest
{
    /// <summary>The tier to enter — <c>running</c> / <c>injects</c> / <c>engine</c> / <c>freeze</c>; required.</summary>
    [JsonPropertyName("tier")]
    public string? Tier { get; init; }

    /// <summary>The individual controller behind the shared console account (COR-018) — required.</summary>
    [JsonPropertyName("actingHumanId")]
    public string? ActingHumanId { get; init; }

    /// <summary>
    /// The exercise IANA time zone the console stamps on its own <c>steering_action</c> event (XC-008). Accepted
    /// for wire parity with the other steering/cockpit POSTs; this endpoint emits no telemetry of its own, so it
    /// is optional here.
    /// </summary>
    [JsonPropertyName("timeZone")]
    public string? TimeZone { get; init; }
}

/// <summary>
/// The staff-only pause-tier projection (XC-002): the recorded tier plus whether the exercise's scenario clock
/// is ACTUALLY frozen, so the console can tell a recorded tier from a genuinely halted engine. Carries no
/// participant content and no provenance.
/// </summary>
public sealed class PauseTierStateDto
{
    /// <summary>The active tier's wire literal — <c>running</c> / <c>injects</c> / <c>engine</c> / <c>freeze</c>.</summary>
    [JsonPropertyName("tier")]
    public required string Tier { get; init; }

    /// <summary>Whether the exercise's scenario clock is frozen (COR-050/052) — read from the shipped clock.</summary>
    [JsonPropertyName("clockFrozen")]
    public required bool ClockFrozen { get; init; }

    /// <summary>Projects the registry's state for <paramref name="exerciseId"/> onto the wire shape.</summary>
    /// <param name="registry">The pause-tier registry.</param>
    /// <param name="exerciseId">The server-resolved exercise (COR-001).</param>
    /// <returns>The staff-only state projection.</returns>
    public static PauseTierStateDto From(PauseTierRegistry registry, Guid exerciseId)
    {
        ArgumentNullException.ThrowIfNull(registry);

        return new PauseTierStateDto
        {
            Tier = PauseTierWire.ToWire(registry.GetTier(exerciseId)),
            ClockFrozen = registry.IsClockFrozen(exerciseId),
        };
    }
}
