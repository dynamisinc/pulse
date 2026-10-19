namespace Pulse.WebApi.Tests.Features.Identity.Enrollments;

using System;
using System.Linq;
using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using System.Threading.Tasks;
using FluentAssertions;
using Microsoft.Data.SqlClient;
using Microsoft.EntityFrameworkCore;
using Pulse.WebApi.Data;
using Pulse.WebApi.Data.Entities;
using Pulse.WebApi.Features.Identity.Enrollments;
using Pulse.WebApi.Features.Identity.RoleMatrix;
using Pulse.WebApi.Tests.Data;
using Pulse.WebApi.Tests.Features.Identity.Credentials;
using Xunit;

/// <summary>
/// identity-auth-roles/21 (XC-010) — revoking a staff enrollment is a SOFT delete: the row survives with
/// <see cref="Enrollment.DeletedAt"/>, the same person can be granted again, and every enrollment read (sign-in, the
/// switcher, the role gate, the lead gate) treats the revoked row as absent. The database refuses a revoked lead and a
/// revoked participant-world enrollment.
/// </summary>
[Collection(MsSqlCollection.Name)]
public sealed class EnrollmentSoftDeleteTests
{
    private readonly MsSqlContainerFixture _fixture;
    private readonly EnrollmentTestKit _kit;
    private readonly CredentialTestWorld _world;

    public EnrollmentSoftDeleteTests(MsSqlContainerFixture fixture)
    {
        _fixture = fixture;
        _kit = new EnrollmentTestKit(fixture);
        _world = new CredentialTestWorld(fixture);
    }

    [RequiresDockerFact]
    public async Task Revoke_KeepsTheRowAsHistory_ThenGrantingTheSamePersonAgain_Works()
    {
        var org = await _kit.SeedOrganizationAsync();
        var exercise = await _kit.SeedExerciseAsync(org);
        var (admin, _) = await _kit.SeedStaffAsync(org, exerciseId: null, orgRole: Person.OrgAdminRole);
        var (adminSession, _) = await _kit.SeedStaffSessionAsync(admin, exerciseId: null, Person.OrgAdminRole);
        var (person, enrollment) = await _kit.SeedStaffAsync(org, exercise, "controller");

        var (service, context) = _kit.ServiceFor(adminSession, admin, org, exerciseScope: null);
        await using (context)
        {
            (await service.RevokeAsync(enrollment)).Outcome.Should().Be(EnrollmentOutcome.Ok);
            await using (var probe = _kit.ReadContext())
            {
                (await probe.Enrollments.IgnoreQueryFilters().AsNoTracking().SingleAsync(e => e.Id == enrollment)).DeletedAt
                    .Should().NotBeNull("an ORG ADMIN's revoke is persisted (its lookup query is tracked)");
            }

            (await service.RevokeAsync(enrollment)).Outcome.Should().Be(
                EnrollmentOutcome.NotFound, "a revoked enrollment is no longer reachable — revoking it again is the bare 404");
            (await service.ChangeRoleAsync(enrollment, "planner")).Outcome.Should().Be(EnrollmentOutcome.NotFound);

            var regrant = await service.GrantAsync(exercise, person, "evaluator");
            regrant.Outcome.Should().Be(EnrollmentOutcome.Ok, "the unique (ExerciseId, PersonId) index ignores the revoked row");
            regrant.Enrollment!.Id.Should().NotBe(enrollment);

            (await service.GrantAsync(exercise, person, "planner")).Outcome.Should().Be(
                EnrollmentOutcome.Conflict, "one LIVE enrollment per person per exercise still holds");

            // The same tracked lookup makes an org admin's role change persist too (it was silently dropped before).
            (await service.ChangeRoleAsync(regrant.Enrollment.Id, "planner")).Outcome.Should().Be(EnrollmentOutcome.Ok);
            await using var roleProbe = _kit.ReadContext();
            (await roleProbe.Enrollments.IgnoreQueryFilters().AsNoTracking().SingleAsync(e => e.Id == regrant.Enrollment.Id)).Role
                .Should().Be("planner");
        }

        await using var read = _kit.ReadContext();
        var rows = await read.Enrollments.IgnoreQueryFilters().AsNoTracking()
            .Where(e => e.ExerciseId == exercise && e.PersonId == person)
            .ToListAsync();
        rows.Should().HaveCount(2, "the revoked row survives as history beside the re-grant");
        rows.Single(e => e.Id == enrollment).DeletedAt.Should().NotBeNull();
        rows.Single(e => e.Id != enrollment).Should().Match<Enrollment>(e => e.DeletedAt == null && e.Role == "planner");
        (await read.Enrollments.IgnoreQueryFilters().Active().CountAsync(e => e.ExerciseId == exercise && e.PersonId == person))
            .Should().Be(1);
    }

