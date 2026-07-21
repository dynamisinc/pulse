namespace Pulse.WebApi.Tests.Features.Identity.Sessions;

using System;
using System.Linq;
using System.Threading.Tasks;
using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using Pulse.WebApi.Data;
using Pulse.WebApi.Data.Entities;
using Pulse.WebApi.Features.Identity.Sessions;
using Pulse.WebApi.Tests.Data;

/// <summary>
/// Integration tests for <see cref="SessionService"/> (story 03, COR-012 / XC-004 / NFR-009) against REAL SQL
/// Server (Testcontainers). Proves: <c>GET /api/session</c> resolves a live session and fails closed on
/// absent/expired/revoked (emitting <c>session.expired</c> on expiry); refresh renews + ROTATES both tokens,
/// preserves the binding, and emits <c>session.refreshed</c>; logout revokes server-side, emits <c>logout</c>,
/// and is idempotent — each session mutation + its lifecycle event committing in one unit of work.
/// </summary>
[Collection(MsSqlCollection.Name)]
public sealed class SessionServiceTests
{
    private readonly MsSqlContainerFixture _fixture;

    public SessionServiceTests(MsSqlContainerFixture fixture) => _fixture = fixture;

    private static SessionService ServiceFor(PulseDbContext context, SessionOptions? options = null) =>
        new(context, Options.Create(options ?? new SessionOptions()));

    private async Task SeedExerciseAsync(Guid exerciseId, DateTimeOffset? scenarioTime = null)
    {
        await using var seed = _fixture.CreateContext();
        seed.Exercises.Add(new Exercise
        {
            Id = exerciseId,
            Name = $"Exercise {exerciseId:N}",
            TimeZone = "America/Chicago",
            Status = "active",
            CurrentScenarioTime = scenarioTime,
        });
        await seed.SaveChangesAsync();
    }

    private async Task<Session> SeedSessionAsync(
        Guid exerciseId,
        string kind = "participant",
        string rawToken = "raw-token",
        string rawRefreshToken = "raw-refresh",
        DateTimeOffset? expiresAt = null,
        DateTimeOffset? refreshExpiresAt = null,
        DateTimeOffset? revokedAt = null,
        string principalId = "acct-1",
        string role = "participant",
        Guid? accountId = null,
        Guid? personaId = null,
        Guid? staffUserId = null,
        string actingHumanId = "human-1")
    {
        var session = new Session
        {
            Id = Guid.NewGuid(),
            TokenHash = SessionTokens.Hash(rawToken),
            RefreshTokenHash = SessionTokens.Hash(rawRefreshToken),
            Kind = kind,
            ExerciseId = exerciseId,
            PrincipalId = principalId,
            AccountId = accountId,
            StaffUserId = staffUserId,
            PersonaId = personaId,
            Role = role,
            ActingHumanId = actingHumanId,
            IsReadOnly = kind == "readonly",
            IssuedAt = DateTimeOffset.UtcNow.AddMinutes(-5),
            ExpiresAt = expiresAt ?? DateTimeOffset.UtcNow.AddHours(1),
            RefreshExpiresAt = refreshExpiresAt ?? DateTimeOffset.UtcNow.AddHours(12),
            RevokedAt = revokedAt,
        };

        await using var seed = _fixture.CreateContext();
        seed.Sessions.Add(session);
        await seed.SaveChangesAsync();
        return session;
    }

    private async Task<int> CountEventsAsync(Guid exerciseId, string eventType)
    {
        await using var read = _fixture.CreateContext();
        return await read.TelemetryEvents.IgnoreQueryFilters()
            .CountAsync(e => e.ExerciseId == exerciseId && e.EventType == eventType);
    }

    private async Task<TelemetryEvent> GetSingleEventAsync(Guid exerciseId, string eventType)
    {
        await using var read = _fixture.CreateContext();
        return await read.TelemetryEvents.IgnoreQueryFilters()
            .SingleAsync(e => e.ExerciseId == exerciseId && e.EventType == eventType);
    }

    // ---- GET /api/session -----------------------------------------------------------------------------

