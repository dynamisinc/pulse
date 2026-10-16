namespace Pulse.WebApi.Tests.Features.ExerciseLifecycleAdmin;

using System;
using System.Linq;
using System.Net;
using System.Net.Http;
using System.Net.Http.Json;
using System.Text.Json;
using System.Threading.Tasks;
using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Pulse.WebApi.Features.ExerciseConfiguration;
using Pulse.WebApi.Features.ExerciseLifecycleAdmin;
using Pulse.WebApi.Tests.Data;
using Xunit;

/// <summary>
/// demo-feedback story 22 (DF-35): the org exercise row actions <b>rename</b>
/// (<c>PATCH /api/org/exercises/{exerciseId}</c>) and <b>archive</b> (<c>POST .../archive</c>), driven over the REAL
/// <c>Program</c> pipeline against real SQL with the adversarial two-customer <see cref="OrgAdminTestWorld"/>.
/// The foreign-tenant refusal of every id-bearing org route is proven separately and generically in
/// <see cref="OrgExerciseByIdIsolationTests"/>.
/// </summary>
[Collection(MsSqlCollection.Name)]
public sealed class ExerciseManagementEndpointTests
{
    private readonly MsSqlContainerFixture _fixture;

    /// <summary>Creates the suite over the shared real-SQL fixture.</summary>
    /// <param name="fixture">The shared migrated database.</param>
    public ExerciseManagementEndpointTests(MsSqlContainerFixture fixture) => _fixture = fixture;

    // ---------------------------------------------------------------- rename

    /// <summary>
    /// AC rename, as narrowed by identity-auth-roles/17 (§8.2): the org admin and the exercise's own planner rename it;
    /// the controller is refused (<see cref="Rename_ByAController_Is403_AndChangesNothing"/>).
    /// </summary>
    [RequiresDockerFact]
    public async Task Rename_ByEachAdministratorRole_RenamesTheExercise_AndEmitsOneRenamedEventWithNoText()
    {
        foreach (var role in new[] { ExerciseAdminRoles.Planner, ExerciseAdminRoles.OrgAdmin })
        {
            var world = await OrgAdminTestWorld.SeedAsync(_fixture, role);
            await using var factory = new OrgAdminProbeFactory(_fixture.ConnectionString!);
            using var client = OrgAdminTestWorld.CreateClient(factory, world.Token);

            var response = await client.PatchAsJsonAsync(ByIdUri(world.OwnExercise.Id), new { name = "  Renamed Run  " });

            response.StatusCode.Should().Be(HttpStatusCode.OK, "{0} may rename (§8.2)", role);
            var row = await response.Content.ReadFromJsonAsync<OrgExerciseWire>();
            row!.ExerciseId.Should().Be(world.OwnExercise.Id.ToString());
            row.Name.Should().Be("Renamed Run", "the settings rule trims");
            row.Status.Should().Be("live", "rename changes the name and nothing else");

            await using var read = _fixture.CreateContext();
            (await read.Exercises.AsNoTracking().SingleAsync(e => e.Id == world.OwnExercise.Id)).Name
                .Should().Be("Renamed Run");

            var events = await read.TelemetryEvents.IgnoreQueryFilters().AsNoTracking()
                .Where(e => e.ExerciseId == world.OwnExercise.Id && e.EventType == "exercise.renamed")
                .ToListAsync();
            var renamed = events.Should().ContainSingle("one action, one event").Which;
            renamed.Actor.ActingHumanId.Should().Be(world.CallerStaffUserId.ToString());
            renamed.Payload.Should().NotContain("Renamed", "telemetry carries counts only, never the name");
            renamed.Payload.Should().NotContain(world.OwnExercise.Name);
        }
    }

