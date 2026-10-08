namespace Pulse.WebApi.Tests.Features.Social;

using System;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using FluentAssertions;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.DependencyInjection;
using Pulse.WebApi.Data.Entities;
using Pulse.WebApi.Features.Media;
using Pulse.WebApi.Features.Social;
using Pulse.WebApi.Features.Social.Engagement;
using Pulse.WebApi.Features.Social.Threads;

/// <summary>
/// demo-polish BP composition (model-only, no Docker): the three seam fallbacks are registered by the existing
/// Social registration methods with <c>TryAdd</c>, a REAL implementation registered with a plain <c>Add</c> wins in
/// either order, each fallback fails closed, and the real <c>Program</c> host resolves the projector and the
/// services that now depend on it — with no new <c>Program.cs</c> line.
/// </summary>
public sealed class PostMediaWiringTests
{
    [Theory]
    [InlineData(nameof(FeedEndpoints.AddSocialFeedRead))]
    [InlineData(nameof(PostWriteEndpoints.AddSocialPostWrite))]
    [InlineData(nameof(PersonaEndpoints.AddSocialPersonaRead))]
    public void EachSocialRegistration_TryAddsTheFallbacksAndTheProjector(string registration)
    {
        var services = new ServiceCollection();
        Register(services, registration);

        Single<IPostEngagementReader>(services).ImplementationType.Should().Be(typeof(ZeroPostEngagementReader));
        // Fully qualified: BM's Pulse.WebApi.Features.Media.UnconfiguredMediaUrlSigner shares the simple name.
        Single<IMediaUrlSigner>(services).ImplementationType.Should().Be(typeof(Pulse.WebApi.Features.Social.UnconfiguredMediaUrlSigner));
        Single<IReplyParentResolver>(services).ImplementationType.Should().Be(typeof(UnavailableReplyParentResolver));
        Single<IParticipantPostProjector>(services).ImplementationType.Should().Be(typeof(ParticipantPostProjector));
    }

    [Fact]
    public void CallingEveryRegistration_StillLeavesExactlyOneFallbackPerSeam()
    {
        var services = new ServiceCollection();
        services.AddSocialFeedRead();
        services.AddSocialPostWrite();
        services.AddSocialPersonaRead();

        Single<IPostEngagementReader>(services);
        Single<IMediaUrlSigner>(services);
        Single<IReplyParentResolver>(services);
        Single<IParticipantPostProjector>(services);
    }

    [Fact]
    public void ARealImplementationRegisteredWithAdd_WinsWhetherItIsRegisteredBeforeOrAfter()
    {
        var after = new ServiceCollection();
        after.AddSocialPostWrite();
        after.AddScoped<IReplyParentResolver, RealResolver>();
        after.AddScoped<IPostEngagementReader, RealEngagementReader>();
        after.AddSingleton<IMediaUrlSigner, RealSigner>();

        var before = new ServiceCollection();
        before.AddScoped<IReplyParentResolver, RealResolver>();
        before.AddScoped<IPostEngagementReader, RealEngagementReader>();
        before.AddSingleton<IMediaUrlSigner, RealSigner>();
        before.AddSocialPostWrite();

        foreach (var services in new[] { after, before })
        {
            using var provider = services.BuildServiceProvider();
            using var scope = provider.CreateScope();
            scope.ServiceProvider.GetRequiredService<IReplyParentResolver>().Should().BeOfType<RealResolver>();
            scope.ServiceProvider.GetRequiredService<IPostEngagementReader>().Should().BeOfType<RealEngagementReader>();
            scope.ServiceProvider.GetRequiredService<IMediaUrlSigner>().Should().BeOfType<RealSigner>();
        }
    }

    [Fact]
    public async Task TheFallbacks_FailClosed()
    {
        var engagement = await new ZeroPostEngagementReader().GetAsync([Guid.NewGuid()], Guid.NewGuid(), CancellationToken.None);
        engagement.Should().BeEmpty("no real engagement is invented");

        var asset = new MediaAsset
        {
            Kind = MediaKinds.Image,
            ContentType = "image/png",
            BlobName = "x",
            OriginalFileName = "x",
            UploadedByHumanId = "h",
        };
        var signer = new Pulse.WebApi.Features.Social.UnconfiguredMediaUrlSigner();
        await signer.Invoking(s => s.GetReadUrlsAsync([asset], CancellationToken.None))
            .Should().ThrowAsync<InvalidOperationException>().WithMessage("*not configured*");
        await signer.Invoking(s => s.GetReadUrlAsync(asset, CancellationToken.None))
            .Should().ThrowAsync<InvalidOperationException>();

        var resolver = new UnavailableReplyParentResolver();
        (await resolver.ResolveAsync(null, CancellationToken.None)).Outcome.Should().Be(ReplyParentOutcome.None);
        (await resolver.ResolveAsync(string.Empty, CancellationToken.None)).Outcome.Should().Be(ReplyParentOutcome.None);
        (await resolver.ResolveAsync(Guid.NewGuid().ToString(), CancellationToken.None)).Outcome
            .Should().Be(ReplyParentOutcome.NotFound, "with no B2 resolver, every reply is refused");
        (await resolver.ResolveAsync("garbage", CancellationToken.None)).Parent.Should().BeNull();
    }

