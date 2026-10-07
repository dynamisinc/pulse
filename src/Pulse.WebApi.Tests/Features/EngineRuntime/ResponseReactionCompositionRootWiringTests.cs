namespace Pulse.WebApi.Tests.Features.EngineRuntime;

using System;
using System.Linq;
using FluentAssertions;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.DependencyInjection;
using Pulse.WebApi.Features.EngineRuntime;
using Pulse.WebApi.Features.EngineRuntime.Addressing;
using Pulse.WebApi.Features.Social;
using Xunit;

/// <summary>
/// Composition-root guard for engine-runtime/06 (official responses reach the live loop) — plain
/// <see cref="FactAttribute"/>, no Docker. Boots the real <see cref="WebApplicationFactory{TEntryPoint}"/> host so
/// <c>Program.cs</c>'s full wiring executes, then asserts against the real service provider.
/// </summary>
/// <remarks>
/// The response path was built, unit-tested and marked Complete while the loop handed the observe stage
/// <c>addressing: []</c> on every tick: a dead seam no slice-level suite could see. This story adds no
/// <c>Program.cs</c> line (the observer and inbox ride the already-wired <c>AddReactionLoopHost()</c>), which
/// makes the guard more important: the wiring it depends on is someone else's line.
/// </remarks>
public sealed class ResponseReactionCompositionRootWiringTests
{
    [Fact]
    public void ProgramCs_RegistersTheEnginesPostObserver_SoParticipantPostsReachTheLoop()
    {
        using var factory = new WiringProbeFactory();

        factory.Services.GetServices<IPostPublishedObserver>()
            .Count(observer => observer is EngineAddressingObserver)
            .Should().Be(1, "PostIngestService notifies every registered observer; exactly one must feed the engine's inbox");
    }

    [Fact]
    public void ProgramCs_ResolvesExactlyOneAddressingInbox_SharedByTheObserverTheSeedAndTheDriver()
    {
        using var factory = new WiringProbeFactory();

        factory.Services.GetServices<IAddressingInbox>().Should().HaveCount(
            1, "AddReactionLoopHost and AddEngineContentSeed both TryAdd it, so only ONE registration may exist");
        factory.Services.GetRequiredService<IAddressingInbox>().Should().BeSameAs(
            factory.Services.GetRequiredService<IAddressingInbox>(),
            "a singleton: two instances would mean the observer writes a queue the driver never drains");
        factory.Services.GetRequiredService<ReactionLoopDriver>().Should().NotBeNull(
            "the driver, which now takes the inbox, must still resolve on the real host");
    }

    [Fact]
    public void ProgramCs_ResolvesPostIngestService_WithTheObserverSeam()
    {
        using var factory = new WiringProbeFactory();
        using var scope = factory.Services.CreateScope();

        scope.ServiceProvider.GetRequiredService<PostIngestService>().Should().NotBeNull(
            "the single post funnel must still construct on the real host now that it takes observers");
    }

    /// <summary>
    /// Boots the real <c>Program</c> host with a dummy, never-connecting connection string so it merely BUILDS.
    /// Mirrors <c>GenerationProviderCutCompositionRootWiringTests</c>'s probe factory.
    /// </summary>
    private sealed class WiringProbeFactory : WebApplicationFactory<Program>
    {
        private const string ConnectionStringEnvVar = "ConnectionStrings__DefaultConnection";
        private const string DummyConnectionString =
            "Server=nonexistent;Database=pulse;Trusted_Connection=False;";

        public WiringProbeFactory()
            => Environment.SetEnvironmentVariable(ConnectionStringEnvVar, DummyConnectionString);

        protected override void Dispose(bool disposing)
        {
            base.Dispose(disposing);
            Environment.SetEnvironmentVariable(ConnectionStringEnvVar, null);
        }
    }
}