    /// <summary>identity-auth-roles/17 (§8.2, deliberate narrowing of DF-20): a controller may not rename or archive.</summary>
    [RequiresDockerFact]
    public async Task Rename_ByAController_Is403_AndChangesNothing()
    {
        var world = await OrgAdminTestWorld.SeedAsync(_fixture, ExerciseAdminRoles.Controller);
        await using var factory = new OrgAdminProbeFactory(_fixture.ConnectionString!);
        using var client = OrgAdminTestWorld.CreateClient(factory, world.Token);

        var rename = await client.PatchAsJsonAsync(ByIdUri(world.OwnExercise.Id), new { name = "Controller Rename" });
        rename.StatusCode.Should().Be(HttpStatusCode.Forbidden);

        await SetStatusAsync(world.OwnExercise.Id, "completed");
        var archive = await client.PostAsync(ArchiveUri(world.OwnExercise.Id), content: null);
        archive.StatusCode.Should().Be(HttpStatusCode.Forbidden);

        await using var read = _fixture.CreateContext();
        var row = await read.Exercises.AsNoTracking().SingleAsync(e => e.Id == world.OwnExercise.Id);
        row.Name.Should().Be(world.OwnExercise.Name);
        row.Status.Should().Be("completed");
    }

    /// <summary>AC rename: the settings name validator is reused — the same inputs pass and fail with the same reasons.</summary>
    [RequiresDockerFact]
    public async Task Rename_ReusesTheSettingsNameValidator_SameLengthAndBlankRules()
    {
        var world = await OrgAdminTestWorld.SeedAsync(_fixture, ExerciseAdminRoles.Planner);
        await using var factory = new OrgAdminProbeFactory(_fixture.ConnectionString!);
        using var client = OrgAdminTestWorld.CreateClient(factory, world.Token);

        string?[] rejected = [null, string.Empty, "   ", "<b></b>", new string('x', ExerciseSettingsFieldRules.MaxNameLength + 1)];
        foreach (var name in rejected)
        {
            ExerciseSettingsFieldRules.TryNormalizeName(name, out _, out var expectedError).Should().BeFalse();

            var response = await client.PatchAsJsonAsync(ByIdUri(world.OwnExercise.Id), new { name });

            response.StatusCode.Should().Be(HttpStatusCode.BadRequest, "'{0}' fails the settings name rule", name);
            (await response.Content.ReadFromJsonAsync<string>()).Should().Be(
                expectedError, "the reason is the settings rule's own, verbatim");
        }

        var noBody = await client.PatchAsync(ByIdUri(world.OwnExercise.Id), JsonContent.Create<object?>(null));
        noBody.StatusCode.Should().Be(HttpStatusCode.BadRequest);

        var longest = new string('y', ExerciseSettingsFieldRules.MaxNameLength);
        (await client.PatchAsJsonAsync(ByIdUri(world.OwnExercise.Id), new { name = longest })).StatusCode
            .Should().Be(HttpStatusCode.OK, "exactly the maximum length is accepted");

        var stripped = await client.PatchAsJsonAsync(ByIdUri(world.OwnExercise.Id), new { name = "<script>x</script>Harbor <b>Two</b>" });
        stripped.StatusCode.Should().Be(HttpStatusCode.OK);
        ExerciseSettingsFieldRules.TryNormalizeName("<script>x</script>Harbor <b>Two</b>", out var expected, out _).Should().BeTrue();
        (await stripped.Content.ReadFromJsonAsync<OrgExerciseWire>())!.Name.Should().Be(expected, "markup is stripped on ingest (NFR-004)");

        await using var read = _fixture.CreateContext();
        (await read.TelemetryEvents.IgnoreQueryFilters().AsNoTracking()
            .CountAsync(e => e.ExerciseId == world.OwnExercise.Id && e.EventType == "exercise.renamed"))
            .Should().Be(2, "only the two accepted renames emitted; a refused one emits nothing");
    }

    /// <summary>AC rename: outside the caller's organization is a 404, and the other customer's row is untouched.</summary>
    [RequiresDockerFact]
    public async Task Rename_AnotherCustomersExercise_Is404_AndChangesNothing()
    {
        var world = await OrgAdminTestWorld.SeedAsync(_fixture, ExerciseAdminRoles.OrgAdmin);
        await using var factory = new OrgAdminProbeFactory(_fixture.ConnectionString!);
        using var client = OrgAdminTestWorld.CreateClient(factory, world.Token);

        var response = await client.PatchAsJsonAsync(ByIdUri(world.OtherExercise.Id), new { name = "Hijacked" });

        response.StatusCode.Should().Be(HttpStatusCode.NotFound, "never 403: that would confirm the exercise exists");
        await using var read = _fixture.CreateContext();
        (await read.Exercises.AsNoTracking().SingleAsync(e => e.Id == world.OtherExercise.Id)).Name
            .Should().Be(world.OtherExercise.Name);
        (await read.TelemetryEvents.IgnoreQueryFilters().AsNoTracking()
            .CountAsync(e => e.ExerciseId == world.OtherExercise.Id && e.EventType == "exercise.renamed"))
            .Should().Be(0);
    }

