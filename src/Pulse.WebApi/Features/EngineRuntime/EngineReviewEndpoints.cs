namespace Pulse.WebApi.Features.EngineRuntime;

using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Pulse.Core.Features.Autonomy.Models;
using Pulse.Core.Features.Generation.Services;

/// <summary>
/// The controller review-cockpit API (story 02) on <c>/api/engine</c>: the exercise-scoped queue GET plus the
/// approve / edit / veto / re-roll / batch-approve review actions and the swamped-mode + kill-switch + restore
/// autonomy controls, plus the engine-settings GET + the autonomy-default / tier-policy POSTs (autonomy-safety
/// story 05). Minimal-API extension methods (the <c>Add*</c>/<c>Map*</c> convention) — the orchestrator wires
/// the single <see cref="AddEngineReview"/> / <see cref="MapEngineReview"/> pair into <c>Program.cs</c> AFTER
/// this story is Gate-2 clean (paired with the mock→live flip of <c>useReviewQueue</c>, a SEPARATE step); no
/// builder edits <c>Program.cs</c>.
/// </summary>
/// <remarks>
/// STAFF world (COBRA cockpit). The handlers stay thin — parse, call <see cref="EngineReviewService"/>, map
/// the result to a status. Scope comes ONLY from <see cref="Pulse.WebApi.Data.IExerciseContext"/> inside the
/// service (COR-001); an unresolved scope FAILS CLOSED with <c>401</c>, never a default/empty-200/unscoped
/// result. Every response is the frozen <see cref="Review.EngineReviewItemDto"/> shape the cockpit consumes.
/// </remarks>
public static class EngineReviewEndpoints
{
    /// <summary>
    /// Registers the review-cockpit services: <see cref="EngineReviewService"/> (Scoped, matching the
    /// <c>PulseDbContext</c> unit of work), the SignalR push <see cref="IEngineReviewBroadcaster"/> (Scoped),
    /// the per-exercise <see cref="EngineAutonomyRegistry"/> (Singleton), the non-request-bound auto-HOLD
    /// <see cref="EngineReviewTickHost"/> (hosted), and the host-wide degraded-mode
    /// <see cref="EngineAutonomyProviderHealthListener"/> — which REPLACES the generation core's no-op
    /// <see cref="IProviderHealthListener"/> so a provider circuit trip clamps every active exercise to Suggest
    /// (§3.5) — and the per-exercise <see cref="EngineTierPolicyRegistry"/> (Singleton, TryAdd — shared with
    /// <c>AddReactionLoopHost</c>).
    /// </summary>
    /// <remarks>
    /// <b>Wire this AFTER <c>AddEngineGeneration</c>.</b> Two things depend on that order: the
    /// <see cref="IProviderHealthListener"/> replacement above, and <see cref="EngineReviewService"/>'s
    /// <see cref="IGenerationProvider"/> + <c>IOptions&lt;GenerationOptions&gt;</c> dependencies, which
    /// <c>GET /api/engine/settings</c> reads (read-only — nothing here ever mutates governed generation config).
    /// </remarks>
    /// <param name="services">The service collection.</param>
    /// <returns>The same collection, for chaining.</returns>
    public static IServiceCollection AddEngineReview(this IServiceCollection services)
    {
        ArgumentNullException.ThrowIfNull(services);

        services.AddScoped<EngineReviewService>();
        services.AddScoped<IEngineReviewBroadcaster, EngineReviewBroadcaster>();
        services.AddSingleton<EngineAutonomyRegistry>();

        // The per-exercise model-tier-policy store (story 05). TryAdd so this and AddReactionLoopHost converge on
        // ONE singleton whichever is wired first — the load-bearing shared-instance point: the settings POST and
        // the loop's per-burst read MUST see the same dictionary or a tier choice would never reach generation.
        services.TryAddSingleton<EngineTierPolicyRegistry>();

        // The degraded-mode bridge (NFR-003 / ADP-042): replace the generation core's no-op listener so a
        // provider circuit trip fans DegradeToSuggest out to every active exercise (only ever LOWERS, §8.2).
        services.RemoveAll<IProviderHealthListener>();
        services.AddSingleton<IProviderHealthListener, EngineAutonomyProviderHealthListener>();

        services.AddHostedService<EngineReviewTickHost>();

        return services;
    }

