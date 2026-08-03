namespace Pulse.WebApi.Tests.Features.Ops.OrgAdminSeed;

using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;
using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;
using Pulse.WebApi.Data;
using Pulse.WebApi.Data.Entities;
using Pulse.WebApi.Features.ExerciseLifecycleAdmin;
using Pulse.WebApi.Features.Ops.OrgAdminSeed;
using Pulse.WebApi.Tests.Data;
using Xunit;

/// <summary>
/// <see cref="OrgAdminSeedService"/> against REAL SQL Server. Every test here builds its OWN customer tenant and
/// pre-seeds the <see cref="StaffUser"/> the allowlist resolves to, so the seeder's tenant resolution lands on
/// that tenant and the shared test database is never polluted — the seeder's other tenant path (the well-known
/// DEFAULT organization, used when the human does not exist yet) is exercised by
/// <see cref="OrgAdminSeedIdentityTests"/> inside a rolled-back transaction.
/// </summary>
/// <remarks>
/// The load-bearing properties, each with its own test: it does NOTHING in production; it does NOTHING (and says
/// so) without a configured credential; it does NOTHING when an org admin already exists; it grants the role
/// when one is missing; it never duplicates on a re-run; it never overwrites an existing role; and it never
/// reaches another customer's exercises.
/// </remarks>
[Collection(MsSqlCollection.Name)]
public sealed class OrgAdminSeedServiceTests
{
    private readonly MsSqlContainerFixture _fixture;

    public OrgAdminSeedServiceTests(MsSqlContainerFixture fixture) => _fixture = fixture;

    [RequiresDockerFact]
    public async Task Seed_WhenTheOrganizationAlreadyHasAnOrgAdmin_WritesNothing()
    {
        var world = await SeedTenantAsync(exerciseCount: 1);

        // A DIFFERENT staff human already holds orgAdmin in this tenant — the "if there is no org admin"
        // condition is asked of the ORGANIZATION, not of the target account.
        var incumbentId = Guid.NewGuid();
        await using (var seed = _fixture.CreateContext())
        {
            var incumbent = OrgAdminSeedTestKit.NewStaffUser(world.OrganizationId, $"idp|{incumbentId:N}");
            incumbent.Id = incumbentId;
            seed.StaffUsers.Add(incumbent);
            seed.StaffAssignments.Add(OrgAdminSeedTestKit.NewAssignment(
                incumbentId, world.ExerciseIds[0], ExerciseAdminRoles.OrgAdmin));
            await seed.SaveChangesAsync();
        }

        var result = await RunAsync(world);

        result.Outcome.Should().Be(
            OrgAdminSeedOutcome.AlreadyProvisioned,
            "an organization that already has an org admin needs nothing from the seeder");

        (await AssignmentsOfAsync(world.StaffUserId)).Should().BeEmpty(
            "a no-op must be a genuine no-op — the target account gains nothing when the tenant is already "
            + "administered");
    }

    [RequiresDockerFact]
    public async Task Seed_WhenNoOrgAdminExists_GrantsTheRoleOnEveryExerciseInTheOrganization()
    {
        var world = await SeedTenantAsync(exerciseCount: 2);

        var result = await RunAsync(world);

        result.Outcome.Should().Be(OrgAdminSeedOutcome.Seeded);
        result.AssignmentsCreated.Should().Be(
            2,
            "staff login is PER EXERCISE and reads Session.Role off the assignment, so an org admin is only "
            + "able to sign in as one on exercises they are assigned to");
        result.StaffUserId.Should().Be(world.StaffUserId, "the EXISTING staff human is reused, never duplicated");

        var assignments = await AssignmentsOfAsync(world.StaffUserId);
        assignments.Should().HaveCount(2);
        assignments.Should().OnlyContain(
            a => a.Role == ExerciseAdminRoles.OrgAdmin,
            "the role literal is the frozen frontend vocabulary, emitted in camelCase exactly as roles.ts spells it");
        assignments.Select(a => a.ExerciseId).Should().BeEquivalentTo(world.ExerciseIds);
    }

