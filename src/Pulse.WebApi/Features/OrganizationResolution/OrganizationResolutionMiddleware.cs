namespace Pulse.WebApi.Features.OrganizationResolution;

using Microsoft.AspNetCore.Http;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using Pulse.WebApi.Data;
using Pulse.WebApi.Features.Identity.Sessions;

/// <summary>
/// The PRODUCTION writer of the CUSTOMER-tenant scope (COR-010, exercise-isolation/11) — the piece
/// <see cref="OrganizationContext"/>'s own remarks always described ("a staff / platform surface … populates
/// it, from the SERVER-resolved tenant") but that nothing actually did. Until this middleware existed
/// <see cref="IOrganizationContext.CurrentOrganizationId"/> was never assigned by any production code path, so
/// the second global query filter matched <see cref="Guid.Empty"/> on every request and EVERY
/// <see cref="IOrganizationScoped"/> read (the <c>PersonaTemplate</c> library) returned zero rows — fail-closed
/// and harmless only while nothing read templates. It is the tenant equivalent of
/// <see cref="ExerciseResolution.ExerciseResolutionMiddleware"/>.
/// </summary>
/// <remarks>
/// <para>
/// <b>The tenant comes from the SERVER, and from exactly one place.</b> It is the authenticated STAFF caller's
/// own <c>StaffUser.OrganizationId</c>, looked up by the <c>StaffUser</c> id carried on the principal that
/// <see cref="SessionAuthenticationMiddleware"/> minted from the presented session token. It is never read
/// from a request body, route value, query string or header — a client-supplied tenant is the cross-CUSTOMER
/// analogue of the client-supplied <c>exerciseId</c> that COR-001 forbids on the inner axis.
/// </para>
/// <para>
/// <b>Staff only — a participant request leaves the tenant UNSET, deliberately.</b> No participant surface may
/// expose or depend on the organization concept (XC-002) and no participant-facing entity is on the org axis,
/// so resolving a tenant for a participant would buy nothing and would put the concept on a code path it has
/// no business being on. An anonymous, participant or shared read-only request therefore keeps the fail-closed
/// default (unset → <see cref="Guid.Empty"/> → zero org-scoped rows, never all customers).
/// </para>
/// <para>
/// <b>REQUIRED ORDERING (orchestrator-owned; getting it wrong is a SILENT failure).</b> Wire
/// <c>app.UseOrganizationResolution()</c> IMMEDIATELY AFTER <c>app.UseSessionAuthentication()</c>:
/// <list type="number">
///   <item><description><b>After</b> the session middleware, because that is what assigns
///   <c>HttpContext.User</c>; before it the principal is anonymous, no tenant is ever resolved, and every
///   org-admin endpoint 401s while every template read silently returns zero rows.</description></item>
///   <item><description><b>Before</b> anything that constructs the REQUEST-SCOPED
///   <see cref="PulseDbContext"/> — which captures both scopes ONCE, in its constructor. A write that lands
///   after the context is built cannot change the filter it already locked in. Nothing between
///   <c>UseExerciseResolution()</c> and this call builds that context (both the host resolver and the session
///   authenticator deliberately use their own throwaway scopes), which is exactly why this slot works and a
///   later one would not.</description></item>
/// </list>
/// This middleware follows the same discipline for the same reason: its own lookup runs in a THROWAWAY DI
/// scope, so the request-scoped context is still unbuilt when the write lands and is constructed lazily by the
/// endpoint afterwards, capturing the resolved tenant.
/// </para>
/// <para>
/// <b>Fail closed on every error path.</b> No staff principal, a staff principal with no <c>StaffUser</c> id, a
/// staff human whose row has vanished, or a transient lookup failure all leave the tenant UNSET — which matches
/// zero rows rather than widening to every customer. It cannot affect the EXERCISE axis at all: the two axes
/// cover disjoint entity sets, so whatever this middleware does or fails to do, no
/// <see cref="IExerciseScoped"/> query returns one row more or less.
/// </para>
/// </remarks>
public sealed partial class OrganizationResolutionMiddleware
{
    /// <summary>The <c>Session.Kind</c> value this middleware resolves a tenant for. Staff/platform only (XC-002).</summary>
    private const string StaffSessionKind = "staff";

    private readonly RequestDelegate _next;
    private readonly IServiceScopeFactory _scopeFactory;
    private readonly ILogger<OrganizationResolutionMiddleware> _logger;

