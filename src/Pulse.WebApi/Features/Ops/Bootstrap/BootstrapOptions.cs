namespace Pulse.WebApi.Features.Ops.Bootstrap;

/// <summary>
/// Bound options for the guarded, one-time UAT bootstrap seam (<c>POST /api/ops/bootstrap-exercise</c>, story
/// login/05). Modeled EXACTLY on <c>DynamisIdentityProviderOptions</c>'s "documented Phase-1 stand-in, fails
/// closed when unconfigured" shape: the endpoint is gated ENTIRELY by <see cref="Secret"/>, which is
/// <b>empty/unset by default</b> — an unconfigured secret disables the endpoint completely (every call is
/// rejected with a 404), and an empty configured secret can never authenticate (never "any secret works").
/// Bound from configuration section <see cref="SectionName"/>.
/// </summary>
/// <remarks>
/// <para>
/// <b>PHASE-1 / UAT-ONLY SEAM — flagged for Tier-2 human sign-off.</b> This exists ONLY to solve the
/// empty-database chicken-and-egg problem (no endpoint in the Complete identity backend can create the FIRST
/// <c>Exercise</c> / <c>StaffAssignment</c> / <c>SharedCredential</c>), not as a general-purpose provisioning
/// API. It is disabled by default and MUST NOT be reachable in a real customer-facing deployment (the
/// operational decision of whether/how it stays gated is story 06's runbook).
/// </para>
/// <para>
/// <b>Never committed, never logged (NFR-009).</b> Like <c>DynamisIdentityProviderOptions</c>, this section is
/// a deployment-supplied secret (story 06 threads it through <c>webapp.bicep</c> the same way <c>jwtSecretKey</c>
/// is) — it is NEVER written to a source-controlled <c>appsettings.json</c>, and the presented / configured
/// secret is compared in constant time and never logged.
/// </para>
/// </remarks>
public sealed class BootstrapOptions
{
    /// <summary>The configuration section this binds from (under the existing <c>Authentication</c> namespace).</summary>
    public const string SectionName = "Authentication:Bootstrap";

    /// <summary>
    /// The bootstrap secret the caller must present in the <c>X-Bootstrap-Secret</c> header. Empty by default —
    /// an unconfigured secret disables the endpoint entirely (fail closed). Compared in constant time and never
    /// logged (NFR-009).
    /// </summary>
    public string Secret { get; init; } = string.Empty;
}
