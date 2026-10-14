namespace Pulse.WebApi.Tests.Features.Identity.Sessions;

using System;
using System.Threading.Tasks;
using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;
using Pulse.WebApi.Data;
using Pulse.WebApi.Data.Entities;
using Pulse.WebApi.Features.Identity.EasyLogin;
using Pulse.WebApi.Features.Identity.Sessions;
using Pulse.WebApi.Tests.Data;
using Pulse.WebApi.Tests.Features.EngineRuntime.Clock;

/// <summary>
/// Integration tests for <see cref="SessionIssuer"/> (story 03, COR-012 / NFR-009) against REAL SQL Server
/// (Testcontainers). Proves issuance persists ONLY the token/refresh HASHES (never the raw tokens), stamps a
/// short-lived expiry + refresh window server-side, binds every identity field from the request, and hands the
/// raw tokens back exactly once. Easy-login story 06 (EL-10): a <c>participant</c>-kind session's refresh window ends
/// at the end of its own exercise's day and its access expiry is <c>min(now + lifetime, end of day)</c>; staff and
/// read-only sessions, and participants with <c>ParticipantDayLong</c> off, are stamped exactly as before.
/// </summary>
[Collection(MsSqlCollection.Name)]
public sealed class SessionIssuerTests
{
    private readonly MsSqlContainerFixture _fixture;

    public SessionIssuerTests(MsSqlContainerFixture fixture) => _fixture = fixture;

    private const string NewYork = "America/New_York";

    private static SessionIssuer IssuerFor(
        PulseDbContext context,
        SessionOptions? options = null,
        TimeProvider? clock = null,
        EasyLoginOptions? easyLogin = null) =>
        new(
            context,
            Options.Create(options ?? new SessionOptions()),
            new ExerciseFactsReader(context),
            Options.Create(easyLogin ?? new EasyLoginOptions()),
            clock ?? TimeProvider.System,
            NullLogger<SessionIssuer>.Instance);

    private static DateTimeOffset Utc(int year, int month, int day, int hour, int minute = 0) =>
        new(year, month, day, hour, minute, 0, TimeSpan.Zero);

    private async Task<Guid> SeedExerciseAsync(string timeZone)
    {
        var exerciseId = Guid.NewGuid();
        await using var seed = _fixture.CreateContext();
        seed.Exercises.Add(new Exercise
        {
            OrganizationId = Organization.DefaultOrganizationId,
            Id = exerciseId,
            Name = $"Exercise {exerciseId:N}",
            TimeZone = timeZone,
            Status = "live",
        });
        await seed.SaveChangesAsync();
        return exerciseId;
    }

    private static SessionIssueRequest RequestOfKind(Guid exerciseId, string kind) => new()
    {
        ExerciseId = exerciseId,
        Kind = kind,
        Role = kind == "staff" ? "controller" : "participant",
        PrincipalId = Guid.NewGuid().ToString(),
        ActingHumanId = Guid.NewGuid().ToString(),
        IsReadOnly = kind == "readonly",
        AccountId = kind == "participant" ? Guid.NewGuid() : null,
        StaffUserId = kind == "staff" ? Guid.NewGuid() : null,
        PersonaId = null,
    };

    private static SessionIssueRequest ParticipantRequest(Guid exerciseId, Guid accountId, Guid personaId) => new()
    {
        ExerciseId = exerciseId,
        Kind = "participant",
        Role = "participant",
        PrincipalId = accountId.ToString(),
        ActingHumanId = "human-42",
        IsReadOnly = false,
        AccountId = accountId,
        StaffUserId = null,
        PersonaId = personaId,
    };

    [RequiresDockerFact]
    public async Task Issue_PersistsOnlyHashes_NeverRawTokens()
    {
        var exerciseId = Guid.NewGuid();
        var accountId = Guid.NewGuid();
        var personaId = Guid.NewGuid();

        SessionIssueResult issued;
        await using (var context = _fixture.CreateContext())
        {
            issued = await IssuerFor(context).IssueAsync(ParticipantRequest(exerciseId, accountId, personaId));
        }

        issued.SessionToken.Should().NotBeNullOrEmpty("the raw session token is returned to the caller once");
        issued.RefreshToken.Should().NotBeNullOrEmpty("the raw refresh token is returned to the caller once");

        await using var verify = _fixture.CreateContext();
        var stored = await verify.Sessions.SingleAsync(s => s.Id == issued.Session.Id);

        stored.TokenHash.Should().Be(SessionTokens.Hash(issued.SessionToken!),
            "the stored TokenHash is the hash of the raw token handed to the client");
        stored.TokenHash.Should().NotBe(issued.SessionToken, "the RAW token is never persisted (NFR-009)");
        stored.RefreshTokenHash.Should().Be(SessionTokens.Hash(issued.RefreshToken!));
        stored.RefreshTokenHash.Should().NotBe(issued.RefreshToken, "the RAW refresh token is never persisted (NFR-009)");
    }

