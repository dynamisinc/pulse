namespace Pulse.WebApi.Tests.Features.Identity.Sessions;

using System;
using System.Collections.Generic;
using System.Net;
using System.Net.Http;
using System.Text.Json;
using System.Threading.Tasks;
using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Pulse.WebApi.Data.Entities;
using Pulse.WebApi.Features.Identity.Sessions;
using Pulse.WebApi.Tests.Data;

/// <summary>
/// Story 03 (XC-001 / COR-001 / COR-008) — extends the standing isolation suite (exercise-isolation/07) through
/// the REAL host-resolution → session-middleware → scoped-read pipeline over REAL SQL Server (Testcontainers).
/// The session is the authenticated anchor of the exercise scope; these prove:
/// <list type="bullet">
///   <item><description><b>session-scope:</b> a participant session bound to exercise A, on A's host, sees only
///   A's rows;</description></item>
///   <item><description><b>precedence (session &gt; host):</b> a staff session bound to A, presented on B's host,
///   sees A's rows — the session's scope write overrides the host's;</description></item>
///   <item><description><b>participant wrong-host fail-closed:</b> a participant session for A presented on B's
///   host is rejected (403) and never yields B's rows;</description></item>
///   <item><description><b>session provides scope with no host:</b> a staff session on an unknown host still
///   sees A's rows (the session is the anchor); and</description></item>
///   <item><description><b>expiry fails closed to zero rows:</b> an expired session on an unknown host resolves
///   NO scope — zero rows, never all exercises.</description></item>
/// </list>
/// </summary>
[Collection(MsSqlCollection.Name)]
public sealed class SessionScopeIsolationTests
{
    private readonly MsSqlContainerFixture _fixture;

    public SessionScopeIsolationTests(MsSqlContainerFixture fixture) => _fixture = fixture;

    [RequiresDockerFact]
    public async Task ParticipantSession_OnItsOwnHost_SeesOnlyItsExerciseRows()
    {
        var (exerciseA, exerciseB, hostA, _, postA, postB) = await SeedTwoExercisesAsync();
        await SeedSessionAsync("participant", "p-token", exerciseA);

        await using var testHost = await SessionAuthenticationTestHost.StartAsync(_fixture.ConnectionString!);
        using var client = testHost.CreateClient(hostA, "p-token");

        var ids = await GetPostIdsAsync(client);

        ids.Should().Contain(postA.ToString(), "a participant session on exercise A's host sees A's own post");
        ids.Should().NotContain(postB.ToString(), "the session anchors the scope to A — never exercise B's rows");
    }

    [RequiresDockerFact]
    public async Task StaffSession_OverridesHostScope_SeesSessionExerciseRows_Precedence()
    {
        var (exerciseA, exerciseB, _, hostB, postA, postB) = await SeedTwoExercisesAsync();
        // A staff session bound to A, presented on exercise B's host: the session (A) must win over the host (B).
        await SeedSessionAsync("staff", "s-token", exerciseA, staffUserId: Guid.NewGuid());

        await using var testHost = await SessionAuthenticationTestHost.StartAsync(_fixture.ConnectionString!);
        using var client = testHost.CreateClient(hostB, "s-token");

        var ids = await GetPostIdsAsync(client);

        ids.Should().Contain(postA.ToString(),
            "the authenticated staff session's exercise (A) takes precedence over the host's resolved exercise (B)");
        ids.Should().NotContain(postB.ToString(),
            "session > host precedence means the host's exercise B is overridden — B's rows must not appear");
    }

    [RequiresDockerFact]
    public async Task ParticipantSession_OnWrongHost_FailsClosed403_NoRows()
    {
        var (exerciseA, _, _, hostB, _, postB) = await SeedTwoExercisesAsync();
        // A participant session for exercise A presented on exercise B's host — the always-Critical mismatch.
        await SeedSessionAsync("participant", "wrong-host-token", exerciseA);

        await using var testHost = await SessionAuthenticationTestHost.StartAsync(_fixture.ConnectionString!);
        using var client = testHost.CreateClient(hostB, "wrong-host-token");

        var response = await client.GetAsync(new Uri("/test/posts", UriKind.Relative));

        response.StatusCode.Should().Be(HttpStatusCode.Forbidden,
            "a participant session for exercise A presented on exercise B's host must fail closed (403), never be honored");
    }

    [RequiresDockerFact]
    public async Task StaffSession_OnUnknownHost_StillSeesSessionExerciseRows()
    {
        var (exerciseA, _, _, _, postA, postB) = await SeedTwoExercisesAsync();
        await SeedSessionAsync("staff", "s-nohost", exerciseA, staffUserId: Guid.NewGuid());

        await using var testHost = await SessionAuthenticationTestHost.StartAsync(_fixture.ConnectionString!);
        using var client = testHost.CreateClient($"unprovisioned-{Guid.NewGuid():N}.example.com", "s-nohost");

        var ids = await GetPostIdsAsync(client);

        ids.Should().Contain(postA.ToString(),
            "a staff session is not host-bound — it anchors the scope to A even when the host resolves to nothing");
        ids.Should().NotContain(postB.ToString());
    }

