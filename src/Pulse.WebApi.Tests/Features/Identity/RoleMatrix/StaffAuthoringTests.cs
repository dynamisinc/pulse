namespace Pulse.WebApi.Tests.Features.Identity.RoleMatrix;

using System;
using System.Net;
using System.Net.Http.Json;
using System.Threading.Tasks;
using FluentAssertions;
using Pulse.WebApi.Tests.Data;
using Pulse.WebApi.Tests.Features.ExerciseConfiguration.Lifecycle;

/// <summary>
/// identity-auth-roles/17 Copilot review 5 + 2 folds (ADMIN-IDENTITY-MODEL §8.2): setup authoring vs conduct posting.
/// In <c>build</c> a planner (and a controller) may post as a persona and pin; in staged and live, posting is
/// controller-only; an evaluator never. Participant sim writes are accepted in live AND staged (dry runs).
/// </summary>
[Collection(MsSqlCollection.Name)]
public sealed class StaffAuthoringTests
{
    private readonly MsSqlContainerFixture _fixture;

    public StaffAuthoringTests(MsSqlContainerFixture fixture) => _fixture = fixture;

    [RequiresDockerTheory]
    [InlineData("build", MatrixRole.Planner, true)]
    [InlineData("build", MatrixRole.Controller, true)]
    [InlineData("build", MatrixRole.Evaluator, false)]
    [InlineData("staged", MatrixRole.Planner, false)]
    [InlineData("staged", MatrixRole.Controller, true)]
    [InlineData("live", MatrixRole.Planner, false)]
    [InlineData("live", MatrixRole.Controller, true)]
    [InlineData("live", MatrixRole.Evaluator, false)]
    public async Task StaffPostAsPersona_FollowsSetupVsConduct(string state, MatrixRole role, bool allowed)
    {
        var world = await RoleMatrixWorld.SeedAsync(_fixture, status: state);
        using var host = new RoleMatrixHost(_fixture.ConnectionString!);
        using var client = world.Client(host, await world.TokenForAsync(role));

        using var response = await client.PostAsJsonAsync("/api/posts", new
        {
            origin = "controller-as-persona",
            authorPersonaId = world.PersonaId.ToString(),
            actingHumanId = "ignored-server-stamps-the-session-person",
            timeZone = "UTC",
            text = $"Setup or conduct post as {role} in {state}",
        });

        if (allowed)
        {
            response.StatusCode.Should().Be(HttpStatusCode.Created, "{0} may post as a persona in {1}", role, state);
        }
        else
        {
            response.StatusCode.Should().Be(HttpStatusCode.Forbidden, "{0} may not post as a persona in {1}", role, state);
        }
    }

    [RequiresDockerTheory]
    [InlineData("build", MatrixRole.Planner, true)]
    [InlineData("live", MatrixRole.Planner, false)]
    [InlineData("live", MatrixRole.Controller, true)]
    [InlineData("build", MatrixRole.Evaluator, false)]
    public async Task StaffPin_FollowsSetupVsConduct(string state, MatrixRole role, bool allowed)
    {
        var world = await RoleMatrixWorld.SeedAsync(_fixture, status: state);
        using var host = new RoleMatrixHost(_fixture.ConnectionString!);
        using var client = world.Client(host, await world.TokenForAsync(role));

        using var response = await client.PutAsync($"/api/staff/posts/{Guid.NewGuid()}/pin", content: null);

        if (allowed)
        {
            response.StatusCode.Should().NotBe(HttpStatusCode.Forbidden).And.NotBe(HttpStatusCode.Unauthorized);
        }
        else
        {
            response.StatusCode.Should().Be(HttpStatusCode.Forbidden);
        }
    }

    [RequiresDockerTheory]
    [InlineData("live", MatrixRole.Participant)]
    [InlineData("staged", MatrixRole.Participant)]
    [InlineData("live", MatrixRole.Pio)]
    [InlineData("staged", MatrixRole.Pio)]
    public async Task ParticipantSimPost_IsAcceptedInLiveAndStaged(string state, MatrixRole role)
    {
        var world = await RoleMatrixWorld.SeedAsync(_fixture, status: state);
        using var host = new RoleMatrixHost(_fixture.ConnectionString!);
        using var client = world.Client(host, await world.TokenForAsync(role));

        using var response = await client.PostAsJsonAsync("/api/posts", new { text = $"A {role} post during {state}", timeZone = "UTC" });

        response.StatusCode.Should().Be(HttpStatusCode.Created, "participant sim writes are allowed in live and in staged dry runs");
    }
}