    [RequiresDockerFact]
    public async Task ARevokedStaffMember_CannotSignIn_DoesNotSeeTheExercise_AndIsRefusedByTheRoleGate()
    {
        var (org, slug) = await _world.SeedOrganizationAsync();
        var exercise = await _world.SeedExerciseAsync(org);
        var (person, email) = await _world.SeedPersonAsync(org);
        await _world.SeedEnrollmentAsync(exercise, person, "planner", deletedAt: DateTimeOffset.UtcNow.AddMinutes(-1));

        // A session minted before the revoke that somehow survived it (revoke revokes it; this isolates the READS).
        var (_, sessionToken, _) = await _world.SeedStaffSessionAsync(person, exercise, "planner");

        await using var factory = new CredentialProbeFactory(_fixture.ConnectionString!);
        using var anonymous = CredentialTestWorld.CreateClient(factory);
        using (var login = await anonymous.PostAsJsonAsync(
            new Uri("/api/auth/staff/login", UriKind.Relative),
            new { orgSlug = slug, email, password = CredentialTestWorld.OldPassword }))
        {
            login.StatusCode.Should().Be(HttpStatusCode.Unauthorized, "the only enrollment is revoked: there is nothing to land on");
        }

        using var asPerson = CredentialTestWorld.CreateClient(factory, sessionToken);
        using (var assignments = await asPerson.GetAsync(new Uri("/api/staff/assignments", UriKind.Relative)))
        {
            assignments.StatusCode.Should().Be(HttpStatusCode.OK);
            (await assignments.Content.ReadFromJsonAsync<JsonElement>()).EnumerateArray().Should().BeEmpty(
                "the switcher never lists a revoked enrollment");
        }

        using (var roster = await asPerson.GetAsync(new Uri("/api/staff/roster", UriKind.Relative)))
        {
            roster.StatusCode.Should().Be(HttpStatusCode.Forbidden, "the live role read finds no enrollment, so the gate refuses");
        }

        // Positive control: a LIVE enrollment of a second person on the same exercise signs in.
        var (live, liveEmail) = await _world.SeedPersonAsync(org);
        await _world.SeedEnrollmentAsync(exercise, live, "planner");
        using var liveLogin = await anonymous.PostAsJsonAsync(
            new Uri("/api/auth/staff/login", UriKind.Relative),
            new { orgSlug = slug, email = liveEmail, password = CredentialTestWorld.OldPassword });
        liveLogin.StatusCode.Should().Be(HttpStatusCode.OK);
    }

    [RequiresDockerFact]
    public async Task RevokingTheLead_ReleasesIt_AndTheLeadGateIgnoresTheRevokedRow_ThenANewLeadCanBeSet()
    {
        var org = await _kit.SeedOrganizationAsync();
        var exercise = await _kit.SeedExerciseAsync(org);
        var (planner, _) = await _kit.SeedStaffAsync(org, exercise, "planner");
        var (plannerSession, _) = await _kit.SeedStaffSessionAsync(planner, exercise, "planner");
        var (lead, leadEnrollment) = await _kit.SeedStaffAsync(org, exercise, "controller", isLead: true);
        var (_, nextEnrollment) = await _kit.SeedStaffAsync(org, exercise, "controller");

        var (service, context) = _kit.ServiceFor(plannerSession, planner, org, exercise);
        await using (context)
        {
            (await service.RevokeAsync(leadEnrollment)).Outcome.Should().Be(EnrollmentOutcome.Ok);
            (await service.SetLeadAsync(leadEnrollment)).Outcome.Should().Be(EnrollmentOutcome.NotFound, "a revoked row cannot be made lead");
            (await service.SetLeadAsync(nextEnrollment)).Outcome.Should().Be(EnrollmentOutcome.Ok);
        }

        await using var read = _fixture.CreateContext(new ExerciseContext { CurrentExerciseId = exercise });
        (await ExerciseCallerRole.IsStillLeadAsync(read, exercise, lead)).Should().BeFalse("the revoked lead is no lead");
        (await read.Enrollments.IgnoreQueryFilters().Active().Where(e => e.ExerciseId == exercise && e.IsLead).Select(e => e.Id).ToListAsync())
            .Should().Equal([nextEnrollment]);
    }

