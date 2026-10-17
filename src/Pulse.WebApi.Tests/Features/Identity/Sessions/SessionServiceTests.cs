namespace Pulse.WebApi.Tests.Features.Identity.Sessions;

using System;
using System.Linq;
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
/// Integration tests for <see cref="SessionService"/> (story 03, COR-012 / XC-004 / NFR-009) against REAL SQL
/// Server (Testcontainers). Proves: <c>GET /api/session</c> resolves a live session and fails closed on
/// absent/expired/revoked (emitting <c>session.expired</c> on expiry); refresh renews + ROTATES both tokens,
/// preserves the binding, and emits <c>session.refreshed</c>; logout revokes server-side, emits <c>logout</c>,
/// and is idempotent — each session mutation + its lifecycle event committing in one unit of work. Easy-login
/// story 06 (EL-10, EL-11): a participant refresh is capped at the end of the CURRENT exercise day (never now + 720 min,
/// never the next day) and refused with no event once that day has ended; staff, read-only and option-off sessions
/// slide exactly as before; a revoked session stays refused; scenario time / zone on <c>session.refreshed</c> are
/// unchanged.
/// </summary>
[Collection(MsSqlCollection.Name)]
public sealed class SessionServiceTests
{
    private readonly MsSqlContainerFixture _fixture;

    public SessionServiceTests(MsSqlContainerFixture fixture) => _fixture = fixture;

    private const string NewYork = "America/New_York";

    private static SessionService ServiceFor(
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
            NullLogger<SessionService>.Instance);

    private static DateTimeOffset Utc(int year, int month, int day, int hour, int minute = 0, int second = 0) =>
        new(year, month, day, hour, minute, second, TimeSpan.Zero);

    private async Task SeedExerciseAsync(
        Guid exerciseId,
        DateTimeOffset? scenarioTime = null,
        string timeZone = "America/Chicago",
        string status = "active")
    {
        await using var seed = _fixture.CreateContext();
        seed.Exercises.Add(new Exercise
        {
            OrganizationId = Organization.DefaultOrganizationId,
            Id = exerciseId,
            Name = $"Exercise {exerciseId:N}",
            TimeZone = timeZone,
            Status = status,
            CurrentScenarioTime = scenarioTime,
        });
        await seed.SaveChangesAsync();
    }

    private async Task<Session> SeedSessionAsync(
        Guid exerciseId,
        string kind = "participant",
        string? rawToken = null,
        string? rawRefreshToken = null,
        DateTimeOffset? expiresAt = null,
        DateTimeOffset? refreshExpiresAt = null,
        DateTimeOffset? revokedAt = null,
        string principalId = "acct-1",
        string role = "participant",
        Guid? accountId = null,
        Guid? personaId = null,
        Guid? staffUserId = null,
        string actingHumanId = "human-1",
        DateTimeOffset? issuedAt = null)
    {
        // The single collection shares ONE database with NO per-test reset, so IX_Sessions_TokenHash (unique)
        // and IX_Sessions_RefreshTokenHash (unique, filtered on non-null) are GLOBAL across every session-seeding
        // test. Default each un-overridden raw token to a fresh GUID-derived value so the seeded hashes are
        // globally unique in any execution order — no authenticating test relies on these defaults (every one
        // passes an explicit rawToken/rawRefreshToken), so uniqueness here is safe.
        rawToken ??= $"seed-access-{Guid.NewGuid():N}";
        rawRefreshToken ??= $"seed-refresh-{Guid.NewGuid():N}";

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
            // "Now" by default (it was now - 5 min): story 06 caps a participant refresh at the end of the day of the
            // session's last issue/refresh, so a seed five minutes in the past would make the participant refresh
            // tests below fail closed for the first five minutes after the exercise zone's midnight.
            IssuedAt = issuedAt ?? DateTimeOffset.UtcNow,
            ExpiresAt = expiresAt ?? DateTimeOffset.UtcNow.AddHours(1),
            RefreshExpiresAt = refreshExpiresAt ?? DateTimeOffset.UtcNow.AddHours(12),
            RevokedAt = revokedAt,
        };

