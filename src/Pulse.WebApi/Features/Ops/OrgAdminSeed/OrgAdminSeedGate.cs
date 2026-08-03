namespace Pulse.WebApi.Features.Ops.OrgAdminSeed;

using Microsoft.Extensions.Hosting;

/// <summary>
/// The single, testable decision of whether the <c>orgAdmin</c> startup seeder may run at all: it is a
/// <b>NON-PRODUCTION</b> development / UAT convenience and must be impossible to execute in a real
/// customer-facing deployment. Mirrors <see cref="Pulse.WebApi.Features.Ops.Bootstrap.BootstrapSecretGate"/>'s
/// shape — one pure static predicate the service, the composition-root registration and the tests all share, so
/// there is exactly one place the gate can be wrong.
/// </summary>
/// <remarks>
/// <para>
/// <b>Fail closed by default.</b> The gate is the ABSENCE of <see cref="Environments.Production"/>, and
/// <c>Production</c> is what <c>WebApplication.CreateBuilder</c> falls back to when <c>ASPNETCORE_ENVIRONMENT</c>
/// is unset — which is precisely the state of an Azure App Service that was never told otherwise. So a
/// deployment that forgets to configure anything gets the seeder DISABLED, never enabled: the safe direction for
/// a seam whose job is minting an administrator.
/// </para>
/// <para>
/// <b>Why an environment gate and not a secret.</b> The ops seams next door
/// (<c>POST /api/ops/bootstrap-exercise</c>, <c>POST /api/ops/seed-engine-content</c>) are secret-gated because
/// they are internet-facing HTTP endpoints an unauthenticated caller can reach; a secret is the only thing that
/// can stand in front of them. This seeder has no HTTP surface at all — it runs once, in-process, at host start
/// — so there is no caller to authenticate and nothing to compare a secret against. What must be constrained is
/// the ENVIRONMENT, and that is what this gates on. (The seeder additionally cannot do anything at all without a
/// configured credential in the staff allowlist — see <see cref="OrgAdminSeedService"/> — so it is doubly
/// opt-in.)
/// </para>
/// </remarks>
public static class OrgAdminSeedGate
{
    /// <summary>
    /// Whether the <c>orgAdmin</c> startup seeder may run in <paramref name="environment"/> — <c>true</c> for
    /// every environment EXCEPT <see cref="Environments.Production"/>.
    /// </summary>
    /// <param name="environment">The resolved host environment.</param>
    /// <returns><c>true</c> when the seeder is permitted; <c>false</c> in production.</returns>
    /// <exception cref="ArgumentNullException"><paramref name="environment"/> is <c>null</c>.</exception>
    public static bool IsEnabled(IHostEnvironment environment)
    {
        ArgumentNullException.ThrowIfNull(environment);

        // An unnamed environment is treated AS production. IsProduction() alone would return false for an
        // empty/whitespace name and thereby ENABLE the seeder — a fail-OPEN edge on the one gate that must
        // never fall open. "I don't know where I am" resolves to the most restrictive answer.
        if (string.IsNullOrWhiteSpace(environment.EnvironmentName))
        {
            return false;
        }

        // IsProduction() is an ordinal, case-INSENSITIVE compare against "Production", so "production" and
        // "PRODUCTION" are refused too. Everything else (Development, Staging, UAT, a bespoke name) is allowed.
        return !environment.IsProduction();
    }
}