    /// <summary>Creates the middleware.</summary>
    /// <param name="next">The next delegate in the pipeline.</param>
    /// <param name="scopeFactory">Factory for the throwaway DI scope the tenant lookup runs in (see remarks).</param>
    /// <param name="logger">Diagnostics logger. Never logs token material (NFR-009).</param>
    public OrganizationResolutionMiddleware(
        RequestDelegate next,
        IServiceScopeFactory scopeFactory,
        ILogger<OrganizationResolutionMiddleware> logger)
    {
        ArgumentNullException.ThrowIfNull(next);
        ArgumentNullException.ThrowIfNull(scopeFactory);
        ArgumentNullException.ThrowIfNull(logger);

        _next = next;
        _scopeFactory = scopeFactory;
        _logger = logger;
    }

    /// <summary>
    /// Resolves the authenticated STAFF caller's own customer tenant and writes it into the request-scoped
    /// <see cref="IOrganizationContext"/>; leaves it unset (fail closed) for every other caller.
    /// </summary>
    /// <param name="context">The current request context.</param>
    /// <param name="organizationContext">
    /// The request-scoped tenant seam to write. A plain POCO — resolving it does NOT construct the
    /// request-scoped <see cref="PulseDbContext"/>, which is what keeps the ordering contract satisfiable.
    /// </param>
    public async Task InvokeAsync(HttpContext context, IOrganizationContext organizationContext)
    {
        ArgumentNullException.ThrowIfNull(context);
        ArgumentNullException.ThrowIfNull(organizationContext);

        var identity = SessionPrincipal.Read(context.User);

        if (identity is { StaffUserId: { } staffUserId }
            && string.Equals(identity.Kind, StaffSessionKind, StringComparison.Ordinal))
        {
            var tenant = await ResolveTenantAsync(staffUserId, context.RequestAborted);

            if (tenant is { } organizationId && organizationId != Guid.Empty)
            {
                // The settable seam is the concrete OrganizationContext; the IOrganizationContext the
                // DbContext consumes stays get-only, exactly as the exercise axis does.
                if (organizationContext is OrganizationContext settable)
                {
                    settable.CurrentOrganizationId = organizationId;
                }
                else
                {
                    // Defensive: fail closed (leave the tenant unset) rather than guess at another shape.
                    LogOrganizationContextNotSettable(organizationId, organizationContext.GetType());
                }
            }
        }

        await _next(context);
    }

    /// <summary>
    /// Reads the staff human's own tenant in a THROWAWAY DI scope, so the request-scoped
    /// <see cref="PulseDbContext"/> is not constructed (and its filters not locked) before the write above.
    /// </summary>
    private async Task<Guid?> ResolveTenantAsync(Guid staffUserId, CancellationToken cancellationToken)
    {
        try
        {
            await using var scope = _scopeFactory.CreateAsyncScope();
            var dbContext = scope.ServiceProvider.GetRequiredService<PulseDbContext>();

            // org-scope-exempt(OwnIdentity): this reads the CALLER'S OWN staff row, by the StaffUser id their
            // server-issued session carries on the authenticated principal — it is the read that DISCOVERS the
            // caller's tenant, so it cannot itself be tenant-bound, and it can reach no other human's row.
            return await dbContext.StaffUsers
                .AsNoTracking()
                .Where(user => user.Id == staffUserId)
                .Select(user => (Guid?)user.OrganizationId)
                .FirstOrDefaultAsync(cancellationToken);
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            // Fail closed: an unresolvable tenant matches zero org-scoped rows, never every customer's.
            LogTenantResolutionFailed(staffUserId, ex);
            return null;
        }
    }

    [LoggerMessage(
        EventId = 1,
        Level = LogLevel.Warning,
        Message = "Customer-tenant resolution failed for staff user {StaffUserId}; leaving the tenant unresolved (fail closed).")]
    private partial void LogTenantResolutionFailed(Guid staffUserId, Exception exception);

    [LoggerMessage(
        EventId = 2,
        Level = LogLevel.Warning,
        Message = "Resolved staff caller to organization {OrganizationId} but the registered IOrganizationContext ({OrganizationContextType}) is not settable; leaving the tenant unresolved.")]
    private partial void LogOrganizationContextNotSettable(Guid organizationId, Type organizationContextType);
}
