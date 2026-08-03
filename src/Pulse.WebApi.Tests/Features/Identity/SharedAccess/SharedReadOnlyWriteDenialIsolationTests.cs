namespace Pulse.WebApi.Tests.Features.Identity.SharedAccess;

using System;
using System.Collections.Generic;
using System.Net;
using System.Net.Http;
using System.Net.Http.Json;
using System.Text.Json;
using System.Threading.Tasks;
using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Pulse.WebApi.Data.Entities;
using Pulse.WebApi.Features.Identity.SharedAccess;
using Pulse.WebApi.Features.Identity.Sessions;
using Pulse.WebApi.Tests.Data;

/// <summary>
/// Story 06 (COR-015 / XC-001 / COR-001 / NFR-009) — the always-Critical, TIER-2 end-to-end proof, extending the
/// standing isolation suite (exercise-isolation/07) with the read-only-session case. Runs the REAL host
/// resolution → session middleware → shared login → guarded sim-write / scoped read pipeline over REAL SQL
/// Server (Testcontainers, <see cref="SharedReadOnlyTestHost"/>). Proves:
/// <list type="bullet">
///   <item><description>a shared credential grants a VIEW-ONLY session (<c>isReadOnly: true</c>, ephemeral
///   identity, no named account);</description></item>
///   <item><description>that read-only session is DENIED a sim write server-side (403) — the load-bearing
///   guarantee;</description></item>
///   <item><description>a non-read-only (staff) session passes the same guard (403 is keyed off
///   <c>IsReadOnly</c>, not off being authenticated);</description></item>
///   <item><description>an anonymous write is NOT a read-only 403 — it fails closed on the unresolved scope
///   instead (proving the guard is not a blanket verb block);</description></item>
///   <item><description>a read-only session for exercise A sees ONLY A's rows (zero B) on a scoped read; and</description></item>
///   <item><description>exercise A's shared password never authenticates on exercise B's host;</description></item>
///   <item><description>a read-only session IS allowed on a write path never wrapped in the guard (the
///   opt-in deny-list does not over-block);</description></item>
///   <item><description>the minted SessionDto uses the SAME ephemeral id for <c>accountId</c> /
///   <c>actingHumanId</c> and omits <c>personaId</c>; and</description></item>
///   <item><description>an unprovisioned host — through the REAL host-resolution middleware — mints no
///   session and stamps no telemetry.</description></item>
/// </list>
/// </summary>
[Collection(MsSqlCollection.Name)]
public sealed class SharedReadOnlyWriteDenialIsolationTests
{
    private readonly MsSqlContainerFixture _fixture;
    private readonly SharedCredentialHasher _hasher = new();

    public SharedReadOnlyWriteDenialIsolationTests(MsSqlContainerFixture fixture) => _fixture = fixture;

    [RequiresDockerFact]
    public async Task SharedLogin_MintsViewOnlySession_ThenThatSessionIsDeniedASimWrite_ButCanRead()
    {
        var seed = await SeedTwoExercisesAsync();

        await using var host = await SharedReadOnlyTestHost.StartAsync(_fixture.ConnectionString!);

        // 1. Log in with the shared credential on exercise A's host → a view-only session + a token.
        using var anon = host.CreateClient(seed.HostA);
        var loginResponse = await anon.PostAsJsonAsync("/api/auth/shared", new { password = SeedData.PasswordA });
        loginResponse.StatusCode.Should().Be(HttpStatusCode.OK, "the correct shared password on A's host mints a session");

        using var loginBody = JsonDocument.Parse(await loginResponse.Content.ReadAsStringAsync());
        var session = loginBody.RootElement.GetProperty("session");
        session.GetProperty("isReadOnly").GetBoolean().Should().BeTrue("a shared login mints a VIEW-ONLY session (COR-015)");
        session.GetProperty("exerciseId").GetString().Should().Be(seed.ExerciseA.ToString(), "the session is bound to A (the host-resolved exercise)");
        session.GetProperty("accountId").GetString().Should().NotBeNullOrEmpty("the ephemeral identity surfaces as accountId (no named account)");
        var token = loginBody.RootElement.GetProperty("token").GetString();
        token.Should().NotBeNullOrEmpty();

        // 2. The load-bearing guarantee: that read-only session is DENIED a sim write server-side (403).
        using var readOnlyClient = host.CreateClient(seed.HostA, token);
        var writeResponse = await readOnlyClient.PostAsJsonAsync("/test/sim-write", new { });
        writeResponse.StatusCode.Should().Be(HttpStatusCode.Forbidden,
            "a read-only session must be denied any sim write server-side (COR-015) — never merely hidden in the UI");

        // 3. …but it CAN read, and sees only exercise A's rows (zero B).
        var ids = await GetPostIdsAsync(readOnlyClient);
        ids.Should().Contain(seed.PostA.ToString(), "a read-only session for A can read A's own content");
        ids.Should().NotContain(seed.PostB.ToString(), "a read-only session for A must never see exercise B's content (XC-001)");
    }

