namespace Pulse.WebApi.Features.OrganizationResolution;

using Microsoft.AspNetCore.Builder;

/// <summary>
/// The composition-root seam for CUSTOMER-tenant resolution (COR-010, exercise-isolation/11). The orchestrator
/// wires the single <see cref="UseOrganizationResolution"/> call into <c>Program.cs</c>; this slice never edits
/// <c>Program.cs</c> itself.
/// </summary>
/// <remarks>
/// <para>
/// There is deliberately no <c>AddOrganizationResolution()</c>: the middleware's only collaborators are the
/// root <c>IServiceScopeFactory</c> and the already-registered <see cref="Data.IOrganizationContext"/>
/// (<c>AddExerciseScoping()</c> → <c>AddOrganizationScoping()</c>), so there is nothing to register and no way
/// to half-wire the DI side.
/// </para>
/// </remarks>
public static class OrganizationResolutionExtensions
{
    /// <summary>
    /// Adds <see cref="OrganizationResolutionMiddleware"/> — it resolves the authenticated STAFF caller's own
    /// customer tenant into the request-scoped <see cref="Data.IOrganizationContext"/> and leaves it unset
    /// (fail closed) for everyone else.
    /// </summary>
    /// <remarks>
    /// <para>
    /// <b>REQUIRED ORDERING (orchestrator-owned).</b> Call this IMMEDIATELY AFTER
    /// <c>app.UseSessionAuthentication()</c> and BEFORE <c>app.UseAuthorization()</c>:
    /// </para>
    /// <list type="bullet">
    ///   <item><description>Earlier than the session middleware, <c>HttpContext.User</c> is still anonymous, so
    ///   NO tenant is ever resolved — a silent failure in which every org-admin endpoint 401s and every
    ///   <c>PersonaTemplate</c> read quietly returns zero rows.</description></item>
    ///   <item><description>Later than the first construction of the request-scoped <c>PulseDbContext</c>, the
    ///   write arrives after that context has already captured (and locked) its tenant filter — the same
    ///   ordering trap the exercise axis has.</description></item>
    /// </list>
    /// <para>
    /// Both failure modes are covered by <c>OrganizationResolutionPipelineOrderTests</c> (a real request
    /// through the real pipeline against real SQL) and by the slice's composition-root guard.
    /// </para>
    /// </remarks>
    /// <param name="app">The application pipeline builder.</param>
    /// <returns>The same builder, for chaining.</returns>
    public static IApplicationBuilder UseOrganizationResolution(this IApplicationBuilder app)
    {
        ArgumentNullException.ThrowIfNull(app);

        return app.UseMiddleware<OrganizationResolutionMiddleware>();
    }
}