    [RequiresDockerFact]
    public async Task ExpiredSession_OnUnknownHost_SeesZeroRows_FailClosed()
    {
        var (exerciseA, _, _, _, _, _) = await SeedTwoExercisesAsync();
        // Globally-unique per-seed token (shared-DB IX_Sessions_TokenHash is global across the collection).
        var token = $"expired-scope-{Guid.NewGuid():N}";
        await SeedSessionAsync("staff", token, exerciseA, staffUserId: Guid.NewGuid(),
            expiresAt: DateTimeOffset.UtcNow.AddMinutes(-1));

        await using var testHost = await SessionAuthenticationTestHost.StartAsync(_fixture.ConnectionString!);
        using var client = testHost.CreateClient($"unprovisioned-{Guid.NewGuid():N}.example.com", token);

        var response = await client.GetAsync(new Uri("/test/posts", UriKind.Relative));
        response.StatusCode.Should().Be(HttpStatusCode.OK, "the read endpoint answers 200 — isolation happens inside the scoped read");

        var ids = await ParseIdsAsync(response);
        ids.Should().BeEmpty(
            "an expired session resolves NO scope and there is no host to fall back to — fail closed to zero rows, never all exercises");
    }

    [RequiresDockerFact]
    public async Task AbsentSession_OnUnknownHost_SeesZeroRows_FailClosed()
    {
        // No token presented at all (not merely expired) and a host that resolves to nothing — the other half
        // of "expired/absent session -> zero rows, never all exercises".
        await SeedTwoExercisesAsync();

        await using var testHost = await SessionAuthenticationTestHost.StartAsync(_fixture.ConnectionString!);
        using var client = testHost.CreateClient($"unprovisioned-{Guid.NewGuid():N}.example.com", bearerToken: null);

        var response = await client.GetAsync(new Uri("/test/posts", UriKind.Relative));
        response.StatusCode.Should().Be(HttpStatusCode.OK, "the read endpoint answers 200 — isolation happens inside the scoped read");

        var ids = await ParseIdsAsync(response);
        ids.Should().BeEmpty(
            "with no session and no host resolution there is nothing to anchor the scope to — fail closed to zero rows, never all exercises");
    }

    [RequiresDockerFact]
    public async Task ExpiredSession_UsedOnANonSessionEndpoint_EmitsNoSessionExpiredTelemetry()
    {
        // The story-03 AC is explicit: `session.expired` is emitted ONLY from GET /api/session (the bounded
        // moment the client learns it must re-auth) — never per-request from the middleware's own token lookup
        // (SessionAuthenticator emits no telemetry at all). Prove that hitting an ordinary scoped-read endpoint
        // with an expired token authenticates nothing (zero rows) AND writes zero session.expired events —
        // the middleware silently leaves the request unauthenticated rather than recording anything.
        var (exerciseA, _, _, _, _, _) = await SeedTwoExercisesAsync();
        await SeedSessionAsync("staff", "expired-no-telemetry", exerciseA, staffUserId: Guid.NewGuid(),
            expiresAt: DateTimeOffset.UtcNow.AddMinutes(-1));

        await using var testHost = await SessionAuthenticationTestHost.StartAsync(_fixture.ConnectionString!);
        using var client = testHost.CreateClient($"unprovisioned-{Guid.NewGuid():N}.example.com", "expired-no-telemetry");

        (await client.GetAsync(new Uri("/test/posts", UriKind.Relative))).StatusCode.Should().Be(HttpStatusCode.OK);

        await using var verify = _fixture.CreateContext();
        var expiredEventCount = await verify.TelemetryEvents.IgnoreQueryFilters()
            .CountAsync(e => e.ExerciseId == exerciseA && e.EventType == "session.expired");

        expiredEventCount.Should().Be(0,
            "session.expired is emitted only from GET /api/session, never per-request from the middleware's " +
            "own token lookup — otherwise every authenticated request with a stale token would spam telemetry");
    }

    private static async Task<List<string>> GetPostIdsAsync(HttpClient client)
    {
        var response = await client.GetAsync(new Uri("/test/posts", UriKind.Relative));
        response.StatusCode.Should().Be(HttpStatusCode.OK);
        return await ParseIdsAsync(response);
    }

    private static async Task<List<string>> ParseIdsAsync(HttpResponseMessage response)
    {
        using var document = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        var ids = new List<string>();
        foreach (var element in document.RootElement.EnumerateArray())
        {
            ids.Add(element.GetString()!);
        }

        return ids;
    }

    private async Task<(Guid ExerciseA, Guid ExerciseB, string HostA, string HostB, Guid PostA, Guid PostB)> SeedTwoExercisesAsync()
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
        seed.Posts.Add(NewPost(postA, exerciseA));
        seed.Posts.Add(NewPost(postB, exerciseB));
        await seed.SaveChangesAsync();

        return (exerciseA, exerciseB, hostA, hostB, postA, postB);
    }

    private async Task SeedSessionAsync(
        string kind,
        string rawToken,
        Guid exerciseId,
        Guid? staffUserId = null,
        DateTimeOffset? expiresAt = null)
    {
        await using var seed = _fixture.CreateContext();
        seed.Sessions.Add(new Session
        {
            Id = Guid.NewGuid(),
            TokenHash = SessionTokens.Hash(rawToken),
            Kind = kind,
            ExerciseId = exerciseId,
            PrincipalId = (staffUserId ?? Guid.NewGuid()).ToString(),
            StaffUserId = staffUserId,
            Role = kind == "staff" ? "controller" : "participant",
            ActingHumanId = "human-1",
            IsReadOnly = kind == "readonly",
            IssuedAt = DateTimeOffset.UtcNow.AddMinutes(-5),
            ExpiresAt = expiresAt ?? DateTimeOffset.UtcNow.AddHours(1),
            RefreshExpiresAt = DateTimeOffset.UtcNow.AddHours(12),
        });
        await seed.SaveChangesAsync();
    }

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
}
