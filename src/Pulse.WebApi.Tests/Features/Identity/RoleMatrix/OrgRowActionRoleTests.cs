namespace Pulse.WebApi.Tests.Features.Identity.RoleMatrix;

using System;
using System.Linq;
using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using System.Threading.Tasks;
using FluentAssertions;
using Pulse.WebApi.Tests.Data;
using Pulse.WebApi.Tests.Features.ExerciseConfiguration.Lifecycle;

/// <summary>
/// identity-auth-roles/17 — the org-tier rows (§8.2) and the bare-404 pattern (§7.2): create exercise is org admin only;
/// rename / archive are the org admin's and the planner's, a planner only on an exercise they hold a planner enrollment
/// on. A same-org exercise the planner is not enrolled in, another organization's exercise and a missing id all return
/// the same bodiless 404; a controller is refused by the role check, which never looks at the id.
/// </summary>
[Collection(MsSqlCollection.Name)]
public sealed class OrgRowActionRoleTests
{
    private readonly MsSqlContainerFixture _fixture;

    public OrgRowActionRoleTests(MsSqlContainerFixture fixture) => _fixture = fixture;

    [RequiresDockerTheory]
    [InlineData(MatrixRole.OrgAdmin, HttpStatusCode.Created)]
    [InlineData(MatrixRole.Planner, HttpStatusCode.Forbidden)]
    [InlineData(MatrixRole.Controller, HttpStatusCode.Forbidden)]
    [InlineData(MatrixRole.Evaluator, HttpStatusCode.Forbidden)]
    public async Task CreateExercise_IsOrgAdminOnly(MatrixRole role, HttpStatusCode expected)
    {
        var world = await RoleMatrixWorld.SeedAsync(_fixture);
        using var host = new RoleMatrixHost(_fixture.ConnectionString!);
        using var client = world.Client(host, await world.TokenForAsync(role));

        using var response = await client.PostAsJsonAsync("/api/org/exercises", new { name = $"Created by {role}", hostname = $"c-{Guid.NewGuid():N}.example.com" });

        response.StatusCode.Should().Be(expected);
    }

    [RequiresDockerFact]
    public async Task Rename_ByAPlanner_ReachesOnlyTheirOwnExercise_AndEveryOtherIdIsTheSameBare404()
    {
        var world = await RoleMatrixWorld.SeedAsync(_fixture);
        var sibling = await RoleMatrixWorld.SeedAsync(_fixture, organizationId: world.OrganizationId);
        var foreign = await RoleMatrixWorld.SeedAsync(_fixture);
        using var host = new RoleMatrixHost(_fixture.ConnectionString!);
        using var planner = world.Client(host, await world.TokenForAsync(MatrixRole.Planner));

        foreach (var target in new[] { sibling.ExerciseId, foreign.ExerciseId, Guid.NewGuid() })
        {
            using var rename = await planner.PatchAsJsonAsync($"/api/org/exercises/{target}", new { name = "Nope" });
            rename.StatusCode.Should().Be(HttpStatusCode.NotFound, "not-enrolled, foreign-org and missing are one bare 404");
            (await rename.Content.ReadAsStringAsync()).Should().BeEmpty();

            using var archive = await planner.PostAsync($"/api/org/exercises/{target}/archive", content: null);
            archive.StatusCode.Should().Be(HttpStatusCode.NotFound);
            (await archive.Content.ReadAsStringAsync()).Should().BeEmpty();
        }

        using var own = await planner.PatchAsJsonAsync($"/api/org/exercises/{world.ExerciseId}", new { name = "Renamed by its planner" });
        own.StatusCode.Should().Be(HttpStatusCode.OK);

        using var controller = world.Client(host, await world.TokenForAsync(MatrixRole.Controller));
        using var refused = await controller.PatchAsJsonAsync($"/api/org/exercises/{world.ExerciseId}", new { name = "Controller" });
        refused.StatusCode.Should().Be(HttpStatusCode.Forbidden, "a controller may not rename (§8.2)");
    }

