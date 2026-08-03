namespace Pulse.WebApi.Data;

/// <summary>
/// Thrown by the <see cref="PulseDbContext"/> write-guard when a tracked <see cref="IOrganizationOwned"/>
/// entity is about to be persisted with a default (<see cref="System.Guid.Empty"/>) <c>OrganizationId</c>.
/// This is the write-time half of the fail-closed CUSTOMER tenant guarantee (COR-010, exercise-isolation/11):
/// the row never reaches the database, which is what lets the empty GUID serve as a sentinel that the
/// read-side org filter can never match. Derives from <see cref="InvalidOperationException"/> so existing
/// catch sites that expect an invalid-state failure still handle it.
/// </summary>
public sealed class OrganizationScopeViolationException : InvalidOperationException
{
    /// <summary>Creates the exception with a default message.</summary>
    public OrganizationScopeViolationException()
        : base("An organization-owned entity was saved with a default (empty) OrganizationId; the write was blocked (COR-010).")
    {
    }

    /// <summary>Creates the exception with a caller-supplied message.</summary>
    public OrganizationScopeViolationException(string message)
        : base(message)
    {
    }

    /// <summary>Creates the exception with a caller-supplied message and inner exception.</summary>
    public OrganizationScopeViolationException(string message, Exception innerException)
        : base(message, innerException)
    {
    }
}
