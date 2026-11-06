namespace Pulse.WebApi.Tests.Features.Press;

using System;
using System.Linq;
using FluentAssertions;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.DependencyInjection;
using Pulse.WebApi.Data;
using Pulse.WebApi.Features.Channels.Contracts;
using Pulse.WebApi.Features.Press;
using Pulse.WebApi.Features.Press.Contracts;
using Pulse.WebApi.Features.Press.Kind;
using Pulse.WebApi.Features.Press.Outlets;

/// <summary>
/// Composition-root guard for the press room (FC-9.10; plain facts, no Docker): boots the REAL <c>Program</c> host and
/// proves <c>AddPress()</c> is wired: the <c>release</c> descriptor is registered with the funnel (once, scoped), and the
/// PC-4 seam defaults and the provisioner resolve from a request scope. Later press backend stories (02, 04, 05, 06, 12)
/// extend this file as they fill <c>AddPress()</c>.
/// </summary>
public sealed class PressCompositionRootWiringTests
{
    [Fact]
    public void ProgramCs_RegistersTheReleaseKind_AndResolvesTheSeamDefaults()
    {
        using var factory = new WiringProbeFactory();
        using var scope = factory.Services.CreateScope();
        ((ExerciseContext)scope.ServiceProvider.GetRequiredService<IExerciseContext>()).CurrentExerciseId = Guid.NewGuid();

        var descriptors = scope.ServiceProvider.GetServices<IContentKindDescriptor>().ToList();
        descriptors.Where(d => d.Kind == ChannelVocabulary.KindRelease).Should().ContainSingle()
            .Which.Should().BeOfType<ReleaseKindDescriptor>();
        descriptors.GroupBy(d => d.Kind).Should().OnlyContain(g => g.Count() == 1, "a kind is registered once");

        scope.ServiceProvider.GetRequiredService<IReleaseApprovalGate>().Should().BeOfType<PassThroughReleaseApprovalGate>();
        scope.ServiceProvider.GetRequiredService<IReleaseReactionHook>().Should().BeOfType<NoOpReleaseReactionHook>();
        scope.ServiceProvider.GetRequiredService<IOrgNewsroomProvisioner>().Should().BeOfType<OrgNewsroomProvisioner>();
    }

    [Fact]
    public void AddPress_IsIdempotent_AndLetsALaterStoryReplaceTheGate()
    {
        var services = new ServiceCollection();
        services.AddScoped<IReleaseApprovalGate, HoldEverythingGate>();

        services.AddPress().AddPress().Should().BeSameAs(services);

        services.Where(d => d.ServiceType == typeof(IContentKindDescriptor)).Select(d => d.ImplementationType)
            .Should().Equal(typeof(ReleaseKindDescriptor));
        services.Where(d => d.ServiceType == typeof(IReleaseApprovalGate)).Select(d => d.ImplementationType)
            .Should().Equal([typeof(HoldEverythingGate)], "a gate registered first wins (TryAdd)");
        services.Count(d => d.ServiceType == typeof(IOrgNewsroomProvisioner)).Should().Be(1);
        services.Should().OnlyContain(d => d.Lifetime == ServiceLifetime.Scoped);
    }

    [Fact]
    public async System.Threading.Tasks.Task ThePassThroughGate_PassesEveryRelease()
    {
        var item = Pulse.WebApi.Tests.Data.ChannelRows.ContentItem(Guid.NewGuid(), Guid.NewGuid());

        var decision = await new PassThroughReleaseApprovalGate().EvaluateAsync(item, "human-1");

        decision.Should().BeSameAs(ReleaseApprovalDecision.Pass);
        decision.IsHeld.Should().BeFalse();
        ReleaseApprovalDecision.Hold(Guid.NewGuid()).IsHeld.Should().BeTrue();
        var act = () => ReleaseApprovalDecision.Hold(Guid.Empty);
        act.Should().Throw<ArgumentException>();
    }

    private sealed class HoldEverythingGate : IReleaseApprovalGate
    {
        public System.Threading.Tasks.Task<ReleaseApprovalDecision> EvaluateAsync(
            Pulse.WebApi.Data.Entities.ContentItem release, string humanId, System.Threading.CancellationToken cancellationToken = default) =>
            System.Threading.Tasks.Task.FromResult(ReleaseApprovalDecision.Hold(Guid.NewGuid()));
    }

    /// <summary>Boots the real <c>Program</c> host with a dummy, never-connecting connection string. Overrides nothing else.</summary>
    private sealed class WiringProbeFactory : WebApplicationFactory<Program>
    {
        private const string ConnectionStringEnvVar = "ConnectionStrings__DefaultConnection";
        private const string DummyConnectionString =
            "Server=nonexistent;Database=pulse;Trusted_Connection=False;Connect Timeout=1;";

        private readonly string? _previous;

        public WiringProbeFactory()
        {
            _previous = Environment.GetEnvironmentVariable(ConnectionStringEnvVar);
            Environment.SetEnvironmentVariable(ConnectionStringEnvVar, DummyConnectionString);
        }

        protected override void Dispose(bool disposing)
        {
            base.Dispose(disposing);
            Environment.SetEnvironmentVariable(ConnectionStringEnvVar, _previous);
        }
    }
}