    /// <summary>
    /// Gate-1 WR-005: the org exercise list carries <c>canManage</c>, the same rule rename/archive enforce — so the UI
    /// offers Rename/Archive only where the server will honour them. Org admin: every row. Planner: only the exercise
    /// they plan (a same-org sibling they are not enrolled on is false). Controller: none.
    /// </summary>
    [RequiresDockerTheory]
    [InlineData(MatrixRole.OrgAdmin, true, true)]
    [InlineData(MatrixRole.Planner, true, false)]
    [InlineData(MatrixRole.Controller, false, false)]
    public async Task OrgExerciseList_CanManage_FollowsTheRenameArchiveRule(MatrixRole role, bool ownExpected, bool siblingExpected)
    {
        var world = await RoleMatrixWorld.SeedAsync(_fixture);
        var sibling = await RoleMatrixWorld.SeedAsync(_fixture, organizationId: world.OrganizationId);
        using var host = new RoleMatrixHost(_fixture.ConnectionString!);
        using var client = world.Client(host, await world.TokenForAsync(role));

        using var response = await client.GetAsync("/api/org/exercises");

        response.StatusCode.Should().Be(HttpStatusCode.OK);
        using var document = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        var canManage = document.RootElement.EnumerateArray().ToDictionary(
            row => Guid.Parse(row.GetProperty("exerciseId").GetString()!),
            row => row.GetProperty("canManage").GetBoolean());

        canManage.Should().HaveCount(2, "the list is the organization's two exercises");
        canManage[world.ExerciseId].Should().Be(ownExpected, "{0} on the exercise they are enrolled in", role);
        canManage[sibling.ExerciseId].Should().Be(siblingExpected, "{0} on a same-org exercise they are not enrolled in", role);

        // The flag is honest: where it says false, rename is the server's refusal (403 for a controller, the bare 404
        // for a planner); where it says true, rename succeeds.
        using var rename = await client.PatchAsJsonAsync($"/api/org/exercises/{sibling.ExerciseId}", new { name = $"Sibling by {role}" });
        rename.IsSuccessStatusCode.Should().Be(siblingExpected);
    }

    [RequiresDockerFact]
    public async Task Archive_OnTheOrgTier_IsAllowedFromBuildOnceTheExerciseHasGoneLive()
    {
        var world = await RoleMatrixWorld.SeedAsync(_fixture, status: "build");
        using var host = new RoleMatrixHost(_fixture.ConnectionString!);
        using var orgAdmin = world.Client(host, await world.TokenForAsync(MatrixRole.OrgAdmin));

        using var neverRan = await orgAdmin.PostAsync($"/api/org/exercises/{world.ExerciseId}/archive", content: null);
        neverRan.StatusCode.Should().Be(HttpStatusCode.Conflict);

        await world.SetStatusAsync("build", firstLiveAt: DateTimeOffset.UtcNow.AddDays(-3));
        using var archived = await orgAdmin.PostAsync($"/api/org/exercises/{world.ExerciseId}/archive", content: null);
        archived.StatusCode.Should().Be(HttpStatusCode.OK);
        (await world.ReadStatusAsync()).Should().Be("archived");
    }

    [RequiresDockerFact]
    public async Task SetLead_IsPlannerOnly()
    {
        var world = await RoleMatrixWorld.SeedAsync(_fixture);
        using var host = new RoleMatrixHost(_fixture.ConnectionString!);

        foreach (var role in new[] { MatrixRole.OrgAdmin, MatrixRole.Controller, MatrixRole.LeadController, MatrixRole.Evaluator })
        {
            using var client = world.Client(host, await world.TokenForAsync(role));
            using var refused = await client.PutAsync($"/api/staff/enrollments/{world.ControllerEnrollmentId}/lead", content: null);
            refused.StatusCode.Should().BeOneOf([HttpStatusCode.Forbidden, HttpStatusCode.Unauthorized], "{0} may not set the lead", role);
        }

        using var planner = world.Client(host, await world.TokenForAsync(MatrixRole.Planner));
        using var set = await planner.PutAsync($"/api/staff/enrollments/{world.ControllerEnrollmentId}/lead", content: null);
        set.StatusCode.Should().Be(HttpStatusCode.OK);
    }
}
