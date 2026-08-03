namespace Pulse.WebApi.Tests.Features.ExerciseLifecycleAdmin;

using System;
using System.Collections.Generic;
using System.Linq;
using System.Net;
using System.Net.Http.Json;
using System.Threading.Tasks;
using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Pulse.WebApi.Features.ExerciseLifecycleAdmin;
using Pulse.WebApi.Tests.Data;
using Xunit;

/// <summary>
/// exercise-lifecycle-admin story 02 (COR-075) — the org-scoped exercise list, and the cross-CUSTOMER
/// isolation suite for the org axis it extends (<c>exercise-isolation/07</c> + <c>/11</c>). Driven over the
/// REAL <c>Program</c> pipeline against real SQL.
/// </summary>
/// <remarks>
/// <b>Every isolation test here carries its controls.</b> A positive control (the caller's own rows ARE
/// returned) so a blanket-deny regression cannot pass; and an unbounded control read straight from the
/// database proving the other customer's rows DO exist — so a zero is the tenant bound closing the door, not
/// an empty table.
/// </remarks>
[Collection(MsSqlCollection.Name)]
public sealed class ExerciseListEndpointTests
{
    private readonly MsSqlContainerFixture _fixture;

    /// <summary>Creates the suite over the shared real-SQL fixture.</summary>
    /// <param name="fixture">The shared migrated database.</param>
    public ExerciseListEndpointTests(MsSqlContainerFixture fixture) => _fixture = fixture;

    /// <summary>
    /// AC1 + the cross-cutting isolation AC: the list contains exactly the caller's organization's exercises
    /// and none of customer Y's — not by id, not by name, not by row count.
    /// </summary>
    [RequiresDockerFact]
    public async Task List_ReturnsOnlyTheCallersOrganizationsExercises_NeverAnotherCustomers()
    {
        var world = await OrgAdminTestWorld.SeedAsync(_fixture, ExerciseAdminRoles.OrgAdmin);

        await using var factory = new OrgAdminProbeFactory(_fixture.ConnectionString!);
        using var client = OrgAdminTestWorld.CreateClient(factory, world.Token);

        var response = await client.GetAsync(new Uri(ExerciseLifecycleAdminEndpoints.ExercisesRoute, UriKind.Relative));
        response.StatusCode.Should().Be(HttpStatusCode.OK);

        var rows = await response.Content.ReadFromJsonAsync<List<OrgExerciseWire>>();
        rows.Should().NotBeNull();
        var listed = rows!;

        // Positive control FIRST: if this were empty the negative assertions below would pass vacuously.
        listed.Select(row => row.ExerciseId).Should().Contain(
            world.OwnExercise.Id.ToString(),
            "AC1: an org-admin sees their OWN organization's runs — a list that showed nothing would satisfy "
            + "every 'must not contain' assertion below while being completely broken");

        listed.Select(row => row.ExerciseId).Should().NotContain(
            world.OtherExercise.Id.ToString(),
            "COR-001 at the org tier: another customer's exercise is never renderable from this surface");
        listed.Select(row => row.Name).Should().NotContain(
            world.OtherExercise.Name,
            "and not by name either — a leak by display name is still a leak");

        // The unbounded control: the other customer's row really is there, so the absence above is the tenant
        // bound closing the door rather than an empty table.
        await using var read = _fixture.CreateContext();
        var bothExist = await read.Exercises
            .AsNoTracking()
            .CountAsync(e => e.Id == world.OwnExercise.Id || e.Id == world.OtherExercise.Id);
        bothExist.Should().Be(
            2,
            "Exercise carries no query filter on either axis, so this unbounded read sees both — which is "
            + "exactly why the endpoint has to write its tenant bound explicitly, and what makes the omission "
            + "above meaningful");
    }

