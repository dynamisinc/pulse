namespace Pulse.WebApi.Tests.Features.Identity.RoleMatrix;

using System;
using System.Linq;
using System.Net;
using System.Net.Http.Json;
using System.Threading.Tasks;
using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Pulse.WebApi.Features.EngineRuntime;
using Pulse.WebApi.Features.Identity.Enrollments;
using Pulse.WebApi.Tests.Data;
using Pulse.WebApi.Tests.Features.Identity.Enrollments;

/// <summary>
/// identity-auth-roles/16 orchestrator fold M-002 (verified and fixed in story 17): swamped mode is in-memory, so when the
/// lead is removed or demoted it is turned OFF only AFTER the enrollment change commits, idempotently (a failed flip is
/// retried, and the next gated staff request re-checks "no lead ⇒ swamped off"); after a restart an exercise with no
/// lead comes back with swamped mode off. M-003 (backend half): any controller may turn swamped mode OFF.
/// </summary>
[Collection(MsSqlCollection.Name)]
public sealed class SwampedModeLeadLossTests
{
    private readonly MsSqlContainerFixture _fixture;
    private readonly EnrollmentTestKit _kit;

    public SwampedModeLeadLossTests(MsSqlContainerFixture fixture)
    {
        _fixture = fixture;
        _kit = new EnrollmentTestKit(fixture);
    }

    [RequiresDockerFact]
    public async Task RemovingTheLead_TurnsSwampedOff_OnlyAfterTheEnrollmentChangeHasCommitted()
    {
        var org = await _kit.SeedOrganizationAsync();
        var exercise = await _kit.SeedExerciseAsync(org);
        var (planner, _) = await _kit.SeedStaffAsync(org, exercise, "planner");
        var (_, leadEnrollment) = await _kit.SeedStaffAsync(org, exercise, "controller", isLead: true);
        var (plannerSession, _) = await _kit.SeedStaffSessionAsync(planner, exercise, "planner");

        bool? enrollmentStillPresentAtFlip = null;
        _kit.Swamped.OnTurnOff = _ =>
        {
            using var probe = _kit.ReadContext();
            enrollmentStillPresentAtFlip = probe.Enrollments.IgnoreQueryFilters().Any(e => e.Id == leadEnrollment);
        };

        var (service, context) = _kit.ServiceFor(plannerSession, planner, org, exercise);
        await using (context)
        {
            (await service.RevokeAsync(leadEnrollment)).Outcome.Should().Be(EnrollmentOutcome.Ok);
        }

        enrollmentStillPresentAtFlip.Should().BeFalse("the in-memory flip runs after the enrollment removal committed");
        _kit.Swamped.Calls.Should().ContainSingle();
    }

    [RequiresDockerFact]
    public async Task AFailedFlip_IsRetried_AndNeverFailsTheCommittedChange()
    {
        var org = await _kit.SeedOrganizationAsync();
        var exercise = await _kit.SeedExerciseAsync(org);
        var (planner, _) = await _kit.SeedStaffAsync(org, exercise, "planner");
        var (_, leadEnrollment) = await _kit.SeedStaffAsync(org, exercise, "controller", isLead: true);
        var (plannerSession, _) = await _kit.SeedStaffSessionAsync(planner, exercise, "planner");
        _kit.Swamped.FailuresBeforeSuccess = 2;

        var (service, context) = _kit.ServiceFor(plannerSession, planner, org, exercise);
        await using (context)
        {
            (await service.ChangeRoleAsync(leadEnrollment, "evaluator")).Outcome.Should().Be(EnrollmentOutcome.Ok);
        }

        _kit.Swamped.Calls.Should().ContainSingle("two failed attempts are retried until the flip lands");
    }

    [RequiresDockerFact]
    public async Task AFlipThatNeverLanded_IsHealedByTheNextGatedStaffRequest()
    {
        var world = await RoleMatrixWorld.SeedAsync(_fixture);
        await using (var demote = _fixture.CreateContext())
        {
            await demote.Enrollments.IgnoreQueryFilters()
                .Where(e => e.ExerciseId == world.ExerciseId && e.IsLead)
                .ExecuteUpdateAsync(set => set.SetProperty(e => e.IsLead, false));
        }

        using var host = new RoleMatrixHost(_fixture.ConnectionString!);
        var autonomy = host.Services.GetRequiredService<EngineAutonomyRegistry>().GetOrCreate(world.ExerciseId);
        autonomy.SetSwampedMode(true, "stale-flip", 0);

        using var planner = world.Client(host, await world.TokenForAsync(MatrixRole.Planner));
        using var response = await planner.PutAsJsonAsync("/api/staff/practice-mode", new { });

        autonomy.SwampedModeEnabled.Should().BeFalse("an exercise with no lead is never left swamped");
    }

    [RequiresDockerFact]
    public async Task AfterARestart_AnExerciseWithNoLead_ComesBackWithSwampedModeOff()
    {
        var world = await RoleMatrixWorld.SeedAsync(_fixture);
        using (var before = new RoleMatrixHost(_fixture.ConnectionString!))
        {
            before.Services.GetRequiredService<EngineAutonomyRegistry>().GetOrCreate(world.ExerciseId)
                .SetSwampedMode(true, "before-restart", 0);
        }

        using var after = new RoleMatrixHost(_fixture.ConnectionString!);
        after.Services.GetRequiredService<EngineAutonomyRegistry>().GetOrCreate(world.ExerciseId).SwampedModeEnabled
            .Should().BeFalse("swamped mode is never persisted, so rehydration always comes back off");
    }

    [RequiresDockerFact]
    public async Task AnyController_MayTurnSwampedModeOff_WhileOnlyTheLeadMayTurnItOn()
    {
        var world = await RoleMatrixWorld.SeedAsync(_fixture);
        using var host = new RoleMatrixHost(_fixture.ConnectionString!);
        var autonomy = host.Services.GetRequiredService<EngineAutonomyRegistry>().GetOrCreate(world.ExerciseId);
        using var controller = world.Client(host, await world.TokenForAsync(MatrixRole.Controller));
        using var lead = world.Client(host, await world.TokenForAsync(MatrixRole.LeadController));

        using var refusedOn = await controller.PostAsJsonAsync("/api/engine/autonomy/swamped-mode", new { enabled = true, actingHumanId = "c" });
        refusedOn.StatusCode.Should().Be(HttpStatusCode.Forbidden);

        using var on = await lead.PostAsJsonAsync("/api/engine/autonomy/swamped-mode", new { enabled = true, actingHumanId = "lead" });
        on.StatusCode.Should().Be(HttpStatusCode.OK);
        autonomy.SwampedModeEnabled.Should().BeTrue();

        using var off = await controller.PostAsJsonAsync("/api/engine/autonomy/swamped-mode", new { enabled = false, actingHumanId = "c" });
        off.StatusCode.Should().Be(HttpStatusCode.OK, "turning swamped mode OFF is a lower — any controller (M-003)");
        autonomy.SwampedModeEnabled.Should().BeFalse();
    }
}
