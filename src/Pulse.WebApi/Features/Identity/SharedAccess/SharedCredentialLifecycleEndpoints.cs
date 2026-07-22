namespace Pulse.WebApi.Features.Identity.SharedAccess;

using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;

/// <summary>
/// The shared-credential LIFECYCLE slice HTTP surface + composition-root seams (story 07, COR-016 / NFR-009):
/// <c>POST /api/staff/shared-credential/rotate</c> and <c>POST /api/staff/shared-credential/revoke</c>, both
/// staff-only. Exposes the extension methods the orchestrator wires into <c>Program.cs</c>
/// (<see cref="AddSharedCredentialLifecycle"/> / <see cref="MapSharedCredentialLifecycleEndpoints"/>); this
/// feature never edits <c>Program.cs</c> itself. Follows the <c>Features/Identity/Staff/*</c> +
/// <c>Features/Social/*</c> minimal-API endpoint-extension pattern; route base <c>/api</c>.
/// </summary>
/// <remarks>
/// <para>
/// <b>Required <c>Program.cs</c> wiring (orchestrator-owned, documented for the serial edit):</b>
/// <list type="number">
///   <item><description>DI: <c>builder.Services.AddSharedCredentialLifecycle()</c> — registers the Scoped
///   <see cref="SharedCredentialLifecycleService"/>. It reuses the singleton <see cref="ISharedCredentialHasher"/>
///   registered by story 06's <c>AddSharedReadOnly()</c> (a defensive <c>TryAddSingleton</c> keeps this slice
///   self-sufficient without overriding 06's registration).</description></item>
///   <item><description>Pipeline: NO new middleware and NO new rate-limit policy. These endpoints are gated by
///   staff authorization (<see cref="Pulse.WebApi.Features.Identity.Staff.ICurrentStaffSessionAccessor"/>), not a
///   limiter — so this slice does NOT call <c>AddRateLimiter</c>, does NOT register a policy, and does NOT touch
///   the global <c>RejectionStatusCode</c>. The internet-facing shared-LOGIN abuse controls (story 06's per-IP
///   <c>shared-login</c> rate-limit policy + the brute-force lockout this story adds to that login's verification)
///   already protect the credential; the lifecycle endpoints are behind the staff console.</description></item>
///   <item><description>Endpoints: <c>app.MapSharedCredentialLifecycleEndpoints()</c>.</description></item>
/// </list>
/// </para>
/// </remarks>
public static class SharedCredentialLifecycleEndpoints
{
    /// <summary>
    /// Registers the shared-credential lifecycle slice: the Scoped <see cref="SharedCredentialLifecycleService"/>.
    /// The slow-KDF <see cref="ISharedCredentialHasher"/> is normally provided by story 06's
    /// <c>AddSharedReadOnly()</c>; a <c>TryAddSingleton</c> is included so this slice resolves even if wired
    /// standalone, WITHOUT overriding 06's singleton when both are present. The orchestrator wires the single
    /// call into <c>Program.cs</c>.
    /// </summary>
    /// <param name="services">The service collection.</param>
    /// <returns>The same collection, for chaining.</returns>
    public static IServiceCollection AddSharedCredentialLifecycle(this IServiceCollection services)
    {
        ArgumentNullException.ThrowIfNull(services);

        services.AddScoped<SharedCredentialLifecycleService>();
        services.TryAddSingleton<ISharedCredentialHasher, SharedCredentialHasher>();

        return services;
    }

    /// <summary>Maps the two staff-only shared-credential lifecycle endpoints onto the given route builder.</summary>
    /// <param name="endpoints">The endpoint route builder.</param>
    /// <returns>The same builder, for chaining.</returns>
    public static IEndpointRouteBuilder MapSharedCredentialLifecycleEndpoints(this IEndpointRouteBuilder endpoints)
    {
        ArgumentNullException.ThrowIfNull(endpoints);

        endpoints.MapPost("/api/staff/shared-credential/rotate", RotateAsync);
        endpoints.MapPost("/api/staff/shared-credential/revoke", RevokeAsync);

        return endpoints;
    }

    /// <summary>
    /// Rotates the active exercise's shared password and returns the fresh plaintext once. Fails closed: 401 when
    /// there is no authenticated staff session / no resolved scope, 404 when the exercise has no credential.
    /// </summary>
    private static async Task<IResult> RotateAsync(
        SharedCredentialLifecycleService lifecycleService,
        CancellationToken cancellationToken)
    {
        var result = await lifecycleService.RotateAsync(cancellationToken);

        return result.Outcome switch
        {
            SharedCredentialRotateOutcome.Rotated => Results.Ok(SharedCredentialRotateResponseDto.From(result)),
            SharedCredentialRotateOutcome.Unauthenticated => Results.Unauthorized(),
            SharedCredentialRotateOutcome.NotProvisioned => Results.NotFound(),
            _ => Results.StatusCode(StatusCodes.Status500InternalServerError),
        };
    }

    /// <summary>
    /// Immediately revokes the active exercise's shared credential and terminates all active read-only sessions.
    /// Fails closed: 401 when there is no authenticated staff session / no resolved scope, 404 when there is no
    /// credential.
    /// </summary>
    private static async Task<IResult> RevokeAsync(
        SharedCredentialLifecycleService lifecycleService,
        CancellationToken cancellationToken)
    {
        var result = await lifecycleService.RevokeAsync(cancellationToken);

        return result.Outcome switch
        {
            SharedCredentialRevokeOutcome.Revoked => Results.Ok(SharedCredentialRevokeResponseDto.From(result)),
            SharedCredentialRevokeOutcome.Unauthenticated => Results.Unauthorized(),
            SharedCredentialRevokeOutcome.NotProvisioned => Results.NotFound(),
            _ => Results.StatusCode(StatusCodes.Status500InternalServerError),
        };
    }
}