    [RequiresDockerFact]
    public async Task GetCurrent_LiveSession_ReturnsLive()
    {
        var exerciseId = Guid.NewGuid();
        await SeedSessionAsync(exerciseId, rawToken: "live-token");

        await using var context = _fixture.CreateContext();
        var result = await ServiceFor(context).GetCurrentAsync("live-token");

        result.Outcome.Should().Be(SessionQueryOutcome.Live);
        result.Session!.ExerciseId.Should().Be(exerciseId);
    }

    [RequiresDockerFact]
    public async Task GetCurrent_AbsentToken_ReturnsAbsent_NoTelemetry()
    {
        await using var context = _fixture.CreateContext();
        var result = await ServiceFor(context).GetCurrentAsync("unknown-token");

        result.Outcome.Should().Be(SessionQueryOutcome.Absent, "an unknown token resolves no session — 401");
    }

    [RequiresDockerFact]
    public async Task GetCurrent_ExpiredSession_ReturnsExpired_EmitsSessionExpired()
    {
        var exerciseId = Guid.NewGuid();
        await SeedExerciseAsync(exerciseId, new DateTimeOffset(2033, 6, 14, 9, 0, 0, TimeSpan.FromHours(-5)));
        await SeedSessionAsync(exerciseId, rawToken: "expired-token", expiresAt: DateTimeOffset.UtcNow.AddMinutes(-1));

        await using (var context = _fixture.CreateContext())
        {
            var result = await ServiceFor(context).GetCurrentAsync("expired-token");
            result.Outcome.Should().Be(SessionQueryOutcome.Expired, "an expired session forces re-auth (401)");
        }

        await using var verify = _fixture.CreateContext();
        var expired = await verify.TelemetryEvents.IgnoreQueryFilters()
            .Where(e => e.ExerciseId == exerciseId && e.EventType == "session.expired")
            .ToListAsync();
        expired.Should().ContainSingle("expiry-forcing-re-auth emits exactly one XC-004 session.expired event");
        expired[0].Actor.Kind.Should().Be("participant");
        expired[0].Actor.ParticipantId.Should().Be("acct-1");
        expired[0].Channel.Should().Be("system");
        expired[0].ScenarioTime.Should().Be(new DateTimeOffset(2033, 6, 14, 9, 0, 0, TimeSpan.FromHours(-5)),
            "scenario time is the exercise's stored CurrentScenarioTime (B2 placeholder)");
    }

    [RequiresDockerFact]
    public async Task GetCurrent_RevokedSession_ReturnsAbsent_NoTelemetry()
    {
        var exerciseId = Guid.NewGuid();
        await SeedSessionAsync(exerciseId, rawToken: "revoked-token", revokedAt: DateTimeOffset.UtcNow.AddMinutes(-1));

        await using (var context = _fixture.CreateContext())
        {
            var result = await ServiceFor(context).GetCurrentAsync("revoked-token");
            result.Outcome.Should().Be(SessionQueryOutcome.Absent, "a revoked session is not honored — 401");
        }

        (await CountEventsAsync(exerciseId, "session.expired")).Should().Be(0,
            "a revoked (not expired) session must not emit session.expired");
    }

    // ---- POST /api/auth/refresh -----------------------------------------------------------------------