    [RequiresDockerFact]
    public async Task ReadOnlySession_IsAllowedOnAnUnguardedWritePath_ProvingTheGuardIsOptIn()
    {
        // The opt-in deny-list design (COR-015): the guard is applied per-endpoint via
        // DenyReadOnlySessions(), not as a blanket POST filter. A read-only session must be able to reach a
        // write path that was never wrapped in the guard (standing in for e.g. POST /api/telemetry,
        // /api/auth/refresh, /api/auth/logout, or SignalR negotiate) — 200, never 403 — so the deliberate
        // trade-off (scoped, not global) does not accidentally over-block legitimate read-only writes.
        var seed = await SeedTwoExercisesAsync();
        await SeedSessionAsync("shared-readonly-unguarded-token", seed.ExerciseA, isReadOnly: true, kind: "readonly");

        await using var host = await SharedReadOnlyTestHost.StartAsync(_fixture.ConnectionString!);
        using var readOnlyClient = host.CreateClient(seed.HostA, "shared-readonly-unguarded-token");

        var response = await readOnlyClient.PostAsJsonAsync("/test/unguarded-write", new { });

        response.StatusCode.Should().Be(HttpStatusCode.OK,
            "a read-only session must NOT be denied on a write path that was never wrapped in " +
            "DenyReadOnlySessions() — the guard is a deliberate opt-in deny-list, not a blanket verb block, so a " +
            "read-only-allowed path (telemetry / refresh / logout / SignalR negotiate) must keep working");
    }

    [RequiresDockerFact]
    public async Task SharedLogin_Success_SessionDto_UsesTheSameEphemeralIdentityForAccountAndActingHuman_AndOmitsPersonaId()
    {
        // The wire-level ephemeral session shape (COR-015): accountId and actingHumanId are the SAME freshly
        // generated ephemeral id (there is no named account or acting human behind a shared login), and
        // personaId is OMITTED from the JSON entirely (not merely null) — the frozen client SessionDto
        // validator accepts an absent personaId but rejects a null one.
        var seed = await SeedTwoExercisesAsync();

        await using var host = await SharedReadOnlyTestHost.StartAsync(_fixture.ConnectionString!);
        using var anon = host.CreateClient(seed.HostA);

        var response = await anon.PostAsJsonAsync("/api/auth/shared", new { password = SeedData.PasswordA });
        response.StatusCode.Should().Be(HttpStatusCode.OK);

        using var body = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        var session = body.RootElement.GetProperty("session");

        var accountId = session.GetProperty("accountId").GetString();
        var actingHumanId = session.GetProperty("actingHumanId").GetString();
        accountId.Should().NotBeNullOrEmpty();
        actingHumanId.Should().Be(accountId,
            "a read-only session has no named account or acting human — the SAME ephemeral identity is used " +
            "for both accountId and actingHumanId");
        Guid.TryParse(accountId, out _).Should().BeTrue("the ephemeral identity is a generated GUID");

        session.TryGetProperty("personaId", out _).Should().BeFalse(
            "personaId must be OMITTED (not merely serialized as null) from the wire session for a read-only " +
            "login");
    }

    [RequiresDockerFact]
    public async Task SharedLogin_OnUnprovisionedHost_FailsClosed_ThroughRealHostResolution_NoSessionMinted_NoTelemetry()
    {
        // The end-to-end proof through the REAL UseExerciseResolution() middleware (not a hand-constructed
        // scope, as in SharedReadOnlyLoginServiceTests.Login_UnresolvedScope_...): a host that resolves to NO
        // exercise at all must reject the shared login (401), minting no session and stamping no telemetry —
        // asserted as a before/after delta so it holds regardless of other tests' data in the shared container.
        var seed = await SeedTwoExercisesAsync();

        await using var before = _fixture.CreateContext();
        var sessionCountBefore = await before.Sessions.IgnoreQueryFilters().CountAsync();
        var loginTelemetryCountBefore = await before.TelemetryEvents.IgnoreQueryFilters()
            .Where(e => e.EventType == "login")
            .CountAsync();

        await using var host = await SharedReadOnlyTestHost.StartAsync(_fixture.ConnectionString!);
        using var onUnknownHost = host.CreateClient($"unprovisioned-{Guid.NewGuid():N}.example.com");

        var response = await onUnknownHost.PostAsJsonAsync("/api/auth/shared", new { password = SeedData.PasswordA });

        response.StatusCode.Should().Be(HttpStatusCode.Unauthorized,
            "an unprovisioned host resolves to no exercise, so there is no credential to check — fail closed " +
            "(401), never a default session, even through the REAL host-resolution middleware");

        await using var after = _fixture.CreateContext();
        (await after.Sessions.IgnoreQueryFilters().CountAsync()).Should().Be(sessionCountBefore,
            "no session may be minted for an unresolved host, even through the real pipeline");
        (await after.TelemetryEvents.IgnoreQueryFilters().Where(e => e.EventType == "login").CountAsync())
            .Should().Be(loginTelemetryCountBefore,
                "no scoped telemetry can be stamped without a resolved exercise, even through the real pipeline");
    }