    [RequiresDockerFact]
    public async Task Seed_WithNoAllowlistEntryForTheTargetAccount_WritesNothing_AndLogsLoudly()
    {
        var world = await SeedTenantAsync(exerciseCount: 1);
        var logger = new CapturingSeedLogger();

        OrgAdminSeedResult result;
        await using (var context = _fixture.CreateContext())
        {
            result = await OrgAdminSeedTestKit
                .NewService(context, OrgAdminSeedTestKit.AllowlistWithoutTheTarget(), logger)
                .SeedAsync();
        }

        result.Outcome.Should().Be(OrgAdminSeedOutcome.NoCredentialConfigured);

        (await AssignmentsOfAsync(world.StaffUserId)).Should().BeEmpty(
            "seeding an assignment for an account with no configured credential would mint an administrator "
            + "nobody can authenticate as — a silent PARTIAL seed, which is strictly worse than none");

        logger.Entries.Should().Contain(
            entry => entry.Level >= LogLevel.Warning
                && entry.Message.Contains(OrgAdminSeedService.TargetUsername, StringComparison.Ordinal)
                && entry.Message.Contains("Authentication:StaffIdentity", StringComparison.Ordinal),
            "the refusal must name the account AND the exact configuration key an operator has to set — a "
            + "silent refusal is indistinguishable from a seeder that ran and did nothing useful");
    }

    [RequiresDockerFact]
    public async Task Seed_WhenTheAllowlistEntryHasAnEmptySecret_WritesNothing_AndLogsLoudly()
    {
        var world = await SeedTenantAsync(exerciseCount: 1);
        var logger = new CapturingSeedLogger();

        OrgAdminSeedResult result;
        await using (var context = _fixture.CreateContext())
        {
            result = await OrgAdminSeedTestKit
                .NewService(context, OrgAdminSeedTestKit.AllowlistFor(world.ExternalSubject, secret: string.Empty), logger)
                .SeedAsync();
        }

        result.Outcome.Should().Be(
            OrgAdminSeedOutcome.NoCredentialConfigured,
            "DynamisIdentityProvider refuses an entry with an empty secret, so an assignment seeded against one "
            + "could never authenticate — the same rule BootstrapService.ValidateStaff already enforces");

        (await AssignmentsOfAsync(world.StaffUserId)).Should().BeEmpty("nothing at all may be written");

        logger.Entries.Should().Contain(
            entry => entry.Level >= LogLevel.Warning,
            "an entry that exists but cannot authenticate is the SUBTLER failure of the two, so it must be just "
            + "as loud as a missing one");
    }

    [RequiresDockerFact]
    public async Task Seed_InProduction_WritesNothing()
    {
        var world = await SeedTenantAsync(exerciseCount: 1);

        OrgAdminSeedResult result;
        await using (var context = _fixture.CreateContext())
        {
            result = await OrgAdminSeedTestKit
                .NewService(
                    context,
                    OrgAdminSeedTestKit.AllowlistFor(world.ExternalSubject),
                    logger: null,
                    environmentName: "Production")
                .SeedAsync();
        }

        result.Outcome.Should().Be(OrgAdminSeedOutcome.RefusedInProduction);

        (await AssignmentsOfAsync(world.StaffUserId)).Should().BeEmpty(
            "this is the most important assertion in the feature: with a perfectly valid credential, a tenant "
            + "with exercises and NO existing org admin — i.e. every precondition for seeding satisfied — the "
            + "production gate alone must leave the database untouched");

        await using var read = _fixture.CreateContext();
        (await read.TelemetryEvents
                .IgnoreQueryFilters()
                .CountAsync(e => e.EventType == OrgAdminSeedService.SeededEventType
                    && world.ExerciseIds.Contains(e.ExerciseId)))
            .Should().Be(0, "and it must not even leave an audit trail claiming it ran");
    }

    [RequiresDockerFact]
    public async Task Seed_RunRepeatedly_IsIdempotent_AndCreatesNoDuplicates()
    {
        var world = await SeedTenantAsync(exerciseCount: 2);

        var first = await RunAsync(world);
        var second = await RunAsync(world);
        var third = await RunAsync(world);

        first.Outcome.Should().Be(OrgAdminSeedOutcome.Seeded);
        second.Outcome.Should().Be(
            OrgAdminSeedOutcome.AlreadyProvisioned,
            "the seeder re-checks on every boot; the second boot must find its own work and stand down");
        third.Outcome.Should().Be(OrgAdminSeedOutcome.AlreadyProvisioned);

        (await AssignmentsOfAsync(world.StaffUserId)).Should().HaveCount(
            2, "three passes must leave exactly the two assignments the first pass created — no duplicates, and "
            + "no exception from the (StaffUserId, ExerciseId) unique index");

        await using var read = _fixture.CreateContext();
        (await read.StaffUsers.CountAsync(u => u.ExternalSubject == world.ExternalSubject))
            .Should().Be(1, "and exactly one staff human, however many times the host restarts");
    }

