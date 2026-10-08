namespace Pulse.WebApi.Tests.Features.Social.Reactions;

using System;
using System.Linq;
using System.Net;
using System.Threading;
using System.Threading.Tasks;
using FluentAssertions;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.Routing;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Pulse.WebApi.Features.Social.Engagement;
using Pulse.WebApi.Features.Social.Reactions;
using Pulse.WebApi.Tests.Data;
using static Pulse.WebApi.Tests.Features.Social.Reactions.ReactionTestSeed;

/// <summary>
/// Composition-root guards for the reaction slice (demo-polish B3; the #310→#317 lesson), model-only (plain
/// <see cref="FactAttribute"/>, no database): <c>Program.cs</c> maps both routes exactly once and the real
/// <see cref="PostEngagementReader"/> wins over any <c>TryAdd</c> fallback. The live-host half is
/// <see cref="ReactionCompositionRootHostTests"/>.
/// </summary>
public sealed class ReactionCompositionRootWiringTests
{
    private const string ReactionRoute = "/api/posts/{postId:guid}/reactions/{kind}";

    [Fact]
    public void ProgramCs_MapsBothReactionRoutesExactlyOnce_AndResolvesTheRealReader()
    {
        using var factory = new WiringProbeFactory();

        var dataSource = factory.Services.GetRequiredService<EndpointDataSource>();

        CountRoutes(dataSource, "PUT").Should().Be(1, "PUT {0} must be reachable through Program.cs exactly once", ReactionRoute);
        CountRoutes(dataSource, "DELETE").Should().Be(1, "DELETE {0} must be reachable through Program.cs exactly once", ReactionRoute);

        using var scope = factory.Services.CreateScope();
        scope.ServiceProvider.GetRequiredService<ReactionService>().Should().NotBeNull(
            "AddSocialReactions must be reached from Program.cs, or the handler 500s on its first request");
        scope.ServiceProvider.GetRequiredService<IPostEngagementReader>().Should().BeOfType<PostEngagementReader>(
            "the REAL reader must be the one the feed projector and the reaction endpoint resolve");
    }

    [Fact]
    public void AddSocialReactions_TheRealReaderWinsOverATryAddFallback_InEitherOrder()
    {
        var fallbackFirst = new ServiceCollection();
        fallbackFirst.TryAddScoped<IPostEngagementReader, FallbackReader>();
        fallbackFirst.AddSocialReactions();

        var fallbackLast = new ServiceCollection();
        fallbackLast.AddSocialReactions();
        fallbackLast.TryAddScoped<IPostEngagementReader, FallbackReader>();

        LastRegistration(fallbackFirst).Should().Be(
            typeof(PostEngagementReader), "a plain AddScoped after a TryAdd fallback is the registration resolved");
        LastRegistration(fallbackLast).Should().Be(
            typeof(PostEngagementReader), "a TryAdd fallback after the real reader is a no-op");
    }

    private static int CountRoutes(EndpointDataSource dataSource, string method)
        => dataSource.Endpoints
            .OfType<RouteEndpoint>()
            .Count(endpoint =>
                string.Equals(endpoint.RoutePattern.RawText, ReactionRoute, StringComparison.OrdinalIgnoreCase)
                && (endpoint.Metadata.GetMetadata<HttpMethodMetadata>()?.HttpMethods.Contains(method) ?? false));

    private static Type? LastRegistration(IServiceCollection services)
        => services.Last(descriptor => descriptor.ServiceType == typeof(IPostEngagementReader)).ImplementationType;

    /// <summary>Stands in for the post read path's <c>TryAdd</c> fallback reader.</summary>
    private sealed class FallbackReader : IPostEngagementReader
    {
        public Task<System.Collections.Generic.IReadOnlyDictionary<Guid, PostEngagement>> GetAsync(
            System.Collections.Generic.IReadOnlyCollection<Guid> postIds, Guid? viewerPersonaId, CancellationToken cancellationToken)
            => throw new NotSupportedException("fallback");
    }

    /// <summary>
    /// Boots the real <c>Program</c> host with a dummy, never-connecting connection string so it merely BUILDS;
    /// enumerating endpoints and resolving services needs no live database.
    /// </summary>
    private sealed class WiringProbeFactory : WebApplicationFactory<Program>
    {
        private const string ConnectionStringEnvVar = "ConnectionStrings__DefaultConnection";
        private const string DummyConnectionString = "Server=nonexistent;Database=pulse;Trusted_Connection=False;";

        public WiringProbeFactory()
            => Environment.SetEnvironmentVariable(ConnectionStringEnvVar, DummyConnectionString);

        protected override void Dispose(bool disposing)
        {
            base.Dispose(disposing);
            Environment.SetEnvironmentVariable(ConnectionStringEnvVar, null);
        }
    }
}

/// <summary>
/// The live-host half of the reaction composition-root guards (real <c>Program</c> host, REAL SQL Server): the routes
/// answer 401 (not 404) unauthenticated, and they sit inside the <c>DenyReadOnlySessions()</c> group.
/// </summary>
[Collection(MsSqlCollection.Name)]
public class ReactionCompositionRootHostTests
{
    private readonly MsSqlContainerFixture _fixture;

    public ReactionCompositionRootHostTests(MsSqlContainerFixture fixture)
    {
        _fixture = fixture;
    }

    [RequiresDockerFact]
    public async Task TheReactionRoutes_Answer401Unauthenticated_Not404()
    {
        var world = await SeedWorldAsync(_fixture);

        await using var host = CreateHost(_fixture);
        using var client = host.CreateClientFor(world.Host, bearerToken: null);

        (await client.PutAsync(ReactionUri(world.Post, "like"), content: null)).StatusCode.Should().Be(
            HttpStatusCode.Unauthorized, "a wired route answers the auth gate's 401; a dead one would 404");
        (await client.DeleteAsync(ReactionUri(world.Post, "repost"))).StatusCode.Should().Be(HttpStatusCode.Unauthorized);
    }

    [RequiresDockerFact]
    public async Task TheReactionRoutes_AreMappedInsideTheDenyReadOnlySessionsGroup()
    {
        // A participant-KIND session flagged read-only: the service's participant allowlist would ACCEPT it, so a 403
        // here can only come from the ReadOnlySessionWriteFilter that the Program.cs group applies (COR-015).
        var world = await SeedWorldAsync(_fixture);
        var token = await SeedSessionAsync(_fixture, world.Exercise, world.Persona, kind: "participant", isReadOnly: true);

        await using var host = CreateHost(_fixture);
        using var client = host.CreateClientFor(world.Host, token);

        (await client.PutAsync(ReactionUri(world.Post, "like"), content: null)).StatusCode.Should().Be(
            HttpStatusCode.Forbidden, "the route must be mapped through MapGroup(...).DenyReadOnlySessions()");
        (await client.DeleteAsync(ReactionUri(world.Post, "like"))).StatusCode.Should().Be(HttpStatusCode.Forbidden);
        (await ReadReactionsAsync(_fixture, world.Post)).Should().BeEmpty();
    }
}
