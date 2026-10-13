namespace Pulse.WebApi.Tests.Features.Identity.LinkEmail;

using System;
using System.Collections.Generic;
using System.Threading;
using System.Threading.Tasks;
using Azure.Core;
using FluentAssertions;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Pulse.WebApi.Data;
using Pulse.WebApi.Features.EngineRuntime.Clock;
using Pulse.WebApi.Features.Identity.EasyLogin;
using Pulse.WebApi.Features.Identity.LinkEmail;
using Pulse.WebApi.Features.Identity.Roster;
using Pulse.WebApi.Features.Identity.Staff;
using Pulse.WebApi.Tests.Data;
using Pulse.WebApi.Tests.Features.ExerciseConfiguration.Lifecycle;
using Pulse.WebApi.Tests.Features.Identity.Staff;

/// <summary>
/// easy-login/13 (S-3): the roster's <c>capabilities.emailLinks</c> and the send path come from ONE switch, the
/// registered mailer's <see cref="IParticipantLinkMailer.IsConfigured"/>. Composed the way <c>Program.cs</c> composes
/// them (<c>AddRoster()</c> + <c>AddLinkEmail()</c>) over real SQL: unset email, and a SET-BUT-UNUSABLE endpoint, both
/// give <c>emailLinks: false</c> AND a <c>503</c>-shaped refusal (so the button is hidden rather than offered and doomed);
/// a usable configuration gives <c>true</c> and a send path.
/// </summary>
[Collection(MsSqlCollection.Name)]
public sealed class LinkEmailCapabilityTests
{
    private readonly LinkEmailTestWorld _world;

    public LinkEmailCapabilityTests(MsSqlContainerFixture fixture) => _world = new LinkEmailTestWorld(fixture);

    public static TheoryData<string, string?, string?, bool> Configurations() => new()
    {
        { "unset", null, null, false },
        { "endpoint set but not https", "http://acs.example.test", LinkEmailTestWorld.Sender, false },
        { "endpoint set, no sender", LinkEmailTestWorld.AcsEndpoint, null, false },
        { "usable", LinkEmailTestWorld.AcsEndpoint, LinkEmailTestWorld.Sender, true },
    };

    [RequiresDockerTheory]
    [MemberData(nameof(Configurations))]
    public async Task TheRosterCapability_AndTheSendPath_Agree(string because, string? endpoint, string? sender, bool configured)
    {
        var exercise = await _world.SeedExerciseAsync();
        var staff = await _world.SeedStaffAsync((exercise, "controller"));
        await _world.SeedParticipantAsync(exercise, "Ann Active");

        await using var provider = Build(exercise, staff, endpoint, sender);
        await using var scope = provider.CreateAsyncScope();

        var roster = await scope.ServiceProvider.GetRequiredService<RosterQueryService>().ListAsync();
        var mailer = scope.ServiceProvider.GetRequiredService<IParticipantLinkMailer>();

        roster!.Capabilities.EmailLinks.Should().Be(configured, because);
        mailer.IsConfigured.Should().Be(configured, because);
        if (!configured)
        {
            var refused = await scope.ServiceProvider.GetRequiredService<LinkEmailService>().SendAsync(new RosterEmailLinksBody());
            refused.Outcome.Should().Be(LinkEmailOutcome.NotConfigured, "the hidden button's endpoint is dark too ({0})", because);
        }
    }

    private ServiceProvider Build(Guid exercise, Guid staff, string? endpoint, string? sender)
    {
        var services = new ServiceCollection();
        services.AddLogging();
        services.AddSingleton<IConfiguration>(new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?>
        {
            [JoinUrlBuilder.FrontendBaseUrlKey] = LinkEmailTestWorld.FrontendBase,
            [LinkEmailSettings.EndpointKey] = endpoint,
            [LinkEmailSettings.SenderAddressKey] = sender,
        }).Build());
        services.AddScoped<IExerciseContext>(_ => new ExerciseContext { CurrentExerciseId = exercise });
        services.AddScoped(provider => _world.Fixture.CreateContext(provider.GetRequiredService<IExerciseContext>()));
        services.AddScoped<ICurrentStaffSessionAccessor>(_ => new StubCurrentStaffSessionAccessor(
            new CurrentStaffSession { SessionId = Guid.NewGuid(), StaffUserId = staff }));
        services.AddScoped<StaffAssignmentService>();
        services.AddExerciseClock();

        // Keyless credential stand-in, so a usable configuration builds the real ACS mailer without a host environment.
        services.AddSingleton(new LinkEmailClientSettings(new NeverCalledCredential()));
        services.AddRoster();
        services.AddLinkEmail();
        services.AddSingleton<IDataProtectionProvider>(_world.KeyRing);

        return services.BuildServiceProvider(new ServiceProviderOptions { ValidateScopes = true });
    }

    private sealed class NeverCalledCredential : TokenCredential
    {
        public override AccessToken GetToken(TokenRequestContext requestContext, CancellationToken cancellationToken) =>
            throw new InvalidOperationException("No email is sent in this test.");

        public override ValueTask<AccessToken> GetTokenAsync(TokenRequestContext requestContext, CancellationToken cancellationToken) =>
            throw new InvalidOperationException("No email is sent in this test.");
    }
}
