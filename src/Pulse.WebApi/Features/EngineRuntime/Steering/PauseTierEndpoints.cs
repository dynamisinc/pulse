namespace Pulse.WebApi.Features.EngineRuntime.Steering;

using System.Linq;
using System.Text.Json.Serialization;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Pulse.WebApi.Data;
using Pulse.WebApi.Data.Entities;
using Pulse.WebApi.Features.EngineRuntime.Clock;
using Pulse.WebApi.Features.ExerciseConfiguration.Lifecycle;

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
    /// transition, starts (if needed) then freezes/unfreezes that exercise's scenario clock. Idempotent:
    /// re-selecting the active tier returns the same <c>200</c> state without touching the clock or publishing an
    /// overlay change. A Freeze whose clock effect could not be applied records nothing and returns <c>409</c>, so
    /// the console reverts instead of claiming a pause the world never felt (CR-001). The <c>200</c> body always
    /// carries the HONEST <c>clockFrozen</c> read off the clock itself — the client verifies it.
    /// </summary>
    private static async Task<IResult> SetPauseTierAsync(
        PauseTierRequest? request,
        PauseTierRegistry registry,
        IExerciseContext exerciseContext,
        PulseDbContext dbContext,
        ILoggerFactory loggerFactory,
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

        // Where to start a clock the reaction loop has not started yet, so a Freeze before the engine's first
        // tick still genuinely halts the exercise (CR-001). Server-authoritative: read from the exercise row —
        // which is also where the exercise's COR-032 lifecycle state comes from, so the refusal below costs no
        // extra query.
        var logger = loggerFactory.CreateLogger(typeof(PauseTierEndpoints).FullName!);
        var exercise = await ResolveExerciseSteeringStateAsync(dbContext, scope.Value, logger, cancellationToken);

        // WR-003 (Tom's ruling): a FREEZE outside a running world is REFUSED OUTRIGHT and LOUDLY — nothing is
        // recorded, the clock is never started or frozen, no overlay is published, and the console is told why.
        // Only Freeze is gated (Resume and the other tiers are unaffected), and the gate is the ONE shared
        // predicate the participant read and the overlay push both use, so the ruling cannot fork.
        //
        // Refusing the whole transition rather than only the overlay is the point: suppressing just the overlay
        // left tier=freeze + a frozen clock + no participant signal — a half-applied state, and in `staged` it
        // started a scenario clock COR-032 says must not run.
        if (tier == PauseTier.Freeze
            && !SteeringOverlayPrecedence.PauseIsParticipantVisibleIn(exercise.LifecycleStatus))
        {
            return Results.Conflict(PauseTierRefusalDto.NotApplicableInLifecycleState(exercise.LifecycleStatus));
        }

        var clockStart = exercise.ClockStart;

        // The overlay register is passed through as the controller's PRESENTATION selection and is validated
        // (coerced to 'out-of-fiction' unless it is exactly 'in-fiction') inside SetTierAsync — see
        // PauseTierRequest.OverlayRegister. It never touches scope, the tier, or the clock.
        var result = await registry.SetTierAsync(
            scope.Value,
            tier,
            request.ActingHumanId,
            clockStart,
            request.OverlayRegister,
            cancellationToken);

        return result.Outcome switch
        {
            PauseTierOutcome.Applied or PauseTierOutcome.Unchanged =>
                Results.Ok(PauseTierStateDto.From(registry, scope.Value)),

            // The tier was NOT recorded because its clock effect could not be applied. Fail closed with a 409 so
            // the console's guarded revert fires — never a 200 claiming a pause the world never felt (CR-001).
            // Carried on the SAME refusal body shape as the lifecycle refusal above, so the console has exactly
            // one 409 parser and both refusals can be shown to the controller as text rather than a status code.
            PauseTierOutcome.ClockUnavailable => Results.Conflict(PauseTierRefusalDto.ClockUnavailable()),

            _ => Results.StatusCode(StatusCodes.Status500InternalServerError),
        };
    }

    /// <summary>
    /// Resolves — in ONE read of the <see cref="Exercise"/> row — both the scenario start/time zone a
    /// never-started clock should be started at AND the exercise's COR-032 lifecycle status the WR-003 Freeze
    /// refusal turns on. Server-authoritative, never client input (in particular NOT
    /// <see cref="PauseTierRequest.TimeZone"/>). A missing row yields a <c>null</c> clock start (a Freeze then
    /// fails closed) and a <c>null</c> status (which the lifecycle gate also refuses).
    ///
    /// <para><b>Start point.</b> <see cref="Exercise.CurrentScenarioTime"/> when configured, otherwise ONE server
    /// wall-clock read. Note this is NOT identical to <c>EngineContentSeedService</c>, which uses its
    /// wall-clock <c>now</c> unconditionally for a registration's <c>ScenarioStart</c> — the stored column is
    /// preferred here because a Freeze may be the FIRST thing that ever starts this exercise's clock.</para>
    ///
    /// <para><b>Coupling to watch (COR-050).</b> Because the reaction loop never re-<c>Start</c>s a clock that is
    /// already frozen (<c>ReactionLoopHost.ShouldStartClock</c>), whichever of "a Freeze" or "the seed's first
    /// tick" happens FIRST decides the exercise's scenario epoch. Today
    /// <see cref="Exercise.CurrentScenarioTime"/> is a documented placeholder that is usually null, so both paths
    /// land on a server wall-clock read and the difference is invisible. Once COR-050 populates that column for
    /// real, a pre-seed Freeze will anchor the epoch to the stored instant while a seed-first run anchors it to
    /// <c>now</c> — the two must be reconciled when the native scenario clock lands (B3 follow-up), not left to
    /// ordering.</para>
    /// </summary>
    private static async Task<ExerciseSteeringState> ResolveExerciseSteeringStateAsync(
        PulseDbContext dbContext,
        Guid exerciseId,
        ILogger logger,
        CancellationToken cancellationToken)
    {
        // Exercise is deliberately UNSCOPED (its own Id IS the scope), so this is a direct read by the resolved
        // scope's id — never a client-supplied one.
        var row = await dbContext.Exercises
            .AsNoTracking()
            .Where(exercise => exercise.Id == exerciseId)
            .Select(exercise => new { exercise.CurrentScenarioTime, exercise.TimeZone, exercise.Status })
            .SingleOrDefaultAsync(cancellationToken);

        if (row is null)
        {
            return new ExerciseSteeringState(null, null);
        }

        // An unrecognised IANA id must not block a safety action — the zone only affects how the scenario
        // INSTANT is projected, never the minute count the engine's timers read. Fall back to UTC, but LOG it:
        // a misconfigured exercise time zone is a real data problem and must not be silent (SG-203).
        TimeZoneInfo timeZone;
        try
        {
            timeZone = TimeZoneInfo.FindSystemTimeZoneById(row.TimeZone);
        }
        catch (Exception ex) when (ex is TimeZoneNotFoundException or InvalidTimeZoneException)
        {
            timeZone = TimeZoneInfo.Utc;
            LogTimeZoneFallback(logger, row.TimeZone, exerciseId, ex);
        }

        return new ExerciseSteeringState(
            new PauseClockStart(row.CurrentScenarioTime ?? DateTimeOffset.UtcNow, timeZone),
            row.Status);
    }

    /// <summary>
    /// The two server-authoritative facts a pause-tier POST needs off the <see cref="Exercise"/> row, read
    /// together in one query: where to start a cold scenario clock, and the COR-032 lifecycle state the WR-003
    /// Freeze refusal turns on. Both <c>null</c> when the exercise row does not exist.
    /// </summary>
    /// <param name="ClockStart">The scenario start + time zone, or <c>null</c> when there is no exercise row.</param>
    /// <param name="LifecycleStatus">The raw stored lifecycle literal, or <c>null</c> when there is no exercise row.</param>
    private sealed record ExerciseSteeringState(PauseClockStart? ClockStart, string? LifecycleStatus);

    /// <summary>
    /// Source-generated warning for the UTC time-zone fallback (CA1848: no per-call allocation).
    /// <c>LoggerMessage.Define</c> rather than the <c>[LoggerMessage]</c> attribute because this is a static
    /// endpoint class with no logger field (mirrors <c>ReactionLoopHost</c>'s own <c>Define</c> usage).
    /// </summary>
    private static readonly Action<ILogger, string, Guid, Exception?> LogTimeZoneFallback =
        LoggerMessage.Define<string, Guid>(
            LogLevel.Warning,
            new EventId(1, nameof(LogTimeZoneFallback)),
            "Exercise {TimeZoneId} is not a recognised time zone for exercise {ExerciseId}; the pause tier " +
            "started its scenario clock in UTC instead. Fix the exercise's TimeZone column (XC-008).");
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
    /// Which register a Freeze's PARTICIPANT holding page renders in (story 08; CTL-023, D7-004) —
    /// <c>in-fiction</c> ("We'll be right back", the fiction preserved) or <c>out-of-fiction</c> ("EXERCISE
    /// PAUSED", the fiction deliberately broken). The console's own
    /// <c>usePauseState().overlayRegister</c> selection.
    ///
    /// <para><b>Legitimately client-supplied, unlike the scope.</b> This is a PRESENTATION choice the controller
    /// makes, exactly like <see cref="Tier"/> and <see cref="ActingHumanId"/> — not a scoping input. It is
    /// VALIDATED server-side, never trusted: <see cref="PauseTierRegistry.SetTierAsync"/> coerces anything that is
    /// not exactly <c>in-fiction</c> (including a missing field) to <c>out-of-fiction</c>, the conservative
    /// default.</para>
    ///
    /// <para><b>MUST NOT influence anything but the overlay copy</b> (the same rule
    /// <see cref="TimeZone"/> carries for the clock). It cannot select an exercise or change who receives the
    /// push — that is the server-resolved <see cref="IExerciseContext"/> scope alone (COR-001) — and it cannot
    /// affect the tier, the scenario clock, or authorization. A future story that needs it for anything else must
    /// justify that separately.</para>
    /// </summary>
    [JsonPropertyName("overlayRegister")]
    public string? OverlayRegister { get; init; }

    /// <summary>
    /// The exercise IANA time zone the console stamps on its own <c>steering_action</c> event (XC-008). Accepted
    /// for wire parity with the other steering/cockpit POSTs; this endpoint emits no telemetry of its own, so it
    /// is optional and currently UNREAD.
    ///
    /// <para><b>MUST NOT be used for the scenario clock.</b> The clock's start point and time zone come ONLY from
    /// the <see cref="Exercise"/> row (see <c>ResolveClockStartAsync</c>) — a client-supplied zone must never
    /// influence server-authoritative scenario time (COR-001/COR-050), any more than a client-supplied
    /// <c>exerciseId</c> may influence scope. If a future story needs this value for telemetry, read it there;
    /// do not wire it into the clock.</para>
    /// </summary>
    [JsonPropertyName("timeZone")]
    public string? TimeZone { get; init; }
}

