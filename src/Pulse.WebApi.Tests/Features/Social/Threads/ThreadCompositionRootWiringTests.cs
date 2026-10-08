namespace Pulse.WebApi.Tests.Features.Social.Threads;

using System;
using System.Linq;
using System.Net;
using System.Threading;
using System.Threading.Tasks;
using FluentAssertions;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.Routing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Pulse.WebApi.Data;
using Pulse.WebApi.Features.ExerciseResolution;
using Pulse.WebApi.Features.Social;
using Pulse.WebApi.Features.Social.Threads;

/// <summary>
/// Composition-root guards for demo-polish B2 (plain <see cref="FactAttribute"/>, no database): the real
/// <c>Program</c> host wires <c>AddSocialThreads()</c>, resolves the REAL reply-parent resolver (not a fallback), maps
/// the thread route exactly once, and answers 401 (not 404) to an anonymous caller. This is the #310→#317 lesson: a
/// slice can be fully green in isolation and still be unreachable on the real host.
/// </summary>
public sealed class ThreadCompositionRootWiringTests
{
    [Fact]
    public void ProgramCs_RegistersTheRealResolver_AndTheThreadRead_AndMapsTheRouteOnce()
    {
        using var factory = new DummyDatabaseFactory();

        var dataSource = factory.Services.GetRequiredService<EndpointDataSource>();
        dataSource.Endpoints.OfType<RouteEndpoint>()
            .Count(e => string.Equals(e.RoutePattern.RawText, "/api/threads/{postId}", StringComparison.OrdinalIgnoreCase))
            .Should().Be(1, "GET /api/threads/{postId} must be mapped exactly once, with no ':guid' constraint");

        using var scope = factory.Services.CreateScope();
        scope.ServiceProvider.GetRequiredService<IReplyParentResolver>().Should().BeOfType<ReplyParentResolver>(
            "Program.cs must call AddSocialThreads(), or BP's ingest rejects every reply");
        scope.ServiceProvider.GetRequiredService<ThreadReadService>().Should().NotBeNull(
            "the thread handler's service must resolve from the real composition root, or the route 500s");
        scope.ServiceProvider.GetRequiredService<IParticipantPostProjector>().Should().BeOfType<ParticipantPostProjector>(
            "ThreadReadService requires the REAL projector (B2 M-2), so threads carry the same counts and media as the feed");
    }

    [Fact]
    public void AddSocialThreads_WinsOverATryAddFallback_InEitherOrder()
    {
        // BP registers a TryAdd fallback resolver. The real one must win whichever extension runs first.
        var fallbackFirst = BaseServices();
        fallbackFirst.TryAddScoped<IReplyParentResolver, RejectEverythingResolver>();
        fallbackFirst.AddSocialThreads();

        var threadsFirst = BaseServices();
        threadsFirst.AddSocialThreads();
        threadsFirst.TryAddScoped<IReplyParentResolver, RejectEverythingResolver>();

        foreach (var services in new[] { fallbackFirst, threadsFirst })
        {
            using var provider = services.BuildServiceProvider(new ServiceProviderOptions { ValidateScopes = true, ValidateOnBuild = true });
            using var scope = provider.CreateScope();
            scope.ServiceProvider.GetRequiredService<IReplyParentResolver>().Should().BeOfType<ReplyParentResolver>();
            scope.ServiceProvider.GetRequiredService<ThreadReadService>().Should().NotBeNull(
                "AddSocialThreads alone supplies the projector ThreadReadService requires (TryAddPostSeamFallbacks)");
        }
    }

    [Fact]
    public async Task ThreadRoute_Anonymous_Is401_Not404()
    {
        using var factory = new DummyDatabaseFactory(resolveEveryHost: true);
        using var client = factory.CreateClient();

        using var response = await client.GetAsync(new Uri($"/api/threads/{Guid.NewGuid()}", UriKind.Relative));

        response.StatusCode.Should().Be(HttpStatusCode.Unauthorized, "the route exists and the default-deny gate refuses an anonymous caller");
    }

    private static ServiceCollection BaseServices()
    {
        var services = new ServiceCollection();
        services.AddDbContext<PulseDbContext>(options => options.UseSqlServer("Server=nonexistent;Database=pulse;Trusted_Connection=False;"));
        services.AddScoped<IExerciseContext>(_ => new ExerciseContext { CurrentExerciseId = Guid.NewGuid() });
        return services;
    }

    private sealed class RejectEverythingResolver : IReplyParentResolver
    {
        public Task<ReplyParentResult> ResolveAsync(string? parentPostId, CancellationToken cancellationToken)
            => Task.FromResult(new ReplyParentResult(ReplyParentOutcome.NotFound, null));
    }

    /// <summary>Boots the real host with a never-connecting database; it only needs to build.</summary>
    private sealed class DummyDatabaseFactory : WebApplicationFactory<Program>
    {
        private const string ConnectionStringEnvVar = "ConnectionStrings__DefaultConnection";

        private readonly bool _resolveEveryHost;

        public DummyDatabaseFactory(bool resolveEveryHost = false)
        {
            _resolveEveryHost = resolveEveryHost;
            Environment.SetEnvironmentVariable(ConnectionStringEnvVar, "Server=nonexistent;Database=pulse;Trusted_Connection=False;");
        }

        protected override void ConfigureWebHost(IWebHostBuilder builder)
        {
            ArgumentNullException.ThrowIfNull(builder);

            if (_resolveEveryHost)
            {
                // Host resolution would otherwise query the (non-existent) database before the gate runs.
                builder.ConfigureTestServices(services =>
                    services.AddSingleton<IHostExerciseResolver>(new FixedHostResolver(Guid.NewGuid())));
            }
        }

        protected override void Dispose(bool disposing)
        {
            base.Dispose(disposing);
            Environment.SetEnvironmentVariable(ConnectionStringEnvVar, null);
        }
    }

    private sealed class FixedHostResolver : IHostExerciseResolver
    {
        private readonly Guid _exerciseId;

        public FixedHostResolver(Guid exerciseId) => _exerciseId = exerciseId;

        public Task<Guid?> ResolveExerciseIdAsync(string? rawHost, CancellationToken cancellationToken)
            => Task.FromResult<Guid?>(_exerciseId);
    }
}