    [RequiresDockerFact]
    public async Task Seed_SelfHeals_WhenTheOrgAdminAssignmentIsDeletedAgain()
    {
        var world = await SeedTenantAsync(exerciseCount: 1);

        (await RunAsync(world)).Outcome.Should().Be(OrgAdminSeedOutcome.Seeded);

        await using (var delete = _fixture.CreateContext())
        {
            var assignments = await delete.StaffAssignments
                .Where(a => a.StaffUserId == world.StaffUserId)
                .ToListAsync();
            delete.StaffAssignments.RemoveRange(assignments);
            await delete.SaveChangesAsync();
        }

        (await RunAsync(world)).Outcome.Should().Be(
            OrgAdminSeedOutcome.Seeded,
            "self-healing on the next boot is the reason this is a startup seeder rather than a migration — a "
            + "migration would have run once, been recorded as applied, and never noticed the row was gone");
    }

    [RequiresDockerFact]
    public async Task Seed_WhenTheOrganizationOwnsNoExercises_WritesNothing_AndSaysSo()
    {
        var world = await SeedTenantAsync(exerciseCount: 0);
        var logger = new CapturingSeedLogger();

        OrgAdminSeedResult result;
        await using (var context = _fixture.CreateContext())
        {
            result = await OrgAdminSeedTestKit
                .NewService(context, OrgAdminSeedTestKit.AllowlistFor(world.ExternalSubject), logger)
                .SeedAsync();
        }

        result.Outcome.Should().Be(
            OrgAdminSeedOutcome.NoExercisesInOrganization,
            "a staff role is granted per exercise, so an empty organization has nothing to make anyone an admin "
            + "OF — the known empty-org gap a separate story owns");

        (await AssignmentsOfAsync(world.StaffUserId)).Should().BeEmpty("and nothing is written in the meantime");

        logger.Entries.Should().Contain(
            entry => entry.Level >= LogLevel.Warning
                && entry.Message.Contains("NO exercises", StringComparison.Ordinal),
            "the gap must be named in the log rather than looking like a successful boot");
    }

    [RequiresDockerFact]
    public async Task Seed_NeverOverwritesAnExistingAssignmentsRole()
    {
        var world = await SeedTenantAsync(exerciseCount: 1);

        await using (var seed = _fixture.CreateContext())
        {
            seed.StaffAssignments.Add(OrgAdminSeedTestKit.NewAssignment(
                world.StaffUserId, world.ExerciseIds[0], ExerciseAdminRoles.Controller));
            await seed.SaveChangesAsync();
        }

        var logger = new CapturingSeedLogger();
        OrgAdminSeedResult result;
        await using (var context = _fixture.CreateContext())
        {
            result = await OrgAdminSeedTestKit
                .NewService(context, OrgAdminSeedTestKit.AllowlistFor(world.ExternalSubject), logger)
                .SeedAsync();
        }

        result.Outcome.Should().Be(OrgAdminSeedOutcome.NoUnassignedExercise);

        (await AssignmentsOfAsync(world.StaffUserId)).Should().ContainSingle()
            .Which.Role.Should().Be(
                ExerciseAdminRoles.Controller,
                "one human holds exactly one role per exercise, so granting orgAdmin here would mean OVERWRITING "
                + "the controller role — silently stripping that human of the engine cockpit "
                + "(EngineCockpitControllerRoleFilter). The seeder refuses and tells the operator instead");

        logger.Entries.Should().Contain(
            entry => entry.Level >= LogLevel.Warning,
            "refusing to act is only acceptable if a human is told why");
    }

