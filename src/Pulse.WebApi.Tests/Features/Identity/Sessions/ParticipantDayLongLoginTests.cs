namespace Pulse.WebApi.Tests.Features.Identity.Sessions;

using System;
using System.Threading.Tasks;
using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;
using Pulse.WebApi.Data;
using Pulse.WebApi.Data.Entities;
using Pulse.WebApi.Features.Identity.Accounts;
using Pulse.WebApi.Features.Identity.EasyLogin;
using Pulse.WebApi.Features.Identity.Sessions;
using Pulse.WebApi.Tests.Data;
using Pulse.WebApi.Tests.Features.EngineRuntime.Clock;

/// <summary>
/// Easy-login story 06 (EL-10), end to end through a real login method (Gate-1 S-6): a participant who signs in with
/// <see cref="ParticipantLoginService"/> (the password path) on exercise day N gets a session minted by the REAL
/// <see cref="SessionIssuer"/> whose refresh window ends at day N's end in the exercise's own zone, and whose access
/// token is the usual 60 minutes. The issuer is the only thing the cap depends on, so the link and word sign-ins (which
/// mint through the same issuer with the same kind via <see cref="ParticipantSessionRequests"/>) are capped alike.
/// </summary>
[Collection(MsSqlCollection.Name)]
public sealed class ParticipantDayLongLoginTests
{
    private const string NewYork = "America/New_York";

    private readonly MsSqlContainerFixture _fixture;
    private readonly ParticipantPasswordHasher _hasher = new();

    public ParticipantDayLongLoginTests(MsSqlContainerFixture fixture) => _fixture = fixture;

    [RequiresDockerFact]
    public async Task PasswordLogin_OnExerciseDayN_GetsARefreshWindowEndingAtDayNsEnd()
    {
        var exerciseId = Guid.NewGuid();
        var accountId = Guid.NewGuid();
        await using (var seed = _fixture.CreateContext())
        {
            seed.Exercises.Add(new Exercise
            {
                OrganizationId = Organization.DefaultOrganizationId,
                Id = exerciseId,
                Name = "Day-long login",
                TimeZone = NewYork,
                Status = "live",
            });
            seed.Accounts.Add(new Account
            {
                Id = accountId,
                ExerciseId = exerciseId,
                Username = "dayn-user",
                DisplayName = "Day N",
                CredentialHash = _hasher.Hash("pw-day-n-123"),
                CreatedAt = DateTimeOffset.UtcNow,
                Enrollment = new Enrollment { Id = Guid.NewGuid(), ExerciseId = exerciseId, Role = "participant" },
            });
            await seed.SaveChangesAsync();
        }

        // 11:00 EDT on 14 Oct 2026: exercise day N is the 14th, which ends at local midnight = 04:00Z on the 15th.
        var clock = new ManualTimeProvider(new DateTimeOffset(2026, 10, 14, 15, 0, 0, TimeSpan.Zero));
        var dayN = new DateOnly(2026, 10, 14);

        ParticipantLoginResult result;
        await using (var context = _fixture.CreateContext(new ExerciseContext { CurrentExerciseId = exerciseId }))
        {
            var issuer = new SessionIssuer(
                context,
                Options.Create(new SessionOptions()),
                new ExerciseFactsReader(context),
                Options.Create(new EasyLoginOptions()),
                clock,
                NullLogger<SessionIssuer>.Instance);
            var login = new ParticipantLoginService(
                context, new ExerciseContext { CurrentExerciseId = exerciseId }, issuer, _hasher);

            result = await login.LoginAsync(new ParticipantLoginRequest { Username = "dayn-user", Password = "pw-day-n-123" });
        }

        result.Outcome.Should().Be(ParticipantLoginOutcome.Authenticated);
        var issued = result.Issued!.Session;
        ExerciseDay.Today(NewYork, issued.IssuedAt, 0).Should().Be(dayN, "the login happened on exercise day N");
        issued.Kind.Should().Be(ParticipantSessionRequests.ParticipantSessionKind);
        issued.RefreshExpiresAt.Should().Be(ExerciseDay.EndOfDayUtc(NewYork, dayN, 0),
            "a password login on day N gets a refresh window that ends at day N's end in the exercise zone");
        issued.RefreshExpiresAt.Should().Be(new DateTimeOffset(2026, 10, 15, 4, 0, 0, TimeSpan.Zero));
        issued.ExpiresAt.Should().Be(new DateTimeOffset(2026, 10, 14, 16, 0, 0, TimeSpan.Zero), "the access token stays 60 minutes");

        await using var verify = _fixture.CreateContext();
        var stored = await verify.Sessions.SingleAsync(s => s.Id == issued.Id && s.ExerciseId == exerciseId);
        stored.AccountId.Should().Be(accountId);
        stored.RefreshExpiresAt.Should().Be(issued.RefreshExpiresAt, "the persisted row carries the day cap");
        stored.ExpiresAt.Should().Be(issued.ExpiresAt);
    }
}
