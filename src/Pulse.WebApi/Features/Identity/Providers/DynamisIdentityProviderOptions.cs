namespace Pulse.WebApi.Features.Identity.Providers;

using System.Collections.Generic;

/// <summary>
/// Bound options for the Phase-1 <see cref="DynamisIdentityProvider"/> — a config-driven staff allowlist that
/// stands behind the <see cref="IIdentityProvider"/> seam until a real Entra ID / AD / SSO / Cadence-federation
/// (E9) provider swaps in (COR-014). Bound from configuration section <see cref="SectionName"/>.
/// </summary>
/// <remarks>
/// <para>
/// <b>PHASE-1 STUB — flagged for Tier-2 human sign-off.</b> This is a documented development / stand-in
/// mechanism, NOT production authentication: a real deployment authenticates staff against the external IdP,
/// which returns a subject Pulse maps to a <c>StaffUser</c> (the entity carries <c>ExternalSubject</c> and NO
/// local password by design). The allowlist here exists only so the staff-login endpoint is exercisable
/// before that IdP integration lands. The default is EMPTY — with no configured accounts every login fails
/// closed, so a real environment that forgets to configure a real provider cannot accidentally authenticate
/// anyone. Secrets configured here are compared in constant time and are NEVER logged or persisted (NFR-009);
/// they should never be committed to source-controlled <c>appsettings.json</c>.
/// </para>
/// <para>
/// This config section is a Phase-1 development seam only — it is NOT one of the keys provisioned by
/// <c>infrastructure/modules/*.bicep</c>; production supplies a real provider behind the same interface.
/// </para>
/// </remarks>
public sealed class DynamisIdentityProviderOptions
{
    /// <summary>The configuration section this binds from (under the existing <c>Authentication</c> namespace).</summary>
    public const string SectionName = "Authentication:StaffIdentity";

    /// <summary>
    /// The configured staff allowlist. Empty by default — an unconfigured provider authenticates NO ONE
    /// (fail closed). Each entry maps a presented credential to the resolved external identity a
    /// <c>StaffUser</c> is provisioned from.
    /// </summary>
    public IList<DynamisStaffAccount> Accounts { get; init; } = new List<DynamisStaffAccount>();
}

/// <summary>
/// One entry in the Phase-1 staff allowlist (<see cref="DynamisIdentityProviderOptions.Accounts"/>). Maps a
/// login handle + secret to the external identity (<see cref="ExternalSubject"/> / <see cref="DisplayName"/>)
/// the provider resolves on success.
/// </summary>
public sealed class DynamisStaffAccount
{
    /// <summary>The login handle presented at <c>/api/auth/staff/login</c> (matched case-insensitively).</summary>
    public string Username { get; init; } = string.Empty;

    /// <summary>
    /// The expected secret — compared in constant time against the presented secret and never logged /
    /// persisted (NFR-009). An entry with an empty secret can never authenticate (fail closed).
    /// </summary>
    public string Secret { get; init; } = string.Empty;

    /// <summary>
    /// The stable external IdP subject this credential resolves to — the <c>StaffUser.ExternalSubject</c> key
    /// (e.g. an OIDC <c>sub</c>). An entry with an empty subject can never authenticate (nothing to map to).
    /// </summary>
    public string ExternalSubject { get; init; } = string.Empty;

    /// <summary>The staff human's display name (staff-world only, XC-002).</summary>
    public string DisplayName { get; init; } = string.Empty;
}