    /// <summary>AC rename + cross-cutting: an evaluator is refused (403) and no session at all is 401.</summary>
    [RequiresDockerFact]
    public async Task Rename_IsRefusedForAnEvaluator_AndForNoSession()
    {
        var world = await OrgAdminTestWorld.SeedAsync(_fixture, ExerciseAdminRoles.Evaluator);
        await using var factory = new OrgAdminProbeFactory(_fixture.ConnectionString!);
        using var evaluator = OrgAdminTestWorld.CreateClient(factory, world.Token);
        using var anonymous = factory.CreateClient();

        (await evaluator.PatchAsJsonAsync(ByIdUri(world.OwnExercise.Id), new { name = "Nope" })).StatusCode
            .Should().Be(HttpStatusCode.Forbidden, "the evaluator is outside the DF-20 set");
        (await anonymous.PatchAsJsonAsync(ByIdUri(world.OwnExercise.Id), new { name = "Nope" })).StatusCode
            .Should().Be(HttpStatusCode.Unauthorized);

        await using var read = _fixture.CreateContext();
        (await read.Exercises.AsNoTracking().SingleAsync(e => e.Id == world.OwnExercise.Id)).Name
            .Should().Be(world.OwnExercise.Name);
    }

    // ---------------------------------------------------------------- archive

    /// <summary>AC archive: completed → archived through the lifecycle service, with both events in one unit of work.</summary>
    [RequiresDockerFact]
    public async Task Archive_ACompletedExercise_ArchivesIt_AndEmitsExerciseArchived()
    {
        // identity-auth-roles/17: archive is the planner's or the org admin's (was a controller under DF-20).
        var world = await OrgAdminTestWorld.SeedAsync(_fixture, ExerciseAdminRoles.Planner);
        await SetStatusAsync(world.OwnExercise.Id, "completed");
        await using var factory = new OrgAdminProbeFactory(_fixture.ConnectionString!);
        using var client = OrgAdminTestWorld.CreateClient(factory, world.Token);

        var response = await client.PostAsync(ArchiveUri(world.OwnExercise.Id), content: null);

        response.StatusCode.Should().Be(HttpStatusCode.OK);
        (await response.Content.ReadFromJsonAsync<OrgExerciseWire>())!.Status.Should().Be("archived");

        await using var read = _fixture.CreateContext();
        (await read.Exercises.AsNoTracking().SingleAsync(e => e.Id == world.OwnExercise.Id)).Status
            .Should().Be("archived");

        var events = await read.TelemetryEvents.IgnoreQueryFilters().AsNoTracking()
            .Where(e => e.ExerciseId == world.OwnExercise.Id)
            .Select(e => e.EventType)
            .ToListAsync();
        events.Should().ContainSingle(type => type == "exercise.archived");
        events.Should().ContainSingle(
            type => type == "exercise.lifecycle.transitioned",
            "archive goes THROUGH the existing lifecycle service, which records its own transition");
    }

