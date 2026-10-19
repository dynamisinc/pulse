namespace Pulse.WebApi.Tests.Features.Identity.RoleMatrix;

using System.Linq;
using System.Net;
using System.Text.Json;
using System.Threading.Tasks;
using FluentAssertions;
using Pulse.WebApi.Data.Entities;
using Pulse.WebApi.Features.ExerciseConfiguration.Readiness;
using Pulse.WebApi.Tests.Data;
using Pulse.WebApi.Tests.Features.ExerciseConfiguration.Lifecycle;
using Pulse.WebApi.Tests.Helpers;

/// <summary>
/// exercise-build-golive/03 (ADMIN-IDENTITY-MODEL §8.2 "read everything in the exercise"): <c>GET /api/staff/readiness</c>
/// over the REAL <c>Program</c> host and real sessions. Planner, controller (lead or not) and evaluator read it; org-scope,
/// participant, pio, view-only and anonymous callers are refused. A read route, so it is a focused suite here rather than
/// a row in <see cref="RoleMatrixTests"/>, whose matrix enumerates mutating routes only.
/// </summary>
[Collection(MsSqlCollection.Name)]
public sealed class ReadinessRoleTests
{
    private readonly MsSqlContainerFixture _fixture;

    public ReadinessRoleTests(MsSqlContainerFixture fixture) => _fixture = fixture;

    [RequiresDockerTheory]
    [InlineData(MatrixRole.Planner, HttpStatusCode.OK)]
    [InlineData(MatrixRole.Controller, HttpStatusCode.OK)]
    [InlineData(MatrixRole.LeadController, HttpStatusCode.OK)]
    [InlineData(MatrixRole.Evaluator, HttpStatusCode.OK)]
    [InlineData(MatrixRole.OrgAdmin, HttpStatusCode.Unauthorized)]
    [InlineData(MatrixRole.Participant, HttpStatusCode.Unauthorized)]
    [InlineData(MatrixRole.Pio, HttpStatusCode.Unauthorized)]
    [InlineData(MatrixRole.ReadOnly, HttpStatusCode.Unauthorized)]
    [InlineData(MatrixRole.Anonymous, HttpStatusCode.Unauthorized)]
    public async Task Readiness_AnswersEachRoleAsTheMatrixSays(MatrixRole role, HttpStatusCode expected)
    {
        var world = await RoleMatrixWorld.SeedAsync(_fixture, status: "build");
        using var host = new RoleMatrixHost(_fixture.ConnectionString!);
        using var client = world.Client(host, await world.TokenForAsync(role));

        using var response = await client.GetAsync(ReadinessEndpoints.ReadinessRoute);

        response.StatusCode.Should().Be(
            expected,
            expected == HttpStatusCode.OK
                ? "{0} may read the exercise's readiness"
                : "{0} must be refused the staff readiness read with exactly this status",
            role);
    }

    /// <summary>
    /// A staff session that POINTS at this exercise but carries no enrollment in it — either a staff human with no
    /// enrollment anywhere, or one enrolled (as planner) only in another exercise of the same organization — is refused.
    /// The session's role claim is never trusted on its own.
    /// </summary>
    [RequiresDockerTheory]
    [InlineData(false)]
    [InlineData(true)]
    public async Task Readiness_RefusesAStaffSessionOnThisExercise_WithNoEnrollmentInIt(bool enrolledElsewhere)
    {
        var world = await RoleMatrixWorld.SeedAsync(_fixture, status: "build");
        Guid personId;
        if (enrolledElsewhere)
        {
            var other = await RoleMatrixWorld.SeedAsync(_fixture, status: "build", organizationId: world.OrganizationId);
            personId = other.PersonOf(MatrixRole.Planner);
        }
        else
        {
            personId = Guid.NewGuid();
            await using var seed = _fixture.CreateContext();
            seed.StaffUsers.Add(StaffTenantSeed.StaffUserFor(personId, world.OrganizationId));
            await seed.SaveChangesAsync();
        }

        var (_, token) = await world.StaffTokenAsync(personId, world.ExerciseId, EnrollmentRoles.Planner);
        using var host = new RoleMatrixHost(_fixture.ConnectionString!);
        using var client = world.Client(host, token);

        using var response = await client.GetAsync(ReadinessEndpoints.ReadinessRoute);

        response.StatusCode.Should().Be(
            HttpStatusCode.Forbidden, "a session naming this exercise is not an enrollment in it");
    }

    [RequiresDockerFact]
    public async Task Readiness_ServesTheContractShape_ForTheSessionsOwnExercise()
    {
        var world = await RoleMatrixWorld.SeedAsync(_fixture, status: "build");
        using var host = new RoleMatrixHost(_fixture.ConnectionString!);
        using var client = world.Client(host, await world.TokenForAsync(MatrixRole.Planner));

        using var response = await client.GetAsync(ReadinessEndpoints.ReadinessRoute);
        response.StatusCode.Should().Be(HttpStatusCode.OK);

        using var body = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        var root = body.RootElement;
        root.GetProperty("lifecycleState").GetString().Should().Be("build");
        root.GetProperty("ready").GetBoolean().Should().BeFalse(
            "the matrix world has no participant account and no view-only code, so participant access is open");

        var blocking = root.GetProperty("blocking").EnumerateArray().ToList();
        blocking.Select(i => i.GetProperty("id").GetString()).Should().Equal(
            "controller-enrolled", "participant-name", "participant-access", "personas-bound", "sign-in-methods",
            "schedule-set", "chrome-valid", "run-sheet-repair");
        root.GetProperty("warnings").EnumerateArray().Select(i => i.GetProperty("id").GetString()).Should().Equal(
            "run-sheet-items", "opening-feed", "noise-pool", "persona-avatars", "sign-in-issued", "evaluator-enrolled",
            "lead-controller");

        var controller = blocking[0];
        controller.GetProperty("status").GetString().Should().Be("ok", "the world's own controllers are enrolled");
        controller.GetProperty("detail").ValueKind.Should().Be(JsonValueKind.Null, "detail is null (not omitted) when ok");
        controller.GetProperty("label").GetString().Should().NotBeNullOrWhiteSpace();
        blocking[1].GetProperty("status").GetString().Should().Be("notChecked");
        blocking[2].GetProperty("status").GetString().Should().Be("open");
    }
}
