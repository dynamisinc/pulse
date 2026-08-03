namespace Pulse.WebApi.Data;

/// <summary>
/// Default <see cref="IOrganizationContext"/> — a simple per-scope holder for the current customer tenant.
/// Registered with a Scoped lifetime by <c>AddOrganizationScoping</c> (itself called from
/// <c>AddExerciseScoping</c>) so it lives exactly as long as the request / unit of work the
/// <see cref="PulseDbContext"/> also belongs to, and so that context can inject it.
/// </summary>
/// <remarks>
/// It starts UNSET (<see cref="CurrentOrganizationId"/> is <c>null</c>) — the fail-closed default — and
/// stays unset for every participant request, which is correct: no participant surface may expose or depend
/// on the organization concept (XC-002), and no participant-facing entity is on the org axis. A staff /
/// platform surface that authors org-owned library assets is what populates it, from the SERVER-resolved
/// tenant (the staff user's own <c>OrganizationId</c>, or the resolved exercise's) — <b>never</b> from a
/// client-supplied body, route or query value, which is the exact cross-tenant vector COR-001 forbids on
/// the inner axis too. The settable property is that seam; the read-side <see cref="IOrganizationContext"/>
/// interface the context depends on stays get-only.
/// </remarks>
public sealed class OrganizationContext : IOrganizationContext
{
    /// <inheritdoc cref="IOrganizationContext.CurrentOrganizationId" />
    public Guid? CurrentOrganizationId { get; set; }
}
