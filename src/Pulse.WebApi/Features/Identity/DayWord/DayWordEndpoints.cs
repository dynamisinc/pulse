namespace Pulse.WebApi.Features.Identity.DayWord;

using System.Threading.RateLimiting;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.AspNetCore.Routing;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Microsoft.Extensions.Options;
using Pulse.WebApi.Features.EngineRuntime;
using Pulse.WebApi.Features.Identity.Accounts;
using Pulse.WebApi.Features.Identity.EasyLogin;
using Pulse.WebApi.Features.Identity.Sessions;
using Pulse.WebApi.Features.Identity.SharedAccess;

/// <summary>
/// The day-word slice's HTTP surface and composition seams (easy-login story 05, EL-9 / EL-13 / EL-16): the three staff
/// routes <c>GET</c> / <c>PUT</c> / <c>DELETE /api/staff/day-word</c> and the anonymous <c>POST /api/auth/word</c>.
/// The orchestrator wires <see cref="AddDayWord"/> and <see cref="MapDayWordEndpoints"/> into <c>Program.cs</c>; this
/// slice never edits it.
/// </summary>
/// <remarks>
/// <para>
/// <b>Required <c>Program.cs</c> wiring (orchestrator-owned, the backend seam commit):</b>
/// <list type="number">
///   <item><description>DI: <c>builder.Services.AddDayWord();</c> alongside <c>AddEasyLoginFoundation()</c> (which binds
///   <see cref="EasyLoginOptions"/> from <c>Authentication:EasyLogin</c>; without it the options keep their defaults).
///   It also relies on what <c>Program.cs</c> already registers: <c>AddSessions</c> (<see cref="ISessionIssuer"/>, the
///   real staff-session accessor), <c>AddStaffIdentity</c> (<c>StaffAssignmentService</c>, used by the staff filters),
///   <c>AddExerciseClock</c> and the persistence / scoping registrations.</description></item>
///   <item><description>Pipeline: no new middleware. The <c>easy-login-word</c> policy joins the shared limiter under
///   the existing <c>app.UseRateLimiter()</c>.</description></item>
///   <item><description>Endpoints: <c>app.MapDayWordEndpoints();</c>.</description></item>
///   <item><description>Pre-auth allowlist: <c>POST /api/auth/word</c> is marked <c>.AllowAnonymousPreAuth()</c> here;
///   the same seam commit adds <c>"POST /api/auth/word"</c> to <c>PreAuthAllowlist.Routes</c> and moves the pinned
///   counts.</description></item>
/// </list>
/// </para>
/// </remarks>
public static class DayWordEndpoints
{
    /// <summary>The staff route (all three verbs).</summary>
    public const string StaffRoute = "/api/staff/day-word";

    /// <summary>The anonymous word sign-in route.</summary>
    public const string WordSignInRoute = "/api/auth/word";

    /// <summary>
    /// The per-IP rate-limit policy on <c>POST /api/auth/word</c> (EL-16): its own bucket, not the shared
    /// <c>participant-login</c> one, sized by <see cref="EasyLoginOptions.WordPermitPerMinute"/> (default 10 a minute).
    /// </summary>
    public const string WordSignInRateLimitPolicy = "easy-login-word";

    /// <summary>The <c>Cache-Control</c> value every staff day-word response carries.</summary>
    public const string NoStore = "no-store";

    /// <summary>
    /// Registers the slice: the two scoped services, the shared slow-KDF hasher and the kernel pieces they need
    /// (<c>TryAdd</c>, so the registrations of <c>AddSharedReadOnly()</c> and <c>AddEasyLoginFoundation()</c> win), and
    /// the <c>easy-login-word</c> rate-limit policy.
    /// </summary>
    /// <param name="services">The service collection.</param>
    /// <returns>The same collection, for chaining.</returns>
    public static IServiceCollection AddDayWord(this IServiceCollection services)
    {
        ArgumentNullException.ThrowIfNull(services);

        // Scoped, matching the PulseDbContext unit of work.
        services.AddScoped<DayWordService>();
        services.AddScoped<WordLoginService>();

        // Shared with the view-only credential (story 06 registers the same singleton) and the kernel (story 01).
        services.TryAddSingleton<ISharedCredentialHasher, SharedCredentialHasher>();
        services.TryAddSingleton(TimeProvider.System);
        services.TryAddScoped<ExerciseFactsReader>();

        // Per-IP fixed window on the guessable-secret sign-in (NFR-009, EL-16). The permit is read from
        // EasyLoginOptions when a client's window is first created, so operators raise it with an app setting
        // (Authentication__EasyLogin__WordPermitPerMinute) and no deploy. AddRateLimiter is additive: this only adds a
        // named policy to the one shared limiter. There is deliberately NO failed-attempt lockout on this route (EL-9).
        services.AddRateLimiter(options =>
        {
            options.RejectionStatusCode = StatusCodes.Status429TooManyRequests;
            options.AddPolicy(WordSignInRateLimitPolicy, httpContext =>
            {
                var permit = httpContext.RequestServices.GetRequiredService<IOptions<EasyLoginOptions>>().Value.WordPermitPerMinute;

                return RateLimitPartition.GetFixedWindowLimiter(
                    partitionKey: httpContext.Connection.RemoteIpAddress?.ToString() ?? "unknown",
                    factory: _ => new FixedWindowRateLimiterOptions
                    {
                        PermitLimit = permit,
                        Window = TimeSpan.FromMinutes(1),
                        QueueLimit = 0,
                    });
            });
        });

        return services;
    }

