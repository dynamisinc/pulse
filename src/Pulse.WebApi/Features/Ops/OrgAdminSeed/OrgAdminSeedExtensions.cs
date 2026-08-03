namespace Pulse.WebApi.Features.Ops.OrgAdminSeed;

using System.Linq;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Microsoft.Extensions.Hosting;
using Pulse.WebApi.Features.Identity.Providers;

/// <summary>
/// The composition-root seam for the non-production <c>orgAdmin</c> startup seeder. Exposes the single
/// <see cref="AddOrgAdminSeed"/> extension the orchestrator wires into <c>Program.cs</c>; this slice never edits
/// <c>Program.cs</c> itself and maps NO endpoint (it has no HTTP surface at all).
/// </summary>
/// <remarks>
/// <para>
/// <b>Required <c>Program.cs</c> wiring (orchestrator-owned, documented for the serial edit):</b> one DI line,
/// <c>builder.Services.AddOrgAdminSeed(builder.Environment, builder.Configuration);</c>. There is NO
/// <c>Map*</c> call and NO middleware, so there is no pipeline-ordering constraint. Placement is free; it is
/// listed with the other <c>Features/Ops</c> registrations for readability.
/// </para>
/// <para>
/// <b>The production gate is applied at REGISTRATION as well as at run time.</b> In
/// <see cref="Environments.Production"/> this method registers nothing whatsoever — no hosted service, no seeder
/// — so there is no code path that could run it, not merely a flag it would consult. <see cref="OrgAdminSeedService"/>
/// re-checks the same <see cref="OrgAdminSeedGate"/> itself, so a future wiring change that registered it
/// unconditionally still cannot seed a production database.
/// </para>
/// <para>
/// <b>Because this slice maps no route, a route-counting composition-root guard would be vacuous for it.</b>
/// <c>Features/Ops/OrgAdminSeed/CompositionRootWiringTests</c> instead asserts over the REAL host's registered
/// <see cref="Microsoft.Extensions.Hosting.IHostedService"/> set — present outside production, absent inside it.
/// </para>
/// <para>
/// <b>Zero-config: the published default credential is injected HERE, at registration.</b> Outside production
/// this method appends <see cref="DefaultOrgAdminAccount"/> to the staff allowlist via
/// <see cref="OptionsServiceCollectionExtensions.PostConfigure{TOptions}(IServiceCollection, Action{TOptions})"/>
/// when — and only when — no entry for that username was configured. The seeder's own logic is untouched: it
/// still resolves its identity from the allowlist and still refuses to write anything when that lookup fails, so
/// the refuse-if-absent guard remains a real guard rather than becoming unreachable. And because the injection
/// sits behind the SAME <see cref="OrgAdminSeedGate"/> as the registration, a default credential cannot enter a
/// production host's allowlist even if the seeder itself never ran.
/// </para>
/// </remarks>
public static class OrgAdminSeedExtensions
{
    /// <summary>
    /// Registers the <c>orgAdmin</c> startup seeder, and injects the published
    /// <see cref="DefaultOrgAdminAccount"/> into the staff allowlist when no entry for it was configured — but
    /// ONLY outside <see cref="Environments.Production"/>. In production this method does neither: it returns
    /// having registered nothing and having touched no options.
    /// </summary>
    /// <param name="services">The service collection.</param>
    /// <param name="environment">The host environment the non-production gate is evaluated against.</param>
    /// <param name="configuration">Configuration — the seeded identity binds from <see cref="DynamisIdentityProviderOptions.SectionName"/>.</param>
    /// <returns>The same collection, for chaining.</returns>
    public static IServiceCollection AddOrgAdminSeed(
        this IServiceCollection services,
        IHostEnvironment environment,
        IConfiguration configuration)
    {
        ArgumentNullException.ThrowIfNull(services);
        ArgumentNullException.ThrowIfNull(environment);
        ArgumentNullException.ThrowIfNull(configuration);

        if (!OrgAdminSeedGate.IsEnabled(environment))
        {
            // Production: register nothing at all. Returning early — rather than registering a service that
            // would decline to act — is what makes "it cannot run here" a structural fact.
            return services;
        }

        // The seeded identity is resolved from the SAME allowlist staff login authenticates against. Binding the
        // section again is idempotent (same section, same values), and keeps the slice self-contained regardless
        // of whether AddStaffIdentity / AddOpsBootstrap were wired before or after this call.
        services.Configure<DynamisIdentityProviderOptions>(
            configuration.GetSection(DynamisIdentityProviderOptions.SectionName));

        // ZERO-CONFIG (non-production ONLY — everything below this point is unreachable in production because of
        // the early return above). PostConfigure runs AFTER every Configure call, whatever order the slices were
        // wired in, so this sees the fully-bound allowlist and a real configured entry always wins: no ordering
        // hazard, no runtime mutation of options from a hosted service, and no fallback branch inside the seeder.
        // The default is genuinely IN the allowlist before anything — the identity provider included — reads it,
        // which is why the login path needs no special case and the seeder's "resolve or refuse" logic is
        // unchanged.
        services.TryAddSingleton<DefaultOrgAdminAccountState>();
        services.AddOptions<DynamisIdentityProviderOptions>()
            .PostConfigure<DefaultOrgAdminAccountState>((options, defaultAccountState) =>
            {
                // "No entry for that username" — deliberately NOT "no USABLE entry". An operator who named this
                // username with a blank secret has expressed an intent (typically: keep the account, disable it);
                // overriding that with a published credential would be worse than the seeder standing down and
                // logging what to fix, which is exactly what it does.
                var alreadyConfigured = options.Accounts.Any(account => string.Equals(
                    account.Username, DefaultOrgAdminAccount.Username, StringComparison.OrdinalIgnoreCase));

                if (alreadyConfigured)
                {
                    return;
                }

                options.Accounts.Add(DefaultOrgAdminAccount.CreateAllowlistEntry());

                // Recorded so the boot-time warning can tell an injected default from an operator's own
                // credential and scream about exactly one of them. Resolved from DI (rather than captured) so the
                // flag the hosted service reads is always the one this callback wrote.
                defaultAccountState.MarkInjected();
            });

        // Scoped, matching the PulseDbContext unit of work it writes through; the hosted service resolves it
        // inside a scope of its own at host start.
        services.AddScoped<OrgAdminSeedService>();
        services.AddHostedService<OrgAdminSeedHostedService>();

        return services;
    }
}
