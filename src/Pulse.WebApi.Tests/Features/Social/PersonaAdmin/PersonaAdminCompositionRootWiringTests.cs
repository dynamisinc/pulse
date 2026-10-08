namespace Pulse.WebApi.Tests.Features.Social.PersonaAdmin;

using System;
using System.Linq;
using System.Net;
using System.Threading.Tasks;
using FluentAssertions;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.Routing;
using Microsoft.Extensions.DependencyInjection;
using Pulse.WebApi.Features.Social.PersonaAdmin;
using Pulse.WebApi.Tests.Data;
using Xunit;
using static Pulse.WebApi.Tests.Features.Social.PersonaAdmin.PersonaAdminHttp;

/// <summary>
/// Composition-root guard for the persona edit slice (demo-polish PE-BE; implementation.md §4.2, the #310→#317
/// lesson): <c>Program.cs</c> really maps <c>PATCH /api/staff/personas/{personaId:guid}</c> exactly once and the
/// handler's service resolves from the real container. Docker-free: building the host needs no database. The live
/// 401 probe is <see cref="PersonaAdminRouteLivenessTests"/>.
/// </summary>
public sealed class PersonaAdminCompositionRootWiringTests
{
    [Fact]
    public void ProgramCs_MapsThePersonaPatchRouteExactlyOnce_AndResolvesItsService()
    {
        using var factory = new WiringProbeFactory();

        var dataSource = factory.Services.GetRequiredService<EndpointDataSource>();
        var matches = dataSource.Endpoints
            .OfType<RouteEndpoint>()
            .Count(endpoint =>
                string.Equals(endpoint.RoutePattern.RawText, PersonaAdminEndpoints.PersonaRoute, StringComparison.OrdinalIgnoreCase)
                && (endpoint.Metadata.GetMetadata<HttpMethodMetadata>()?.HttpMethods.Contains("PATCH") ?? false));

        matches.Should().Be(1, "Program.cs must map PATCH /api/staff/personas/{personaId:guid} exactly once (MapPersonaAdminEndpoints)");

        using var scope = factory.Services.CreateScope();
        scope.ServiceProvider.GetRequiredService<PersonaProfileEditService>().Should().NotBeNull(
            "AddPersonaAdmin must be reached from Program.cs; a mapped route whose service is missing 500s on first use");
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
/// The other half of the composition-root guard: against the real database, with NOTHING in <c>Program.cs</c>
/// overridden (the real signer included), the mapped route answers 401 (not 404) to an unauthenticated caller, and
/// an assigned controller's edit round-trips.
/// </summary>
[Collection(MsSqlCollection.Name)]
public sealed class PersonaAdminRouteLivenessTests
{
    private readonly PersonaAdminSeeder _seed;

    public PersonaAdminRouteLivenessTests(MsSqlContainerFixture fixture) => _seed = new PersonaAdminSeeder(fixture);

    [RequiresDockerFact]
    public async Task ProgramCs_PersonaPatchRoute_Answers401Unauthenticated_Not404()
    {
        var exercise = await _seed.SeedExerciseAsync();
        var personaId = await _seed.SeedPersonaAsync(exercise.Id);
        var before = await _seed.ReadPersonaAsync(personaId);

        await using var factory = new UnmodifiedHostFactory(_seed.ConnectionString);
        using var client = factory.CreateClient(new WebApplicationFactoryClientOptions { BaseAddress = new Uri($"http://{exercise.Host}") });

        var response = await PatchAsync(client, personaId, """{ "displayName": "Should not apply" }""");

        response.StatusCode.Should().Be(
            HttpStatusCode.Unauthorized, "the route exists (a dead mapping would 404) and refuses an unauthenticated caller");
        (await _seed.ReadPersonaAsync(personaId)).DisplayName.Should().Be(before.DisplayName);
    }

    [RequiresDockerFact]
    public async Task ProgramCs_IntegratedHost_ControllerEditRoundTrips_WithTheRealSigner()
    {
        var exercise = await _seed.SeedExerciseAsync();
        var personaId = await _seed.SeedPersonaAsync(exercise.Id);
        var avatar = await _seed.SeedMediaAsync(exercise.Id);
        var controller = await _seed.SeedControllerSessionAsync(exercise.Id);

        await using var factory = new UnmodifiedHostFactory(_seed.ConnectionString);
        using var client = factory.CreateClient(new WebApplicationFactoryClientOptions { BaseAddress = new Uri($"http://{exercise.Host}") });
        client.DefaultRequestHeaders.Authorization = new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", controller);

        var response = await PatchAsync(client, personaId, $$"""{ "displayName": "Wired", "avatarMediaId": "{{avatar}}" }""");

        // Whatever the host's signer does with the asset (sign it, or fail and be absorbed), the edit is a 200.
        response.StatusCode.Should().Be(HttpStatusCode.OK);
        (await ReadObjectAsync(response)).GetProperty("displayName").GetString().Should().Be("Wired");
        (await _seed.ReadPersonaAsync(personaId)).AvatarMediaId.Should().Be(avatar);
    }

    /// <summary>The real <c>Program</c> host over the shared database with nothing replaced.</summary>
    private sealed class UnmodifiedHostFactory : WebApplicationFactory<Program>
    {
        private const string ConnectionStringEnvVar = "ConnectionStrings__DefaultConnection";

        public UnmodifiedHostFactory(string connectionString) =>
            Environment.SetEnvironmentVariable(ConnectionStringEnvVar, connectionString);

        protected override void Dispose(bool disposing)
        {
            base.Dispose(disposing);
            Environment.SetEnvironmentVariable(ConnectionStringEnvVar, null);
        }
    }
}
