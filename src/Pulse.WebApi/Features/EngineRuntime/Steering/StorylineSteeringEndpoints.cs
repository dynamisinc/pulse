namespace Pulse.WebApi.Features.EngineRuntime.Steering;

using System;
using System.Linq;
using System.Text.Json.Serialization;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Pulse.Core.Features.Storylines.Models;
using Pulse.WebApi.Data;
using Pulse.WebApi.Features.EngineRuntime.Clock;

/// <summary>
/// The escalation-dial "live" API (feature: world-steering, story 09 — "Escalation dial live"; CTL-022 /
/// D5-014/2.2, COR-001, XC-002, XC-004). STAFF world (COBRA cockpit). Minimal-API extension methods (the
/// <c>Add*</c>/<c>Map*</c> convention) — the orchestrator wires the single <see cref="AddStorylineSteering"/> /
/// <see cref="MapStorylineSteering"/> pair into <c>Program.cs</c> AFTER this story is Gate-2 clean (paired with
/// the mock→live flip of <c>useStorylineTarget</c>, a SEPARATE step); no builder edits <c>Program.cs</c>
/// (#310→#317 caution).
/// </summary>
/// <remarks>
/// <para>
/// <b>No new engine/EF code (the key finding this story builds on).</b> A storyline is a purely in-memory
/// <see cref="Storyline"/> domain object held in the <see cref="IReactionLoopRegistry"/> registration the
/// SAME <c>ReactionLoopHost</c> ticks — there is no EF entity or migration to reach it. <c>GET</c> reads it
/// directly; <c>POST .../target</c> calls <see cref="Storyline.SetTargetIntensity"/> on that VERY object (no
/// shadow/duplicate storyline), so the next reaction-loop tick's already-shipped
/// <c>Storyline.Tick</c>/<c>IntensityModel.TickTowardTarget</c> branch picks the new target up with zero new
/// engine code.
/// </para>
/// <para>
/// <b>Correction (Gate-1, W-004): <c>TargetFollow.Modulate</c> is NOT unwired.</b> An earlier pass of this
/// story's docs (and the story text itself) claimed the DECIDE-stage burst-steering half stayed unwired this
/// pass. That was wrong about the shipped codebase: <c>DecideStage.Decide</c> falls back to
/// <c>IntentComposer.Compose</c> for any trigger with no registered behavior (the inaction trigger this
/// endpoint's target feeds registers none), and <c>IntentComposer.Compose</c> already calls
/// <c>TargetFollow.Modulate</c> to size the requested burst. So the moment a controller sets a live target via
/// this endpoint, BOTH halves react on the next tick: the MEASURE-stage chase this story exists to prove
/// (<c>Storyline.Tick</c>/<c>TickTowardTarget</c>, verified in
/// <c>StorylineTargetChaseIntegrationTests</c>/<c>Composes_SetTargetAsync_Then_TicksTowardIt</c>), AND the
/// DECIDE-stage burst direction/count (<c>TargetFollow.Modulate</c>'s raise/lower/hold, already shipped,
/// unmodified by this story). Nobody should be surprised, in UAT or otherwise, that setting a target also
/// changes how many posts the engine suggests, not only the dial's actual-fill number.
/// </para>
/// <para>
/// <b>Isolation (COR-001/XC-002) — same gate as the review cockpit.</b> Both endpoints sit behind the SAME
/// <see cref="EngineCockpitStaffAuthorizationFilter"/> story 02 built (reused UNMODIFIED): no staff session →
/// <c>401</c>; a staff session but an unresolved scope → <c>401</c>; a staff session not assigned to the
/// resolved exercise → <c>403</c>. On top of that gate, <see cref="StorylineSteeringService"/> resolves the
/// storyline ONLY from the registration matching the CALLER'S resolved exercise — a storyline id (or the
/// <c>"primary"</c> sentinel, see below) is never looked up against another exercise's registration, so a
/// cross-exercise id (or an id from an exercise with no registered loop at all) resolves to nothing → <c>404</c>,
/// never that exercise's data.
/// </para>
/// <para>
/// <b>The "which storyline" gap this story closes pragmatically (a deliberate, narrow design call — flag for
/// review).</b> The Stories toolstrip flyout / storyline board (D5-016/017) that would let a controller pick
/// among several storylines is Out of Scope here (same as story 02) and not yet built, so the dial has no UI
/// path to learn a real storyline GUID before it mounts. <c>{storylineId}</c> is therefore typed as a plain
/// route <c>string</c>, not <c>{storylineId:guid}</c>: a value that parses as a <see cref="Guid"/> is looked up
/// by EXACT id within the caller's exercise (the path a future multi-storyline board will use); any other value
/// (the frontend's <c>PRIMARY_STORYLINE_SENTINEL</c>, literally <c>"primary"</c> — mirroring story 02's
/// hardcoded <c>MOCK_STORYLINE_ID</c> constant) resolves to the FIRST storyline registered for the caller's
/// OWN exercise. This keeps the story's stated "one endpoint pair" shape, needs no new discovery endpoint, and
/// stays forward-compatible with a real per-storyline id once the board ships. It is still exercise-scoped by
/// construction: the sentinel only ever resolves within the registration the auth filter already confined the
/// caller to.
/// </para>
/// <para>
/// <b>Telemetry (XC-004) is NOT emitted here.</b> Per the reuse map, the <c>steering_action</c> event is
/// emitted CLIENT-SIDE by the live <c>useStorylineTarget</c> branch (via <c>buildAndEmit</c>), unchanged in
/// shape from story 02's mock branch — mirroring how the mock's <c>storylineMock.setTargetIntensity</c> never
/// emitted telemetry itself either (the hook did). This endpoint therefore emits no server-side
/// <c>steering_action</c> telemetry event of its own — doing so in addition would double-emit for the same
/// controller action (an explicit non-goal per the story's XC-004 AC).
/// </para>
/// </remarks>
public static class StorylineSteeringEndpoints
{
    /// <summary>
    /// Registers <see cref="StorylineSteeringService"/> (Scoped — it resolves the caller's per-request
    /// <see cref="IExerciseContext"/>) and the shared <see cref="IReactionLoopRegistry"/> (via
    /// <c>TryAddSingleton</c>, mirroring <c>AddEngineContentSeed</c>'s convergence pattern: when
    /// <c>AddReactionLoopHost()</c> already ran — the intended production order — this slice converges on the
    /// SAME singleton instance the loop host ticks and story 02's cockpit reads; the <c>TryAdd</c> only keeps
    /// this slice self-contained against wave-ordering, never creates a second registry).
    /// </summary>
    /// <param name="services">The service collection.</param>
    /// <returns>The same collection, for chaining.</returns>
    public static IServiceCollection AddStorylineSteering(this IServiceCollection services)
    {
        ArgumentNullException.ThrowIfNull(services);

        services.TryAddSingleton<IReactionLoopRegistry, ReactionLoopRegistry>();
        services.AddScoped<StorylineSteeringService>();

        return services;
    }