        await using var seed = _fixture.CreateContext();
        seed.Sessions.Add(session);
        await seed.SaveChangesAsync();
        return session;
    }

    private async Task<Account> SeedAccountAsync(Guid exerciseId, DateTimeOffset? disabledAt)
    {
        var id = Guid.NewGuid();
        var account = new Account
        {
            Id = id,
            ExerciseId = exerciseId,
            Username = $"acct{id:N}"[..30],
            DisplayName = "Pat Participant",
            CreatedAt = DateTimeOffset.UtcNow,
            DisabledAt = disabledAt,
            Enrollment = new Enrollment { Id = Guid.NewGuid(), ExerciseId = exerciseId, Role = "participant" },
        };

        await using var seed = _fixture.CreateContext();
        seed.Accounts.Add(account);
        await seed.SaveChangesAsync();
        return account;
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
        // Globally-unique per-seed token: "expired-token" was a cross-file literal shared with
        // SessionScopeIsolationTests, colliding on the shared-DB IX_Sessions_TokenHash.
        var token = $"expired-{Guid.NewGuid():N}";
        await SeedExerciseAsync(exerciseId, new DateTimeOffset(2033, 6, 14, 9, 0, 0, TimeSpan.FromHours(-5)));
        await SeedSessionAsync(exerciseId, rawToken: token, expiresAt: DateTimeOffset.UtcNow.AddMinutes(-1));

        await using (var context = _fixture.CreateContext())
        {
            var result = await ServiceFor(context).GetCurrentAsync(token);
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
        var personaId = Guid.NewGuid();
        await SeedExerciseAsync(exerciseId);

        // A real, enabled account: refresh renews a participant session only while one exists in its exercise
        // (easy-login Gate-2 S-1, fail closed).
        var accountId = (await SeedAccountAsync(exerciseId, disabledAt: null)).Id;
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

    [RequiresDockerFact]
    public async Task Refresh_ParticipantWhoseAccountIsDisabled_IsRefusedLikeARevokedSession_WithNoEventAndNoWrite()
    {
        // easy-login Gate-2 W-001: a sign-in that raced a Disable can hold a session the Disable's sweep never saw. Refresh
        // refuses a participant session whose account is disabled exactly as it refuses a revoked one (401, no event,
        // nothing written), so such a session outlives the Disable by at most one access-token lifetime. The context is
        // UNSCOPED on purpose: the check must not depend on the refresh request's own resolved scope (a filtered read
        // would see no account there and renew).
        var exerciseId = Guid.NewGuid();
        await SeedExerciseAsync(exerciseId);
        var disabled = await SeedAccountAsync(exerciseId, disabledAt: DateTimeOffset.UtcNow.AddMinutes(-1));
        var enabled = await SeedAccountAsync(exerciseId, disabledAt: null);
        var disabledRefresh = $"disabled-refresh-{Guid.NewGuid():N}";
        var enabledRefresh = $"enabled-refresh-{Guid.NewGuid():N}";
        var disabledSession = await SeedSessionAsync(
            exerciseId, rawRefreshToken: disabledRefresh, accountId: disabled.Id, principalId: disabled.Id.ToString());
        await SeedSessionAsync(exerciseId, rawRefreshToken: enabledRefresh, accountId: enabled.Id, principalId: enabled.Id.ToString());

        RefreshResult refused;
        RefreshResult renewed;
        await using (var context = _fixture.CreateContext())
        {
            refused = await ServiceFor(context).RefreshAsync(disabledRefresh);
        }

        await using (var context = _fixture.CreateContext())
        {
            renewed = await ServiceFor(context).RefreshAsync(enabledRefresh);
        }

        refused.Outcome.Should().Be(RefreshOutcome.Invalid, "a disabled participant cannot renew (the ordinary fail-closed 401)");
        refused.SessionToken.Should().BeNull();
        renewed.Outcome.Should().Be(RefreshOutcome.Refreshed, "anti-vacuity: the same session for an enabled account renews");

        await using var verify = _fixture.CreateContext();
        var stored = await verify.Sessions.AsNoTracking().SingleAsync(x => x.Id == disabledSession.Id);
        stored.Should().BeEquivalentTo(disabledSession, "the refusal writes nothing: no rotation, no new window, no RevokedAt");
        (await CountEventsAsync(exerciseId, "session.refreshed")).Should().Be(1, "only the enabled account's refresh emits an event");
    }

    [RequiresDockerFact]
    public async Task Refresh_ParticipantWhoseAccountDoesNotExist_IsRefused_FailClosed()
    {
        // easy-login Gate-2 S-1: the check is "an ENABLED account with this id exists in the session's exercise", not
        // "the account is not disabled", so an account that is gone (or was never there) cannot keep a session renewing.
        var exerciseId = Guid.NewGuid();
        await SeedExerciseAsync(exerciseId);
        var ghost = Guid.NewGuid();
        var refresh = $"ghost-refresh-{Guid.NewGuid():N}";
        await SeedSessionAsync(exerciseId, rawRefreshToken: refresh, accountId: ghost, principalId: ghost.ToString());

        await using var context = _fixture.CreateContext();
        (await ServiceFor(context).RefreshAsync(refresh)).Outcome.Should().Be(
            RefreshOutcome.Invalid, "no enabled account with the session's AccountId exists in its exercise");
        (await CountEventsAsync(exerciseId, "session.refreshed")).Should().Be(0);
    }

    [RequiresDockerFact]
    public async Task Refresh_AnotherExercisesAccount_NeverDecidesThisExercisesRefresh()
    {
        // easy-login Gate-2 W-1 (isolation, always-Critical): the account check ignores the central filter and relies on an
        // explicit ExerciseId predicate instead. Pin it: a participant session bound to exercise B whose AccountId names
        // an account of exercise A is refused whatever that account's state, and whatever exercise the refresh REQUEST
        // resolved to (unset, A or B). A's own session on the same account renews, so the zero is the predicate, not a
        // missing row.
        var exerciseA = Guid.NewGuid();
        var exerciseB = Guid.NewGuid();
        await SeedExerciseAsync(exerciseA);
        await SeedExerciseAsync(exerciseB);
        var accountInA = await SeedAccountAsync(exerciseA, disabledAt: null);
        var refreshB = $"cross-b-refresh-{Guid.NewGuid():N}";
        var refreshA = $"cross-a-refresh-{Guid.NewGuid():N}";
        var sessionB = await SeedSessionAsync(
            exerciseB, rawRefreshToken: refreshB, accountId: accountInA.Id, principalId: accountInA.Id.ToString());
        await SeedSessionAsync(exerciseA, rawRefreshToken: refreshA, accountId: accountInA.Id, principalId: accountInA.Id.ToString());

        async Task<RefreshOutcome> RefreshAsync(string token, Guid? requestScope)
        {
            await using var context = requestScope is { } scope
                ? _fixture.CreateContext(new ExerciseContext { CurrentExerciseId = scope })
                : _fixture.CreateContext();
            return (await ServiceFor(context).RefreshAsync(token)).Outcome;
        }

        foreach (var requestScope in new Guid?[] { null, exerciseA, exerciseB })
        {
            (await RefreshAsync(refreshB, requestScope)).Should().Be(
                RefreshOutcome.Invalid,
                "B's session naming A's ENABLED account is refused (request scope {0}): A's account is not B's",
                requestScope?.ToString() ?? "unset");
        }

        // A's account state never decides B's refresh: disable it, then enable it again; B stays refused throughout.
        foreach (var disabledAt in new DateTimeOffset?[] { DateTimeOffset.UtcNow, null })
        {
            await using (var staff = _fixture.CreateContext(new ExerciseContext { CurrentExerciseId = exerciseA }))
            {
                (await staff.Accounts.SingleAsync(a => a.Id == accountInA.Id)).DisabledAt = disabledAt;
                await staff.SaveChangesAsync();
            }

            (await RefreshAsync(refreshB, exerciseA)).Should().Be(
                RefreshOutcome.Invalid, "B's refresh does not follow A's account (DisabledAt {0})", disabledAt?.ToString("O") ?? "null");
        }

        (await RefreshAsync(refreshA, requestScope: null)).Should().Be(
            RefreshOutcome.Refreshed, "anti-vacuity: the account is real and enabled, and its OWN exercise's session renews");

        await using var verify = _fixture.CreateContext();
        (await verify.Sessions.AsNoTracking().SingleAsync(s => s.Id == sessionB.Id)).Should().BeEquivalentTo(
            sessionB, "every refusal of B's session wrote nothing");
        (await CountEventsAsync(exerciseB, "session.refreshed")).Should().Be(0, "B's session never refreshed");
        (await CountEventsAsync(exerciseA, "session.refreshed")).Should().Be(1);
    }

    // ---- Story 06: day-long participant sessions on refresh (EL-10, EL-11) ------------------------------------

    [RequiresDockerFact]
    public async Task Refresh_Participant_BeforeEndOfDay_RotatesAndCapsAtTheEndOfTheCurrentDay()
    {
        // 11:00 EDT on 14 Oct; the day ends 04:00Z on the 15th. now + 720 min would be 03:00Z — a different instant.
        var exerciseId = Guid.NewGuid();
        await SeedExerciseAsync(exerciseId, timeZone: NewYork);
        var token = $"day-refresh-{Guid.NewGuid():N}";
        var original = await SeedSessionAsync(
            exerciseId,
            rawRefreshToken: token,
            issuedAt: Utc(2026, 10, 14, 13),
            expiresAt: Utc(2026, 10, 14, 14),
            refreshExpiresAt: Utc(2026, 10, 15, 4));
        var clock = new ManualTimeProvider(Utc(2026, 10, 14, 15));

        RefreshResult result;
        await using (var context = _fixture.CreateContext())
        {
            result = await ServiceFor(context, clock: clock).RefreshAsync(token);
        }

        result.Outcome.Should().Be(RefreshOutcome.Refreshed);
        result.RefreshToken.Should().NotBe(token, "both tokens rotate exactly as today");

        await using var verify = _fixture.CreateContext();
        var renewed = await verify.Sessions.SingleAsync(s => s.Id == original.Id);
        renewed.IssuedAt.Should().Be(Utc(2026, 10, 14, 15));
        renewed.ExpiresAt.Should().Be(Utc(2026, 10, 14, 16), "the access token is again now + 60 min");
        renewed.RefreshExpiresAt.Should().Be(Utc(2026, 10, 15, 4),
            "the refresh window is the end of the CURRENT exercise day — never now + 720 min, never the next day");
        renewed.TokenHash.Should().Be(SessionTokens.Hash(result.SessionToken!));
    }

    [RequiresDockerFact]
    public async Task Refresh_Participant_LateInTheDay_AccessExpiryIsCappedAtTheDayEnd()
    {
        var exerciseId = Guid.NewGuid();
        await SeedExerciseAsync(exerciseId, timeZone: NewYork);
        var token = $"late-refresh-{Guid.NewGuid():N}";
        var original = await SeedSessionAsync(
            exerciseId,
            rawRefreshToken: token,
            issuedAt: Utc(2026, 10, 15, 2, 45),
            expiresAt: Utc(2026, 10, 15, 3, 45),
            refreshExpiresAt: Utc(2026, 10, 15, 4));
        var clock = new ManualTimeProvider(Utc(2026, 10, 15, 3, 30));

        await using (var context = _fixture.CreateContext())
        {
            (await ServiceFor(context, clock: clock).RefreshAsync(token)).Outcome.Should().Be(RefreshOutcome.Refreshed);
        }

        await using var verify = _fixture.CreateContext();
        var renewed = await verify.Sessions.SingleAsync(s => s.Id == original.Id);
        renewed.ExpiresAt.Should().Be(Utc(2026, 10, 15, 4), "ExpiresAt is min(now + 60 min, end of the current day)");
        renewed.RefreshExpiresAt.Should().Be(Utc(2026, 10, 15, 4));
    }

    [RequiresDockerFact]
    public Task Refresh_Participant_ExactlyAtTheEndOfDay_Is401_WithNoEvent() =>
        AssertDayEndedRefreshAsync(Utc(2026, 10, 15, 4));

    [RequiresDockerFact]
    public Task Refresh_Participant_AfterTheEndOfDay_Is401_WithNoEvent() =>
        AssertDayEndedRefreshAsync(Utc(2026, 10, 15, 4, 0, 1));

    [RequiresDockerFact]
    public async Task Refresh_Participant_WhoseStoredWindowCrossesMidnight_Is401OnceItsDayHasEnded_AndIsRevoked()
    {
        // A row stamped under the old sliding rule (option off, or before story 06 shipped): last refreshed at 19:00 EDT
        // on the 14th with a 720-minute window ending 11:00Z on the 15th. At 01:00 EDT on the 15th the stored window is
        // still open, but the session's exercise day ended at midnight — it must not slide into the 15th.
        var exerciseId = Guid.NewGuid();
        await SeedExerciseAsync(exerciseId, timeZone: NewYork);
        var token = $"legacy-window-{Guid.NewGuid():N}";
        var accessToken = $"legacy-access-{Guid.NewGuid():N}";
        var original = await SeedSessionAsync(
            exerciseId,
            rawToken: accessToken,
            rawRefreshToken: token,
            issuedAt: Utc(2026, 10, 14, 23),
            expiresAt: Utc(2026, 10, 15, 6),
            refreshExpiresAt: Utc(2026, 10, 15, 11));
        var clock = new ManualTimeProvider(Utc(2026, 10, 15, 5));

        await using (var context = _fixture.CreateContext())
        {
            (await ServiceFor(context, clock: clock).RefreshAsync(token)).Outcome.Should().Be(
                RefreshOutcome.Invalid, "the session's day has ended: a full sign-in is needed (401)");
        }

        (await CountEventsAsync(exerciseId, "session.refreshed")).Should().Be(0, "a refused refresh emits no event");

        // Gate-1 S-2: the row is ended, not left with an open window. It reads as revoked at the refusal instant, the
        // binding and token hashes are untouched, and nothing else on the row moved.
        await using (var verify = _fixture.CreateContext())
        {
            var ended = await verify.Sessions.SingleAsync(s => s.Id == original.Id && s.ExerciseId == exerciseId);
            ended.RevokedAt.Should().Be(Utc(2026, 10, 15, 5), "the day-end refusal of a legacy row revokes it, server-stamped");
            ended.RefreshTokenHash.Should().Be(SessionTokens.Hash(token), "nothing is rotated");
            ended.IssuedAt.Should().Be(Utc(2026, 10, 14, 23));
            ended.RefreshExpiresAt.Should().Be(Utc(2026, 10, 15, 11), "the stored window is left as evidence");
        }

        // A retry stops at the revoked check, and the still-unexpired access token no longer authenticates.
        clock.Advance(TimeSpan.FromMinutes(1));
        await using (var retry = _fixture.CreateContext())
        {
            var service = ServiceFor(retry, clock: clock);
            (await service.RefreshAsync(token)).Outcome.Should().Be(RefreshOutcome.Invalid, "a revoked row is never retried");
            (await service.GetCurrentAsync(accessToken)).Outcome.Should().Be(
                SessionQueryOutcome.Absent, "its access token (ExpiresAt 06:00Z) stops at once, with no session.expired event");
        }

        (await CountEventsAsync(exerciseId, "session.refreshed")).Should().Be(0);
        (await CountEventsAsync(exerciseId, "session.expired")).Should().Be(0);
    }

    [RequiresDockerFact]
    public async Task Refresh_Participant_RepeatedRefreshes_NeverSlidePastTheDay()
    {
        var exerciseId = Guid.NewGuid();
        await SeedExerciseAsync(exerciseId, timeZone: NewYork);
        var token = $"chain-{Guid.NewGuid():N}";
        await SeedSessionAsync(
            exerciseId,
            rawRefreshToken: token,
            issuedAt: Utc(2026, 10, 14, 14),
            expiresAt: Utc(2026, 10, 14, 15),
            refreshExpiresAt: Utc(2026, 10, 15, 4));
        var clock = new ManualTimeProvider(Utc(2026, 10, 14, 15));

        var current = token;
        foreach (var step in new[] { TimeSpan.Zero, TimeSpan.FromHours(6), TimeSpan.FromHours(6), TimeSpan.FromMinutes(59) })
        {
            clock.Advance(step);
            await using var context = _fixture.CreateContext();
            var refreshed = await ServiceFor(context, clock: clock).RefreshAsync(current);
            refreshed.Outcome.Should().Be(RefreshOutcome.Refreshed, "at {0:O} the day has not ended", clock.GetUtcNow());
            refreshed.Session!.RefreshExpiresAt.Should().Be(Utc(2026, 10, 15, 4),
                "however often it is refreshed, the window never moves past the end of the day");
            current = refreshed.RefreshToken!;
        }

        clock.Advance(TimeSpan.FromMinutes(1)); // 04:00Z: the day has ended.
        await using var last = _fixture.CreateContext();
        (await ServiceFor(last, clock: clock).RefreshAsync(current)).Outcome.Should().Be(RefreshOutcome.Invalid);
        (await CountEventsAsync(exerciseId, "session.refreshed")).Should().Be(4, "one event per successful refresh only");
    }

    [RequiresDockerFact]
    public Task Refresh_Staff_IsUnchanged_SlidesByTheRefreshLifetimeAcrossTheDayEnd() =>
        AssertUncappedRefreshAsync("staff", new SessionOptions());

    [RequiresDockerFact]
    public Task Refresh_SharedReadOnly_IsUnchanged_SlidesByTheRefreshLifetimeAcrossTheDayEnd() =>
        AssertUncappedRefreshAsync("readonly", new SessionOptions());

    [RequiresDockerFact]
    public Task Refresh_Participant_WithParticipantDayLongOff_SlidesExactlyAsBefore() =>
        AssertUncappedRefreshAsync("participant", new SessionOptions { ParticipantDayLong = false });

    [RequiresDockerFact]
    public async Task Refresh_Participant_UnknownZone_IsCappedAtTheEndOfTheUtcDay()
    {
        var exerciseId = Guid.NewGuid();
        await SeedExerciseAsync(exerciseId, timeZone: "Not/AZone");
        var token = $"utc-fallback-{Guid.NewGuid():N}";
        var original = await SeedSessionAsync(
            exerciseId,
            rawRefreshToken: token,
            issuedAt: Utc(2026, 10, 14, 20),
            refreshExpiresAt: Utc(2026, 10, 15, 0));
        var clock = new ManualTimeProvider(Utc(2026, 10, 14, 23, 30));

        await using (var context = _fixture.CreateContext())
        {
            (await ServiceFor(context, clock: clock).RefreshAsync(token)).Outcome.Should().Be(RefreshOutcome.Refreshed);
        }

        await using var verify = _fixture.CreateContext();
        var renewed = await verify.Sessions.SingleAsync(s => s.Id == original.Id);
        renewed.RefreshExpiresAt.Should().Be(Utc(2026, 10, 15, 0), "an unknown zone falls back to the UTC day");
        renewed.ExpiresAt.Should().Be(Utc(2026, 10, 15, 0), "min(now + 60 min, UTC midnight)");
    }

    [RequiresDockerFact]
    public async Task Refresh_Participant_IsCappedByItsOwnExercisesZone_NeverAnotherExercises()
    {
        // XC-001: the session is bound to A (Auckland); B (Los Angeles) exists with a different day end. The cap is
        // read for the session's own bound exercise only.
        var exerciseA = Guid.NewGuid();
        var exerciseB = Guid.NewGuid();
        await SeedExerciseAsync(exerciseA, timeZone: "Pacific/Auckland");
        await SeedExerciseAsync(exerciseB, timeZone: "America/Los_Angeles");
        var now = Utc(2026, 10, 14, 1);
        var token = $"own-zone-{Guid.NewGuid():N}";
        var original = await SeedSessionAsync(
            exerciseA, rawRefreshToken: token, issuedAt: now.AddMinutes(-30), refreshExpiresAt: now.AddHours(2));
        var clock = new ManualTimeProvider(now);

        await using (var context = _fixture.CreateContext())
        {
            (await ServiceFor(context, clock: clock).RefreshAsync(token)).Outcome.Should().Be(RefreshOutcome.Refreshed);
        }

        await using var verify = _fixture.CreateContext();
        var renewed = await verify.Sessions.SingleAsync(s => s.Id == original.Id);
        var endOfDayA = ExerciseDay.EndOfDayUtc("Pacific/Auckland", now, 0);
        var endOfDayB = ExerciseDay.EndOfDayUtc("America/Los_Angeles", now, 0);
        endOfDayA.Should().NotBe(endOfDayB, "the two zones must disagree for this test to discriminate");
        renewed.ExerciseId.Should().Be(exerciseA, "refresh never re-scopes");
        renewed.RefreshExpiresAt.Should().Be(endOfDayA);
        renewed.RefreshExpiresAt.Should().NotBe(endOfDayB, "exercise B's zone never caps a session bound to A");
        (await CountEventsAsync(exerciseB, "session.refreshed")).Should().Be(0, "nothing is emitted against B");
    }

    [RequiresDockerFact]
    public async Task Refresh_Participant_SessionRefreshedEnvelope_IsUnchanged()
    {
        // The refresh path now reads the exercise through ExerciseFactsReader (one read, shared with the cap); the
        // session.refreshed envelope must still carry the stored scenario time and the exercise's zone.
        var exerciseId = Guid.NewGuid();
        var scenarioTime = new DateTimeOffset(2033, 6, 14, 9, 0, 0, TimeSpan.FromHours(-5));
        await SeedExerciseAsync(exerciseId, scenarioTime, timeZone: NewYork);
        var token = $"envelope-{Guid.NewGuid():N}";
        var principalId = Guid.NewGuid().ToString();
        await SeedSessionAsync(exerciseId, rawRefreshToken: token, principalId: principalId);

        await using (var context = _fixture.CreateContext())
        {
            (await ServiceFor(context).RefreshAsync(token)).Outcome.Should().Be(RefreshOutcome.Refreshed);
        }

        var evt = await GetSingleEventAsync(exerciseId, "session.refreshed");
        evt.ScenarioTime.Should().Be(scenarioTime, "scenario time is the exercise's stored CurrentScenarioTime");
        evt.TimeZone.Should().Be(NewYork);
        evt.Channel.Should().Be("system");
        evt.SchemaVersion.Should().Be("v0");
        evt.Actor.Kind.Should().Be("participant");
        evt.Actor.ParticipantId.Should().Be(principalId);
    }

    [RequiresDockerFact]
    public async Task Refresh_ParticipantWithNoExerciseRow_FallsBackToUtc_AndTheWallClockScenarioTime()
    {
        // Defensive: the bound exercise cannot be read. The cap still applies (UTC day) — a participant session is
        // never left uncapped — and the event falls back exactly as before.
        var exerciseId = Guid.NewGuid();
        var token = $"no-row-{Guid.NewGuid():N}";
        var original = await SeedSessionAsync(
            exerciseId, rawRefreshToken: token, issuedAt: Utc(2026, 10, 14, 10), refreshExpiresAt: Utc(2026, 10, 15, 0));
        var clock = new ManualTimeProvider(Utc(2026, 10, 14, 12));

        await using (var context = _fixture.CreateContext())
        {
            (await ServiceFor(context, clock: clock).RefreshAsync(token)).Outcome.Should().Be(RefreshOutcome.Refreshed);
        }

        await using var verify = _fixture.CreateContext();
        (await verify.Sessions.SingleAsync(s => s.Id == original.Id)).RefreshExpiresAt.Should().Be(Utc(2026, 10, 15, 0));
        var evt = await GetSingleEventAsync(exerciseId, "session.refreshed");
        evt.ScenarioTime.Should().Be(Utc(2026, 10, 14, 12));
        evt.TimeZone.Should().Be("UTC");
    }

    [RequiresDockerFact]
    public Task Refresh_ParticipantSessionRevokedByStaff_Is401_AndTheAccessTokenIs401() =>
        AssertRevokedCappedSessionIsRefusedAsync(viaLogout: false);

    [RequiresDockerFact]
    public Task Refresh_ParticipantSessionLoggedOut_Is401_AndTheAccessTokenIs401() =>
        AssertRevokedCappedSessionIsRefusedAsync(viaLogout: true);

    [RequiresDockerFact]
    public async Task Refresh_Participant_InACompletedOrArchivedExercise_IsNotRefused()
    {
        // EL-11: refresh is deliberately NOT refused at EndEx — the lifecycle gate handles the data routes, and a
        // refused refresh would bounce participants off the COR-054 EndEx overlay (see the lifecycle pin suite).
        foreach (var status in new[] { "completed", "archived" })
        {
            var exerciseId = Guid.NewGuid();
            await SeedExerciseAsync(exerciseId, timeZone: "UTC", status: status);
            var token = $"endex-{status}-{Guid.NewGuid():N}";
            await SeedSessionAsync(exerciseId, rawRefreshToken: token);

            await using var context = _fixture.CreateContext();
            (await ServiceFor(context).RefreshAsync(token)).Outcome.Should().Be(
                RefreshOutcome.Refreshed, "a '{0}' exercise does not newly refuse a participant refresh", status);
        }
    }

    /// <summary>
    /// Shared body for the day-ended facts: a participant session last refreshed at 23:00 EDT on the 14th whose stored
    /// window ends at local midnight (04:00Z), refreshed at <paramref name="at"/> — fail closed, no event, tokens kept.
    /// </summary>
    private async Task AssertDayEndedRefreshAsync(DateTimeOffset at)
    {
        var exerciseId = Guid.NewGuid();
        await SeedExerciseAsync(exerciseId, timeZone: NewYork);
        var token = $"day-ended-{Guid.NewGuid():N}";
        var original = await SeedSessionAsync(
            exerciseId,
            rawRefreshToken: token,
            issuedAt: Utc(2026, 10, 15, 3),
            expiresAt: Utc(2026, 10, 15, 4),
            refreshExpiresAt: Utc(2026, 10, 15, 4));
        var clock = new ManualTimeProvider(at);

        await using (var context = _fixture.CreateContext())
        {
            (await ServiceFor(context, clock: clock).RefreshAsync(token)).Outcome.Should().Be(
                RefreshOutcome.Invalid, "at or after the end of the exercise day a full sign-in is needed (401)");
        }

        (await CountEventsAsync(exerciseId, "session.refreshed")).Should().Be(0, "a refused refresh emits no event");
        await using var verify = _fixture.CreateContext();
        var stored = await verify.Sessions.SingleAsync(s => s.Id == original.Id);
        stored.RefreshTokenHash.Should().Be(SessionTokens.Hash(token), "a refused refresh rotates nothing");
        stored.RevokedAt.Should().BeNull(
            "a window that already ended at the day end is the ordinary lapsed case: nothing is written (only a legacy row "
            + "whose stored window was still open is revoked)");
    }

    /// <summary>
    /// Shared body for the "unchanged" facts: at 23:30 EDT, with a stored window that was stamped on the previous day,
    /// a staff / read-only / option-off participant session slides to now + 60 and now + 720 min, exactly as before.
    /// </summary>
    private async Task AssertUncappedRefreshAsync(string kind, SessionOptions options)
    {
        var exerciseId = Guid.NewGuid();
        await SeedExerciseAsync(exerciseId, timeZone: NewYork);
        var token = $"uncapped-{kind}-{Guid.NewGuid():N}";
        var now = Utc(2026, 10, 15, 3, 30);
        var original = await SeedSessionAsync(
            exerciseId,
            kind: kind,
            rawRefreshToken: token,
            issuedAt: Utc(2026, 10, 13, 22),
            expiresAt: Utc(2026, 10, 13, 23),
            refreshExpiresAt: Utc(2026, 10, 15, 10),
            staffUserId: kind == "staff" ? Guid.NewGuid() : null,
            role: kind == "staff" ? "controller" : "participant");
        var clock = new ManualTimeProvider(now);

        await using (var context = _fixture.CreateContext())
        {
            (await ServiceFor(context, options, clock).RefreshAsync(token)).Outcome.Should().Be(
                RefreshOutcome.Refreshed, "a {0} session is never day-capped here", kind);
        }

        await using var verify = _fixture.CreateContext();
        var renewed = await verify.Sessions.SingleAsync(s => s.Id == original.Id);
        renewed.ExpiresAt.Should().Be(now.AddMinutes(60), "the access window is now + 60 min, as before");
        renewed.RefreshExpiresAt.Should().Be(now.AddMinutes(720), "the refresh window slides to now + 720 min, as before");
        (await CountEventsAsync(exerciseId, "session.refreshed")).Should().Be(1);
    }

    /// <summary>
    /// Shared body for the revoke regression guard (AC3): a day-capped participant session ended by a staff action
    /// (link revoke / reissue / disable all set <c>RevokedAt</c> on the session rows) or by logout cannot be refreshed,
    /// and its access token no longer resolves.
    /// </summary>
    private async Task AssertRevokedCappedSessionIsRefusedAsync(bool viaLogout)
    {
        var exerciseId = Guid.NewGuid();
        await SeedExerciseAsync(exerciseId, timeZone: NewYork);
        var issued = await IssueParticipantSessionAsync(exerciseId);

        if (viaLogout)
        {
            await using var logout = _fixture.CreateContext();
            await ServiceFor(logout).LogoutAsync(issued.SessionToken);
        }
        else
        {
            await using var revoke = _fixture.CreateContext();
            var row = await revoke.Sessions.SingleAsync(s => s.Id == issued.Session.Id && s.ExerciseId == exerciseId);
            row.RevokedAt = DateTimeOffset.UtcNow;
            await revoke.SaveChangesAsync();
        }

        await using (var context = _fixture.CreateContext())
        {
            (await ServiceFor(context).RefreshAsync(issued.RefreshToken)).Outcome.Should().Be(
                RefreshOutcome.Invalid, "a revoked day-long session's refresh token must be refused (401)");
            (await ServiceFor(context).GetCurrentAsync(issued.SessionToken)).Outcome.Should().Be(
                SessionQueryOutcome.Absent, "the next authenticated request with its access token is 401");
        }

        (await CountEventsAsync(exerciseId, "session.refreshed")).Should().Be(0);
    }

    private async Task<SessionIssueResult> IssueParticipantSessionAsync(Guid exerciseId)
    {
        await using var context = _fixture.CreateContext();
        var issuer = new SessionIssuer(
            context,
            Options.Create(new SessionOptions()),
            new ExerciseFactsReader(context),
            Options.Create(new EasyLoginOptions()),
            TimeProvider.System,
            NullLogger<SessionIssuer>.Instance);

        var accountId = Guid.NewGuid();
        return await issuer.IssueAsync(new SessionIssueRequest
        {
            ExerciseId = exerciseId,
            Kind = "participant",
            Role = "participant",
            PrincipalId = accountId.ToString(),
            ActingHumanId = accountId.ToString(),
            IsReadOnly = false,
            AccountId = accountId,
        });
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