    /// <summary>
    /// AC1, the aggregate form: the row COUNT must not leak the other customer's portfolio size either. Seeds
    /// several extra exercises for customer Y so a count leak would be unmistakable.
    /// </summary>
    [RequiresDockerFact]
    public async Task List_DoesNotLeakTheOtherCustomersPortfolioSize_ThroughTheRowCount()
    {
        var world = await OrgAdminTestWorld.SeedAsync(_fixture, ExerciseAdminRoles.Planner);

        await using (var seed = _fixture.CreateContext())
        {
            for (var i = 0; i < 4; i++)
            {
                seed.Exercises.Add(new Pulse.WebApi.Data.Entities.Exercise
                {
                    Id = Guid.NewGuid(),
                    OrganizationId = world.OtherOrganizationId,
                    Name = $"Other Customer Extra {Guid.NewGuid():N}",
                    TimeZone = "UTC",
                    Status = "build",
                });
            }

            await seed.SaveChangesAsync();
        }

        await using var factory = new OrgAdminProbeFactory(_fixture.ConnectionString!);
        using var client = OrgAdminTestWorld.CreateClient(factory, world.Token);

        var rows = await client.GetFromJsonAsync<List<OrgExerciseWire>>(
            new Uri(ExerciseLifecycleAdminEndpoints.ExercisesRoute, UriKind.Relative));

        rows.Should().ContainSingle(
            "customer X owns exactly one exercise; customer Y now owns five. A count of six (or two) would "
            + "disclose the other tenant's size even without disclosing a single name")
            .Which.ExerciseId.Should().Be(world.OwnExercise.Id.ToString());
    }

    /// <summary>
    /// AC2: each row carries the four fields the surface needs to tell two runs apart — name, lifecycle
    /// status, hostname and created date.
    /// </summary>
    [RequiresDockerFact]
    public async Task List_Row_CarriesNameStatusHostnameAndCreatedDate()
    {
        var world = await OrgAdminTestWorld.SeedAsync(_fixture, ExerciseAdminRoles.Planner);

        await using (var seed = _fixture.CreateContext())
        {
            var own = await seed.Exercises.SingleAsync(e => e.Id == world.OwnExercise.Id);
            own.Hostname = $"listed-{Guid.NewGuid():N}.pulse.test";
            await seed.SaveChangesAsync();
        }

        await using var factory = new OrgAdminProbeFactory(_fixture.ConnectionString!);
        using var client = OrgAdminTestWorld.CreateClient(factory, world.Token);

        var rows = await client.GetFromJsonAsync<List<OrgExerciseWire>>(
            new Uri(ExerciseLifecycleAdminEndpoints.ExercisesRoute, UriKind.Relative));

        var row = rows!.Single(candidate => candidate.ExerciseId == world.OwnExercise.Id.ToString());

        row.Name.Should().Be(world.OwnExercise.Name);
        row.Status.Should().Be("live", "the lifecycle literal is what the surface renders as text + icon");
        row.Hostname.Should().StartWith("listed-");
        row.CreatedAt.Should().NotBeNullOrWhiteSpace("AC2 lists created date among the minimum fields");
    }

    /// <summary>
    /// AC2's status field, transitional case: a row still carrying a LEGACY pre-COR-032 literal is folded onto
    /// its canonical equivalent, so the frozen client guard (which fails closed on an unknown value) never
    /// blanks a row for a spelling the server itself understands.
    /// </summary>
    [RequiresDockerFact]
    public async Task List_FoldsALegacyStatusLiteralOntoItsCanonicalCor032Equivalent()
    {
        var world = await OrgAdminTestWorld.SeedAsync(_fixture, ExerciseAdminRoles.Planner);

        await using (var seed = _fixture.CreateContext())
        {
            var own = await seed.Exercises.SingleAsync(e => e.Id == world.OwnExercise.Id);
            own.Status = "scheduled";
            await seed.SaveChangesAsync();
        }

        await using var factory = new OrgAdminProbeFactory(_fixture.ConnectionString!);
        using var client = OrgAdminTestWorld.CreateClient(factory, world.Token);

        var rows = await client.GetFromJsonAsync<List<OrgExerciseWire>>(
            new Uri(ExerciseLifecycleAdminEndpoints.ExercisesRoute, UriKind.Relative));

        rows!.Single(row => row.ExerciseId == world.OwnExercise.Id.ToString()).Status.Should().Be(
            "build",
            "the legacy four stay valid in the column through the transition, and the read folds them "
            + "(scheduled → build) rather than emitting a literal no deployed client guard accepts");
    }