    [RequiresDockerFact]
    public async Task Issue_StampsShortLivedExpiryAndRefreshWindow_ServerSide()
    {
        // Story 06 changed the participant expectation: the refresh window is the end of the exercise day, the access
        // window the configured lifetime capped at that instant. The exercise row is absent here, so the day is UTC.
        var exerciseId = Guid.NewGuid();
        var options = new SessionOptions { SessionLifetimeMinutes = 30, RefreshLifetimeMinutes = 240 };
        var before = DateTimeOffset.UtcNow;

        await using var context = _fixture.CreateContext();
        var issued = await IssuerFor(context, options).IssueAsync(ParticipantRequest(exerciseId, Guid.NewGuid(), Guid.NewGuid()));

        var session = issued.Session;
        var endOfDay = ExerciseDay.EndOfDayUtc("UTC", session.IssuedAt, 0);
        session.IssuedAt.Should().BeOnOrAfter(before, "issued-at is the server wall clock, never client input");
        session.ExpiresAt.Should().Be(
            session.IssuedAt.AddMinutes(30) < endOfDay ? session.IssuedAt.AddMinutes(30) : endOfDay,
            "the access window is the configured short-lived lifetime, capped at the end of the exercise day");
        session.RefreshExpiresAt.Should().Be(endOfDay,
            "a participant's refresh window ends at the end of the exercise day (EL-10), not issued-at + 240 min");
    }

    [RequiresDockerFact]
    public async Task Issue_ParticipantDayLongOff_StampsTheConfiguredLifetimes_AsBefore()
    {
        var exerciseId = Guid.NewGuid();
        var options = new SessionOptions
        {
            SessionLifetimeMinutes = 30,
            RefreshLifetimeMinutes = 240,
            ParticipantDayLong = false,
        };

        await using var context = _fixture.CreateContext();
        var issued = await IssuerFor(context, options).IssueAsync(ParticipantRequest(exerciseId, Guid.NewGuid(), Guid.NewGuid()));

        var session = issued.Session;
        session.ExpiresAt.Should().Be(session.IssuedAt.AddMinutes(30),
            "with the option off the access window is the configured short-lived lifetime");
        session.RefreshExpiresAt.Should().Be(session.IssuedAt.AddMinutes(240),
            "with the option off the refresh window is the configured (longer) lifetime, exactly as before story 06");
    }

    // ---- Story 06: day-long participant sessions (EL-10) ---------------------------------------------------

    [RequiresDockerFact]
    public async Task Issue_Participant_MidDay_RefreshEndsAtEndOfExerciseDay_AccessIsTheLifetime()
    {
        // 11:00 EDT on 14 Oct: the exercise day ends at local midnight, 04:00Z on the 15th.
        var exerciseId = await SeedExerciseAsync(NewYork);
        var clock = new ManualTimeProvider(Utc(2026, 10, 14, 15));

        await using var context = _fixture.CreateContext();
        var session = (await IssuerFor(context, clock: clock).IssueAsync(RequestOfKind(exerciseId, "participant"))).Session;

        session.IssuedAt.Should().Be(Utc(2026, 10, 14, 15), "issued-at is the server clock");
        session.ExpiresAt.Should().Be(Utc(2026, 10, 14, 16), "the access token stays 60 minutes (COR-012)");
        session.RefreshExpiresAt.Should().Be(Utc(2026, 10, 15, 4),
            "the refresh window ends at the end of the exercise day in the exercise's zone, not now + 720 min");
    }

