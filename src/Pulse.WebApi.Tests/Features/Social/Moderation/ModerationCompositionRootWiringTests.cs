namespace Pulse.WebApi.Tests.Features.Social.Moderation;

using System;
using System.Linq;
using System.Net;
using System.Threading.Tasks;
using FluentAssertions;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.Routing;
using Microsoft.Extensions.DependencyInjection;
using Pulse.WebApi.Features.Social.Moderation;
using Pulse.WebApi.Tests.Data;
using Xunit;

/// <summary>
/// Composition-root guard for the takedown slice (demo-polish B6; implementation.md §4.2, the #310→#317 lesson):
/// <c>Program.cs</c> really maps <c>DELETE /api/staff/posts/{postId:guid}</c> exactly once and the handler's
/// service resolves from the real container. Docker-free: building the host needs no database. The live 401 probe
/// is <see cref="ModerationRouteLivenessTests"/>.
/// </summary>
public sealed class ModerationCompositionRootWiringTests
{
    [Fact]
    public void ProgramCs_MapsTheTakedownRouteExactlyOnce_AndResolvesItsService()
    {
        using var factory = new WiringProbeFactory();

        var dataSource = factory.Services.GetRequiredService<EndpointDataSource>();
        var matches = dataSource.Endpoints
            .OfType<RouteEndpoint>()
            .Count(endpoint =>
                string.Equals(endpoint.RoutePattern.RawText, ModerationEndpoints.TakedownRoute, StringComparison.OrdinalIgnoreCase)
                && (endpoint.Metadata.GetMetadata<HttpMethodMetadata>()?.HttpMethods.Contains("DELETE") ?? false));

        matches.Should().Be(1, "Program.cs must map DELETE /api/staff/posts/{postId:guid} exactly once (MapSocialModerationEndpoints)");

        using var scope = factory.Services.CreateScope();
        scope.ServiceProvider.GetRequiredService<PostTakedownService>().Should().NotBeNull(
            "AddSocialModeration must be reached from Program.cs; a mapped route whose service is missing 500s on first use");
    }

    /// <summary>Boots the real <c>Program</c> host with a never-connecting connection string, enough to enumerate endpoints.</summary>
    private sealed class WiringProbeFactory : WebApplicationFactory<Program>
    {
        private const string ConnectionStringEnvVar = "ConnectionStrings__DefaultConnection";
        private const string DummyConnectionString = "Server=nonexistent;Database=pulse;Trusted_Connection=False;";

        public WiringProbeFactory() => Environment.SetEnvironmentVariable(ConnectionStringEnvVar, DummyConnectionString);

        protected override void Dispose(bool disposing)
        {
            base.Dispose(disposing);
            Environment.SetEnvironmentVariable(ConnectionStringEnvVar, null);
        }
    }
}

/// <summary>
/// The other half of the composition-root guard: against the real database, the mapped takedown route answers 401
/// (not 404) to an unauthenticated caller, with nothing in Program.cs overridden.
/// </summary>
[Collection(MsSqlCollection.Name)]
public sealed class ModerationRouteLivenessTests
{
    private readonly ModerationSeeder _seed;

    public ModerationRouteLivenessTests(MsSqlContainerFixture fixture) => _seed = new ModerationSeeder(fixture);

    [RequiresDockerFact]
    public async Task ProgramCs_TakedownRoute_Answers401Unauthenticated_Not404()
    {
        var exercise = await _seed.SeedExerciseAsync();
        var postId = await _seed.SeedPostAsync(exercise.Id);

        // Nothing overridden: the real broadcaster and the real pipeline.
        using var factory = new ModerationWebApplicationFactory(_seed.ConnectionString, useRealBroadcaster: true);
        using var client = factory.CreateClientFor(exercise.Host, bearerToken: null);

        var response = await client.DeleteAsync(new Uri($"/api/staff/posts/{postId}", UriKind.Relative));

        response.StatusCode.Should().Be(
            HttpStatusCode.Unauthorized, "the route exists (a dead mapping would 404) and refuses an unauthenticated caller");
        (await _seed.ReadSurvivingPostAsync(postId)).DeletedAt.Should().BeNull();
    }
}