    [RequiresDockerFact]
    public async Task NonReadOnlySession_PassesTheWriteGuard()
    {
        // The 403 is keyed off IsReadOnly, not off merely being authenticated: a staff (non-read-only) session
        // bound to A passes the guard and reaches the handler (which resolves scope A).
        var seed = await SeedTwoExercisesAsync();
        // Globally-unique per-seed token (shared-DB IX_Sessions_TokenHash is global across the collection).
        var token = $"staff-guard-{Guid.NewGuid():N}";
        await SeedSessionAsync(token, seed.ExerciseA, isReadOnly: false, kind: "staff");

        await using var host = await SharedReadOnlyTestHost.StartAsync(_fixture.ConnectionString!);
        using var staffClient = host.CreateClient(seed.HostA, token);

        var response = await staffClient.PostAsJsonAsync("/test/sim-write", new { });

        response.StatusCode.Should().Be(HttpStatusCode.OK,
            "a non-read-only session must pass the read-only write guard — the denial is keyed off IsReadOnly, " +
            "not off being authenticated");
    }

    [RequiresDockerFact]
    public async Task AnonymousWrite_IsNotAReadOnly403_ButFailsClosedOnUnresolvedScope()
    {
        // An anonymous request presents no session, so the read-only guard does NOT apply (it is not a blanket
        // verb block). On an unknown host the write instead fails closed on the unresolved scope (401) — proving
        // the guard's 403 is specifically the read-only-session denial, distinct from the ordinary auth failure.
        await SeedTwoExercisesAsync();

        await using var host = await SharedReadOnlyTestHost.StartAsync(_fixture.ConnectionString!);
        using var anon = host.CreateClient($"unprovisioned-{Guid.NewGuid():N}.example.com");

        var response = await anon.PostAsJsonAsync("/test/sim-write", new { });

        response.StatusCode.Should().Be(HttpStatusCode.Unauthorized,
            "an anonymous write on an unknown host fails closed on the unresolved scope (401) — the read-only " +
            "guard returns 403 only for a live read-only session, so this is NOT a 403");
    }

    [RequiresDockerFact]
    public async Task ExerciseAPassword_OnExerciseBHost_FailsClosed()
    {
        // The always-Critical cross-host guarantee: exercise A's shared password presented on exercise B's host
        // is checked against B's credential (not A's) and rejected — a shared secret never crosses exercises.
        var seed = await SeedTwoExercisesAsync();

        await using var host = await SharedReadOnlyTestHost.StartAsync(_fixture.ConnectionString!);
        using var onHostB = host.CreateClient(seed.HostB);

        var response = await onHostB.PostAsJsonAsync("/api/auth/shared", new { password = SeedData.PasswordA });

        response.StatusCode.Should().Be(HttpStatusCode.Unauthorized,
            "exercise A's shared password must never authenticate on exercise B's host — the credential is " +
            "checked against the host-resolved exercise's own credential (COR-001/COR-008)");
    }

    [RequiresDockerFact]
    public async Task WrongPassword_OnCorrectHost_FailsClosed()
    {
        var seed = await SeedTwoExercisesAsync();

        await using var host = await SharedReadOnlyTestHost.StartAsync(_fixture.ConnectionString!);
        using var onHostA = host.CreateClient(seed.HostA);

        var response = await onHostA.PostAsJsonAsync("/api/auth/shared", new { password = "not-the-shared-password" });

        response.StatusCode.Should().Be(HttpStatusCode.Unauthorized, "a wrong shared password fails closed (401), never a default session");
    }

