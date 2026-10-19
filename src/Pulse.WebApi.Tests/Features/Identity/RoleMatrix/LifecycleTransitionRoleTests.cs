namespace Pulse.WebApi.Tests.Features.Identity.RoleMatrix;

using System;
using System.Linq;
using System.Net;
using System.Net.Http.Json;
using System.Threading.Tasks;
using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Pulse.WebApi.Data.Entities;
using Pulse.WebApi.Features.ExerciseConfiguration.Lifecycle;
using Pulse.WebApi.Tests.Data;
using Pulse.WebApi.Tests.Features.ExerciseConfiguration.Lifecycle;

/// <summary>
/// identity-auth-roles/17 AC1 (#377/#481) — the lifecycle endpoint checks the role PER TRANSITION, in the relevant
/// lifecycle states, over the real host: stage / archive are the planner's, StartEx / pause / resume / EndEx the
/// controller's, unarchive no in-exercise role's, archive from build only once the exercise has gone live. Every
/// refusal is 403 with the stored state unchanged; every applied transition emits one event carrying the acting person
/// and role.
/// </summary>
[Collection(MsSqlCollection.Name)]
public sealed class LifecycleTransitionRoleTests
{
    private readonly MsSqlContainerFixture _fixture;

    public LifecycleTransitionRoleTests(MsSqlContainerFixture fixture) => _fixture = fixture;

    [RequiresDockerTheory]
    // stage: planner
    [InlineData("build", "staged", MatrixRole.Planner, true)]
    [InlineData("build", "staged", MatrixRole.Controller, false)]
    [InlineData("build", "staged", MatrixRole.LeadController, false)]
    [InlineData("build", "staged", MatrixRole.Evaluator, false)]
    // StartEx: controller
    [InlineData("staged", "live", MatrixRole.Controller, true)]
    [InlineData("staged", "live", MatrixRole.Planner, false)]
    [InlineData("staged", "live", MatrixRole.Evaluator, false)]
    // pause / resume: controller
    [InlineData("live", "paused", MatrixRole.Controller, true)]
    [InlineData("live", "paused", MatrixRole.Planner, false)]
    [InlineData("paused", "live", MatrixRole.LeadController, true)]
    [InlineData("paused", "live", MatrixRole.Planner, false)]
    [InlineData("paused", "live", MatrixRole.Evaluator, false)]
    // EndEx: controller
    [InlineData("live", "completed", MatrixRole.Controller, true)]
    [InlineData("paused", "completed", MatrixRole.Controller, true)]
    [InlineData("live", "completed", MatrixRole.Planner, false)]
    [InlineData("live", "completed", MatrixRole.Evaluator, false)]
    // archive: planner
    [InlineData("completed", "archived", MatrixRole.Planner, true)]
    [InlineData("completed", "archived", MatrixRole.Controller, false)]
    [InlineData("completed", "archived", MatrixRole.Evaluator, false)]
    // unarchive: org admin only — no in-exercise role
    [InlineData("archived", "completed", MatrixRole.Planner, false)]
    [InlineData("archived", "completed", MatrixRole.Controller, false)]
    [InlineData("archived", "build", MatrixRole.Planner, false)]
    // org-scope org admin: no implicit exercise power
    [InlineData("build", "staged", MatrixRole.OrgAdmin, false)]
    [InlineData("live", "paused", MatrixRole.OrgAdmin, false)]
    public async Task Transition_IsAppliedOnlyForItsRole_AndARefusalLeavesTheStateUnchanged(
        string from, string to, MatrixRole role, bool allowed)
    {
        var world = await RoleMatrixWorld.SeedAsync(_fixture, status: from);
        using var host = new RoleMatrixHost(_fixture.ConnectionString!);
        using var client = world.Client(host, await world.TokenForAsync(role));

        using var response = await client.PostAsJsonAsync(LifecycleEndpoints.TransitionRoute, new { to });

        if (allowed)
        {
            response.StatusCode.Should().Be(HttpStatusCode.OK, "{0} may apply {1} -> {2}", role, from, to);
            (await world.ReadStatusAsync()).Should().Be(to);
            await AssertTransitionEventAsync(world, role);
        }
        else
        {
            response.StatusCode.Should().BeOneOf(
                [HttpStatusCode.Forbidden, HttpStatusCode.Unauthorized], "{0} may not apply {1} -> {2}", role, from, to);
            (await world.ReadStatusAsync()).Should().Be(from, "a refused transition changes nothing");
        }
    }