    /// <summary>
    /// Maps the escalation-dial live endpoints under <c>/api/steering/storylines</c>. Both sit behind the
    /// SAME <see cref="EngineCockpitStaffAuthorizationFilter"/> the review cockpit uses (COR-005/COR-001),
    /// applied once to the group.
    /// </summary>
    /// <param name="endpoints">The route builder to map onto.</param>
    /// <returns>The same route builder, for chaining.</returns>
    public static IEndpointRouteBuilder MapStorylineSteering(this IEndpointRouteBuilder endpoints)
    {
        ArgumentNullException.ThrowIfNull(endpoints);

        var steering = endpoints
            .MapGroup(string.Empty)
            .AddEndpointFilter<EngineCockpitStaffAuthorizationFilter>();

        steering.MapGet("/api/steering/storylines/{storylineId}", GetStorylineAsync);
        steering.MapPost("/api/steering/storylines/{storylineId}/target", SetStorylineTargetAsync);

        return endpoints;
    }

    /// <summary>
    /// <c>GET /api/steering/storylines/{storylineId}</c> — the storyline's CURRENT actual/target/phase, read
    /// directly off the live <see cref="Storyline"/> object the reaction loop ticks. Fails closed with
    /// <c>401</c> on an unresolved scope and <c>404</c> when the id (or the <c>"primary"</c> sentinel) does not
    /// resolve within the caller's OWN exercise (COR-001) — never another exercise's storyline.
    /// </summary>
    private static async Task<IResult> GetStorylineAsync(
        string storylineId,
        StorylineSteeringService service,
        CancellationToken cancellationToken)
    {
        var result = await service.GetAsync(storylineId, cancellationToken);
        return Map(result);
    }

