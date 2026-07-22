namespace Pulse.WebApi.Tests.Features.Identity.Accounts;

using System;
using System.Linq;
using System.Threading.Tasks;
using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Pulse.WebApi.Data;
using Pulse.WebApi.Data.Entities;
using Pulse.WebApi.Features.Identity.Accounts;
using Pulse.WebApi.Features.Identity.Staff;
using Pulse.WebApi.Tests.Data;
using Pulse.WebApi.Tests.Features.Identity.Staff;

/// <summary>
/// The standing cross-exercise isolation suite's account entries (<c>exercise-isolation/07</c>, COR-001/COR-007)
/// extended for story <c>identity-auth-roles/02</c> (#59) — the always-Critical, fail-closed proofs that ride on
/// the account BEHAVIOUR this story adds (login + staff provisioning), complementing the entity-level filter
/// proofs already in <c>AccountAndSharedCredentialIsolationTests</c>. Real SQL Server (Testcontainers), fresh
/// <see cref="Guid.NewGuid"/> ids per test, FluentAssertions because-reasons.
/// </summary>
[Collection(MsSqlCollection.Name)]
public sealed class AccountLoginIsolationTests
{
    private readonly MsSqlContainerFixture _fixture;
    private readonly ParticipantPasswordHasher _hasher = new();

    public AccountLoginIsolationTests(MsSqlContainerFixture fixture) => _fixture = fixture;

    private static CurrentStaffSession AuthenticatedStaff() =>
        new() { SessionId = Guid.NewGuid(), StaffUserId = Guid.NewGuid() };

    private async Task<Exercise> SeedExerciseAsync(string name)
    {
        var exercise = new Exercise { Id = Guid.NewGuid(), Name = name, TimeZone = "UTC", Status = "active" };
        await using var seed = _fixture.CreateContext();
        seed.Exercises.Add(exercise);
        await seed.SaveChangesAsync();
        return exercise;
    }

    private async Task SeedAccountAsync(Guid exerciseId, string username, string password)
    {
        await using var seed = _fixture.CreateContext();
        seed.Accounts.Add(new Account
        {
            Id = Guid.NewGuid(),
            ExerciseId = exerciseId,
            Username = username,
            DisplayName = username,
            Role = "participant",
            CredentialHash = _hasher.Hash(password),
            CreatedAt = DateTimeOffset.UtcNow,
        });
        await seed.SaveChangesAsync();
    }

    [RequiresDockerFact]
    public async Task Login_HandleProvisionedInExerciseB_IsNotValidOnExerciseAHost_ButIsValidOnB()
    {
        // The always-Critical vector: a real, correct credential for exercise B must NOT authenticate when
        // presented on exercise A's host — the account is simply invisible under A's scope, so the login fails
        // closed exactly like an unknown handle. The SAME credential authenticating on B's host proves the
        // rejection is the isolation filter closing the door, not a bad password.
        var exerciseA = await SeedExerciseAsync("Host A Exercise");
        var exerciseB = await SeedExerciseAsync("Host B Exercise");
        await SeedAccountAsync(exerciseB.Id, "bob", "bob-correct-pw");

        // Attempt on host A (scope = A): must fail closed.
        await using (var contextA = _fixture.CreateContext(new ExerciseContext { CurrentExerciseId = exerciseA.Id }))
        {
            var serviceA = new ParticipantLoginService(
                contextA, new ExerciseContext { CurrentExerciseId = exerciseA.Id }, new RecordingSessionIssuer(), _hasher);

            var resultA = await serviceA.LoginAsync(new ParticipantLoginRequest { Username = "bob", Password = "bob-correct-pw" });

            resultA.Outcome.Should().Be(ParticipantLoginOutcome.RejectedCredential,
                "bob is provisioned only in exercise B, so bob's correct credential must NOT resolve on exercise A's host (fail closed)");
        }

        // Attempt on host B (scope = B): must succeed — proving the rejection above is the scope, not the password.
        var issuerB = new RecordingSessionIssuer();
        await using (var contextB = _fixture.CreateContext(new ExerciseContext { CurrentExerciseId = exerciseB.Id }))
        {
            var serviceB = new ParticipantLoginService(
                contextB, new ExerciseContext { CurrentExerciseId = exerciseB.Id }, issuerB, _hasher);

            var resultB = await serviceB.LoginAsync(new ParticipantLoginRequest { Username = "bob", Password = "bob-correct-pw" });

            resultB.Outcome.Should().Be(ParticipantLoginOutcome.Authenticated,
                "the same credential authenticates on its own exercise B host — the A rejection was isolation, not a bad credential");
        }

        issuerB.LastRequest!.ExerciseId.Should().Be(exerciseB.Id);
    }