/// <summary>
/// The staff-only <c>409</c> body for a REFUSED pause-tier change (WR-003) — a machine-readable
/// <see cref="Outcome"/> plus a plain <see cref="Reason"/> the console shows the controller as TEXT.
/// </summary>
/// <remarks>
/// <para>
/// <b>Why <c>409 Conflict</c> and not <c>422</c>.</b> The request is well-formed and the controller is
/// authorized; it conflicts with the exercise's CURRENT STATE — which is what 409 means, and it is already the
/// status the sibling clock refusal uses. It also matters behaviourally: the console's guarded-revert machinery
/// hangs off a REJECTED promise, so reusing 409 keeps one client path for both refusals instead of adding a
/// second branch for no gain.
/// </para>
/// <para>
/// <b>A refusal means NOTHING was recorded</b> — no tier, no clock effect, no overlay publish. That is the
/// contract the console relies on to revert directly rather than re-GETing to find out what happened.
/// </para>
/// <para>
/// <b>Staff-only (XC-002).</b> The reason names the exercise's lifecycle state, which is staff vocabulary; it
/// travels only on this staff-gated route and never onto a participant surface.
/// </para>
/// </remarks>
public sealed class PauseTierRefusalDto
{
    /// <summary>The machine-readable refusal kind — the console branches on this, never on the prose.</summary>
    [JsonPropertyName("outcome")]
    public required string Outcome { get; init; }

