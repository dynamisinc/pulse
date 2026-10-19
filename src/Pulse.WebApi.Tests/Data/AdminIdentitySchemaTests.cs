namespace Pulse.WebApi.Tests.Data;

using System;
using System.Linq;
using System.Threading.Tasks;
using FluentAssertions;
using Microsoft.Data.SqlClient;
using Microsoft.EntityFrameworkCore;
using Pulse.WebApi.Data;
using Pulse.WebApi.Data.Entities;
using Pulse.WebApi.Tests.Helpers;

/// <summary>
/// identity-auth-roles/16 (#572) — the database itself enforces the A1 identity rules: one enrollment per person per
/// exercise (any role), the enrollment role vocabulary (no orgAdmin), no persona on a staff role, the lead only on a
/// controller and at most one per exercise, one account per enrollment, and the central exercise filter / org filter
/// on the two new scoped tables (fail closed, IDOR-proof).
/// </summary>
[Collection(MsSqlCollection.Name)]
public sealed class AdminIdentitySchemaTests
{
    private readonly MsSqlContainerFixture _fixture;

    public AdminIdentitySchemaTests(MsSqlContainerFixture fixture) => _fixture = fixture;

    [RequiresDockerFact]
    public async Task ASecondEnrollment_OfTheSamePerson_InTheSameExercise_IsRefusedByTheUniqueIndex_WhateverTheRole()
    {
        var (exercise, person) = await SeedExerciseAndPersonAsync();
        await AddAsync(NewEnrollment(exercise, person, "controller"));

        var act = () => AddAsync(NewEnrollment(exercise, person, "participant"));

        (await act.Should().ThrowAsync<DbUpdateException>("being staff and a participant in one exercise is impossible in the database"))
            .Which.InnerException.Should().BeOfType<SqlException>().Which.Number.Should().BeOneOf(2601, 2627);
    }

    [RequiresDockerFact]
    public async Task OneOffParticipants_WithNoPerson_DoNotCollide()
    {
        var (exercise, _) = await SeedExerciseAndPersonAsync();

        await AddAsync(NewEnrollment(exercise, personId: null, "participant"));
        var act = () => AddAsync(NewEnrollment(exercise, personId: null, "participant"));

        await act.Should().NotThrowAsync("the person uniqueness index is filtered to PersonId IS NOT NULL");
    }

    [RequiresDockerFact]
    public async Task ThePersonaIdCheck_RefusesAPersonaOnAStaffRole()
    {
        var (exercise, person) = await SeedExerciseAndPersonAsync();
        var enrollment = NewEnrollment(exercise, person, "controller");
        enrollment.PersonaId = Guid.NewGuid();

        await ShouldViolateCheckAsync(enrollment, "CK_Enrollments_PersonaId_ParticipantRolesOnly");
    }

    [RequiresDockerFact]
    public async Task TheRoleCheck_RefusesOrgAdmin_WhichIsNoLongerAnExerciseRole()
    {
        var (exercise, person) = await SeedExerciseAndPersonAsync();

        await ShouldViolateCheckAsync(NewEnrollment(exercise, person, "orgAdmin"), "CK_Enrollments_Role");
    }

    [RequiresDockerFact]
    public async Task TheLeadCheck_RefusesALeadThatIsNotAController()
    {
        var (exercise, person) = await SeedExerciseAndPersonAsync();
        var enrollment = NewEnrollment(exercise, person, "evaluator");
        enrollment.IsLead = true;

        await ShouldViolateCheckAsync(enrollment, "CK_Enrollments_IsLead_ControllerOnly");
    }

    [RequiresDockerFact]
    public async Task ASecondLead_InOneExercise_IsRefusedByTheFilteredUniqueIndex()
    {
        var (exercise, first) = await SeedExerciseAndPersonAsync();
        var second = await SeedPersonAsync();
        var lead = NewEnrollment(exercise, first, "controller");
        lead.IsLead = true;
        await AddAsync(lead);

        var another = NewEnrollment(exercise, second, "controller");
        another.IsLead = true;
        var act = () => AddAsync(another);

        await act.Should().ThrowAsync<DbUpdateException>("an exercise has at most one lead controller");
    }

    [RequiresDockerFact]
    public async Task TwoAccounts_CannotShareOneEnrollment()
    {
        var (exercise, _) = await SeedExerciseAndPersonAsync();
        var enrollment = NewEnrollment(exercise, personId: null, "participant");
        await using (var seed = _fixture.CreateContext())
        {
            seed.Accounts.Add(NewAccount(exercise, enrollment));
            await seed.SaveChangesAsync();
        }

        await using var write = _fixture.CreateContext();
        var second = NewAccount(exercise, enrollment: null);
        second.EnrollmentId = enrollment.Id;
        write.Accounts.Add(second);
        var act = () => write.SaveChangesAsync();

        await act.Should().ThrowAsync<DbUpdateException>("Accounts.EnrollmentId is unique — one sign-in facet per enrollment");
    }