    /// <summary>
    /// <c>POST /api/steering/storylines/{storylineId}/target</c> — sets (or, with a <c>null</c>/omitted
    /// <c>target</c>, clears) the controller's dial target on the SAME in-memory <see cref="Storyline"/> the
    /// loop ticks, then returns the updated actual/target/phase so the dial's optimistic local update
    /// reconciles against this authoritative response.
    /// </summary>
    private static async Task<IResult> SetStorylineTargetAsync(
        string storylineId,
        SetStorylineTargetRequest? request,
        StorylineSteeringService service,
        CancellationToken cancellationToken)
    {
        if (request is null)
        {
            return Results.BadRequest("A JSON target body is required.");
        }

        var result = await service.SetTargetAsync(storylineId, request.Target, cancellationToken);
        return Map(result);
    }

    /// <summary>Maps a <see cref="StorylineSteeringResult"/> to its HTTP status (fail closed).</summary>
    private static IResult Map(StorylineSteeringResult result) => result.Outcome switch
    {
        StorylineSteeringOutcome.Ok => Results.Ok(result.Storyline),
        StorylineSteeringOutcome.ScopeUnresolved => Results.Unauthorized(),
        StorylineSteeringOutcome.Invalid => Results.BadRequest(result.ValidationError),
        StorylineSteeringOutcome.NotFound => Results.NotFound(),
        _ => Results.StatusCode(StatusCodes.Status500InternalServerError),
    };
}

/// <summary>
/// Resolves + mutates the live in-memory <see cref="Storyline"/> the reaction loop ticks. Scoped lifetime
/// (matches the request's <see cref="IExerciseContext"/>); the <see cref="IReactionLoopRegistry"/> and
/// <see cref="IExerciseClock"/> it reads are both shared singletons — the SAME instances the loop host and
/// story 02's cockpit use.
/// </summary>
public sealed class StorylineSteeringService
{
    /// <summary>
    /// The route-segment sentinel a container-agnostic, single-storyline caller passes in place of a real
    /// storyline GUID (mirrors story 02's hardcoded <c>MOCK_STORYLINE_ID</c> until the Stories board,
    /// D5-016/017, lets a controller pick among several). Resolves to the FIRST storyline registered for the
    /// caller's OWN exercise — never another exercise's.
    /// </summary>
    public const string PrimaryStorylineSentinel = "primary";

    private readonly IReactionLoopRegistry _registry;
    private readonly IExerciseContext _exerciseContext;
    private readonly IExerciseClock _exerciseClock;

    /// <summary>Creates the service over the shared loop registry, the server-authoritative scope, and the native scenario clock.</summary>
    /// <param name="registry">The active-loop registry the reaction loop host ticks (shared singleton).</param>
    /// <param name="exerciseContext">The server-authoritative exercise scope (COR-001) — the sole scoping source.</param>
    /// <param name="exerciseClock">The native per-exercise scenario clock — supplies the scenario minute a target change is stamped with.</param>
    public StorylineSteeringService(
        IReactionLoopRegistry registry,
        IExerciseContext exerciseContext,
        IExerciseClock exerciseClock)
    {
        ArgumentNullException.ThrowIfNull(registry);
        ArgumentNullException.ThrowIfNull(exerciseContext);
        ArgumentNullException.ThrowIfNull(exerciseClock);

        _registry = registry;
        _exerciseContext = exerciseContext;
        _exerciseClock = exerciseClock;
    }

