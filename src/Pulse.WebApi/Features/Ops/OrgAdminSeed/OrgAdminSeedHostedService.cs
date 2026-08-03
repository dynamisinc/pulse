namespace Pulse.WebApi.Features.Ops.OrgAdminSeed;

using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using Pulse.WebApi.Features.Identity.Providers;

/// <summary>
/// Runs <see cref="OrgAdminSeedService"/> exactly once per host start, in its own DI scope, and NEVER lets its
/// outcome affect startup. Registered only in a non-production environment (see
/// <see cref="OrgAdminSeedExtensions.AddOrgAdminSeed"/>). Also the host's mouthpiece for the
/// <see cref="DefaultOrgAdminAccount"/> warning — see <see cref="StartAsync"/>.
/// </summary>
/// <remarks>
/// <para>
/// <b>An <see cref="IHostedService"/>, not a <c>BackgroundService</c>.</b> The seed must be complete before the
/// first request is served — an operator restarting the API to pick up a newly-configured credential should not
/// have to race a background task — and it is a bounded, one-shot piece of work with no loop to run.
/// </para>
/// <para>
/// <b>It can never break the host.</b> Every failure — an unreachable database, a migration not yet applied, a
/// unique-index race with a concurrent instance — is caught and logged. A convenience seeder that could take an
/// environment down at boot would be strictly worse than the hand-inserted row it replaces. Cancellation during
/// shutdown is deliberately not treated as a failure.
/// </para>
/// <para>
/// <b>Why the default-credential warning lives here.</b> This is the one thing in the slice that runs once per
/// boot regardless of what the seeder decides, so "a default admin credential is active" is announced on EVERY
/// boot rather than only on the boot that first seeded something — a host that seeded months ago is exactly as
/// exposed as one seeding now.
/// </para>
/// </remarks>
public sealed partial class OrgAdminSeedHostedService : IHostedService
{
    private readonly IServiceScopeFactory _scopeFactory;
    private readonly IOptions<DynamisIdentityProviderOptions> _staffAllowlist;
    private readonly DefaultOrgAdminAccountState _defaultAccountState;
    private readonly ILogger<OrgAdminSeedHostedService> _logger;

    /// <summary>Creates the hosted seeder over its scope factory and logger.</summary>
    /// <param name="scopeFactory">Creates the DI scope the scoped <see cref="OrgAdminSeedService"/> and its <c>DbContext</c> resolve from.</param>
    /// <param name="staffAllowlist">The staff allowlist options — resolved here purely to MATERIALIZE them, which is what runs the <c>PostConfigure</c> that may inject the default credential.</param>
    /// <param name="defaultAccountState">Whether that injection happened, i.e. whether this host must scream.</param>
    /// <param name="logger">The logger a seeding failure, and the default-credential warning, are reported to.</param>
    public OrgAdminSeedHostedService(
        IServiceScopeFactory scopeFactory,
        IOptions<DynamisIdentityProviderOptions> staffAllowlist,
        DefaultOrgAdminAccountState defaultAccountState,
        ILogger<OrgAdminSeedHostedService> logger)
    {
        ArgumentNullException.ThrowIfNull(scopeFactory);
        ArgumentNullException.ThrowIfNull(staffAllowlist);
        ArgumentNullException.ThrowIfNull(defaultAccountState);
        ArgumentNullException.ThrowIfNull(logger);

        _scopeFactory = scopeFactory;
        _staffAllowlist = staffAllowlist;
        _defaultAccountState = defaultAccountState;
        _logger = logger;
    }

    /// <inheritdoc />
    public async Task StartAsync(CancellationToken cancellationToken)
    {
        try
        {
            // FIRST, unconditionally, and before any database work — a host that cannot reach its database still
            // has an active default credential and must still say so.
            AnnounceDefaultCredentialIfActive();

            // The seeder is SCOPED (it shares the PulseDbContext unit-of-work lifetime), so it must not be
            // resolved from the root provider.
            using var scope = _scopeFactory.CreateScope();
            var seeder = scope.ServiceProvider.GetRequiredService<OrgAdminSeedService>();

            await seeder.SeedAsync(cancellationToken);
        }
        catch (OperationCanceledException)
        {
            // The host is shutting down mid-seed. Nothing was committed (one SaveChanges), nothing to report.
        }
        catch (Exception exception)
        {
            LogSeedFailed(exception);
        }
    }

    /// <inheritdoc />
    public Task StopAsync(CancellationToken cancellationToken) => Task.CompletedTask;

    /// <summary>
    /// Screams — once per boot — if this host is running on the published <see cref="DefaultOrgAdminAccount"/>
    /// rather than a configured credential. Says nothing at all when a real entry was configured, so the warning
    /// stays a signal instead of becoming boot noise an operator learns to ignore.
    /// </summary>
    private void AnnounceDefaultCredentialIfActive()
    {
        // Reading .Value is what MATERIALIZES the options graph, and therefore what runs the registration-time
        // PostConfigure that decides whether to inject the default. Asking the flag before that would read it
        // before it could possibly have been written.
        _ = _staffAllowlist.Value;

        if (!_defaultAccountState.WasInjected)
        {
            return;
        }

        // Critical, not Warning: the exposure being reported is "anyone who can reach this host is an
        // organization administrator". The credential VALUE is still never logged (NFR-009) — it does not need
        // to be, since it is published in DefaultOrgAdminAccount.
        LogDefaultCredentialActive(
            DefaultOrgAdminAccount.Username,
            DynamisIdentityProviderOptions.SectionName);
    }

    /// <summary>
    /// Source-generated default-credential alarm (CA1848). Emitted on EVERY boot on which the published default
    /// was injected — never when a configured entry won.
    /// </summary>
    [LoggerMessage(
        Level = LogLevel.Critical,
        Message = "*** DEFAULT ADMIN CREDENTIAL IS ACTIVE *** No staff-allowlist entry for '{TargetUsername}' is "
                + "configured, so this host injected the PUBLISHED, NON-SECRET default org-admin account "
                + "'{TargetUsername}' — anyone who can reach this host can sign in as an organization "
                + "administrator with a credential that is committed to source control. This is a NON-PRODUCTION "
                + "convenience ONLY: it is registered exclusively outside ASPNETCORE_ENVIRONMENT=Production (a "
                + "blank or unset environment counts AS production), so a production host neither injects nor "
                + "accepts it. To override it, configure a real entry and restart — "
                + "{ConfigurationSection}:Accounts:{{i}}:Username = '{TargetUsername}' together with that "
                + "entry's Secret, ExternalSubject and DisplayName (user-secrets locally, or the indexed "
                + "Authentication__StaffIdentity__Accounts__{{i}}__* app settings in a deployed environment). A "
                + "configured entry always wins and silences this alarm.")]
    private partial void LogDefaultCredentialActive(string targetUsername, string configurationSection);

    /// <summary>Source-generated seeding-failure warning (CA1848) — loud, but never fatal to startup.</summary>
    [LoggerMessage(
        Level = LogLevel.Warning,
        Message = "The orgAdmin startup seeder failed and was skipped; the host started normally. If the org "
                + "tier is unreachable, provision an orgAdmin assignment by hand or fix the cause and restart.")]
    private partial void LogSeedFailed(Exception exception);
}
