namespace Pulse.WebApi.Tests.Features.Identity.LinkEmail;

using System.Collections.Generic;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using FluentAssertions;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using Pulse.WebApi.Features.Identity.LinkEmail;

/// <summary>
/// easy-login/13 (EL-18, "dark until configured"): with no <c>Email:*</c> configuration the host STARTS normally and
/// quietly (no startup failure, no log line from the slice), the mailer is the fail-closed
/// <see cref="NullParticipantLinkMailer"/> (not configured, sends nothing). An endpoint that is set but unusable still
/// starts the host, keeps the null mailer, and names the offending KEY once (never its value). A usable configuration
/// selects the keyless ACS mailer. Plain facts: no SQL, no network.
/// </summary>
public sealed class NullParticipantLinkMailerTests
{
    [Fact]
    public async Task WithNoEmailConfiguration_TheHostStartsQuietly_AndTheMailerIsTheNullOne()
    {
        var logs = new LinkEmailCapturingLoggerProvider();

        using var host = await StartAsync(new Dictionary<string, string?>(), logs);

        var mailer = host.Services.GetRequiredService<IParticipantLinkMailer>();
        mailer.Should().BeOfType<NullParticipantLinkMailer>();
        mailer.IsConfigured.Should().BeFalse();
        logs.Messages.Where(m => m.Contains("LinkEmail", System.StringComparison.Ordinal))
            .Should().BeEmpty("an unconfigured host is a normal state: no log noise");
    }

    [Fact]
    public async Task TheNullMailer_SendsNothing_AndReportsAFailure()
    {
        var mailer = new NullParticipantLinkMailer();

        var outcome = await mailer.SendAsync(
            LinkEmailComposer.Compose("jane@example.org", "Exercise", "Jane", "jsmith", "https://pulse.example/join/abc"),
            CancellationToken.None);

        outcome.Should().Be(LinkMailSendOutcome.Failed);
        mailer.IsConfigured.Should().BeFalse();
    }

    [Fact]
    public async Task AnUnusableEndpoint_StillStartsTheHost_KeepsTheNullMailer_AndNamesTheKeyOnce_NeverTheValue()
    {
        var logs = new LinkEmailCapturingLoggerProvider();

        using var host = await StartAsync(
            new Dictionary<string, string?>
            {
                [LinkEmailSettings.EndpointKey] = "http://secret-host.example/?sig=abc123",
                [LinkEmailSettings.SenderAddressKey] = LinkEmailTestWorld.Sender,
            },
            logs);

        host.Services.GetRequiredService<IParticipantLinkMailer>().Should().BeOfType<NullParticipantLinkMailer>();
        var warning = logs.Messages.Should().ContainSingle(m => m.Contains("Link email is requested but not usable", System.StringComparison.Ordinal)).Subject;
        warning.Should().Contain("Email:Endpoint").And.NotContain("secret-host").And.NotContain("abc123");
    }

    [Fact]
    public async Task AUsableConfiguration_SelectsTheAcsMailer_AndLogsNothing()
    {
        var logs = new LinkEmailCapturingLoggerProvider();

        using var host = await StartAsync(
            new Dictionary<string, string?>
            {
                [LinkEmailSettings.EndpointKey] = LinkEmailTestWorld.AcsEndpoint,
                [LinkEmailSettings.SenderAddressKey] = LinkEmailTestWorld.Sender,
            },
            logs);

        var mailer = host.Services.GetRequiredService<IParticipantLinkMailer>();
        mailer.Should().BeOfType<AcsParticipantLinkMailer>();
        mailer.IsConfigured.Should().BeTrue();
        logs.Messages.Where(m => m.Contains("LinkEmail", System.StringComparison.Ordinal)).Should().BeEmpty();
    }

    [Fact]
    public void AddLinkEmail_IsIdempotent()
    {
        var once = new ServiceCollection();
        once.AddLinkEmail();

        var twice = new ServiceCollection();
        twice.AddLinkEmail();
        twice.AddLinkEmail();

        twice.Count(d => d.ServiceType == typeof(IParticipantLinkMailer)).Should().Be(1);
        twice.Count(d => d.ServiceType == typeof(LinkEmailService)).Should().Be(1);
        twice.Count(d => d.ServiceType == typeof(IHostedService)).Should().Be(once.Count(d => d.ServiceType == typeof(IHostedService)));
    }

    private static async Task<IHost> StartAsync(Dictionary<string, string?> settings, LinkEmailCapturingLoggerProvider logs)
    {
        var builder = Host.CreateApplicationBuilder();
        builder.Configuration.AddInMemoryCollection(settings);
        builder.Logging.ClearProviders();
        builder.Logging.SetMinimumLevel(LogLevel.Trace);
        builder.Logging.AddProvider(logs);
        builder.Services.AddLinkEmail();

        var host = builder.Build();
        await host.StartAsync();
        await host.StopAsync();
        return host;
    }
}