    /// <summary>AC5: a Controller session cannot reach the list.</summary>
    [RequiresDockerFact]
    public async Task List_AsController_IsRefused()
    {
        await AssertRoleIsRefusedAsync(ExerciseAdminRoles.Controller);
    }

    /// <summary>AC5: an Evaluator session cannot reach the list.</summary>
    [RequiresDockerFact]
    public async Task List_AsEvaluator_IsRefused()
    {
        await AssertRoleIsRefusedAsync(ExerciseAdminRoles.Evaluator);
    }

    /// <summary>The default-deny floor: an anonymous caller gets 401, never an empty 200.</summary>
    [RequiresDockerFact]
    public async Task List_WithNoSession_IsUnauthorized_NeverAnEmpty200()
    {
        await OrgAdminTestWorld.SeedAsync(_fixture, ExerciseAdminRoles.OrgAdmin);

        await using var factory = new OrgAdminProbeFactory(_fixture.ConnectionString!);
        using var client = factory.CreateClient();

        var response = await client.GetAsync(new Uri(ExerciseLifecycleAdminEndpoints.ExercisesRoute, UriKind.Relative));

        response.StatusCode.Should().Be(
            HttpStatusCode.Unauthorized,
            "an unresolved caller fails closed with 401 — an empty 200 would tell an anonymous client the "
            + "surface exists and that it owns nothing, and would train the client to treat 'no rows' as a "
            + "valid state rather than a refusal");
    }

    /// <summary>
    /// A PLANNER is admitted here even though the org-admin surface family's own read (story 03) refuses one —
    /// story 02's AC says "a Planner or OrgAdmin session", and conflating the two gates would either lock
    /// planners out of their own organization's list or hand them the org-admin family.
    /// </summary>
    [RequiresDockerFact]
    public async Task List_AsPlanner_IsAdmitted_BecauseStory02IsPlannerOrOrgAdmin()
    {
        var world = await OrgAdminTestWorld.SeedAsync(_fixture, ExerciseAdminRoles.Planner);

        await using var factory = new OrgAdminProbeFactory(_fixture.ConnectionString!);
        using var client = OrgAdminTestWorld.CreateClient(factory, world.Token);

        var response = await client.GetAsync(new Uri(ExerciseLifecycleAdminEndpoints.ExercisesRoute, UriKind.Relative));

        response.StatusCode.Should().Be(HttpStatusCode.OK);
    }

    /// <summary>Shared arrangement for AC5: a non-administrator staff role gets a 403 and sees nothing.</summary>
    private async Task AssertRoleIsRefusedAsync(string role)
    {
        var world = await OrgAdminTestWorld.SeedAsync(_fixture, role);

        await using var factory = new OrgAdminProbeFactory(_fixture.ConnectionString!);
        using var client = OrgAdminTestWorld.CreateClient(factory, world.Token);

        var response = await client.GetAsync(new Uri(ExerciseLifecycleAdminEndpoints.ExercisesRoute, UriKind.Relative));

        response.StatusCode.Should().Be(
            HttpStatusCode.Forbidden,
            "AC5: exercise list/management is Planner/OrgAdmin only — a {0} already reaches their individual "
            + "assigned exercises through the switcher, a different and narrower concern. A 200 here means "
            + "the endpoint gates on 'any staff session' rather than on role",
            role);

        var body = await response.Content.ReadAsStringAsync();
        body.Should().NotContain(
            world.OwnExercise.Name, "a refusal must not carry the payload it refused in its error body");
    }
}
