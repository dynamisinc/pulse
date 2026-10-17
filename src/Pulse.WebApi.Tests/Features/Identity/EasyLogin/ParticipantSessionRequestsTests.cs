namespace Pulse.WebApi.Tests.Features.Identity.EasyLogin;

using System;
using System.Threading.Tasks;
using FluentAssertions;
using Pulse.WebApi.Data;
using Pulse.WebApi.Data.Entities;
using Pulse.WebApi.Features.Identity.Accounts;
using Pulse.WebApi.Features.Identity.EasyLogin;
using Pulse.WebApi.Features.Identity.Sessions;
using Pulse.WebApi.Tests.Data;
using Pulse.WebApi.Tests.Features.Identity.Staff;

/// <summary>
/// easy-login/01 (Sessions and gates AC) — <see cref="ParticipantSessionRequests.For"/> builds the same
/// <see cref="SessionIssueRequest"/> <see cref="ParticipantLoginService"/> builds for a password sign-in today: kind
/// <c>participant</c>, the account's role and persona, the acting human defaulting to the account id, never read-only.
/// The equivalence is proved directly against the real login service (real SQL) as well as field by field.
/// </summary>
[Collection(MsSqlCollection.Name)]
public sealed class ParticipantSessionRequestsTests
{
    private readonly MsSqlContainerFixture _fixture;

    public ParticipantSessionRequestsTests(MsSqlContainerFixture fixture) => _fixture = fixture;

    private static Account NewAccount(Guid exerciseId, string role = "participant", Guid? personaId = null, string? actingHumanId = null) => new()
    {
        Id = Guid.NewGuid(),
        ExerciseId = exerciseId,
        Username = $"user_{Guid.NewGuid():N}",
        DisplayName = "Jane Smith",
        ActingHumanId = actingHumanId,
        CreatedAt = DateTimeOffset.UtcNow,
        Enrollment = new Enrollment { Id = Guid.NewGuid(), ExerciseId = exerciseId, Role = role, PersonaId = personaId },
    };

    [Fact]
    public void For_BuildsAParticipantSession_WithPersona_AndTheAccountIdAsActingHuman()
    {
        var exerciseId = Guid.NewGuid();
        var personaId = Guid.NewGuid();
        var account = NewAccount(exerciseId, role: "pio", personaId: personaId);

        var request = ParticipantSessionRequests.For(account, exerciseId);

        request.Should().BeEquivalentTo(new SessionIssueRequest
        {
            ExerciseId = exerciseId,
            Kind = "participant",
            Role = "pio",
            PrincipalId = account.Id.ToString(),
            ActingHumanId = account.Id.ToString(),
            IsReadOnly = false,
            AccountId = account.Id,
            StaffUserId = null,
            PersonaId = personaId,
        });
    }

    [Fact]
    public void For_KeepsTheAccountsOwnActingHuman_AndAMissingPersona()
    {
        var exerciseId = Guid.NewGuid();
        var account = NewAccount(exerciseId, personaId: null, actingHumanId: "human-77");

        var request = ParticipantSessionRequests.For(account, exerciseId);

        request.ActingHumanId.Should().Be("human-77", "an explicit acting human (COR-018) wins over the account-id default");
        request.PersonaId.Should().BeNull("an account with no persona issues a session with none (personaId omitted on the wire)");
        request.Role.Should().Be("participant");
    }

    [Fact]
    public void For_RefusesAnEmptyOrForeignExercise_FailClosed()
    {
        var account = NewAccount(Guid.NewGuid());

        ((Action)(() => ParticipantSessionRequests.For(account, Guid.Empty))).Should().Throw<ArgumentException>(
            "a session is never bound to an unresolved scope");
        ((Action)(() => ParticipantSessionRequests.For(account, Guid.NewGuid()))).Should().Throw<ArgumentException>(
            "a session is never bound to an exercise other than the account's own (COR-001)");
        ((Action)(() => ParticipantSessionRequests.For(null!, Guid.NewGuid()))).Should().Throw<ArgumentNullException>();
    }

    [RequiresDockerFact]
    public async Task For_IsEquivalentToWhatParticipantLoginServiceIssuesToday()
    {
        var hasher = new ParticipantPasswordHasher();
        var exercise = new Exercise
        {
            Id = Guid.NewGuid(),
            OrganizationId = Organization.DefaultOrganizationId,
            Name = "Equivalence",
            TimeZone = "America/Chicago",
            Status = "live",
        };
        var account = NewAccount(exercise.Id, role: "pio", personaId: Guid.NewGuid());
        account.CredentialHash = hasher.Hash("pw-equivalence-1");

        await using (var seed = _fixture.CreateContext())
        {
            seed.Exercises.Add(exercise);
            seed.Accounts.Add(account);
            await seed.SaveChangesAsync();
        }

        var issuer = new RecordingSessionIssuer();
        await using (var context = _fixture.CreateContext(new ExerciseContext { CurrentExerciseId = exercise.Id }))
        {
            var service = new ParticipantLoginService(
                context, new ExerciseContext { CurrentExerciseId = exercise.Id }, issuer, hasher);
            (await service.LoginAsync(new ParticipantLoginRequest { Username = account.Username, Password = "pw-equivalence-1" }))
                .Outcome.Should().Be(ParticipantLoginOutcome.Authenticated);
        }

        issuer.LastRequest.Should().BeEquivalentTo(
            ParticipantSessionRequests.For(account, exercise.Id),
            "the link and word sign-ins must mint exactly the session a password sign-in mints");
    }
}