    /// <summary>Maps the review-cockpit endpoints under <c>/api/engine</c>.</summary>
    /// <param name="endpoints">The route builder to map onto.</param>
    /// <returns>The same route builder, for chaining.</returns>
    public static IEndpointRouteBuilder MapEngineReview(this IEndpointRouteBuilder endpoints)
    {
        ArgumentNullException.ThrowIfNull(endpoints);

        // Every cockpit endpoint is STAFF-only and assigned-exercise-only (COR-005). One shared authorization
        // filter (EngineCockpitStaffAuthorizationFilter) gates the whole group BEFORE any handler — layered on
        // top of the service's COR-001 scope resolution, which is unchanged. The group carries an EMPTY prefix
        // so the absolute route templates stay exactly as before (the orchestrator wires the same paths).
        var cockpit = endpoints
            .MapGroup(string.Empty)
            .AddEndpointFilter<EngineCockpitStaffAuthorizationFilter>();

        // #297: every MUTATING cockpit route additionally requires the caller's StaffAssignment.Role to be
        // 'controller' (EngineCockpitControllerRoleFilter — a SIBLING of the staff filter above, composed with it,
        // never a second auth mechanism). An evaluator/planner assigned to the exercise may WATCH the cockpit
        // (both GETs below stay on the read-only group) but may not steer it: no approve/veto/re-roll, no kill
        // switch, no settings change. The sub-group carries an EMPTY prefix so route templates are unchanged.
        var steering = cockpit
            .MapGroup(string.Empty)
            .AddEndpointFilter<EngineCockpitControllerRoleFilter>();

        cockpit.MapGet("/api/engine/review-queue", GetQueueAsync);
        cockpit.MapGet("/api/engine/settings", GetSettingsAsync);

        steering.MapPost("/api/engine/review/{draftId:guid}/approve", ApproveAsync);
        steering.MapPost("/api/engine/review/{draftId:guid}/edit", EditAsync);
        steering.MapPost("/api/engine/review/{draftId:guid}/veto", VetoAsync);
        steering.MapPost("/api/engine/review/{draftId:guid}/re-roll", ReRollAsync);
        steering.MapPost("/api/engine/review/batch-approve", BatchApproveAsync);
        steering.MapPost("/api/engine/autonomy/swamped-mode", SetSwampedModeAsync);
        steering.MapPost("/api/engine/autonomy/kill-switch", EngageKillSwitchAsync);
        steering.MapPost("/api/engine/autonomy/restore", RestoreAsync);
        steering.MapPost("/api/engine/settings/autonomy-default", SetAutonomyDefaultAsync);
        steering.MapPost("/api/engine/settings/tier-policy", SetTierPolicyAsync);

        return endpoints;
    }

    /// <summary>
    /// <c>GET /api/engine/review-queue</c> — the current exercise's review QUEUE (queued Suggest +
    /// counting-down Delayed-auto + auto-HELD; resolved items excluded), each item the frozen wire shape.
    /// Fails closed with <c>401</c> on an unresolved scope (COR-001).
    /// </summary>
    private static async Task<IResult> GetQueueAsync(EngineReviewService service, CancellationToken cancellationToken)
    {
        var result = await service.GetQueueAsync(cancellationToken);
        return result.Outcome == EngineReviewOutcome.Ok
            ? Results.Ok(result.Items)
            : Results.Unauthorized();
    }

    /// <summary><c>POST /api/engine/review/{draftId}/approve</c> — publish the burst through the shared funnel (one decision per burst).</summary>
    private static async Task<IResult> ApproveAsync(
        Guid draftId,
        EngineReviewActionRequest? request,
        EngineReviewService service,
        CancellationToken cancellationToken)
    {
        if (request is null)
        {
            return Results.BadRequest("A JSON action body is required.");
        }

        var result = await service.ApproveAsync(draftId, request.ToInput(), cancellationToken);
        return MapAction(result);
    }

    /// <summary><c>POST /api/engine/review/{draftId}/edit</c> — sanitize the new text (NFR-004) then publish through the same funnel.</summary>
    private static async Task<IResult> EditAsync(
        Guid draftId,
        EngineDraftEditRequest? request,
        EngineReviewService service,
        CancellationToken cancellationToken)
    {
        if (request is null)
        {
            return Results.BadRequest("A JSON edit body is required.");
        }

        var result = await service.EditAsync(draftId, request.Text, request.ToInput(), cancellationToken);
        return MapAction(result);
    }

    /// <summary><c>POST /api/engine/review/{draftId}/veto</c> — mark Vetoed; NOTHING publishes.</summary>
    private static async Task<IResult> VetoAsync(
        Guid draftId,
        EngineReviewActionRequest? request,
        EngineReviewService service,
        CancellationToken cancellationToken)
    {
        if (request is null)
        {
            return Results.BadRequest("A JSON action body is required.");
        }

        var result = await service.VetoAsync(draftId, request.ToInput(), cancellationToken);
        return MapAction(result);
    }

