namespace Pulse.WebApi.Tests.Features.ExerciseResolution;

using System;
using System.Net;
using System.Net.Http;
using System.Text.Json;
using System.Threading.Tasks;
using FluentAssertions;
using Pulse.WebApi.Data.Entities;
using Pulse.WebApi.Tests.Data;

/// <summary>
/// Story <c>exercise-isolation/08</c> — the <c>GET /api/exercise-context</c> HTTP contract, component-level
/// over a REAL SQL Server (Testcontainers) through the ACTUAL host-resolution pipeline (not a stubbed
/// <c>IExerciseContext</c>). Proves: a resolved host returns exactly the FROZEN four-field
/// <see cref="Features.ExerciseResolution.ExerciseScopeDto"/> shape for THAT exercise — never another one,
/// never a list; and an unresolved host fails closed with <c>404</c> — never a <c>200</c> with empty/default
/// data (COR-004, XC-002).
/// </summary>
[Collection(MsSqlCollection.Name)]
public class ExerciseContextEndpointTests
{
    private readonly MsSqlContainerFixture _fixture;

    public ExerciseContextEndpointTests(MsSqlContainerFixture fixture)
    {
        _fixture = fixture;
    }

    [RequiresDockerFact]
    public async Task ResolvedHost_Returns200_WithTheSeededExercisesScope_NeverAnotherExercisesData()
    {
        var exerciseA = Guid.NewGuid();
        var exerciseB = Guid.NewGuid();
        var hostA = $"host-a-{exerciseA:N}.example.com";
        var hostB = $"host-b-{exerciseB:N}.example.com";

        await SeedExerciseAsync(
            exerciseA, hostA, name: "Atlanta Hurricane Cascade", timeZone: "America/Chicago", status: "scheduled");
        await SeedExerciseAsync(
            exerciseB, hostB, name: "Coastal Cascade Exercise", timeZone: "America/New_York", status: "active");

        await using var testHost = await ExerciseResolutionTestHost.StartAsync(_fixture.ConnectionString!);
        using var client = testHost.CreateClientForHost(hostA);

        var response = await client.GetAsync(new Uri("/api/exercise-context", UriKind.Relative));
        response.StatusCode.Should().Be(HttpStatusCode.OK);

        var body = await response.Content.ReadAsStringAsync();
        using var document = JsonDocument.Parse(body);
        var root = document.RootElement;

        root.ValueKind.Should().Be(
            JsonValueKind.Object, "the resolver returns exactly ONE exercise scope for the resolved host, never a list/array");

        root.GetProperty("exerciseId").GetString().Should().Be(
            exerciseA.ToString(), "the returned exerciseId must be the HOST-resolved exercise, never client-influenced");
        root.GetProperty("exerciseName").GetString().Should().Be("Atlanta Hurricane Cascade");
        root.GetProperty("timeZone").GetString().Should().Be("America/Chicago");
        root.GetProperty("status").GetString().Should().Be(
            "scheduled", "status must pass through verbatim (lowercase ExerciseStatus vocabulary), not a hardcoded default like 'active'");

        body.Should().NotContain(exerciseB.ToString(), "exercise B's id must never appear in exercise A's host-resolved response");
        body.Should().NotContain("Coastal Cascade", "exercise B's name must never appear in exercise A's host-resolved response");
    }

    [RequiresDockerFact]
    public async Task UnknownHost_Returns404_NeverA200WithEmptyOrDefaultData()
    {
        var exerciseA = Guid.NewGuid();
        var hostA = $"host-a-{exerciseA:N}.example.com";
        var unknownHost = $"unprovisioned-{Guid.NewGuid():N}.example.com";

        await SeedExerciseAsync(exerciseA, hostA, name: "Atlanta Hurricane Cascade", timeZone: "America/Chicago", status: "active");

        await using var testHost = await ExerciseResolutionTestHost.StartAsync(_fixture.ConnectionString!);
        using var client = testHost.CreateClientForHost(unknownHost);

        var response = await client.GetAsync(new Uri("/api/exercise-context", UriKind.Relative));

        response.StatusCode.Should().Be(
            HttpStatusCode.NotFound,
            "an unresolved host must fail closed with 404 — never a 200 with empty/default data, and never exercise A's data either");
    }

    private async Task SeedExerciseAsync(Guid id, string hostname, string name, string timeZone, string status)
    {
        await using var seed = _fixture.CreateContext();
        seed.Exercises.Add(new Exercise
        {
            OrganizationId = Organization.DefaultOrganizationId,
            Id = id,
            Name = name,
            Hostname = hostname,
            TimeZone = timeZone,
            Status = status,
        });
        await seed.SaveChangesAsync();
    }
}