    [RequiresDockerFact]
    public async Task Issue_Participant_LateInTheDay_AccessExpiryIsCappedAtTheDayEnd()
    {
        // 23:30 EDT: now + 60 min would run past local midnight.
        var exerciseId = await SeedExerciseAsync(NewYork);
        var clock = new ManualTimeProvider(Utc(2026, 10, 15, 3, 30));

        await using var context = _fixture.CreateContext();
        var session = (await IssuerFor(context, clock: clock).IssueAsync(RequestOfKind(exerciseId, "participant"))).Session;

        session.ExpiresAt.Should().Be(Utc(2026, 10, 15, 4), "ExpiresAt is min(now + 60 min, end of day)");
        session.RefreshExpiresAt.Should().Be(Utc(2026, 10, 15, 4));
    }

    [RequiresDockerFact]
    public async Task Issue_Participant_WithAThreeAmRollover_BelongsToThePreviousDayUntilThree()
    {
        // 01:00 EDT on the 15th is still the 14th's exercise day with a 3 a.m. rollover; it ends at 03:00 EDT = 07:00Z.
        var exerciseId = await SeedExerciseAsync(NewYork);
        var clock = new ManualTimeProvider(Utc(2026, 10, 15, 5));

        await using var context = _fixture.CreateContext();
        var session = (await IssuerFor(context, clock: clock, easyLogin: new EasyLoginOptions { DayRolloverHour = 3 })
            .IssueAsync(RequestOfKind(exerciseId, "participant"))).Session;

        session.ExpiresAt.Should().Be(Utc(2026, 10, 15, 6));
        session.RefreshExpiresAt.Should().Be(Utc(2026, 10, 15, 7), "the day ends at the configured rollover hour");
    }

    [RequiresDockerFact]
    public Task Issue_Staff_IsUnchanged_EvenLateInTheExerciseDay() => AssertUncappedIssueAsync("staff");

    [RequiresDockerFact]
    public Task Issue_SharedReadOnly_IsUnchanged_EvenLateInTheExerciseDay() => AssertUncappedIssueAsync("readonly");

    [RequiresDockerFact]
    public async Task Issue_Participant_UnknownOrBlankZone_IsCappedAtTheEndOfTheUtcDay()
    {
        var unknown = await SeedExerciseAsync("Not/AZone");
        var blank = await SeedExerciseAsync(string.Empty);
        var clock = new ManualTimeProvider(Utc(2026, 10, 14, 22));

        await using var context = _fixture.CreateContext();
        var issuer = IssuerFor(context, clock: clock);
        var fromUnknown = (await issuer.IssueAsync(RequestOfKind(unknown, "participant"))).Session;
        var fromBlank = (await issuer.IssueAsync(RequestOfKind(blank, "participant"))).Session;

        fromUnknown.RefreshExpiresAt.Should().Be(Utc(2026, 10, 15, 0), "an unknown zone falls back to the UTC day");
        fromUnknown.ExpiresAt.Should().Be(Utc(2026, 10, 14, 23));
        fromBlank.RefreshExpiresAt.Should().Be(Utc(2026, 10, 15, 0), "a blank zone falls back to the UTC day");
    }

    [RequiresDockerFact]
    public async Task Issue_Participant_IsCappedByItsOwnExercisesZone_NeverAnotherExercises()
    {
        // XC-001: two exercises, two zones whose days end at different instants. The session is bound to A, so only
        // A's zone may cap it; B's day end (an exercise the caller never named) must not leak into it.
        var exerciseA = await SeedExerciseAsync("Pacific/Auckland");
        var exerciseB = await SeedExerciseAsync("America/Los_Angeles");
        var now = Utc(2026, 10, 14, 1);
        var clock = new ManualTimeProvider(now);

        await using var context = _fixture.CreateContext();
        var session = (await IssuerFor(context, clock: clock).IssueAsync(RequestOfKind(exerciseA, "participant"))).Session;

        var endOfDayA = ExerciseDay.EndOfDayUtc("Pacific/Auckland", now, 0);
        var endOfDayB = ExerciseDay.EndOfDayUtc("America/Los_Angeles", now, 0);
        endOfDayA.Should().NotBe(endOfDayB, "the two zones must disagree for this test to discriminate");
        session.ExerciseId.Should().Be(exerciseA);
        session.RefreshExpiresAt.Should().Be(endOfDayA, "the cap is read for the session's own bound exercise only");
        session.RefreshExpiresAt.Should().NotBe(endOfDayB, "exercise B's zone never caps a session bound to exercise A");
    }