    /// <summary><c>POST /api/engine/review/{draftId}/re-roll</c> — return the burst to review; NOTHING publishes.</summary>
    private static async Task<IResult> ReRollAsync(
        Guid draftId,
        EngineReviewActionRequest? request,
        EngineReviewService service,
        CancellationToken cancellationToken)
    {
        if (request is null)
        {
            return Results.BadRequest("A JSON action body is required.");
        }

        var result = await service.ReRollAsync(draftId, request.ToInput(), cancellationToken);
        return MapAction(result);
    }

    /// <summary><c>POST /api/engine/review/batch-approve</c> — approve several bursts, one decision each (never per post, CTL-034).</summary>
    private static async Task<IResult> BatchApproveAsync(
        EngineBatchApproveRequest? request,
        EngineReviewService service,
        CancellationToken cancellationToken)
    {
        if (request is null)
        {
            return Results.BadRequest("A JSON batch body is required.");
        }

        if (request.DraftIds is null || request.DraftIds.Count == 0)
        {
            return Results.BadRequest("draftIds is required and must be non-empty.");
        }

        var draftIds = new List<Guid>(request.DraftIds.Count);
        foreach (var raw in request.DraftIds)
        {
            if (!Guid.TryParse(raw, out var draftId))
            {
                return Results.BadRequest($"'{raw}' is not a valid draft id.");
            }

            draftIds.Add(draftId);
        }

        var result = await service.BatchApproveAsync(draftIds, request.ToInput(), cancellationToken);
        return result.Outcome switch
        {
            EngineReviewOutcome.Ok => Results.Ok(result.Outcomes),
            EngineReviewOutcome.ScopeUnresolved => Results.Unauthorized(),
            EngineReviewOutcome.Invalid => Results.BadRequest(result.ValidationError),
            _ => Results.StatusCode(StatusCodes.Status500InternalServerError),
        };
    }

    /// <summary><c>POST /api/engine/autonomy/swamped-mode</c> — the lead-gated timeout auto-send toggle (an explicit human action; never self-set, §8.2).</summary>
    private static async Task<IResult> SetSwampedModeAsync(
        EngineSwampedModeRequest? request,
        EngineReviewService service,
        CancellationToken cancellationToken)
    {
        if (request is null)
        {
            return Results.BadRequest("A JSON swamped-mode body is required.");
        }

        if (request.Enabled is not { } enabled)
        {
            return Results.BadRequest("enabled is required.");
        }

        var result = await service.SetSwampedModeAsync(enabled, request.ToInput(), cancellationToken);
        return MapAutonomy(result);
    }

    /// <summary><c>POST /api/engine/autonomy/kill-switch</c> — the manual kill switch (ADP-042); only ever LOWERS autonomy (§8.2).</summary>
    private static async Task<IResult> EngageKillSwitchAsync(
        EngineKillSwitchRequest? request,
        EngineReviewService service,
        CancellationToken cancellationToken)
    {
        if (request is null)
        {
            return Results.BadRequest("A JSON kill-switch body is required.");
        }

        if (!TryParseKillSwitchMode(request.Mode, out var mode))
        {
            return Results.BadRequest("mode must be one of 'drop-to-suggest' or 'full-stop'.");
        }

        var result = await service.EngageKillSwitchAsync(mode, request.ToInput(), cancellationToken);
        return MapAutonomy(result);
    }

    /// <summary><c>POST /api/engine/autonomy/restore</c> — the controller UNDO for the kill switch / degraded clamp; resumes generation at the preserved base levels (§8.2 human-only raise).</summary>
    private static async Task<IResult> RestoreAsync(
        EngineReviewActionRequest? request,
        EngineReviewService service,
        CancellationToken cancellationToken)
    {
        if (request is null)
        {
            return Results.BadRequest("A JSON restore body is required.");
        }

        var result = await service.RestoreFromSafetyAsync(request.ToInput(), cancellationToken);
        return MapAutonomy(result);
    }

    /// <summary>
    /// <c>GET /api/engine/settings</c> — the read-only "what is this exercise's engine actually running" view:
    /// active provider, the governed <c>Generation:Tiers:*</c> mapping (informational), the exercise's autonomy
    /// default + safety clamp, and its tier-policy mode. Open to ANY assigned staff caller (an evaluator may
    /// watch); fails closed with <c>401</c> on an unresolved scope (COR-001).
    /// </summary>
    private static async Task<IResult> GetSettingsAsync(EngineReviewService service, CancellationToken cancellationToken)
    {
        var result = await service.GetSettingsAsync(cancellationToken);
        return MapSettings(result);
    }

