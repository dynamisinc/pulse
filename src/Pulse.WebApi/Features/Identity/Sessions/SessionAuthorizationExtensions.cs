namespace Pulse.WebApi.Features.Identity.Sessions;

using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Builder;
using Microsoft.Extensions.DependencyInjection;

/// <summary>
/// The composition-root seams for the default-deny session gate (identity-auth-roles/11, COR-012) — the
/// missing half of COR-012: a live session is not merely <i>modeled</i>, it is <i>required</i>.
/// </summary>
/// <remarks>
/// <para>
/// <b>The bug this closes (#359).</b> Every endpoint gated on
/// <c>if (exerciseContext.CurrentExerciseId is null) return Results.Unauthorized();</c> — a question about
/// <i>whose data is this</i> (COR-001 isolation), not <i>may this caller have any data</i>.
/// <c>ExerciseResolutionMiddleware</c> answers the first one for an anonymous caller from the bare
/// <c>Host</c> header, deliberately, because <c>/api/exercise-context</c> and the login endpoints must work
/// pre-auth. A mechanism sized for a handful of pre-auth routes had become the default scope for all of them,
/// so 12 routes plus the SignalR hub were reachable with no credential at all.
/// </para>
/// <para>
/// <b>Why ASP.NET's own <c>FallbackPolicy</c> and not this codebase's <c>IEndpointFilter</c> idiom.</b>
/// The filter-plus-<c>MapGroup</c> pattern (<c>DenyReadOnlySessions</c>,
/// <c>EngineCockpitStaffAuthorizationFilter</c>) is the established local shape and has a smaller blast
/// radius — but minimal-API endpoint filters are <b>never invoked</b> for MVC endpoints
/// (<c>POST /api/telemetry</c> is an <c>[ApiController]</c>) or for hub endpoints (<c>MapHub</c>). Taking that
/// route would have meant three parallel gates, which is precisely the composition failure that produced this
/// bug: three individually-sound mechanisms that never compose into one guarantee.
/// <c>AuthorizationMiddleware</c> covers minimal APIs, controllers and hubs through one policy, and it is
/// opt-OUT (<see cref="AllowAnonymousPreAuth{TBuilder}"/>) rather than opt-in.
/// </para>
/// <para>
/// <b>No authentication scheme is registered, by design.</b> Pulse resolves an opaque bearer token in its own
/// <see cref="SessionAuthenticationMiddleware"/>, not through an <c>IAuthenticationHandler</c>; that
/// middleware's precedence and participant host-binding semantics are load-bearing and are NOT rewritten here.
/// The fallback policy carries no authentication schemes, so <c>PolicyEvaluator</c> reads
/// <c>HttpContext.User</c> (which the middleware now populates — see <see cref="SessionPrincipal"/>) directly
/// instead of challenging a scheme. <see cref="AccessRejectionResultHandler"/> then writes the 401/403, so no
/// default challenge scheme needs to exist.
/// </para>
/// <para>
/// <b>Required <c>Program.cs</c> wiring + ordering (orchestrator-owned).</b>
/// <list type="number">
///   <item><description>DI: <c>builder.Services.AddSessionAuthorization()</c>.</description></item>
///   <item><description>Pipeline: <c>app.UseAuthorization()</c> MUST be called EXPLICITLY, immediately after
///   <c>app.UseSessionAuthentication()</c>. <c>WebApplication</c> auto-inserts it ahead of all user middleware
///   when it is never called explicitly, which would evaluate the policy before the principal exists. That
///   failure is SILENT rather than total: the allowlisted routes keep working (<c>IAllowAnonymous</c>
///   short-circuits the middleware wherever it sits), so login succeeds and then every authenticated call
///   after it 401s.</description></item>
///   <item><description>Each of <see cref="PreAuthAllowlist"/>'s eleven routes carries
///   <see cref="AllowAnonymousPreAuth{TBuilder}"/> at its own mapping call site.</description></item>
/// </list>
/// </para>
/// </remarks>
public static class SessionAuthorizationExtensions
{
    /// <summary>
    /// Registers the default-deny authorization posture: a <c>RequireAuthenticatedUser</c> fallback policy
    /// applied to every endpoint that declares no authorization metadata of its own, plus the result handler
    /// that turns a policy failure into a 401/403 and emits the XC-004 <c>access.rejected</c> audit event.
    /// </summary>
    /// <param name="services">The service collection.</param>
    /// <returns>The same collection, for chaining.</returns>
    public static IServiceCollection AddSessionAuthorization(this IServiceCollection services)
    {
        ArgumentNullException.ThrowIfNull(services);

        services.AddAuthorization(options =>
        {
            // Fallback, not Default: it applies ONLY where an endpoint declares no authorization metadata,
            // which is exactly "everything nobody deliberately opted out". No authentication schemes are
            // named, so the policy evaluates HttpContext.User as the middleware left it.
            options.FallbackPolicy = new AuthorizationPolicyBuilder()
                .RequireAuthenticatedUser()
                .Build();
        });

        services.AddSingleton<AccessRejectionTelemetry>();
        services.AddSingleton<IAuthorizationMiddlewareResultHandler, AccessRejectionResultHandler>();

        return services;
    }

    /// <summary>
    /// Marks an endpoint as reachable WITHOUT a live session — the single, explicit opt-out from the
    /// default-deny gate. A self-documenting wrapper over <c>.AllowAnonymous()</c> so every exception is
    /// greppable by one name and traceable to <see cref="PreAuthAllowlist"/>, which must list the route.
    /// </summary>
    /// <typeparam name="TBuilder">The endpoint convention builder type (route handler or route group).</typeparam>
    /// <param name="builder">The endpoint builder to mark.</param>
    /// <returns>The same builder, for chaining.</returns>
    public static TBuilder AllowAnonymousPreAuth<TBuilder>(this TBuilder builder)
        where TBuilder : IEndpointConventionBuilder
    {
        ArgumentNullException.ThrowIfNull(builder);
        return builder.AllowAnonymous();
    }
}