    [RequiresDockerFact]
    public async Task Refresh_ValidRefreshToken_RotatesBothTokens_PreservesBinding_EmitsRefreshed()
    {
        var exerciseId = Guid.NewGuid();
        await SeedExerciseAsync(exerciseId);
        var original = await SeedSessionAsync(
            exerciseId,
            kind: "staff",
            rawToken: "old-access",
            rawRefreshToken: "old-refresh",
            expiresAt: DateTimeOffset.UtcNow.AddMinutes(-1), // access expired — refresh still open
            principalId: "staff-9",
            role: "controller");

        RefreshResult result;
        await using (var context = _fixture.CreateContext())
        {
            result = await ServiceFor(context).RefreshAsync("old-refresh");
        }

        result.Outcome.Should().Be(RefreshOutcome.Refreshed);
        result.SessionToken.Should().NotBe("old-access", "the access token is rotated on refresh");
        result.RefreshToken.Should().NotBe("old-refresh", "the refresh token is rotated (old one cannot be replayed)");

        await using var verify = _fixture.CreateContext();
        var renewed = await verify.Sessions.SingleAsync(s => s.Id == original.Id);

        // Binding is preserved verbatim — refresh never re-scopes.
        renewed.ExerciseId.Should().Be(exerciseId, "refresh preserves the bound exercise (never re-scopes)");
        renewed.PrincipalId.Should().Be("staff-9", "refresh preserves the bound principal");
        renewed.Kind.Should().Be("staff");
        renewed.Role.Should().Be("controller");
        renewed.ExpiresAt.Should().BeAfter(DateTimeOffset.UtcNow, "the renewed access window is in the future");

        // The rotated hashes match the new raw tokens; the OLD refresh token no longer resolves.
        renewed.TokenHash.Should().Be(SessionTokens.Hash(result.SessionToken!));
        renewed.RefreshTokenHash.Should().Be(SessionTokens.Hash(result.RefreshToken!));
        (await verify.Sessions.CountAsync(s => s.RefreshTokenHash == SessionTokens.Hash("old-refresh")))
            .Should().Be(0, "the old refresh token's hash is overwritten — a stolen old refresh reference cannot be replayed");

        (await CountEventsAsync(exerciseId, "session.refreshed")).Should().Be(1,
            "a refresh emits exactly one XC-004 session.refreshed event");
    }

    [RequiresDockerFact]
    public async Task Refresh_OldAccessTokenNoLongerResolves_AfterRotation()
    {
        var exerciseId = Guid.NewGuid();
        await SeedExerciseAsync(exerciseId);
        await SeedSessionAsync(exerciseId, rawToken: "access-1", rawRefreshToken: "refresh-1");

        await using (var refreshContext = _fixture.CreateContext())
        {
            (await ServiceFor(refreshContext).RefreshAsync("refresh-1")).Outcome.Should().Be(RefreshOutcome.Refreshed);
        }

        await using var context = _fixture.CreateContext();
        var result = await ServiceFor(context).GetCurrentAsync("access-1");

        result.Outcome.Should().Be(SessionQueryOutcome.Absent,
            "after rotation the OLD access token must no longer resolve any session");
    }

    [RequiresDockerFact]
    public async Task Refresh_OldRefreshToken_CannotBeReplayed_AfterRotation()
    {
        var exerciseId = Guid.NewGuid();
        await SeedExerciseAsync(exerciseId);
        await SeedSessionAsync(exerciseId, rawToken: "access-replay", rawRefreshToken: "refresh-replay");

        await using (var first = _fixture.CreateContext())
        {
            (await ServiceFor(first).RefreshAsync("refresh-replay")).Outcome.Should().Be(RefreshOutcome.Refreshed);
        }

        await using var replay = _fixture.CreateContext();
        var replayResult = await ServiceFor(replay).RefreshAsync("refresh-replay");

        replayResult.Outcome.Should().Be(RefreshOutcome.Invalid,
            "the OLD refresh token was rotated away by the first refresh — replaying it must fail closed (re-auth), never renew a second time");
    }

    [RequiresDockerFact]
    public async Task Refresh_NewlyRotatedTokens_BothWork_AccessAuthenticatesAndRefreshRenewsAgain()
    {
        var exerciseId = Guid.NewGuid();
        await SeedExerciseAsync(exerciseId);
        await SeedSessionAsync(exerciseId, rawToken: "access-before", rawRefreshToken: "refresh-before");

        RefreshResult firstRefresh;
        await using (var context = _fixture.CreateContext())
        {
            firstRefresh = await ServiceFor(context).RefreshAsync("refresh-before");
        }

        await using (var getContext = _fixture.CreateContext())
        {
            var getResult = await ServiceFor(getContext).GetCurrentAsync(firstRefresh.SessionToken);
            getResult.Outcome.Should().Be(SessionQueryOutcome.Live,
                "the freshly rotated access token must authenticate — the new tokens work, not just the old ones failing");
        }

        await using var secondRefreshContext = _fixture.CreateContext();
        var secondRefresh = await ServiceFor(secondRefreshContext).RefreshAsync(firstRefresh.RefreshToken);

        secondRefresh.Outcome.Should().Be(RefreshOutcome.Refreshed,
            "the freshly rotated refresh token must itself be usable for a subsequent refresh");
    }

