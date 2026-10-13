namespace Pulse.WebApi.Features.Identity.PersonalLinks;

using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Pulse.WebApi.Features.Identity.EasyLogin;

/// <summary>
/// The composition entry points for personal links (easy-login/03): <see cref="AddPersonalLinks"/> and
/// <see cref="MapPersonalLinkEndpoints"/>. The orchestrator wires both into <c>Program.cs</c> in the backend seam commit;
/// this slice never edits it.
/// </summary>
/// <remarks>
/// <para>
/// <b>Required <c>Program.cs</c> wiring (orchestrator-owned).</b>
/// <list type="number">
///   <item><description>DI: <c>builder.Services.AddPersonalLinks();</c> next to <c>AddEasyLoginFoundation()</c>, in
///   either order. It depends on the foundation (options, token protector, URL builder, link DTO factory, facts
///   reader), <c>AddSessions(...)</c> (<c>ISessionIssuer</c>, the real staff-session accessor),
///   <c>AddStaffIdentity(...)</c> (the staff gate's <c>StaffAssignmentService</c>), persistence and exercise scoping;
///   all are registered before the provider is built.</description></item>
///   <item><description>Pipeline: no new middleware. <c>app.UseRateLimiter()</c> (already wired) enforces the added
///   <c>easy-login-join</c> policy.</description></item>
///   <item><description>Endpoints: <c>app.MapPersonalLinkEndpoints();</c></description></item>
///   <item><description>Pre-auth allowlist: add <c>"POST /api/auth/join"</c> to <c>PreAuthAllowlist.Routes</c> and bump
///   the pinned counts in the same commit.</description></item>
/// </list>
/// </para>
/// </remarks>
public static class PersonalLinkExtensions
{
    /// <summary>
    /// Registers the personal-link services and the <c>easy-login-join</c> rate-limit policy, and REPLACES story 01's
    /// fail-closed <c>NullParticipantLinkIssuer</c> with <see cref="ParticipantLinkService"/>. <c>Replace</c> (not
    /// <c>TryAdd</c>) makes the real issuer win whichever of this and <c>AddEasyLoginFoundation()</c> runs first.
    /// </summary>
    /// <param name="services">The service collection.</param>
    /// <returns>The same collection, for chaining.</returns>
    public static IServiceCollection AddPersonalLinks(this IServiceCollection services)
    {
        ArgumentNullException.ThrowIfNull(services);

        // TryAdd: the foundation registers the same system clock, and a test host's fake must win.
        services.TryAddSingleton(TimeProvider.System);

        // Scoped to the PulseDbContext unit of work. The issuer seam resolves to the SAME scoped instance the staff
        // actions use, so a request never holds two link services over one context.
        services.TryAddScoped<ParticipantLinkService>();
        services.Replace(ServiceDescriptor.Scoped<IParticipantLinkIssuer>(
            provider => provider.GetRequiredService<ParticipantLinkService>()));

        services.TryAddScoped<JoinLoginService>();
        services.TryAddScoped<ParticipantAccessService>();

        // NFR-009 / EL-16: additive, like every other slice's policy; enforced by the already-wired UseRateLimiter().
        services.AddRateLimiter(options =>
        {
            options.RejectionStatusCode = StatusCodes.Status429TooManyRequests;
            options.AddPolicy<string, JoinRateLimiterPolicy>(JoinRateLimiterPolicy.PolicyName);
        });

        return services;
    }

    /// <summary>
    /// Maps <c>POST /api/auth/join</c> (anonymous, pre-auth) and the four staff routes under
    /// <c>/api/staff/roster/{id:guid}</c> (staff + controller/planner).
    /// </summary>
    /// <param name="endpoints">The route builder.</param>
    /// <returns>The same route builder, for chaining.</returns>
    public static IEndpointRouteBuilder MapPersonalLinkEndpoints(this IEndpointRouteBuilder endpoints)
    {
        ArgumentNullException.ThrowIfNull(endpoints);

        endpoints.MapJoinEndpoint();
        endpoints.MapParticipantAccessEndpoints();

        return endpoints;
    }
}