    [RequiresDockerFact]
    public async Task SharedLogin_Rejected_ReturnsBodilessUnauthorized_NoCredentialExistenceOracle()
    {
        // Story-06 regression pinned post-story-07 fold (grace/lockout/decoy): the endpoint maps EVERY negative
        // outcome — wrong password, absent/disabled/revoked/locked credential, unresolved host scope — to the
        // SAME Results.Unauthorized(), which carries NO response body. A wrong password against a real, enabled
        // credential must therefore be byte-identical (empty body) to every other rejection: there is no way
        // for a caller to distinguish "wrong password" from "this exercise has no credential at all" (no
        // credential-existence oracle). Runs through the REAL host-resolution + login pipeline.
        var seed = await SeedTwoExercisesAsync();

        await using var host = await SharedReadOnlyTestHost.StartAsync(_fixture.ConnectionString!);
        using var onHostA = host.CreateClient(seed.HostA);

        var response = await onHostA.PostAsJsonAsync("/api/auth/shared", new { password = "definitely-wrong" });

        response.StatusCode.Should().Be(HttpStatusCode.Unauthorized);
        var body = await response.Content.ReadAsStringAsync();
        body.Should().BeEmpty(
            "a rejected shared login must return a BODILESS 401 — the story-07 grace/lockout/decoy changes must " +
            "not have added any content that could distinguish one rejection reason from another");
    }

    private static async Task<List<string>> GetPostIdsAsync(HttpClient client)
    {
        var response = await client.GetAsync(new Uri("/test/posts", UriKind.Relative));
        response.StatusCode.Should().Be(HttpStatusCode.OK);
        using var document = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        var ids = new List<string>();
        foreach (var element in document.RootElement.EnumerateArray())
        {
            ids.Add(element.GetString()!);
        }

        return ids;
    }

    private async Task<SeedData> SeedTwoExercisesAsync()
    {
        var exerciseA = Guid.NewGuid();
        var exerciseB = Guid.NewGuid();
        var hostA = $"host-a-{exerciseA:N}.example.com";
        var hostB = $"host-b-{exerciseB:N}.example.com";
        var postA = Guid.NewGuid();
        var postB = Guid.NewGuid();

        await using var seed = _fixture.CreateContext();
        seed.Exercises.Add(new Exercise { OrganizationId = Organization.DefaultOrganizationId, Id = exerciseA, Name = "A", Hostname = hostA, TimeZone = "UTC", Status = "active" });
        seed.Exercises.Add(new Exercise { OrganizationId = Organization.DefaultOrganizationId, Id = exerciseB, Name = "B", Hostname = hostB, TimeZone = "UTC", Status = "active" });
        seed.SharedCredentials.Add(NewCredential(exerciseA, SeedData.PasswordA));
        seed.SharedCredentials.Add(NewCredential(exerciseB, SeedData.PasswordB));
        seed.Posts.Add(NewPost(postA, exerciseA));
        seed.Posts.Add(NewPost(postB, exerciseB));
        await seed.SaveChangesAsync();

        return new SeedData(exerciseA, exerciseB, hostA, hostB, postA, postB);
    }

    private async Task SeedSessionAsync(string rawToken, Guid exerciseId, bool isReadOnly, string kind)
    {
        await using var seed = _fixture.CreateContext();
        seed.Sessions.Add(new Session
        {
            Id = Guid.NewGuid(),
            TokenHash = SessionTokens.Hash(rawToken),
            Kind = kind,
            ExerciseId = exerciseId,
            PrincipalId = Guid.NewGuid().ToString(),
            StaffUserId = kind == "staff" ? Guid.NewGuid() : null,
            Role = kind == "staff" ? "controller" : "participant",
            ActingHumanId = "human-1",
            IsReadOnly = isReadOnly,
            IssuedAt = DateTimeOffset.UtcNow.AddMinutes(-5),
            ExpiresAt = DateTimeOffset.UtcNow.AddHours(1),
            RefreshExpiresAt = DateTimeOffset.UtcNow.AddHours(12),
        });
        await seed.SaveChangesAsync();
    }

    private SharedCredential NewCredential(Guid exerciseId, string password) => new()
    {
        Id = Guid.NewGuid(),
        ExerciseId = exerciseId,
        CurrentHash = _hasher.Hash(password),
        IsEnabled = true,
        CreatedAt = DateTimeOffset.UtcNow,
    };

    private static Post NewPost(Guid id, Guid exerciseId) => new()
    {
        Id = id,
        ExerciseId = exerciseId,
        AuthorPersonaId = Guid.NewGuid(),
        Body = $"Post {id:N}",
        CreatedScenarioTime = DateTimeOffset.UtcNow,
        Origin = "participant",
        ActingHumanId = "human-test",
        CreatedWallClock = new DateTimeOffset(2033, 9, 4, 13, 15, 0, TimeSpan.Zero),
    };

    private sealed record SeedData(Guid ExerciseA, Guid ExerciseB, string HostA, string HostB, Guid PostA, Guid PostB)
    {
        public const string PasswordA = "shared-password-for-A";
        public const string PasswordB = "shared-password-for-B";
    }
}