    [RequiresDockerFact]
    public async Task Enrollments_AreConfinedByTheCentralExerciseFilter_AndAnUnsetScopeSeesNothing()
    {
        var (exerciseA, personA) = await SeedExerciseAndPersonAsync();
        var (exerciseB, personB) = await SeedExerciseAndPersonAsync();
        var inA = NewEnrollment(exerciseA, personA, "controller");
        var inB = NewEnrollment(exerciseB, personB, "controller");
        await AddAsync(inA);
        await AddAsync(inB);

        await using (var scopedToA = _fixture.CreateContext(new ExerciseContext { CurrentExerciseId = exerciseA }))
        {
            (await scopedToA.Enrollments.Where(e => e.Id == inA.Id || e.Id == inB.Id).Select(e => e.Id).ToListAsync())
                .Should().Equal([inA.Id], "exercise A sees only A's enrollments");
            (await scopedToA.Enrollments.FindAsync(inB.Id)).Should().BeNull("a known cross-exercise id (IDOR) is invisible");
        }

        await using var unscoped = _fixture.CreateContext();
        (await unscoped.Enrollments.CountAsync(e => e.Id == inA.Id || e.Id == inB.Id)).Should().Be(0, "fail closed");
        (await unscoped.Enrollments.IgnoreQueryFilters().CountAsync(e => e.Id == inA.Id || e.Id == inB.Id))
            .Should().Be(2, "the rows exist — the zero above is the filter closing the door");
    }

    [RequiresDockerFact]
    public async Task OrgAuditEvents_AreConfinedByTheCentralOrgFilter_AndAnUnresolvedTenantSeesNothing()
    {
        var orgA = Guid.NewGuid();
        var orgB = Guid.NewGuid();
        var inA = NewAudit(orgA);
        var inB = NewAudit(orgB);
        await using (var seed = _fixture.CreateContext())
        {
            seed.OrgAuditEvents.AddRange(inA, inB);
            await seed.SaveChangesAsync();
        }

        await using (var asA = _fixture.CreateContextForOrganization(orgA))
        {
            (await asA.OrgAuditEvents.Where(a => a.Id == inA.Id || a.Id == inB.Id).Select(a => a.Id).ToListAsync())
                .Should().Equal([inA.Id], "organization A sees only its own audit");
        }

        await using var unresolved = _fixture.CreateContext();
        (await unresolved.OrgAuditEvents.CountAsync(a => a.Id == inA.Id || a.Id == inB.Id)).Should().Be(0, "fail closed");
    }

    private static OrgAuditEvent NewAudit(Guid organizationId) => new()
    {
        Id = Guid.NewGuid(),
        OrganizationId = organizationId,
        Kind = "org.test",
        Outcome = "success",
        Payload = "{}",
        OccurredAt = DateTimeOffset.UtcNow,
    };

    private static Enrollment NewEnrollment(Guid exerciseId, Guid? personId, string role) => new()
    {
        Id = Guid.NewGuid(),
        ExerciseId = exerciseId,
        PersonId = personId,
        Role = role,
        CreatedAt = DateTimeOffset.UtcNow,
    };

    private static Account NewAccount(Guid exerciseId, Enrollment? enrollment)
    {
        var id = Guid.NewGuid();
        var account = new Account
        {
            Id = id,
            ExerciseId = exerciseId,
            Username = $"user_{id:N}",
            DisplayName = "Participant",
            CreatedAt = DateTimeOffset.UtcNow,
        };

        if (enrollment is not null)
        {
            account.Enrollment = enrollment;
        }

        return account;
    }

    private async Task<(Guid ExerciseId, Guid PersonId)> SeedExerciseAndPersonAsync()
    {
        var exerciseId = Guid.NewGuid();
        await using (var seed = _fixture.CreateContext())
        {
            seed.Exercises.Add(new Exercise { Id = exerciseId, OrganizationId = Organization.DefaultOrganizationId, Name = $"Schema {exerciseId:N}" });
            await seed.SaveChangesAsync();
        }

        return (exerciseId, await SeedPersonAsync());
    }

    private async Task<Guid> SeedPersonAsync()
    {
        var personId = Guid.NewGuid();
        await using var seed = _fixture.CreateContext();
        seed.StaffUsers.Add(StaffTenantSeed.StaffUserFor(personId));
        await seed.SaveChangesAsync();
        return personId;
    }

    private async Task AddAsync(Enrollment enrollment)
    {
        await using var write = _fixture.CreateContext();
        write.Enrollments.Add(enrollment);
        await write.SaveChangesAsync();
    }

    private async Task ShouldViolateCheckAsync(Enrollment enrollment, string constraintName)
    {
        var act = () => AddAsync(enrollment);

        (await act.Should().ThrowAsync<DbUpdateException>())
            .Which.InnerException!.Message.Should().Contain(constraintName);
    }
}