    /// <summary>Reads the current actual/target/phase of the resolved storyline. Fails closed (see the type header).</summary>
    /// <param name="storylineId">A storyline GUID, or the <see cref="PrimaryStorylineSentinel"/>.</param>
    /// <param name="cancellationToken">Cancellation token (unused today — no I/O; reserved for signature symmetry).</param>
    /// <returns>The read result.</returns>
    public Task<StorylineSteeringResult> GetAsync(string storylineId, CancellationToken cancellationToken = default)
    {
        _ = cancellationToken;

        if (!TryResolveScope(out var exerciseId))
        {
            return Task.FromResult(StorylineSteeringResult.ScopeUnresolved());
        }

        var storyline = ResolveStoryline(exerciseId, storylineId);
        return Task.FromResult(storyline is null
            ? StorylineSteeringResult.NotFound()
            : StorylineSteeringResult.Ok(StorylineSteeringDto.FromStoryline(storyline)));
    }

    /// <summary>
    /// Sets (or clears) the controller's dial target on the resolved storyline via
    /// <see cref="Storyline.SetTargetIntensity"/> — the SAME in-memory object the loop ticks (no shadow/
    /// duplicate storyline) — stamped with the caller's exercise's OWN current scenario minute. Returns the
    /// updated actual/target/phase. Fails closed (see the type header); an out-of-range target (outside
    /// 0-100) is rejected as <c>400</c> before the mutation ever runs.
    /// </summary>
    /// <param name="storylineId">A storyline GUID, or the <see cref="PrimaryStorylineSentinel"/>.</param>
    /// <param name="target">The new target (0-100), or <c>null</c> to clear it.</param>
    /// <param name="cancellationToken">Cancellation token (unused today — no I/O; reserved for signature symmetry).</param>
    /// <returns>The write result.</returns>
    public Task<StorylineSteeringResult> SetTargetAsync(
        string storylineId,
        int? target,
        CancellationToken cancellationToken = default)
    {
        _ = cancellationToken;

        if (!TryResolveScope(out var exerciseId))
        {
            return Task.FromResult(StorylineSteeringResult.ScopeUnresolved());
        }

        if (target is int value && (value < 0 || value > 100))
        {
            return Task.FromResult(StorylineSteeringResult.Invalid("target must be between 0 and 100."));
        }

        var storyline = ResolveStoryline(exerciseId, storylineId);
        if (storyline is null)
        {
            return Task.FromResult(StorylineSteeringResult.NotFound());
        }

        var scenarioMinute = _exerciseClock.CurrentScenarioMinute(exerciseId);
        storyline.SetTargetIntensity(target, scenarioMinute);

        return Task.FromResult(StorylineSteeringResult.Ok(StorylineSteeringDto.FromStoryline(storyline)));
    }

    /// <summary>
    /// Resolves <paramref name="storylineId"/> to a live <see cref="Storyline"/> WITHIN the registration for
    /// <paramref name="exerciseId"/> ONLY (COR-001) — a registration for any OTHER exercise is never consulted,
    /// so a cross-exercise id can never resolve here. Returns <c>null</c> when the caller's exercise has no
    /// registered loop, the loop has no storylines, no storyline matches the given id, or
    /// <paramref name="storylineId"/> is neither a real GUID nor the exact <see cref="PrimaryStorylineSentinel"/>
    /// literal (W-001 — a stray non-GUID value such as <c>"undefined"</c>/<c>"null"</c>/a typo must 404, never
    /// silently wildcard to "whichever storyline is first").
    /// </summary>
    /// <exception cref="InvalidOperationException">
    /// A resolved storyline's OWN <see cref="Storyline.ExerciseId"/> disagrees with <paramref name="exerciseId"/>
    /// — a corrupt registration (W-002 defense-in-depth, mirrors <c>ReactionLoopHost.BuildReviewItem</c>'s
    /// identical guard). This can only happen if the registry itself is broken; it must fail loud, never
    /// silently 404 (which would look like an ordinary "not found") or silently serve/mutate another exercise's
    /// data (COR-001).
    /// </exception>
    private Storyline? ResolveStoryline(Guid exerciseId, string storylineId)
    {
        var registration = _registry.Active.FirstOrDefault(r => r.ExerciseId == exerciseId);
        if (registration is null || registration.Storylines.Count == 0)
        {
            return null;
        }

        Storyline? storyline;
        if (string.Equals(storylineId, PrimaryStorylineSentinel, StringComparison.Ordinal))
        {
            storyline = registration.Storylines[0];
        }
        else if (Guid.TryParse(storylineId, out var parsedId))
        {
            storyline = registration.Storylines.FirstOrDefault(s => s.Id == parsedId);
        }
        else
        {
            // Neither the exact sentinel nor a parseable GUID — a caller error (a stray literal, a typo, or
            // `String(undefined)`), never a silent "first storyline" wildcard (W-001).
            return null;
        }

        if (storyline is null)
        {
            return null;
        }

        // Defense-in-depth (W-002, COR-001): a storyline found under THIS exercise's own registration must
        // carry THIS exercise's id. A mismatch is a corrupt registration, not an ordinary "not found" — fail
        // loud exactly like ReactionLoopHost.BuildReviewItem's identical guard, rather than silently 404 (which
        // would mask the corruption) or silently serve/mutate the wrong exercise's storyline.
        if (storyline.ExerciseId != exerciseId)
        {
            throw new InvalidOperationException(
                $"Storyline {storyline.Id} carries ExerciseId {storyline.ExerciseId} but was found under exercise " +
                $"{exerciseId}'s own registration; a cross-exercise storyline read/write is forbidden (COR-001).");
        }

        return storyline;
    }

