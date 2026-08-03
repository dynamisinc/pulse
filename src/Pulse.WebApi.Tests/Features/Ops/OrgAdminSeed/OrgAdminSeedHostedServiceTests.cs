namespace Pulse.WebApi.Tests.Features.Ops.OrgAdminSeed;

using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;
using FluentAssertions;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;
using Pulse.WebApi.Features.Identity.Providers;
using Pulse.WebApi.Features.Ops.OrgAdminSeed;
using Xunit;

/// <summary>
/// The SCREAMING. When the published <see cref="DefaultOrgAdminAccount"/> was injected, the host must say so on
/// EVERY boot — not once, and not only on the boot that happened to seed something. These tests drive
/// <see cref="OrgAdminSeedHostedService.StartAsync"/> directly, which is the "one boot" unit, and assert the
/// alarm per call.
/// </summary>
/// <remarks>
/// <para>
/// <b>No database, deliberately.</b> The provider these run against registers no
/// <see cref="OrgAdminSeedService"/>, so the seeding half of <c>StartAsync</c> throws and is swallowed by the
/// hosted service's never-break-the-host catch. That is the point: the alarm has to fire on a host that CANNOT
/// seed, because an unreachable database does not make a live default admin credential any less live — and it
/// proves the alarm is not a side effect of a successful seed.
/// </para>
/// <para>
/// The alarm's LEVEL is asserted, not just its text: the exposure being reported is "anyone who can reach this
/// host is an organization administrator", and a message logged at Debug on a host filtering to Information
/// would be indistinguishable from silence.
/// </para>
/// </remarks>
public sealed class OrgAdminSeedHostedServiceTests
{
    [Fact]
    public async Task StartAsync_ScreamsAboutTheDefaultCredential_ONEVERYCall()
    {
        var (hostedService, log) = BuildHostedService();

        await hostedService.StartAsync(default);
        await hostedService.StartAsync(default);
        await hostedService.StartAsync(default);

        Alarms(log).Should().HaveCount(
            3, "the warning must be emitted on every boot. A once-only alarm (a latched flag, a first-seed-only "
            + "log) would go quiet on exactly the hosts that have been running on a published admin credential "
            + "the longest");
    }

    [Fact]
    public async Task TheAlarm_NamesTheAccount_TheNonProductionScope_AndTheOverrideKeys()
    {
        var (hostedService, log) = BuildHostedService();

        await hostedService.StartAsync(default);

        var alarm = Alarms(log).Should().ContainSingle().Subject;

        alarm.Message.Should().Contain(
            "DEFAULT ADMIN CREDENTIAL IS ACTIVE",
            "an operator skimming a boot log has to be unable to miss it");
        alarm.Message.Should().Contain(
            DefaultOrgAdminAccount.Username, "and must name WHICH account, so it can be located and replaced");
        alarm.Message.Should().Contain(
            "NON-PRODUCTION", "and must say the exposure is scoped, or it reads as a production incident");
        alarm.Message.Should().Contain(
            DynamisIdentityProviderOptions.SectionName,
            "and must give the EXACT configuration key that overrides it — an alarm with no remedy trains people "
            + "to ignore alarms");
        alarm.Message.Should().Contain(
            "Authentication__StaffIdentity__Accounts__",
            "including the double-underscore environment-variable form, which is how a deployed host is actually "
            + "configured");
        alarm.Message.Should().NotContain(
            DefaultOrgAdminAccount.Secret,
            "the credential VALUE is still never written to a log (NFR-009) — it does not need to be, since it "
            + "is published in source");
    }

    [Fact]
    public async Task TheAlarm_IsSilent_WhenARealConfiguredEntryIsUsed()
    {
        var (hostedService, log) = BuildHostedService(defaultWasInjected: false);

        await hostedService.StartAsync(default);

        Alarms(log).Should().BeEmpty(
            "an operator who configured their own credential must get NO default-credential alarm; a warning that "
            + "fires either way carries no information and is the fastest way to make the real one invisible");
    }

    [Fact]
    public async Task StartAsync_StillNeverBreaksTheHost()
    {
        var (hostedService, log) = BuildHostedService();

        var act = async () => await hostedService.StartAsync(default);

        await act.Should().NotThrowAsync(
            "the seeding half of this call fails here (no seeder is registered) and must stay swallowed — a "
            + "convenience seeder that can take a host down at boot is worse than the hand-inserted row it "
            + "replaced");
        log.Entries.Should().Contain(
            entry => entry.Message.Contains("failed and was skipped", StringComparison.Ordinal),
            "and the failure is reported rather than silently absorbed");
    }

    /// <summary>The default-credential alarm records only — i.e. what an operator must not be able to miss.</summary>
    private static List<OrgAdminSeedLogEntry> Alarms(CapturingHostedServiceLogger log) =>
        log.Entries
            .Where(entry => entry.Level >= LogLevel.Critical
                && entry.Message.Contains("DEFAULT ADMIN CREDENTIAL IS ACTIVE", StringComparison.Ordinal))
            .ToList();

    /// <summary>
    /// Builds the hosted service over a provider that registers NO seeder (see the class remarks) and a
    /// <see cref="DefaultOrgAdminAccountState"/> in the requested state.
    /// </summary>
    private static (OrgAdminSeedHostedService HostedService, CapturingHostedServiceLogger Log) BuildHostedService(
        bool defaultWasInjected = true)
    {
        var state = new DefaultOrgAdminAccountState();
        if (defaultWasInjected)
        {
            state.MarkInjected();
        }

        var provider = new ServiceCollection().BuildServiceProvider();
        var log = new CapturingHostedServiceLogger();

        var hostedService = new OrgAdminSeedHostedService(
            provider.GetRequiredService<IServiceScopeFactory>(),
            Options.Create(new DynamisIdentityProviderOptions()),
            state,
            log);

        return (hostedService, log);
    }
}

/// <summary>
/// A capturing <see cref="ILogger{TCategoryName}"/> for the hosted service — the alarm is the only externally
/// observable effect of the default-credential injection, so it is asserted rather than assumed.
/// </summary>
internal sealed class CapturingHostedServiceLogger : ILogger<OrgAdminSeedHostedService>
{
    /// <summary>Everything logged, in order.</summary>
    public List<OrgAdminSeedLogEntry> Entries { get; } = [];

    /// <inheritdoc />
    public IDisposable BeginScope<TState>(TState state)
        where TState : notnull => NullLogger.Instance.BeginScope(state);

    /// <inheritdoc />
    public bool IsEnabled(LogLevel logLevel) => true;

    /// <inheritdoc />
    public void Log<TState>(
        LogLevel logLevel,
        EventId eventId,
        TState state,
        Exception? exception,
        Func<TState, Exception?, string> formatter)
    {
        ArgumentNullException.ThrowIfNull(formatter);
        Entries.Add(new OrgAdminSeedLogEntry(logLevel, formatter(state, exception)));
    }
}