    [RequiresDockerFact]
    public async Task Refresh_PreservesAccountIdAndPersonaId_ForParticipantSession()
    {
        var exerciseId = Guid.NewGuid();
        var accountId = Guid.NewGuid();
        var personaId = Guid.NewGuid();
        await SeedExerciseAsync(exerciseId);
        var original = await SeedSessionAsync(
            exerciseId,
            kind: "participant",
            rawToken: "persona-access",
            rawRefreshToken: "persona-refresh",
            principalId: accountId.ToString(),
            accountId: accountId,
            personaId: personaId,
            role: "pio");

        await using (var context = _fixture.CreateContext())
        {
            (await ServiceFor(context).RefreshAsync("persona-refresh")).Outcome.Should().Be(RefreshOutcome.Refreshed);
        }

        await using var verify = _fixture.CreateContext();
        var renewed = await verify.Sessions.SingleAsync(s => s.Id == original.Id);

        renewed.AccountId.Should().Be(accountId, "refresh must never re-scope the bound account");
        renewed.PersonaId.Should().Be(personaId, "refresh must preserve the bound persona verbatim — never re-scope it");
        renewed.Role.Should().Be("pio", "refresh must preserve the bound role verbatim");
    }

    [RequiresDockerFact]
    public Task Refresh_EmitsSessionRefreshedWithTheParticipantActorShape() =>
        AssertRefreshActorShapeAsync("participant");

    [RequiresDockerFact]
    public Task Refresh_EmitsSessionRefreshedWithTheStaffActorShape() =>
        AssertRefreshActorShapeAsync("staff");

    [RequiresDockerFact]
    public Task Refresh_EmitsSessionRefreshedWithTheReadOnlyActorShape() =>
        AssertRefreshActorShapeAsync("readonly");

    [RequiresDockerFact]
    public Task Logout_EmitsLogoutWithTheParticipantActorShape() =>
        AssertLogoutActorShapeAsync("participant");

    [RequiresDockerFact]
    public Task Logout_EmitsLogoutWithTheStaffActorShape() =>
        AssertLogoutActorShapeAsync("staff");

    [RequiresDockerFact]
    public Task Logout_EmitsLogoutWithTheReadOnlyActorShape() =>
        AssertLogoutActorShapeAsync("readonly");

    /// <summary>
    /// Shared body for the three per-kind <c>session.refreshed</c> actor-shape facts above. Not itself a test
    /// method (xUnit only auto-discovers <c>[RequiresDockerFact]</c>/<c>[Fact]</c>-attributed methods), which is
    /// exactly the point: <c>[Theory]</c>/<c>[InlineData]</c> would NOT get the Docker-availability skip
    /// treatment (only the <see cref="RequiresDockerFactAttribute"/> constructor sets <c>Skip</c>), so each kind
    /// is its own explicit fact.
    /// </summary>
    private async Task AssertRefreshActorShapeAsync(string kind)
    {
        var exerciseId = Guid.NewGuid();
        var principalId = Guid.NewGuid().ToString();
        await SeedExerciseAsync(exerciseId);
        await SeedSessionAsync(
            exerciseId,
            kind: kind,
            rawToken: $"actor-access-{kind}",
            rawRefreshToken: $"actor-refresh-{kind}",
            principalId: principalId,
            staffUserId: kind == "staff" ? Guid.NewGuid() : null,
            role: kind == "staff" ? "controller" : "participant",
            actingHumanId: "human-77");

        await using (var context = _fixture.CreateContext())
        {
            (await ServiceFor(context).RefreshAsync($"actor-refresh-{kind}")).Outcome.Should().Be(RefreshOutcome.Refreshed);
        }

        var evt = await GetSingleEventAsync(exerciseId, "session.refreshed");
        evt.Channel.Should().Be("system");
        AssertActorShapeForKind(evt.Actor, kind, principalId);
    }