    /// <summary>Resolves the server-authoritative scope (COR-001); <c>false</c> when unresolved (fail closed).</summary>
    private bool TryResolveScope(out Guid exerciseId)
    {
        var scope = _exerciseContext.CurrentExerciseId;
        exerciseId = scope ?? Guid.Empty;
        return scope is not null && scope.Value != Guid.Empty;
    }
}

/// <summary>Which outcome a <see cref="StorylineSteeringService"/> call produced — the endpoint maps this to an HTTP status.</summary>
public enum StorylineSteeringOutcome
{
    /// <summary>The operation succeeded.</summary>
    Ok,

    /// <summary>No exercise scope was resolved — fail closed (401).</summary>
    ScopeUnresolved,

    /// <summary>The request failed validation (400) — e.g. a target outside 0-100.</summary>
    Invalid,

    /// <summary>No matching storyline is visible under the scope — missing, or a cross-exercise IDOR (404).</summary>
    NotFound,
}

/// <summary>The outcome of a <see cref="StorylineSteeringService"/> GET/POST call, mapped by the endpoint to a status.</summary>
public sealed class StorylineSteeringResult
{
    private StorylineSteeringResult(StorylineSteeringOutcome outcome, StorylineSteeringDto? storyline, string? validationError)
    {
        Outcome = outcome;
        Storyline = storyline;
        ValidationError = validationError;
    }

    /// <summary>Which outcome occurred.</summary>
    public StorylineSteeringOutcome Outcome { get; }

    /// <summary>The wire projection of the resolved storyline — non-null only when <see cref="Outcome"/> is <see cref="StorylineSteeringOutcome.Ok"/>.</summary>
    public StorylineSteeringDto? Storyline { get; }

    /// <summary>The validation message — non-null only when <see cref="Outcome"/> is <see cref="StorylineSteeringOutcome.Invalid"/>.</summary>
    public string? ValidationError { get; }

    /// <summary>A successful read/write.</summary>
    /// <param name="storyline">The updated wire projection.</param>
    /// <returns>An OK result.</returns>
    public static StorylineSteeringResult Ok(StorylineSteeringDto storyline)
    {
        ArgumentNullException.ThrowIfNull(storyline);
        return new StorylineSteeringResult(StorylineSteeringOutcome.Ok, storyline, null);
    }

    /// <summary>The fail-closed result for an unresolved scope.</summary>
    /// <returns>A scope-unresolved result.</returns>
    public static StorylineSteeringResult ScopeUnresolved() => new(StorylineSteeringOutcome.ScopeUnresolved, null, null);

    /// <summary>A rejected request (e.g. an out-of-range target).</summary>
    /// <param name="validationError">The human-readable reason.</param>
    /// <returns>An invalid result.</returns>
    public static StorylineSteeringResult Invalid(string validationError) =>
        new(StorylineSteeringOutcome.Invalid, null, validationError);