    [RequiresDockerFact]
    public async Task StaffCreate_LandsOnlyInTheActiveExercise()
    {
        var activeExercise = await SeedExerciseAsync("Active Exercise A");
        var otherExercise = await SeedExerciseAsync("Other Exercise B");

        await using (var context = _fixture.CreateContext(new ExerciseContext { CurrentExerciseId = activeExercise.Id }))
        {
            var service = new AccountProvisioningService(
                context,
                new ExerciseContext { CurrentExerciseId = activeExercise.Id },
                new StubCurrentStaffSessionAccessor(AuthenticatedStaff()),
                _hasher);

            (await service.CreateAsync(new CreateAccountRequest { Username = "newbie", DisplayName = "Newbie", Role = "participant" }))
                .Outcome.Should().Be(CreateAccountOutcome.Created);
        }

        // The new account is visible under the active exercise's scope, and INVISIBLE under the other exercise's.
        await using var readActive = _fixture.CreateContext(new ExerciseContext { CurrentExerciseId = activeExercise.Id });
        (await readActive.Accounts.AnyAsync(a => a.Username == "newbie")).Should().BeTrue(
            "the created account lands in the staff caller's active exercise");

        await using var readOther = _fixture.CreateContext(new ExerciseContext { CurrentExerciseId = otherExercise.Id });
        (await readOther.Accounts.AnyAsync(a => a.Username == "newbie")).Should().BeFalse(
            "the created account must NOT be visible under any other exercise's scope (isolation)");

        await using var unfiltered = _fixture.CreateContext();
        (await unfiltered.Accounts.IgnoreQueryFilters().CountAsync(a => a.Username == "newbie" && a.ExerciseId == activeExercise.Id))
            .Should().Be(1, "physically, exactly one 'newbie' row exists and it is stamped with the active exercise");
        (await unfiltered.Accounts.IgnoreQueryFilters().CountAsync(a => a.Username == "newbie" && a.ExerciseId == otherExercise.Id))
            .Should().Be(0, "nothing was written into the other exercise");
    }

    [RequiresDockerFact]
    public async Task StaffImport_LandsOnlyInTheActiveExercise()
    {
        var activeExercise = await SeedExerciseAsync("Active Exercise A");
        var otherExercise = await SeedExerciseAsync("Other Exercise B");
        const string csv = "username,displayName,role\nimported1,One,participant\nimported2,Two,pio";

        await using (var context = _fixture.CreateContext(new ExerciseContext { CurrentExerciseId = activeExercise.Id }))
        {
            var service = new AccountProvisioningService(
                context,
                new ExerciseContext { CurrentExerciseId = activeExercise.Id },
                new StubCurrentStaffSessionAccessor(AuthenticatedStaff()),
                _hasher);

            (await service.ImportAsync(csv)).Summary!.CreatedCount.Should().Be(2);
        }

        await using var readOther = _fixture.CreateContext(new ExerciseContext { CurrentExerciseId = otherExercise.Id });
        (await readOther.Accounts.CountAsync(a => a.Username == "imported1" || a.Username == "imported2")).Should().Be(0,
            "an import must never leak rows into a different exercise");

        await using var unfiltered = _fixture.CreateContext();
        (await unfiltered.Accounts.IgnoreQueryFilters().CountAsync(a => a.ExerciseId == activeExercise.Id)).Should().Be(2,
            "both imported rows are stamped with the active exercise only");
    }
}