    [RequiresDockerTheory]
    [InlineData("staged", "build", MatrixRole.Planner, MatrixRole.Controller)]       // unstage (body: build-golive 07-08)
    [InlineData("completed", "live", MatrixRole.Controller, MatrixRole.Planner)]     // reopen (body: build-golive 07-08)
    public async Task NotYetBuiltTransitions_AreAlreadyRoleChecked_TheRightRoleReachesTheStateMachine(
        string from, string to, MatrixRole owner, MatrixRole other)
    {
        var world = await RoleMatrixWorld.SeedAsync(_fixture, status: from);
        using var host = new RoleMatrixHost(_fixture.ConnectionString!);

        using var ownerClient = world.Client(host, await world.TokenForAsync(owner));
        using var owned = await ownerClient.PostAsJsonAsync(LifecycleEndpoints.TransitionRoute, new { to });
        owned.StatusCode.Should().Be(HttpStatusCode.Conflict, "the role gate admits {0}; the edge itself is out of scope here", owner);

        using var otherClient = world.Client(host, await world.TokenForAsync(other));
        using var refused = await otherClient.PostAsJsonAsync(LifecycleEndpoints.TransitionRoute, new { to });
        refused.StatusCode.Should().Be(HttpStatusCode.Forbidden);
        (await world.ReadStatusAsync()).Should().Be(from);
    }

    [RequiresDockerFact]
    public async Task ArchiveFromBuild_IsAllowedForThePlannerOnlyOnceTheExerciseHasGoneLive()
    {
        var world = await RoleMatrixWorld.SeedAsync(_fixture, status: "build");
        using var host = new RoleMatrixHost(_fixture.ConnectionString!);

        using var neverRan = world.Client(host, await world.TokenForAsync(MatrixRole.Planner));
        using var refused = await neverRan.PostAsJsonAsync(LifecycleEndpoints.TransitionRoute, new { to = "archived" });
        refused.StatusCode.Should().Be(HttpStatusCode.Conflict, "an exercise that never ran is deleted, not archived");

        await world.SetStatusAsync("build", firstLiveAt: DateTimeOffset.UtcNow.AddDays(-2));

        using var controller = world.Client(host, await world.TokenForAsync(MatrixRole.Controller));
        using var controllerRefused = await controller.PostAsJsonAsync(LifecycleEndpoints.TransitionRoute, new { to = "archived" });
        controllerRefused.StatusCode.Should().Be(HttpStatusCode.Forbidden);

        using var planner = world.Client(host, await world.TokenForAsync(MatrixRole.Planner));
        using var archived = await planner.PostAsJsonAsync(LifecycleEndpoints.TransitionRoute, new { to = "archived" });
        archived.StatusCode.Should().Be(HttpStatusCode.OK, "a reset exercise that ran is retired by archive from build");
        (await world.ReadStatusAsync()).Should().Be("archived");
    }

    [RequiresDockerFact]
    public async Task AnOrgAdmin_ActsInTheExerciseOnlyThroughTheEnrollmentTheyHold()
    {
        var world = await RoleMatrixWorld.SeedAsync(_fixture, status: "build");
        var orgAdmin = world.PersonOf(MatrixRole.OrgAdmin);
        await using (var seed = _fixture.CreateContext())
        {
            seed.Enrollments.Add(new Enrollment
            {
                Id = Guid.NewGuid(),
                ExerciseId = world.ExerciseId,
                PersonId = orgAdmin,
                Role = EnrollmentRoles.Planner,
                CreatedAt = DateTimeOffset.UtcNow,
            });
            await seed.SaveChangesAsync();
        }

        using var host = new RoleMatrixHost(_fixture.ConnectionString!);

        var (_, orgScope) = await world.StaffTokenAsync(orgAdmin, exerciseId: null, "orgAdmin");
        using var orgScopeClient = world.Client(host, orgScope);
        using var refused = await orgScopeClient.PostAsJsonAsync(LifecycleEndpoints.TransitionRoute, new { to = "staged" });
        refused.StatusCode.Should().Be(HttpStatusCode.Unauthorized, "an org-scope session has no exercise scope and no implicit exercise power");

        var (_, enrolled) = await world.StaffTokenAsync(orgAdmin, world.ExerciseId, EnrollmentRoles.Planner);
        using var enrolledClient = world.Client(host, enrolled);
        using var staged = await enrolledClient.PostAsJsonAsync(LifecycleEndpoints.TransitionRoute, new { to = "staged" });
        staged.StatusCode.Should().Be(HttpStatusCode.OK, "holding the planner enrollment, the org admin stages as a planner");
    }

    private async Task AssertTransitionEventAsync(RoleMatrixWorld world, MatrixRole role)
    {
        await using var read = _fixture.CreateContext();
        var events = await read.TelemetryEvents
            .IgnoreQueryFilters()
            .Where(e => e.ExerciseId == world.ExerciseId && e.EventType == "exercise.lifecycle.transitioned")
            .ToListAsync();

        var transition = events.Should().ContainSingle("one XC-004 event per applied transition").Subject;
        transition.Channel.Should().Be("system");
        transition.Actor.ActingHumanId.Should().Be(world.PersonOf(role).ToString(), "the acting PersonId is the session's person");
        transition.Actor.Role.Should().Be(role == MatrixRole.Planner ? "planner" : "controller", "the event carries the actor's role");
        transition.ScenarioTime.Should().NotBe(default);
        transition.WallClockTime.Should().BeCloseTo(DateTimeOffset.UtcNow, TimeSpan.FromMinutes(5));
    }
}
