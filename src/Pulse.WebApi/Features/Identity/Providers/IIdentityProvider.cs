namespace Pulse.WebApi.Features.Identity.Providers;

/// <summary>
/// The provider-agnostic staff authentication seam (COR-014). Staff (controller / evaluator / planner)
/// authenticate against the Dynamis IdP in Phase 1; a future Entra ID / AD / SSO / Cadence-federation (E9)
/// provider slots in BEHIND this interface with no call-site change. Wave-0 freezes the seam only — the
/// <c>DynamisIdentityProvider</c> implementation and the staff-login endpoint are story 05 (a later wave).
/// </summary>
/// <remarks>
/// Implementations MUST NOT log the presented secret (NFR-004). Pulse persists only the RESOLVED external
/// identity (<see cref="StaffIdentity"/>) as a <c>StaffUser</c>, never a staff password.
/// </remarks>
public interface IIdentityProvider
{
    /// <summary>
    /// Authenticates a staff human against the underlying identity provider.
    /// </summary>
    /// <param name="credentials">The presented staff credentials (never logged).</param>
    /// <param name="cancellationToken">Cancellation token.</param>
    /// <returns>
    /// A <see cref="StaffAuthenticationResult"/> whose <see cref="StaffAuthenticationResult.Outcome"/> is
    /// <see cref="StaffAuthenticationOutcome.Authenticated"/> (carrying the resolved
    /// <see cref="StaffIdentity"/>) or <see cref="StaffAuthenticationOutcome.Rejected"/> (no identity).
    /// </returns>
    Task<StaffAuthenticationResult> AuthenticateAsync(
        StaffCredentials credentials,
        CancellationToken cancellationToken = default);
}

/// <summary>
/// The credentials a staff human presents to <see cref="IIdentityProvider.AuthenticateAsync"/>. An input
/// value holder — the <see cref="Secret"/> is never persisted and never logged (NFR-004).
/// </summary>
public sealed class StaffCredentials
{
    /// <summary>The presented staff username / login handle.</summary>
    public required string Username { get; init; }

    /// <summary>The presented secret (password / token). Never persisted, never logged.</summary>
    public required string Secret { get; init; }
}

/// <summary>
/// The external identity an <see cref="IIdentityProvider"/> resolves on a successful authentication — the
/// data Pulse records as a <c>StaffUser</c> (COR-005). Carries no participant-visible content (XC-002).
/// </summary>
public sealed class StaffIdentity
{
    /// <summary>The provider's stable, unique subject id (e.g. an OIDC <c>sub</c>) — the <c>StaffUser.ExternalSubject</c> key.</summary>
    public required string ExternalSubject { get; init; }

    /// <summary>The staff human's display name (staff-world only).</summary>
    public required string DisplayName { get; init; }

    /// <summary>An optional human-readable username if the provider exposes one distinct from <see cref="ExternalSubject"/>.</summary>
    public string? Username { get; init; }
}

/// <summary>The outcome of an <see cref="IIdentityProvider.AuthenticateAsync"/> call.</summary>
public enum StaffAuthenticationOutcome
{
    /// <summary>The credentials were rejected by the provider — no identity is resolved (fail-closed).</summary>
    Rejected = 0,

    /// <summary>The credentials authenticated — the resolved <see cref="StaffIdentity"/> is present.</summary>
    Authenticated = 1,
}

/// <summary>
/// The result of authenticating staff credentials: an <see cref="Outcome"/> plus, when
/// <see cref="StaffAuthenticationOutcome.Authenticated"/>, the resolved <see cref="Identity"/>.
/// </summary>
public sealed class StaffAuthenticationResult
{
    /// <summary>Whether the credentials authenticated.</summary>
    public required StaffAuthenticationOutcome Outcome { get; init; }

    /// <summary>The resolved external identity when <see cref="Outcome"/> is Authenticated; otherwise <c>null</c>.</summary>
    public StaffIdentity? Identity { get; init; }
}