    [RequiresDockerFact]
    public async Task Revoke_ThatRacesAConcurrentSetLead_Is409LeadChangedRetry_AndChangesNothing()
    {
        // Gate-1 S-003: the row becomes the lead between FindReachableAsync's read and the save, so the soft delete would
        // violate CK_Enrollments_DeletedAt_NotLead. The whole unit of work rolls back and the caller is told to retry.
        var org = await _kit.SeedOrganizationAsync();
        var exercise = await _kit.SeedExerciseAsync(org);
        var (planner, _) = await _kit.SeedStaffAsync(org, exercise, "planner");
        var (plannerSession, _) = await _kit.SeedStaffSessionAsync(planner, exercise, "planner");
        var (controller, enrollment) = await _kit.SeedStaffAsync(org, exercise, "controller");
        var (controllerSession, _) = await _kit.SeedStaffSessionAsync(controller, exercise, "controller");

        var hook = new BeforeSaveHook(async () =>
        {
            await using var competing = _kit.ReadContext();
            await competing.Database.ExecuteSqlInterpolatedAsync($"UPDATE [Enrollments] SET [IsLead] = 1 WHERE [Id] = {enrollment}");
        });

        var (service, context) = _kit.ServiceFor(plannerSession, planner, org, exercise, interceptor: hook);
        await using (context)
        {
            var result = await service.RevokeAsync(enrollment);
            result.Outcome.Should().Be(EnrollmentOutcome.Conflict);
            result.Error.Should().Be(EnrollmentService.LeadChangedRetryError);
        }

        hook.Fired.Should().BeTrue("the competing lead change landed in the window");
        await using var read = _kit.ReadContext();
        var row = await read.Enrollments.IgnoreQueryFilters().AsNoTracking().SingleAsync(e => e.Id == enrollment);
        row.DeletedAt.Should().BeNull("nothing was saved");
        row.IsLead.Should().BeTrue("the concurrent lead change stands; this revoke released nothing");
        (await read.Sessions.AsNoTracking().SingleAsync(s => s.Id == controllerSession)).RevokedAt.Should().BeNull(
            "the session revocation rolled back with the refused soft delete");
        (await read.TelemetryEvents.IgnoreQueryFilters().AsNoTracking()
                .CountAsync(t => t.ExerciseId == exercise && t.EventType == EnrollmentService.RevokedEventType))
            .Should().Be(0);
        _kit.Swamped.Calls.Should().BeEmpty("no lead was released, so the swamped-off path does not run");
    }

    [RequiresDockerFact]
    public async Task TheDatabase_RefusesARevokedLead_AndARevokedParticipantWorldEnrollment()
    {
        var org = await _kit.SeedOrganizationAsync();
        var exercise = await _kit.SeedExerciseAsync(org);
        var (person, _) = await _kit.SeedStaffAsync(org, exerciseId: null);

        async Task<int?> InsertAsync(string role, bool isLead)
        {
            await using var context = _fixture.CreateContext();
            context.Enrollments.Add(new Enrollment
            {
                Id = Guid.NewGuid(),
                ExerciseId = exercise,
                PersonId = role is "participant" ? null : person,
                Role = role,
                IsLead = isLead,
                CreatedAt = DateTimeOffset.UtcNow,
                DeletedAt = DateTimeOffset.UtcNow,
            });
            try
            {
                await context.SaveChangesAsync();
                return null;
            }
            catch (DbUpdateException exception) when (exception.InnerException is SqlException sql)
            {
                return sql.Number;
            }
        }

        (await InsertAsync("controller", isLead: true)).Should().Be(547, "CK_Enrollments_DeletedAt_NotLead");
        (await InsertAsync("participant", isLead: false)).Should().Be(547, "CK_Enrollments_DeletedAt_StaffOnly");
        (await InsertAsync("controller", isLead: false)).Should().BeNull("positive control: a revoked staff row is valid");
    }

    /// <summary>Runs one competing write just before the first save of the context it is attached to.</summary>
    private sealed class BeforeSaveHook(Func<Task> competingWrite) : Microsoft.EntityFrameworkCore.Diagnostics.SaveChangesInterceptor
    {
        public bool Fired { get; private set; }

        public override async ValueTask<Microsoft.EntityFrameworkCore.Diagnostics.InterceptionResult<int>> SavingChangesAsync(
            Microsoft.EntityFrameworkCore.Diagnostics.DbContextEventData eventData,
            Microsoft.EntityFrameworkCore.Diagnostics.InterceptionResult<int> result,
            System.Threading.CancellationToken cancellationToken = default)
        {
            if (!Fired)
            {
                Fired = true;
                await competingWrite();
            }

            return result;
        }
    }
}