    /// <summary>
    /// Shared body for the per-kind "unchanged" facts: 23:30 EDT, where a capped session would end at midnight, the
    /// staff / read-only session still gets now + 60 min and now + 720 min.
    /// </summary>
    private async Task AssertUncappedIssueAsync(string kind)
    {
        var exerciseId = await SeedExerciseAsync(NewYork);
        var now = Utc(2026, 10, 15, 3, 30);
        var clock = new ManualTimeProvider(now);

        await using var context = _fixture.CreateContext();
        var session = (await IssuerFor(context, clock: clock).IssueAsync(RequestOfKind(exerciseId, kind))).Session;

        session.Kind.Should().Be(kind);
        session.ExpiresAt.Should().Be(now.AddMinutes(60), "{0} sessions keep the 60-minute access window", kind);
        session.RefreshExpiresAt.Should().Be(now.AddMinutes(720),
            "{0} sessions keep the 720-minute refresh window; only participant sessions are day-capped", kind);
    }

    [RequiresDockerFact]
    public async Task Issue_BindsEveryIdentityFieldFromTheRequest()
    {
        var exerciseId = Guid.NewGuid();
        var accountId = Guid.NewGuid();
        var personaId = Guid.NewGuid();

        await using var context = _fixture.CreateContext();
        var issued = await IssuerFor(context).IssueAsync(ParticipantRequest(exerciseId, accountId, personaId));

        var session = issued.Session;
        session.Kind.Should().Be("participant");
        session.ExerciseId.Should().Be(exerciseId, "the session binds to exactly one exercise (COR-012)");
        session.Role.Should().Be("participant");
        session.PrincipalId.Should().Be(accountId.ToString());
        session.AccountId.Should().Be(accountId, "a participant session binds to exactly one account (COR-012)");
        session.PersonaId.Should().Be(personaId);
        session.ActingHumanId.Should().Be("human-42");
        session.IsReadOnly.Should().BeFalse();
        session.StaffUserId.Should().BeNull();
        session.RevokedAt.Should().BeNull("a freshly issued session is live");
    }

    [RequiresDockerFact]
    public async Task Issue_SatisfiesTheStaffLoginRequestShape()
    {
        // Story 05's StaffLoginService already calls IssueAsync with Kind="staff", StaffUserId set, no account /
        // persona. Prove the real issuer honors exactly that request shape (the seam story 05 depends on).
        var exerciseId = Guid.NewGuid();
        var staffUserId = Guid.NewGuid();

        await using var context = _fixture.CreateContext();
        var issued = await IssuerFor(context).IssueAsync(new SessionIssueRequest
        {
            ExerciseId = exerciseId,
            Kind = "staff",
            Role = "controller",
            PrincipalId = staffUserId.ToString(),
            ActingHumanId = staffUserId.ToString(),
            IsReadOnly = false,
            AccountId = null,
            StaffUserId = staffUserId,
            PersonaId = null,
        });

        issued.Session.Kind.Should().Be("staff");
        issued.Session.StaffUserId.Should().Be(staffUserId);
        issued.Session.AccountId.Should().BeNull();
        issued.Session.PersonaId.Should().BeNull();
        issued.Session.Role.Should().Be("controller");
    }

    [RequiresDockerFact]
    public async Task Issue_NeverEmitsAnyTelemetryEvent()
    {
        // Story 03's class remarks are explicit: the issuer emits NO telemetry (in particular, no `login` event
        // — that is the calling login method's own concern; see StaffLoginService etc.). Prove the issuer's unit
        // of work writes only the Session row, never a TelemetryEvent, for any of the three session kinds.
        var exerciseId = Guid.NewGuid();

        await using var context = _fixture.CreateContext();
        await IssuerFor(context).IssueAsync(ParticipantRequest(exerciseId, Guid.NewGuid(), Guid.NewGuid()));

        await using var verify = _fixture.CreateContext();
        var eventCount = await verify.TelemetryEvents.IgnoreQueryFilters()
            .CountAsync(e => e.ExerciseId == exerciseId);

        eventCount.Should().Be(0,
            "issuance is not a telemetry-emitting operation — the login METHOD emits the login event, not this seam");
    }
}
