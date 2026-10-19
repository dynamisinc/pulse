namespace Pulse.WebApi.Tests.Features.Identity.RoleMatrix;

using System;
using System.Linq;
using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using System.Threading.Tasks;
using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Pulse.WebApi.Features.EngineRuntime;
using Pulse.WebApi.Features.EngineRuntime.Clock;
using Pulse.WebApi.Features.Identity.RoleMatrix;
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
    public async Task AFailedFlip_NeverFailsTheCommittedChange_AndIsLeftForTheNextGatedRequestToHeal()
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

        // A1b's post-commit flip is attempted once and a failure is logged, never retried in-request and never
        // surfaced: the change committed. Recovery is AFlipThatNeverLanded_IsHealedByTheNextGatedStaffRequest.
        _kit.Swamped.Calls.Should().BeEmpty("the one post-commit attempt failed");
        await using var verify = _kit.ReadContext();
        (await verify.Enrollments.IgnoreQueryFilters().SingleAsync(e => e.Id == leadEnrollment)).IsLead
            .Should().BeFalse("the lead release committed with the role change");
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
    public async Task TheHeal_WhenSwampedModeWasOn_RecordsExactlyOneSwampedOffEventAndAudit_AtTheCurrentScenarioMinute()
    {
        // Gate-1 WR-003: the self-heal goes through ISwampedModeSwitch and is recorded like EnrollmentService's flip.
        var world = await RoleMatrixWorld.SeedAsync(_fixture);
        await ClearTheLeadAsync(world);

        using var host = new RoleMatrixHost(_fixture.ConnectionString!);
        var clock = host.Services.GetRequiredService<IExerciseClock>();
        clock.Start(world.ExerciseId, DateTimeOffset.UtcNow, TimeZoneInfo.Utc);
        clock.Jump(world.ExerciseId, 42);
        var autonomy = host.Services.GetRequiredService<EngineAutonomyRegistry>().GetOrCreate(world.ExerciseId);
        autonomy.SetSwampedMode(true, "stale-flip", 0);

        using var planner = world.Client(host, await world.TokenForAsync(MatrixRole.Planner));
        using (await planner.PutAsJsonAsync("/api/staff/practice-mode", new { }))
        {
        }

        using var second = world.Client(host, await world.TokenForAsync(MatrixRole.Planner));
        using (await second.PutAsJsonAsync("/api/staff/practice-mode", new { }))
        {
        }

        autonomy.SwampedModeEnabled.Should().BeFalse();
        await using var verify = _fixture.CreateContext();
        var events = await verify.TelemetryEvents.IgnoreQueryFilters()
            .Where(e => e.ExerciseId == world.ExerciseId && e.EventType == EnrollmentService.SwampedModeOffEventType)
            .ToListAsync();
        var heal = events.Should().ContainSingle("one heal flipped it; the second request found it already off").Subject;
        heal.Actor.Kind.Should().Be("system");
        heal.Actor.ActingHumanId.Should().BeNull("the heal is a system action — no acting human");
        heal.Channel.Should().Be("system");
        using (var payload = JsonDocument.Parse(heal.Payload!))
        {
            payload.RootElement.GetProperty("reason").GetString().Should().Be(ExerciseCallerRole.NoLeadRecheckReason);
            payload.RootElement.GetProperty("wasOn").GetBoolean().Should().BeTrue();
            payload.RootElement.GetProperty("scenarioMinute").GetInt32().Should().Be(42, "the clock's CURRENT minute, never 0");
        }

        var audits = await verify.OrgAuditEvents.IgnoreQueryFilters()
            .Where(a => a.ExerciseId == world.ExerciseId && a.Kind == EnrollmentService.SwampedModeOffAuditKind)
            .ToListAsync();
        audits.Should().ContainSingle().Which.OrganizationId.Should().Be(world.OrganizationId);
    }

    [RequiresDockerFact]
    public async Task TheHeal_WhenSwampedModeWasAlreadyOff_RecordsNothing()
    {
        var world = await RoleMatrixWorld.SeedAsync(_fixture);
        await ClearTheLeadAsync(world);

        using var host = new RoleMatrixHost(_fixture.ConnectionString!);
        using var planner = world.Client(host, await world.TokenForAsync(MatrixRole.Planner));
        using (await planner.PutAsJsonAsync("/api/staff/practice-mode", new { }))
        {
        }

        await using var verify = _fixture.CreateContext();
        (await verify.TelemetryEvents.IgnoreQueryFilters()
            .CountAsync(e => e.ExerciseId == world.ExerciseId && e.EventType == EnrollmentService.SwampedModeOffEventType))
            .Should().Be(0, "nothing was turned off, so nothing is recorded");
        (await verify.OrgAuditEvents.IgnoreQueryFilters()
            .CountAsync(a => a.ExerciseId == world.ExerciseId && a.Kind == EnrollmentService.SwampedModeOffAuditKind))
            .Should().Be(0);
    }

    private async Task ClearTheLeadAsync(RoleMatrixWorld world)
    {
        await using var demote = _fixture.CreateContext();
        await demote.Enrollments.IgnoreQueryFilters()
            .Where(e => e.ExerciseId == world.ExerciseId && e.IsLead)
            .ExecuteUpdateAsync(set => set.SetProperty(e => e.IsLead, false));
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
