namespace Pulse.WebApi.Data.Entities;

/// <summary>
/// The CUSTOMER tenant boundary — the outer of Pulse's two nested isolation tiers (COR-001 / COR-010,
/// <c>docs/01-platform-core-isolation.md</c>: "Organization = Tenant boundary (customer)"). An organization
/// owns exercises, the persona-template authoring library, cast libraries, and the staff humans who work
/// them; a customer's authored content is never visible to another customer.
/// </summary>
/// <remarks>
/// <para>
/// <b>Two tiers, nested — the org NEVER weakens the exercise tier.</b>
/// <code>
/// Organization  (customer tenant — this entity, exercise-isolation/11)
///    └── owns many Exercises  (the participant-facing isolation scope — COR-001, always-Critical)
///                     └── Posts · Personas · Accounts · Sessions · TelemetryEvents (IExerciseScoped)
/// </code>
/// The per-exercise guarantee is unchanged and unconditional: two exercises are isolated from each other
/// whether or not they share an organization. The org tier closes a DIFFERENT hole — cross-CUSTOMER
/// visibility of the assets that are deliberately shared ACROSS exercises (the XC-005 persona-template
/// library, and the staff access records). See <see cref="IOrganizationScoped"/> for the mechanism.
/// </para>
/// <para>
/// <b>This is the aggregate root of its own tier, so it is neither <see cref="IExerciseScoped"/> nor
/// <see cref="IOrganizationOwned"/>.</b> Its own <see cref="Id"/> IS the org scope — exactly as
/// <c>Exercise.Id</c> is the exercise scope. It therefore carries no global query filter; reads of this
/// table are staff/platform-only (XC-002).
/// </para>
/// <para>
/// <b>NOT the in-fiction "organization account" (COR-018).</b> A persona posting AS an agency/outlet, with
/// per-human attribution, is a CONTENT/attribution concept owned by
/// <c>identity-auth-roles/09-org-account-operation.md</c>. It has nothing to do with this platform tenant
/// row, and no participant surface ever exposes this concept (XC-002).
/// </para>
/// </remarks>
public sealed class Organization
{
    /// <summary>
    /// The well-known id of the DEFAULT organization — the single tenant every pre-existing row is
    /// backfilled onto by the <c>OrganizationTenantBoundary</c> migration, and the tenant
    /// <c>BootstrapService</c> creates-or-reuses when it seeds a fresh database.
    /// </summary>
    /// <remarks>
    /// A fixed, stable GUID (rather than a generated one) is what makes both the migration backfill and the
    /// bootstrap create-or-reuse deterministic and idempotent across every environment — the migration's
    /// insert is <c>IF NOT EXISTS</c>-guarded on this id, and a bootstrap re-run resolves the SAME row
    /// instead of minting a second "default" tenant. It is deliberately NOT <see cref="System.Guid.Empty"/>:
    /// the empty GUID is the fail-closed sentinel the write-guards reject, so it can never be a real tenant.
    /// </remarks>
    public static readonly Guid DefaultOrganizationId = new("9f2f0e26-6a1d-4c1e-9a54-1f0b4a3d7c80");

    /// <summary>The display name of the default organization created by the migration / bootstrap.</summary>
    public const string DefaultOrganizationName = "Default Organization";

    /// <summary>Primary key — the tenant scope every <see cref="IOrganizationOwned"/> row's <c>OrganizationId</c> references.</summary>
    public Guid Id { get; set; }

    /// <summary>The customer's display name (staff/platform surfaces only — never participant-visible, XC-002).</summary>
    public required string Name { get; set; }

    /// <summary>Server wall-clock instant (UTC) the tenant record was created.</summary>
    public DateTimeOffset CreatedAt { get; set; }
}