    [Fact]
    public void TheRealHost_ResolvesTheProjectorAndEveryServiceThatNowDependsOnIt()
    {
        // Resolution only, never the concrete seam types: once B2/B3/BM merge, their real implementations replace
        // the fallbacks on this same host and this assertion must keep passing.
        using var factory = new WiringProbeFactory();
        using var scope = factory.Services.CreateScope();
        var provider = scope.ServiceProvider;

        provider.GetRequiredService<IParticipantPostProjector>().Should().BeOfType<ParticipantPostProjector>();
        provider.GetRequiredService<PostIngestService>().Should().NotBeNull();
        provider.GetRequiredService<PostReadService>().Should().NotBeNull();
        provider.GetRequiredService<PersonaReadService>().Should().NotBeNull();
        provider.GetRequiredService<IReplyParentResolver>().Should().NotBeNull();
        provider.GetRequiredService<IPostEngagementReader>().Should().NotBeNull();
        provider.GetRequiredService<IMediaUrlSigner>().Should().NotBeNull();
    }

    private static void Register(IServiceCollection services, string registration)
    {
        switch (registration)
        {
            case nameof(FeedEndpoints.AddSocialFeedRead):
                services.AddSocialFeedRead();
                break;
            case nameof(PostWriteEndpoints.AddSocialPostWrite):
                services.AddSocialPostWrite();
                break;
            default:
                services.AddSocialPersonaRead();
                break;
        }
    }

    private static ServiceDescriptor Single<TService>(IServiceCollection services) =>
        services.Where(d => d.ServiceType == typeof(TService)).Should().ContainSingle(
            "{0} is TryAdd'ed, so repeated registration never stacks a second fallback", typeof(TService).Name).Subject;

    private sealed class RealResolver : IReplyParentResolver
    {
        public Task<ReplyParentResult> ResolveAsync(string? parentPostId, CancellationToken cancellationToken) =>
            Task.FromResult(new ReplyParentResult(ReplyParentOutcome.None, null));
    }

    private sealed class RealEngagementReader : IPostEngagementReader
    {
        public Task<System.Collections.Generic.IReadOnlyDictionary<Guid, PostEngagement>> GetAsync(
            System.Collections.Generic.IReadOnlyCollection<Guid> postIds, Guid? viewerPersonaId, CancellationToken cancellationToken) =>
            Task.FromResult<System.Collections.Generic.IReadOnlyDictionary<Guid, PostEngagement>>(
                new System.Collections.Generic.Dictionary<Guid, PostEngagement>());
    }

    private sealed class RealSigner : IMediaUrlSigner
    {
        public Task<string> GetReadUrlAsync(MediaAsset asset, CancellationToken cancellationToken) => Task.FromResult("real");

        public Task<System.Collections.Generic.IReadOnlyDictionary<Guid, string>> GetReadUrlsAsync(
            System.Collections.Generic.IReadOnlyCollection<MediaAsset> assets, CancellationToken cancellationToken) =>
            Task.FromResult<System.Collections.Generic.IReadOnlyDictionary<Guid, string>>(
                new System.Collections.Generic.Dictionary<Guid, string>());
    }

    /// <summary>Boots the real <c>Program</c> host on a never-connecting connection string — resolution only.</summary>
    private sealed class WiringProbeFactory : WebApplicationFactory<Program>
    {
        private const string ConnectionStringEnvVar = "ConnectionStrings__DefaultConnection";

        public WiringProbeFactory() => Environment.SetEnvironmentVariable(
            ConnectionStringEnvVar, "Server=nonexistent;Database=pulse;Trusted_Connection=False;");

        protected override void Dispose(bool disposing)
        {
            base.Dispose(disposing);
            Environment.SetEnvironmentVariable(ConnectionStringEnvVar, null);
        }
    }
}