    [RequiresDockerFact]
    public async Task Seed_NeverReachesAnotherCustomersExercises()
    {
        var world = await SeedTenantAsync(exerciseCount: 1);

        // An adversarial second customer that also has an un-administered exercise. A seeder that forgot its
        // tenant bound would grant this account orgAdmin over ANOTHER customer's run (COR-010).
        var otherOrganizationId = Guid.NewGuid();
        var otherExerciseId = Guid.NewGuid();
        await using (var seed = _fixture.CreateContext())
        {
            seed.Organizations.Add(OrgAdminSeedTestKit.NewOrganization(otherOrganizationId));
            var otherExercise = OrgAdminSeedTestKit.NewExercise(otherOrganizationId);
            otherExercise.Id = otherExerciseId;
            seed.Exercises.Add(otherExercise);
            await seed.SaveChangesAsync();
        }

        var result = await RunAsync(world);

        result.Outcome.Should().Be(OrgAdminSeedOutcome.Seeded);
        result.OrganizationId.Should().Be(
            world.OrganizationId, "the tenant comes from the staff human's own row, never from anywhere else");

        var assignments = await AssignmentsOfAsync(world.StaffUserId);
        assignments.Select(a => a.ExerciseId).Should().BeEquivalentTo(
            world.ExerciseIds,
            "the grant is bounded to the caller's own customer — another customer's exercise must be invisible "
            + "to it even though it is equally un-administered");
        assignments.Should().NotContain(
            a => a.ExerciseId == otherExerciseId, "cross-customer reach is the always-Critical failure");
    }

    [RequiresDockerFact]
    public async Task Seed_EmitsExactlyOneTelemetryEventPerGrantedAssignment()
    {
        var world = await SeedTenantAsync(exerciseCount: 2);

        await RunAsync(world);

        await using var read = _fixture.CreateContext();
        var events = await read.TelemetryEvents
            .IgnoreQueryFilters()
            .Where(e => e.EventType == OrgAdminSeedService.SeededEventType
                && world.ExerciseIds.Contains(e.ExerciseId))
            .ToListAsync();

        events.Should().HaveCount(
            2, "minting an administrator unattended is the most privilege-relevant write in this codebase, so "
            + "each grant carries exactly one XC-004 audit event, persisted in the SAME unit of work");
        events.Select(e => e.ExerciseId).Should().BeEquivalentTo(world.ExerciseIds);
        events.Should().OnlyContain(e => e.SchemaVersion == "v0" && e.Channel == "system");
        events.Should().OnlyContain(
            e => e.Actor != null && e.Actor.Kind == "system",
            "the locked v0 envelope has no staff actor kind, so an unattended server action is actor.kind 'system'");
    }

    /// <summary>Runs the seeder over a fresh context with a valid allowlist for the world's subject.</summary>
    private async Task<OrgAdminSeedResult> RunAsync(SeededTenant world)
    {
        await using var context = _fixture.CreateContext();
        return await OrgAdminSeedTestKit
            .NewService(context, OrgAdminSeedTestKit.AllowlistFor(world.ExternalSubject))
            .SeedAsync();
    }

    /// <summary>Reads back every assignment held by one staff human, independently of the seeder's context.</summary>
    private async Task<List<StaffAssignment>> AssignmentsOfAsync(Guid staffUserId)
    {
        await using var read = _fixture.CreateContext();
        return await read.StaffAssignments
            .AsNoTracking()
            .Where(a => a.StaffUserId == staffUserId)
            .ToListAsync();
    }

    /// <summary>
    /// Seeds a fresh customer tenant with <paramref name="exerciseCount"/> exercises and the staff human the
    /// allowlist subject resolves to — which is what pins the seeder's tenant resolution onto THIS tenant
    /// instead of the shared default one.
    /// </summary>
    private async Task<SeededTenant> SeedTenantAsync(int exerciseCount)
    {
        var organizationId = Guid.NewGuid();
        var externalSubject = $"idp|{Guid.NewGuid():N}";

        await using var context = _fixture.CreateContext();

        context.Organizations.Add(OrgAdminSeedTestKit.NewOrganization(organizationId));

        var staffUser = OrgAdminSeedTestKit.NewStaffUser(organizationId, externalSubject);
        context.StaffUsers.Add(staffUser);

        var exerciseIds = new List<Guid>();
        for (var i = 0; i < exerciseCount; i++)
        {
            var exercise = OrgAdminSeedTestKit.NewExercise(organizationId);
            context.Exercises.Add(exercise);
            exerciseIds.Add(exercise.Id);
        }

        await context.SaveChangesAsync();

        return new SeededTenant(organizationId, staffUser.Id, externalSubject, exerciseIds);
    }

    /// <summary>The per-test customer tenant.</summary>
    /// <param name="OrganizationId">The tenant.</param>
    /// <param name="StaffUserId">The pre-seeded staff human the allowlist resolves to.</param>
    /// <param name="ExternalSubject">That human's IdP subject.</param>
    /// <param name="ExerciseIds">The tenant's exercises.</param>
    private sealed record SeededTenant(
        Guid OrganizationId,
        Guid StaffUserId,
        string ExternalSubject,
        List<Guid> ExerciseIds);
}