    /// <summary>
    /// <c>POST /api/engine/settings/autonomy-default</c> — sets the exercise's DEFAULT autonomy level
    /// (<c>suggest</c> / <c>delayed-auto</c>) on the SHARED autonomy state the loop reads, live for the next
    /// burst. Controller-role only. <c>auto</c> (v1.1) and any unknown literal are rejected <c>400</c>; a change
    /// never lifts an active safety clamp (§8.2).
    /// </summary>
    private static async Task<IResult> SetAutonomyDefaultAsync(
        EngineAutonomyDefaultRequest? request,
        EngineReviewService service,
        CancellationToken cancellationToken)
    {
        if (request is null)
        {
            return Results.BadRequest("A JSON autonomy-default body is required.");
        }

        var result = await service.SetExerciseAutonomyDefaultAsync(request.Level, request.ToInput(), cancellationToken);
        return MapSettings(result);
    }

    /// <summary>
    /// <c>POST /api/engine/settings/tier-policy</c> — sets the exercise's model-tier policy mode
    /// (<c>standard</c> / <c>ambient</c> / <c>auto</c>, where <c>auto</c> clears the override). Controller-role
    /// only. Never sets which deployment/model a tier resolves to (that stays governed config, NFR-005).
    /// </summary>
    private static async Task<IResult> SetTierPolicyAsync(
        EngineTierPolicyRequest? request,
        EngineReviewService service,
        CancellationToken cancellationToken)
    {
        if (request is null)
        {
            return Results.BadRequest("A JSON tier-policy body is required.");
        }

        var result = await service.SetTierPolicyModeAsync(request.Mode, request.ToInput(), cancellationToken);
        return MapSettings(result);
    }

    /// <summary>Maps an engine-settings result to its HTTP status (fail closed).</summary>
    private static IResult MapSettings(EngineSettingsResult result) => result.Outcome switch
    {
        EngineReviewOutcome.Ok => Results.Ok(result.Settings),
        EngineReviewOutcome.ScopeUnresolved => Results.Unauthorized(),
        EngineReviewOutcome.Invalid => Results.BadRequest(result.ValidationError),
        _ => Results.StatusCode(StatusCodes.Status500InternalServerError),
    };

    /// <summary>Maps a single-action result to its HTTP status (fail closed).</summary>
    private static IResult MapAction(EngineReviewActionResult result) => result.Outcome switch
    {
        EngineReviewOutcome.Ok => Results.Ok(result.Item),
        EngineReviewOutcome.ScopeUnresolved => Results.Unauthorized(),
        EngineReviewOutcome.Invalid => Results.BadRequest(result.ValidationError),
        EngineReviewOutcome.NotFound => Results.NotFound(),
        EngineReviewOutcome.AlreadyResolved => Results.Conflict("The review item is already resolved (published or vetoed)."),
        // WR-002/SG-001: the publish funnel did not fully reach the feed; the burst is NOT marked Published and
        // stays actionable. Surfaced as 502 (upstream publish failed), never a 2xx — the same fail-closed style.
        EngineReviewOutcome.PublishFailed => Results.StatusCode(StatusCodes.Status502BadGateway),
        _ => Results.StatusCode(StatusCodes.Status500InternalServerError),
    };

    /// <summary>Maps an autonomy-control result to its HTTP status (fail closed).</summary>
    private static IResult MapAutonomy(EngineAutonomyResult result) => result.Outcome switch
    {
        EngineReviewOutcome.Ok => Results.Ok(result.State),
        EngineReviewOutcome.ScopeUnresolved => Results.Unauthorized(),
        EngineReviewOutcome.Invalid => Results.BadRequest(result.ValidationError),
        _ => Results.StatusCode(StatusCodes.Status500InternalServerError),
    };

    /// <summary>Parses the kebab kill-switch mode literal to the built <see cref="KillSwitchMode"/>.</summary>
    private static bool TryParseKillSwitchMode(string? raw, out KillSwitchMode mode)
    {
        switch (raw)
        {
            case "drop-to-suggest":
                mode = KillSwitchMode.DropToSuggest;
                return true;
            case "full-stop":
                mode = KillSwitchMode.FullStop;
                return true;
            default:
                mode = KillSwitchMode.DropToSuggest;
                return false;
        }
    }
}

/// <summary>
/// The common review-action request body (camelCase JSON). Every scalar is nullable so a missing field is a
/// validation 400 (in the service), never a deserialization failure. Carries NO <c>exerciseId</c> — scope is
/// server-authoritative from <see cref="Pulse.WebApi.Data.IExerciseContext"/> (COR-001).
/// </summary>
public class EngineReviewActionRequest
{
    /// <summary>The individual controller behind the shared account (COR-018) — required.</summary>
    public string? ActingHumanId { get; init; }

