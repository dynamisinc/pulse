namespace Pulse.WebApi.Features.WhiteNoise;

using System.Collections.Generic;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Routing;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Pulse.WebApi.Features.BackgroundWork;
using Pulse.WebApi.Features.EngineRuntime;
using Pulse.WebApi.Features.Identity.EasyLogin;

/// <summary>
/// The white-noise routes (demo-feedback story 05, DF-12/DF-13). STAFF world. Minimal-API extension methods; the
/// orchestrator wires <see cref="AddWhiteNoise"/> and <see cref="MapWhiteNoise"/> into <c>Program.cs</c> (seam S-2).
/// </summary>
/// <remarks>
/// <para>
/// <b>Who may call what.</b> <c>GET /api/staff/noise</c> needs any staff user assigned to the resolved exercise
/// (evaluators included): <see cref="EngineCockpitStaffAuthorizationFilter"/>. The two <c>PUT</c>s also need the
/// <c>controller</c> role: <see cref="EngineCockpitControllerRoleFilter"/> on a nested empty-prefix group, the
/// composition <c>ModerationEndpoints</c> uses. Participant, shared read-only and anonymous sessions get 401; an
/// evaluator's <c>PUT</c> gets 403. The filters run before the handler, so a refused caller never reaches validation.
/// </para>
/// <para>
/// <b>Responses.</b> 200 with <see cref="NoiseStateDto"/> or <see cref="NoisePoolResultDto"/>; 400 ProblemDetails
/// (with a readable <c>detail</c>) for an unknown level, a bad pool mode, a missing <c>posts</c>, more than 1,000
/// entries, or a replace none of whose entries could be used (that 400 also carries <c>poolSize</c> and
/// <c>rejected</c>, and the pool is left unchanged); 401 when no scope resolves.
/// </para>
/// </remarks>
public static class WhiteNoiseEndpoints
{
    /// <summary>The state and level route.</summary>
    public const string NoiseRoute = "/api/staff/noise";

    /// <summary>The ProblemDetails extension carrying the unchanged pool size on a refused replace.</summary>
    public const string PoolSizeExtension = "poolSize";

    /// <summary>The ProblemDetails extension carrying the rejections on a refused replace.</summary>
    public const string RejectedExtension = "rejected";

    /// <summary>The pool route.</summary>
    public const string PoolRoute = "/api/staff/noise/pool";

    /// <summary>
    /// The largest pool body: 1,000 entries of up to 280 code points of text plus a persona, with generous room for
    /// JSON escaping.
    /// </summary>
    public const long MaxPoolRequestBytes = 4 * 1024 * 1024;

    /// <summary>
    /// Registers <see cref="WhiteNoiseService"/> (scoped), its collaborators, and the <see cref="WhiteNoisePacer"/>
    /// hosted service. Wire it after <c>AddInjects()</c> / <c>AddPauseTierSteering()</c> (seam S-2). Prerequisites the
    /// host provides: persistence + exercise scoping, <c>AddExerciseClock()</c>, <c>AddPauseTierSteering()</c>,
    /// <c>AddStaffIdentity()</c> (the gates and the acting human), <c>AddSocialPostWrite()</c> +
    /// <c>AddSocialRealtimeHub()</c> (the post funnel and the hub context the push uses).
    /// </summary>
    /// <param name="services">The service collection.</param>
    /// <returns>The same collection, for chaining.</returns>
    public static IServiceCollection AddWhiteNoise(this IServiceCollection services)
    {
        ArgumentNullException.ThrowIfNull(services);

        services.TryAddSingleton(TimeProvider.System);
        services.TryAddSingleton<INoiseJitterSource, CryptoNoiseJitterSource>();
        services.TryAddSingleton(new WhiteNoisePacerOptions());
        services.AddWakeSignal<WhiteNoisePacerSignal>(wakeOnClockChange: true);
        services.TryAddSingleton<NoiseStateThrottle>();
        services.TryAddSingleton<INoiseBroadcaster, NoiseBroadcaster>();
        services.TryAddScoped<ExerciseFactsReader>();
        services.TryAddScoped<WhiteNoiseService>();
        services.AddHostedService<WhiteNoisePacer>();

        return services;
    }

    /// <summary>
    /// Maps <c>GET /api/staff/noise</c> behind the staff gate, and <c>PUT /api/staff/noise</c> and
    /// <c>PUT /api/staff/noise/pool</c> behind the staff gate AND the controller-role gate.
    /// </summary>
    /// <param name="endpoints">The route builder.</param>
    /// <returns>The same route builder, for chaining.</returns>
    public static IEndpointRouteBuilder MapWhiteNoise(this IEndpointRouteBuilder endpoints)
    {
        ArgumentNullException.ThrowIfNull(endpoints);

        var staff = endpoints
            .MapGroup(string.Empty)
            .AddEndpointFilter<EngineCockpitStaffAuthorizationFilter>();

        var controllerOnly = staff
            .MapGroup(string.Empty)
            .AddEndpointFilter<EngineCockpitControllerRoleFilter>();

        staff.MapGet(NoiseRoute, GetStateAsync);
        controllerOnly.MapPut(NoiseRoute, SetLevelAsync);
        controllerOnly.MapPut(PoolRoute, ReplacePoolAsync)
            .WithMetadata(new RequestSizeLimitAttribute(MaxPoolRequestBytes));

        return endpoints;
    }

    private static async Task<IResult> GetStateAsync(WhiteNoiseService service, CancellationToken cancellationToken) =>
        ToResult(await service.GetStateAsync(cancellationToken));

    private static async Task<IResult> SetLevelAsync(
        NoiseLevelRequest? request,
        WhiteNoiseService service,
        CancellationToken cancellationToken) =>
        ToResult(await service.SetLevelAsync(request, cancellationToken));

    private static async Task<IResult> ReplacePoolAsync(
        NoisePoolRequest? request,
        WhiteNoiseService service,
        CancellationToken cancellationToken) =>
        ToResult(await service.ReplacePoolAsync(request, cancellationToken));

    private static IResult ToResult<TValue>(WhiteNoiseResult<TValue> result)
        where TValue : class => result.Outcome switch
        {
            WhiteNoiseOutcome.Ok when result.Value is { } value => Results.Json(value),

            // A replace with no usable entry: the 400 carries the same poolSize + rejected the 200 would.
            WhiteNoiseOutcome.Invalid when result.Value is NoisePoolResultDto pool => Results.Problem(
                detail: result.Message,
                statusCode: StatusCodes.Status400BadRequest,
                extensions: new Dictionary<string, object?>
                {
                    [PoolSizeExtension] = pool.PoolSize,
                    [RejectedExtension] = pool.Rejected,
                }),
            WhiteNoiseOutcome.Invalid => Results.Problem(detail: result.Message, statusCode: StatusCodes.Status400BadRequest),
            WhiteNoiseOutcome.ScopeUnresolved => Results.Unauthorized(),
            _ => Results.StatusCode(StatusCodes.Status500InternalServerError),
        };
}