    /// <summary>Shared body for the three per-kind <c>logout</c> actor-shape facts above (see the remarks on <see cref="AssertRefreshActorShapeAsync"/>).</summary>
    private async Task AssertLogoutActorShapeAsync(string kind)
    {
        var exerciseId = Guid.NewGuid();
        var principalId = Guid.NewGuid().ToString();
        await SeedExerciseAsync(exerciseId);
        await SeedSessionAsync(
            exerciseId,
            kind: kind,
            rawToken: $"logout-actor-{kind}",
            principalId: principalId,
            staffUserId: kind == "staff" ? Guid.NewGuid() : null,
            role: kind == "staff" ? "controller" : "participant",
            actingHumanId: "human-88");

        await using (var context = _fixture.CreateContext())
        {
            await ServiceFor(context).LogoutAsync($"logout-actor-{kind}");
        }

        var evt = await GetSingleEventAsync(exerciseId, "logout");
        evt.Channel.Should().Be("system");
        AssertActorShapeForKind(evt.Actor, kind, principalId);
    }

    /// <summary>
    /// Asserts the story-03 per-kind actor shape shared by <c>session.refreshed</c> / <c>session.expired</c> /
    /// <c>logout</c>: participant → <c>kind:'participant'</c> + <c>participantId</c>; read-only →
    /// <c>kind:'system'</c> + <c>sessionId</c> (the ephemeral identity, COR-015 — no named account); staff →
    /// <c>kind:'system'</c> + <c>role</c> + <c>actingHumanId</c>.
    /// </summary>
    private static void AssertActorShapeForKind(TelemetryActor actor, string kind, string principalId)
    {
        switch (kind)
        {
            case "participant":
                actor.Kind.Should().Be("participant");
                actor.ParticipantId.Should().Be(principalId);
                actor.Role.Should().BeNull("a participant actor carries no role field");
                actor.SessionId.Should().BeNull("a participant actor carries no sessionId field");
                break;
            case "readonly":
                actor.Kind.Should().Be("system", "a read-only session's actor is system-kind (COR-015 — no named account)");
                actor.SessionId.Should().Be(principalId, "the read-only actor's sessionId is the ephemeral identity");
                actor.ParticipantId.Should().BeNull();
                actor.Role.Should().BeNull();
                break;
            default: // staff (and any other non-participant/read-only kind)
                actor.Kind.Should().Be("system");
                actor.Role.Should().Be("controller");
                actor.ActingHumanId.Should().NotBeNullOrEmpty("staff attribution is per-human (COR-018)");
                actor.ParticipantId.Should().BeNull();
                actor.SessionId.Should().BeNull();
                break;
        }
    }

    [RequiresDockerFact]
    public async Task Refresh_ExpiredRefreshWindow_ReturnsInvalid()
    {
        var exerciseId = Guid.NewGuid();
        await SeedSessionAsync(
            exerciseId,
            rawRefreshToken: "lapsed-refresh",
            expiresAt: DateTimeOffset.UtcNow.AddMinutes(-30),
            refreshExpiresAt: DateTimeOffset.UtcNow.AddMinutes(-1));

        await using var context = _fixture.CreateContext();
        var result = await ServiceFor(context).RefreshAsync("lapsed-refresh");

        result.Outcome.Should().Be(RefreshOutcome.Invalid, "a lapsed refresh window forces a full re-login (fail closed)");
    }

    [RequiresDockerFact]
    public async Task Refresh_RevokedSession_ReturnsInvalid()
    {
        var exerciseId = Guid.NewGuid();
        await SeedSessionAsync(exerciseId, rawRefreshToken: "revoked-refresh", revokedAt: DateTimeOffset.UtcNow.AddMinutes(-1));

        await using var context = _fixture.CreateContext();
        var result = await ServiceFor(context).RefreshAsync("revoked-refresh");

        result.Outcome.Should().Be(RefreshOutcome.Invalid, "a revoked (logged-out) session cannot be refreshed");
    }

    // ---- POST /api/auth/logout ------------------------------------------------------------------------