    /// <summary>A plain, controller-readable explanation, rendered as text by the console (NFR-001).</summary>
    [JsonPropertyName("reason")]
    public required string Reason { get; init; }

    /// <summary>
    /// The WR-003 refusal: a Freeze outside a running world. Names the exercise's lifecycle state so the
    /// controller can act on it ("transition to Live first"), rather than being told only that something failed.
    /// </summary>
    /// <param name="lifecycleStatus">The exercise's stored lifecycle literal, or <c>null</c> when there is no row.</param>
    /// <returns>The refusal body.</returns>
    public static PauseTierRefusalDto NotApplicableInLifecycleState(string? lifecycleStatus)
    {
        var canonical = ExerciseLifecycleStates.TryParse(lifecycleStatus, out var parsed) ? parsed : null;

        var reason = canonical switch
        {
            ExerciseLifecycleStates.Build or ExerciseLifecycleStates.Staged =>
                $"Freeze is not applicable before StartEx — this exercise is {canonical}. "
                + "Take the exercise Live first; there is no running world to freeze.",

            ExerciseLifecycleStates.Completed or ExerciseLifecycleStates.Archived =>
                $"Freeze is not applicable after EndEx — this exercise is {canonical}. The run is over.",

            null when lifecycleStatus is null =>
                "Freeze is not applicable — no exercise record was found for this session's exercise.",

            null =>
                $"Freeze is not applicable — this exercise's state '{lifecycleStatus}' is not recognised, "
                + "so it is not treated as a running world.",

            // Every remaining canonical state is either running (never refused) or 'paused' — where the world is
            // already administratively held and a controller Freeze adds nothing a participant could notice.
            _ => $"Freeze is not applicable — this exercise is {canonical}, not running.",
        };

        return new PauseTierRefusalDto
        {
            Outcome = "not-applicable-in-lifecycle-state",
            Reason = reason,
        };
    }

    /// <summary>The CR-001 clock refusal: the scenario clock could not be reached, so no tier was recorded.</summary>
    /// <returns>The refusal body.</returns>
    public static PauseTierRefusalDto ClockUnavailable() => new()
    {
        Outcome = "clock-unavailable",
        Reason = "The exercise scenario clock could not be reached, so the pause tier was not applied.",
    };
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
