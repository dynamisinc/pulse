namespace Pulse.WebApi.Features.Ops.OrgAdminSeed;

using Pulse.WebApi.Features.Identity.Providers;

/// <summary>
/// THE published, NON-PRODUCTION default org-admin credential — the single place its value exists in this
/// codebase. Injected into the Phase-1 staff allowlist at REGISTRATION time by
/// <see cref="OrgAdminSeedExtensions.AddOrgAdminSeed"/> (outside <c>Production</c> only, and only when no entry
/// for <see cref="Username"/> was configured), so that a freshly-cloned checkout can boot and sign in as an
/// organization administrator with <b>no configuration step at all</b>.
/// </summary>
/// <remarks>
/// <para>
/// <b>This is a PUBLISHED DEFAULT, not a secret.</b> Like a router's <c>admin/admin</c>, its confidentiality is
/// deliberately NOT the security control — it is committed, documented, and assumed known to anyone who can read
/// this repository. The control is the ENVIRONMENT GATE: <see cref="OrgAdminSeedGate"/> refuses everything
/// outside a non-production host, a blank/unset <c>ASPNETCORE_ENVIRONMENT</c> counts AS production, and in
/// production <see cref="OrgAdminSeedExtensions.AddOrgAdminSeed"/> registers nothing whatsoever — so this
/// account cannot enter the allowlist of a real deployment even if the seeder itself never runs. Because that
/// gate is now the only thing standing between a live deployment and a known administrator credential, it is the
/// most important code in this slice and is tested independently of the seeder.
/// </para>
/// <para>
/// <b>It screams.</b> Whenever the default was injected, the host logs a <c>Critical</c> record on EVERY boot
/// (see <c>OrgAdminSeedHostedService</c>) naming the account, saying it is non-production only, and giving the
/// exact configuration keys that override it. Silence means a real configured entry is in use.
/// </para>
/// <para>
/// <b>A configured entry always wins.</b> The injection is a <c>PostConfigure</c> that appends this account only
/// when the bound allowlist holds NO entry for <see cref="Username"/> — including an entry that is present but
/// unusable (blank secret / blank subject). An operator who named that username has expressed intent, and
/// silently overriding it with a published credential would be strictly worse than the seeder standing down and
/// saying so.
/// </para>
/// <para>
/// <b>How to get rid of it.</b> Either configure a real entry —
/// <c>Authentication:StaffIdentity:Accounts:{i}:Username</c> = <see cref="Username"/> plus that entry's
/// <c>Secret</c> / <c>ExternalSubject</c> / <c>DisplayName</c> (user-secrets locally, indexed
/// <c>Authentication__StaffIdentity__Accounts__{i}__*</c> app settings in a deployed environment) — or delete
/// this file and the <c>PostConfigure</c> block that reads it, which reverts the seeder to its previous,
/// explicitly-opt-in behaviour. Changing or locking the account for real is the job of the eventual staff
/// user-management surface, which will own credentials properly (<see cref="Data.Entities.StaffUser"/> carries no
/// credential column today, by design — NFR-004).
/// </para>
/// </remarks>
public static class DefaultOrgAdminAccount
{
    /// <summary>
    /// The login handle. Bound to <see cref="OrgAdminSeedService.TargetUsername"/> rather than restated, so the
    /// account that gets injected and the account the seeder looks for can never drift apart.
    /// </summary>
    public const string Username = OrgAdminSeedService.TargetUsername;

    /// <summary>
    /// <b>THE DEFAULT CREDENTIAL — the one and only place this value lives.</b> A published non-production
    /// default (see the type remarks): it is committed on purpose, it is not treated as a secret, and production
    /// can never reach it. It is compared in constant time by <see cref="DynamisIdentityProvider"/> and is never
    /// logged or persisted (NFR-009); <see cref="Data.Entities.StaffUser"/> stores no credential at all.
    /// </summary>
    /// <remarks>
    /// <b>It must stay a purpose-made throwaway.</b> This repository is PUBLIC, so this literal is not merely
    /// "in source control" — it is published to the internet, permanently, in git history (a later commit that
    /// removes it does not remove it from history), and the repository currently has GitHub secret scanning and
    /// push protection disabled, so nothing here will warn you. That is acceptable ONLY because this value is a
    /// machine default with no reuse value anywhere: it unlocks an org-admin on a non-production host and
    /// nothing else. NEVER replace it with a real passphrase — least of all one a human uses on another system,
    /// which is what publishing would actually compromise. If you want a private credential, configure a real
    /// allowlist entry (which always wins over this default and silences the boot alarm) instead of editing
    /// this line.
    /// </remarks>
    public const string Secret = "pulse-dev-admin";

    /// <summary>The staff human's display name (staff-world only, XC-002).</summary>
    public const string DisplayName = "Tom Bull";

    /// <summary>
    /// The stable external IdP subject this default resolves to — the <c>StaffUser.ExternalSubject</c> key the
    /// seeded row carries and a later login is matched on. It MUST stay stable across boots and deployments:
    /// change it and the next login resolves to a different (auto-provisioned, unassigned) staff human instead
    /// of the seeded administrator. The <c>dev-default|</c> prefix marks it as belonging to this
    /// non-production seam so it can never be mistaken for a real IdP subject.
    /// </summary>
    public const string ExternalSubject = "dev-default|tbull@dynamis.com";

    /// <summary>
    /// Builds the allowlist entry appended to <see cref="DynamisIdentityProviderOptions.Accounts"/> — the exact
    /// shape an operator would have configured by hand, so every downstream consumer (the identity provider, the
    /// seeder) sees an ordinary configured account and needs no special case for it.
    /// </summary>
    /// <returns>A fresh allowlist entry for the default org-admin account.</returns>
    public static DynamisStaffAccount CreateAllowlistEntry() => new()
    {
        Username = Username,
        Secret = Secret,
        ExternalSubject = ExternalSubject,
        DisplayName = DisplayName,
    };
}

/// <summary>
/// The one bit of registration-time state the boot-time warning needs: whether
/// <see cref="OrgAdminSeedExtensions.AddOrgAdminSeed"/>'s <c>PostConfigure</c> actually appended
/// <see cref="DefaultOrgAdminAccount"/> to the staff allowlist, or whether a real configured entry won.
/// </summary>
/// <remarks>
/// Registered as a singleton (non-production only, alongside the seeder) and written from the
/// <c>PostConfigure</c> callback, which runs once when the options graph is first materialized. A plain flag
/// rather than an inspection of the live options object on purpose: "an entry for this username exists" is TRUE
/// in both the configured and the injected case, so only the injector itself can answer which happened — and
/// getting that wrong in either direction would either scream about an operator's own credential or stay silent
/// about a published one.
/// </remarks>
public sealed class DefaultOrgAdminAccountState
{
    private volatile bool _wasInjected;

    /// <summary>
    /// Whether the published default credential was injected into the staff allowlist on this host —
    /// <c>false</c> when a real configured entry was used (or when nothing was injected at all).
    /// </summary>
    public bool WasInjected => _wasInjected;

    /// <summary>
    /// Records that the default credential was injected. Idempotent: options may be re-materialized (a
    /// configuration reload builds a fresh instance and re-runs <c>PostConfigure</c>), and this must stay
    /// latched either way.
    /// </summary>
    public void MarkInjected() => _wasInjected = true;
}