    /// <summary>Maps the three staff day-word routes and the anonymous word sign-in.</summary>
    /// <param name="endpoints">The endpoint route builder.</param>
    /// <returns>The same builder, for chaining.</returns>
    public static IEndpointRouteBuilder MapDayWordEndpoints(this IEndpointRouteBuilder endpoints)
    {
        ArgumentNullException.ThrowIfNull(endpoints);

        // EL-13: an assigned staff session (EngineCockpitStaffAuthorizationFilter) holding controller or planner on
        // the resolved exercise (RosterStaffRoleFilter). The no-store filter runs first so 401/403 carry it too.
        endpoints.MapGet(StaffRoute, GetStatusAsync).WithDayWordStaffGate();
        endpoints.MapPut(StaffRoute, SetAsync).WithDayWordStaffGate();
        endpoints.MapDelete(StaffRoute, ClearAsync).WithDayWordStaffGate();

        // PRE-AUTH (PreAuthAllowlist; the seam commit adds the entry): this route ESTABLISHES a session. It fails
        // closed on its own with one bodyless 401, behind its own per-IP limiter and the 16 KiB login body bound.
        endpoints.MapPost(WordSignInRoute, WordSignInAsync)
            .RequireRateLimiting(WordSignInRateLimitPolicy)
            .WithLoginBodyLimit()
            .AllowAnonymousPreAuth();

        return endpoints;
    }

    private static RouteHandlerBuilder WithDayWordStaffGate(this RouteHandlerBuilder builder) =>
        builder
            .AddEndpointFilter<NoStoreEndpointFilter>()
            .AddEndpointFilter<EngineCockpitStaffAuthorizationFilter>()
            .AddEndpointFilter<RosterStaffRoleFilter>();

    private static async Task<IResult> GetStatusAsync(DayWordService service, CancellationToken cancellationToken)
    {
        var result = await service.GetStatusAsync(cancellationToken);

        return result.Outcome switch
        {
            DayWordOutcome.Ok when result.Status is { } status => Results.Ok(status),
            _ => Refusal(result),
        };
    }

    private static async Task<IResult> SetAsync(
        [FromBody] DayWordPutBody? body,
        DayWordService service,
        CancellationToken cancellationToken)
    {
        var result = await service.SetAsync(body, cancellationToken);

        return result.Outcome switch
        {
            DayWordOutcome.Ok when result.SetResult is { } set => Results.Ok(set),
            _ => Refusal(result),
        };
    }

    private static async Task<IResult> ClearAsync(
        [FromQuery] string? date,
        DayWordService service,
        CancellationToken cancellationToken)
    {
        var result = await service.ClearAsync(date, cancellationToken);

        return result.Outcome == DayWordOutcome.Ok ? Results.NoContent() : Refusal(result);
    }

    /// <summary>Maps a non-success staff outcome: 400 ProblemDetails (never the word), 401, 403; anything else fails closed.</summary>
    private static IResult Refusal(DayWordResult result) => result.Outcome switch
    {
        DayWordOutcome.Invalid => Results.Problem(detail: result.Error, statusCode: StatusCodes.Status400BadRequest),
        DayWordOutcome.Forbidden => Results.StatusCode(StatusCodes.Status403Forbidden),
        DayWordOutcome.Unauthorized => Results.Unauthorized(),
        _ => Results.StatusCode(StatusCodes.Status500InternalServerError),
    };

    /// <summary>
    /// Signs a participant in with their sign-in name and today's word: 200 with exactly the <c>/api/auth/login</c>
    /// envelope, 400 for a missing or oversized field, and one bodyless 401 for everything else.
    /// </summary>
    private static async Task<IResult> WordSignInAsync(
        [FromBody] WordSignInRequestBody? body,
        WordLoginService service,
        CancellationToken cancellationToken)
    {
        if (body is null)
        {
            return Results.Problem(
                detail: "A JSON body with signInName and word is required.",
                statusCode: StatusCodes.Status400BadRequest);
        }

        var result = await service.SignInAsync(body, cancellationToken);

        return result.Outcome switch
        {
            WordLoginOutcome.Authenticated when result.Issued is { } issued =>
                Results.Ok(ParticipantLoginResponseDto.From(issued)),
            WordLoginOutcome.Invalid =>
                Results.Problem(detail: result.ValidationError, statusCode: StatusCodes.Status400BadRequest),
            WordLoginOutcome.Rejected => Results.Unauthorized(),

            // Unreachable: an authenticated outcome always carries a session. Fail closed, still bodyless.
            _ => Results.Unauthorized(),
        };
    }

    /// <summary>Stamps <c>Cache-Control: no-store</c> on every response of the route it wraps, refusals included.</summary>
    private sealed class NoStoreEndpointFilter : IEndpointFilter
    {
        public ValueTask<object?> InvokeAsync(EndpointFilterInvocationContext context, EndpointFilterDelegate next)
        {
            ArgumentNullException.ThrowIfNull(context);
            ArgumentNullException.ThrowIfNull(next);

            context.HttpContext.Response.Headers.CacheControl = NoStore;
            return next(context);
        }
    }
}
