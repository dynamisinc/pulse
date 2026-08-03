namespace Pulse.WebApi.Tests.Features.ExerciseResolution;

using System;
using System.Collections.Generic;
using System.Net;
using System.Net.Http;
using System.Text.Json;
using System.Threading.Tasks;
using FluentAssertions;
using Pulse.WebApi.Data.Entities;
using Pulse.WebApi.Tests.Data;

/// <summary>
/// Story <c>exercise-isolation/08</c> — the standing isolation suite's host-resolution entry
/// (<c>exercise-isolation/07-isolation-test-suite</c>, COR-007), proven component-level over a REAL SQL
/// Server (Testcontainers) through the ACTUAL <see cref="Features.ExerciseResolution.ExerciseResolutionMiddleware"/>
/// and the request-scoped <c>PulseDbContext</c> read path — not a stubbed <c>IHostExerciseResolver</c> or a
/// hand-built <c>IExerciseContext</c>. Two invariants, both against the same seeded exercises A and B:
/// <list type="bullet">
///   <item><description>a request resolved to exercise A's host sees ONLY A's scoped rows, never B's — the
///   "A-host request → B rows = empty" case, extended here from a stubbed resolver
///   (<c>ExerciseResolutionMiddlewareTests</c>) and a DbContext-level scope
///   (<c>QueryFilterIsolationTests</c>) to the REAL host → middleware → scoped-read pipeline end to end; and
///   this same assertion also PROVES the middleware's scope write lands before the endpoint's
///   <c>PulseDbContext</c> is constructed — if that ordering were wrong, A's own request would wrongly see
///   zero rows too, exactly like the unknown-host case below;</description></item>
///   <item><description>a request on an unknown/spoofed host sees ZERO rows of EITHER exercise — fail
///   closed to the central query filter's <see cref="Guid.Empty"/> floor, never "all exercises" or a
///   default/first exercise.</description></item>
/// </list>
/// </summary>
[Collection(MsSqlCollection.Name)]
public class ExerciseResolutionIsolationTests
{
    private readonly MsSqlContainerFixture _fixture;

    public ExerciseResolutionIsolationTests(MsSqlContainerFixture fixture)
    {
        _fixture = fixture;
    }

    [RequiresDockerFact]
    public async Task HostA_Request_SeesOnlyExerciseARows_NeverExerciseBRows()
    {
        var exerciseA = Guid.NewGuid();
        var exerciseB = Guid.NewGuid();
        var hostA = $"host-a-{exerciseA:N}.example.com";
        var hostB = $"host-b-{exerciseB:N}.example.com";
        var postA = Guid.NewGuid();
        var postB = Guid.NewGuid();

        await SeedExerciseAsync(exerciseA, hostA);
        await SeedExerciseAsync(exerciseB, hostB);
        await SeedPostAsync(postA, exerciseA);
        await SeedPostAsync(postB, exerciseB);

        await using var testHost = await ExerciseResolutionTestHost.StartAsync(_fixture.ConnectionString!);
        using var client = testHost.CreateClientForHost(hostA);

        var response = await client.GetAsync(new Uri("/test/posts", UriKind.Relative));
        response.StatusCode.Should().Be(HttpStatusCode.OK);

        var ids = await ParseIdsAsync(response);

        ids.Should().Contain(
            postA.ToString(),
            "a request resolved to exercise A's host must see A's own post — and, since this is the SAME " +
            "scoped read an unresolved host also exercises, proves the middleware's scope write reaches the " +
            "endpoint's lazily-constructed PulseDbContext (the throwaway-scope ordering decision)");
        ids.Should().NotContain(
            postB.ToString(),
            "extends exercise-isolation/07's standing suite through the REAL host-resolution pipeline: an " +
            "A-host request must NEVER return exercise B's rows");
    }

    [RequiresDockerFact]
    public async Task UnknownHost_Request_SeesZeroRows_OfEitherExercise_FailClosed()
    {
        var exerciseA = Guid.NewGuid();
        var exerciseB = Guid.NewGuid();
        var hostA = $"host-a-{exerciseA:N}.example.com";
        var hostB = $"host-b-{exerciseB:N}.example.com";
        var postA = Guid.NewGuid();
        var postB = Guid.NewGuid();
        var unknownHost = $"unprovisioned-{Guid.NewGuid():N}.example.com";

        await SeedExerciseAsync(exerciseA, hostA);
        await SeedExerciseAsync(exerciseB, hostB);
        await SeedPostAsync(postA, exerciseA);
        await SeedPostAsync(postB, exerciseB);

        await using var testHost = await ExerciseResolutionTestHost.StartAsync(_fixture.ConnectionString!);
        using var client = testHost.CreateClientForHost(unknownHost);

        var response = await client.GetAsync(new Uri("/test/posts", UriKind.Relative));
        response.StatusCode.Should().Be(
            HttpStatusCode.OK, "the test endpoint itself always answers 200 — the isolation happens INSIDE the scoped read, not as an HTTP-level rejection");

        var ids = await ParseIdsAsync(response);

        ids.Should().BeEmpty(
            "an unresolved/spoofed host must leave the scope unset, which fails closed to ZERO rows via the " +
            "central query filter's Guid.Empty floor — never a default/first/'all exercises' result, and " +
            "never exercise A's or exercise B's rows");
    }

    private static async Task<List<string>> ParseIdsAsync(HttpResponseMessage response)
    {
        var body = await response.Content.ReadAsStringAsync();
        using var document = JsonDocument.Parse(body);

        var ids = new List<string>();
        foreach (var element in document.RootElement.EnumerateArray())
        {
            ids.Add(element.GetString()!);
        }

        return ids;
    }

    private async Task SeedExerciseAsync(Guid id, string hostname)
    {
        await using var seed = _fixture.CreateContext();
        seed.Exercises.Add(new Exercise
        {
            OrganizationId = Organization.DefaultOrganizationId,
            Id = id,
            Name = $"Exercise {id:N}",
            Hostname = hostname,
            TimeZone = "America/New_York",
            Status = "active",
        });
        await seed.SaveChangesAsync();
    }

    private async Task SeedPostAsync(Guid id, Guid exerciseId)
    {
        await using var seed = _fixture.CreateContext();
        seed.Posts.Add(new Post
        {
            Id = id,
            ExerciseId = exerciseId,
            AuthorPersonaId = Guid.NewGuid(),
            Body = $"Post {id:N}",
            CreatedScenarioTime = DateTimeOffset.UtcNow,
            Origin = "participant",
            ActingHumanId = "human-test",
            CreatedWallClock = new DateTimeOffset(2033, 9, 4, 13, 15, 0, TimeSpan.Zero),
        });
        await seed.SaveChangesAsync();
    }
}