    /// <summary>No matching storyline under the resolved scope (missing, or a cross-exercise IDOR).</summary>
    /// <returns>A not-found result.</returns>
    public static StorylineSteeringResult NotFound() => new(StorylineSteeringOutcome.NotFound, null, null);
}

/// <summary>
/// The wire shape of a live storyline's actual/target/phase (feature: world-steering, story 09) — the
/// field-for-field mirror of the frontend's <c>StorylineActual</c> (<c>storylineMock.ts</c>) escalation-dial
/// fields. Every property carries an explicit <see cref="JsonPropertyNameAttribute"/> so the camelCase wire
/// shape is fixed independent of host serializer config. <see cref="Phase"/> serializes as the PLAIN enum
/// member name (e.g. <c>Escalating</c>) — NOT the uppercase display label
/// (<see cref="Pulse.Core.Features.Storylines.Services.StorylineBriefProjection.PhaseLabel"/>) — because it
/// must deserialize directly into the frontend's <c>StorylinePhase</c> TS union
/// (<c>'Dormant' | 'Seeded' | 'Escalating' | ...</c>), which the dial's own <c>phaseLabel()</c> helper
/// upper-cases for display exactly as story 02 already does.
/// </summary>
public sealed class StorylineSteeringDto
{
    /// <summary>The storyline's real, stable id (a GUID string) — resolved server-side even when the request used the <c>"primary"</c> sentinel.</summary>
    [JsonPropertyName("storylineId")]
    public required string StorylineId { get; init; }

    /// <summary>
    /// The storyline's human title (e.g. "Water main contamination fears", <see cref="Storyline.Title"/>) —
    /// W-008: so the dial can name what it is steering rather than showing only numbers.
    /// </summary>
    [JsonPropertyName("title")]
    public required string Title { get; init; }

    /// <summary>The exercise this storyline belongs to (COR-001), as a GUID string.</summary>
    [JsonPropertyName("exerciseId")]
    public required string ExerciseId { get; init; }

    /// <summary>Actual intensity, 0-100 (<see cref="Storyline.Intensity"/>) — the dial's fill.</summary>
    [JsonPropertyName("intensity")]
    public required int Intensity { get; init; }

    /// <summary>The controller-set target, 0-100, or <c>null</c> when unset (<see cref="Storyline.TargetIntensity"/>).</summary>
    [JsonPropertyName("targetIntensity")]
    public int? TargetIntensity { get; init; }

    /// <summary>The PascalCase <see cref="StorylinePhase"/> member name (e.g. <c>Escalating</c>) — see the type header.</summary>
    [JsonPropertyName("phase")]
    public required string Phase { get; init; }

    /// <summary>Projects a live <see cref="Storyline"/> to the wire shape.</summary>
    /// <param name="storyline">The live storyline (the SAME object the loop ticks).</param>
    /// <returns>The wire projection of <paramref name="storyline"/>.</returns>
    public static StorylineSteeringDto FromStoryline(Storyline storyline)
    {
        ArgumentNullException.ThrowIfNull(storyline);

        return new StorylineSteeringDto
        {
            StorylineId = storyline.Id.ToString(),
            Title = storyline.Title,
            ExerciseId = storyline.ExerciseId.ToString(),
            Intensity = storyline.Intensity,
            TargetIntensity = storyline.TargetIntensity,
            Phase = storyline.Phase.ToString(),
        };
    }
}

/// <summary>
/// The <c>POST /api/steering/storylines/{storylineId}/target</c> request body (camelCase JSON). Carries NO
/// <c>exerciseId</c> — scope is server-authoritative from <see cref="IExerciseContext"/> (COR-001). A missing
/// or explicit <c>null</c> <see cref="Target"/> both mean "clear the target" (mirrors
/// <see cref="Storyline.SetTargetIntensity"/>'s own <c>int?</c> contract) — the two are indistinguishable on
/// the wire by design; there is no separate "omitted" semantic to preserve.
/// </summary>
public sealed class SetStorylineTargetRequest
{
    /// <summary>The new target (0-100), or <c>null</c>/omitted to clear it.</summary>
    [JsonPropertyName("target")]
    public int? Target { get; init; }
}