    /// <summary>AC archive: every state other than completed is 409 <c>{ reason: "not-completed" }</c> and writes nothing.</summary>
    [RequiresDockerFact]
    public async Task Archive_AnyStateOtherThanCompleted_Is409NotCompleted_AndWritesNothing()
    {
        foreach (var status in new[] { "build", "staged", "live", "paused", "archived" })
        {
            var world = await OrgAdminTestWorld.SeedAsync(_fixture, ExerciseAdminRoles.Planner);
            await SetStatusAsync(world.OwnExercise.Id, status);
            await using var factory = new OrgAdminProbeFactory(_fixture.ConnectionString!);
            using var client = OrgAdminTestWorld.CreateClient(factory, world.Token);

            var response = await client.PostAsync(ArchiveUri(world.OwnExercise.Id), content: null);

            response.StatusCode.Should().Be(HttpStatusCode.Conflict, "'{0}' is not completed", status);
            using var body = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
            body.RootElement.GetProperty("reason").GetString().Should().Be("not-completed");

            await using var read = _fixture.CreateContext();
            (await read.Exercises.AsNoTracking().SingleAsync(e => e.Id == world.OwnExercise.Id)).Status
                .Should().Be(status, "a refused archive changes nothing");
            (await read.TelemetryEvents.IgnoreQueryFilters().AsNoTracking()
                .CountAsync(e => e.ExerciseId == world.OwnExercise.Id))
                .Should().Be(0, "a refused archive emits nothing");
        }
    }

    /// <summary>AC archive: another customer's COMPLETED exercise is a 404 and stays completed; an evaluator is 403.</summary>
    [RequiresDockerFact]
    public async Task Archive_AnotherCustomersCompletedExercise_Is404_AndAnEvaluatorIs403()
    {
        var world = await OrgAdminTestWorld.SeedAsync(_fixture, ExerciseAdminRoles.OrgAdmin);
        await SetStatusAsync(world.OtherExercise.Id, "completed");
        await using var factory = new OrgAdminProbeFactory(_fixture.ConnectionString!);
        using var client = OrgAdminTestWorld.CreateClient(factory, world.Token);

        (await client.PostAsync(ArchiveUri(world.OtherExercise.Id), content: null)).StatusCode
            .Should().Be(HttpStatusCode.NotFound);

        var evaluatorWorld = await OrgAdminTestWorld.SeedAsync(_fixture, ExerciseAdminRoles.Evaluator);
        await SetStatusAsync(evaluatorWorld.OwnExercise.Id, "completed");
        using var evaluator = OrgAdminTestWorld.CreateClient(factory, evaluatorWorld.Token);
        (await evaluator.PostAsync(ArchiveUri(evaluatorWorld.OwnExercise.Id), content: null)).StatusCode
            .Should().Be(HttpStatusCode.Forbidden);

        await using var read = _fixture.CreateContext();
        (await read.Exercises.AsNoTracking().SingleAsync(e => e.Id == world.OtherExercise.Id)).Status
            .Should().Be("completed", "the other customer's exercise is untouched");
        (await read.Exercises.AsNoTracking().SingleAsync(e => e.Id == evaluatorWorld.OwnExercise.Id)).Status
            .Should().Be("completed");
    }

    /// <summary>The archived exercise still lists (labelled by its status) — archive is not delete.</summary>
    [RequiresDockerFact]
    public async Task Archive_TheArchivedExerciseStillAppearsInTheList()
    {
        var world = await OrgAdminTestWorld.SeedAsync(_fixture, ExerciseAdminRoles.Planner);
        await SetStatusAsync(world.OwnExercise.Id, "completed");
        await using var factory = new OrgAdminProbeFactory(_fixture.ConnectionString!);
        using var client = OrgAdminTestWorld.CreateClient(factory, world.Token);

        (await client.PostAsync(ArchiveUri(world.OwnExercise.Id), content: null)).EnsureSuccessStatusCode();

        var rows = await client.GetFromJsonAsync<OrgExerciseWire[]>(
            new Uri(ExerciseLifecycleAdminEndpoints.ExercisesRoute, UriKind.Relative));
        rows!.Single(row => row.ExerciseId == world.OwnExercise.Id.ToString()).Status.Should().Be("archived");
    }

    private static Uri ByIdUri(Guid exerciseId) => new($"/api/org/exercises/{exerciseId}", UriKind.Relative);

    private static Uri ArchiveUri(Guid exerciseId) => new($"/api/org/exercises/{exerciseId}/archive", UriKind.Relative);

    private async Task SetStatusAsync(Guid exerciseId, string status)
    {
        await using var write = _fixture.CreateContext();
        var exercise = await write.Exercises.SingleAsync(e => e.Id == exerciseId);
        exercise.Status = status;
        await write.SaveChangesAsync();
    }
}