    /// <summary>The exercise IANA time zone for the XC-004 envelope (XC-008) — required (client-supplied stopgap until COR-050 metadata carries it).</summary>
    public string? TimeZone { get; init; }

    /// <summary>Projects the request to the service input.</summary>
    /// <returns>The action input.</returns>
    public EngineReviewActionInput ToInput() => new(ActingHumanId, TimeZone);
}

/// <summary>The edit-action request body — the common action fields plus the new lead-post text (sanitized server-side, NFR-004).</summary>
public sealed class EngineDraftEditRequest : EngineReviewActionRequest
{
    /// <summary>The controller's edited lead-post text; sanitized before publishing.</summary>
    public string? Text { get; init; }
}

/// <summary>The batch-approve request body — the common action fields plus the draft ids to approve.</summary>
public sealed class EngineBatchApproveRequest : EngineReviewActionRequest
{
    /// <summary>The burst/draft ids to approve, as GUID strings.</summary>
    public IReadOnlyList<string>? DraftIds { get; init; }
}

/// <summary>The swamped-mode request body — the acting human (COR-018) plus the desired on/off state.</summary>
public sealed class EngineSwampedModeRequest
{
    /// <summary>The lead controller behind the shared account (COR-018) — required.</summary>
    public string? ActingHumanId { get; init; }

    /// <summary>Whether swamped mode (timeout auto-send) should be on — required.</summary>
    public bool? Enabled { get; init; }

    /// <summary>Projects the request to the service input (swamped mode needs no telemetry zone).</summary>
    /// <returns>The action input.</returns>
    public EngineReviewActionInput ToInput() => new(ActingHumanId, null);
}

/// <summary>
/// The autonomy-default request body (autonomy-safety story 05) — the acting human (COR-018) plus the requested
/// level literal. Carries NO <c>exerciseId</c>: scope is server-authoritative from
/// <see cref="Pulse.WebApi.Data.IExerciseContext"/> (COR-001), and a client-supplied one would be ignored.
/// Every field is nullable so a missing one is a validation <c>400</c>, never a deserialization failure.
/// </summary>
public sealed class EngineAutonomyDefaultRequest
{
    /// <summary>The controller behind the shared account (COR-018) — required.</summary>
    public string? ActingHumanId { get; init; }

    /// <summary>The requested exercise default level — <c>suggest</c> or <c>delayed-auto</c> (<c>auto</c> is v1.1 and rejected 400).</summary>
    public string? Level { get; init; }

    /// <summary>The exercise IANA time zone for the XC-004 envelope (XC-008) — optional; defaults to <c>UTC</c>.</summary>
    public string? TimeZone { get; init; }

    /// <summary>Projects the request to the service input.</summary>
    /// <returns>The action input.</returns>
    public EngineReviewActionInput ToInput() => new(ActingHumanId, TimeZone);
}

/// <summary>
/// The tier-policy request body (autonomy-safety story 05) — the acting human (COR-018) plus the requested mode.
/// The concrete deployment/model a tier resolves to is deliberately NOT expressible here (NFR-005 / ADP-025).
/// </summary>
public sealed class EngineTierPolicyRequest
{
    /// <summary>The controller behind the shared account (COR-018) — required.</summary>
    public string? ActingHumanId { get; init; }

    /// <summary>The requested tier-policy mode — <c>standard</c>, <c>ambient</c>, or <c>auto</c> (clears the override).</summary>
    public string? Mode { get; init; }

    /// <summary>The exercise IANA time zone for the XC-004 envelope (XC-008) — optional; defaults to <c>UTC</c>.</summary>
    public string? TimeZone { get; init; }

    /// <summary>Projects the request to the service input.</summary>
    /// <returns>The action input.</returns>
    public EngineReviewActionInput ToInput() => new(ActingHumanId, TimeZone);
}

/// <summary>The kill-switch request body — the acting human (COR-018) plus the drop mode.</summary>
public sealed class EngineKillSwitchRequest
{
    /// <summary>The controller behind the shared account (COR-018) — required.</summary>
    public string? ActingHumanId { get; init; }

    /// <summary>The kill-switch mode literal — <c>drop-to-suggest</c> or <c>full-stop</c>.</summary>
    public string? Mode { get; init; }

    /// <summary>Projects the request to the service input (the kill switch needs no telemetry zone).</summary>
    /// <returns>The action input.</returns>
    public EngineReviewActionInput ToInput() => new(ActingHumanId, null);
}