    [RequiresDockerFact]
    public async Task Logout_LiveSession_RevokesServerSide_EmitsLogout()
    {
        var exerciseId = Guid.NewGuid();
        await SeedExerciseAsync(exerciseId);
        var session = await SeedSessionAsync(exerciseId, rawToken: "logout-token");

        await using (var context = _fixture.CreateContext())
        {
            await ServiceFor(context).LogoutAsync("logout-token");
        }

        await using var verify = _fixture.CreateContext();
        var stored = await verify.Sessions.SingleAsync(s => s.Id == session.Id);
        stored.RevokedAt.Should().NotBeNull("logout invalidates the session server-side so a stolen reference cannot be replayed");

        (await CountEventsAsync(exerciseId, "logout")).Should().Be(1, "logout emits exactly one XC-004 logout event");
    }

    [RequiresDockerFact]
    public async Task Logout_ThenGetCurrent_FailsClosed()
    {
        var exerciseId = Guid.NewGuid();
        await SeedExerciseAsync(exerciseId);
        await SeedSessionAsync(exerciseId, rawToken: "bye-token");

        await using (var logoutContext = _fixture.CreateContext())
        {
            await ServiceFor(logoutContext).LogoutAsync("bye-token");
        }

        await using var context = _fixture.CreateContext();
        (await ServiceFor(context).GetCurrentAsync("bye-token")).Outcome
            .Should().Be(SessionQueryOutcome.Absent, "a logged-out session's token must no longer resolve — the reference cannot be replayed");
    }

    [RequiresDockerFact]
    public async Task Logout_Idempotent_SecondCallEmitsNoSecondEvent()
    {
        var exerciseId = Guid.NewGuid();
        await SeedExerciseAsync(exerciseId);
        await SeedSessionAsync(exerciseId, rawToken: "twice-token");

        await using (var first = _fixture.CreateContext())
        {
            await ServiceFor(first).LogoutAsync("twice-token");
        }

        await using (var second = _fixture.CreateContext())
        {
            await ServiceFor(second).LogoutAsync("twice-token");
        }

        (await CountEventsAsync(exerciseId, "logout")).Should().Be(1,
            "logging out an already-revoked session is an idempotent no-op — no second logout event");
    }

    [RequiresDockerFact]
    public async Task Logout_UnknownToken_NoOp_NoEvent()
    {
        var exerciseId = Guid.NewGuid();
        await SeedExerciseAsync(exerciseId);

        await using (var context = _fixture.CreateContext())
        {
            await ServiceFor(context).LogoutAsync("never-issued");
        }

        (await CountEventsAsync(exerciseId, "logout")).Should().Be(0, "an unknown token has nothing to invalidate");
    }

    // ---- No `login` event anywhere on the session-lifecycle path (that is the login METHOD's concern) --------

    [RequiresDockerFact]
    public async Task SessionLifecycle_RefreshLogoutAndExpiry_NeverEmitALoginEvent()
    {
        // Story 03 deliberately owns only session.refreshed / session.expired / logout — never `login` (see the
        // SessionService / SessionIssuer class remarks). Drive all three lifecycle paths for the SAME exercise
        // and assert the login event type never appears among them.
        var exerciseId = Guid.NewGuid();
        await SeedExerciseAsync(exerciseId);
        await SeedSessionAsync(exerciseId, rawToken: "life-access", rawRefreshToken: "life-refresh");
        await SeedSessionAsync(exerciseId, rawToken: "life-expired", expiresAt: DateTimeOffset.UtcNow.AddMinutes(-1));
        await SeedSessionAsync(exerciseId, rawToken: "life-logout");

        await using (var context = _fixture.CreateContext())
        {
            var service = ServiceFor(context);
            (await service.RefreshAsync("life-refresh")).Outcome.Should().Be(RefreshOutcome.Refreshed);
            (await service.GetCurrentAsync("life-expired")).Outcome.Should().Be(SessionQueryOutcome.Expired);
            await service.LogoutAsync("life-logout");
        }

        (await CountEventsAsync(exerciseId, "login")).Should().Be(0,
            "the session-lifecycle service never emits a `login` event — that is the login method's (02/05/06) own concern");
    }
}
