namespace Pulse.WebApi.Tests.Features.Identity.Sessions;

using System;
using System.Linq;
using System.Net;
using System.Net.Http;
using System.Text.Json;
using System.Threading.Tasks;
using FluentAssertions;
using Pulse.WebApi.Data.Entities;
using Pulse.WebApi.Features.Identity.Sessions;
using Pulse.WebApi.Tests.Data;

/// <summary>
/// Story 03 — the end-to-end <c>GET /api/session</c> contract through the real host → session-middleware →
/// endpoint pipeline over REAL SQL Server (Testcontainers). Proves flipping <c>USE_MOCK_SESSION</c> live will
/// drive <c>useSession()</c> unchanged: the response is the FROZEN <c>Session</c> shape field-for-field for a
/// participant (with persona) and staff (no persona) kind, and an expired/absent session fails closed with 401
/// (never a default/stale session).
/// </summary>
[Collection(MsSqlCollection.Name)]
public sealed class SessionEndpointContractTests
{
    private readonly MsSqlContainerFixture _fixture;

    public SessionEndpointContractTests(MsSqlContainerFixture fixture) => _fixture = fixture;

    [RequiresDockerFact]
    public async Task GetSession_ParticipantOnItsHost_ReturnsFrozenSevenKeyShape()
    {
        var exerciseId = Guid.NewGuid();
        var host = $"host-{exerciseId:N}.example.com";
        var accountId = Guid.NewGuid();
        var personaId = Guid.NewGuid();
        await SeedExerciseAsync(exerciseId, host);
        await SeedSessionAsync("participant", "p-live", exerciseId, principalId: accountId.ToString(), personaId: personaId, role: "pio");

        await using var testHost = await SessionAuthenticationTestHost.StartAsync(_fixture.ConnectionString!);
        using var client = testHost.CreateClient(host, "p-live");

        var response = await client.GetAsync(new Uri("/api/session", UriKind.Relative));
        response.StatusCode.Should().Be(HttpStatusCode.OK);

        using var document = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        var keys = document.RootElement.EnumerateObject().Select(p => p.Name).ToList();
        keys.Should().BeEquivalentTo(
            ["exerciseId", "accountId", "role", "personaId", "actingHumanId", "isReadOnly", "expiresAt"],
            "a participant session with a persona serializes exactly the frozen seven keys");
        document.RootElement.GetProperty("exerciseId").GetString().Should().Be(exerciseId.ToString());
        document.RootElement.GetProperty("accountId").GetString().Should().Be(accountId.ToString());
        document.RootElement.GetProperty("role").GetString().Should().Be("pio");
        document.RootElement.GetProperty("isReadOnly").GetBoolean().Should().BeFalse();
    }

    [RequiresDockerFact]
    public async Task GetSession_StaffSession_OmitsPersonaIdKey()
    {
        var exerciseId = Guid.NewGuid();
        await SeedExerciseAsync(exerciseId, $"host-{exerciseId:N}.example.com");
        // Staff sessions are not host-bound, so any host works.
        await SeedSessionAsync("staff", "s-live", exerciseId, principalId: Guid.NewGuid().ToString(),
            staffUserId: Guid.NewGuid(), role: "controller");

        await using var testHost = await SessionAuthenticationTestHost.StartAsync(_fixture.ConnectionString!);
        using var client = testHost.CreateClient("staff-console.example.com", "s-live");

        var response = await client.GetAsync(new Uri("/api/session", UriKind.Relative));
        response.StatusCode.Should().Be(HttpStatusCode.OK);

        using var document = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        var keys = document.RootElement.EnumerateObject().Select(p => p.Name).ToList();
        keys.Should().NotContain("personaId", "a staff session has no persona — the optional key is OMITTED, never null");
        keys.Should().BeEquivalentTo(["exerciseId", "accountId", "role", "actingHumanId", "isReadOnly", "expiresAt"]);
    }

    [RequiresDockerFact]
    public async Task GetSession_ReadOnlySession_ReturnsFrozenSixKeyShape_OmitsPersonaId()
    {
        var exerciseId = Guid.NewGuid();
        await SeedExerciseAsync(exerciseId, $"host-{exerciseId:N}.example.com");
        var ephemeralId = Guid.NewGuid().ToString();
        // Read-only sessions are not host-bound (story-03 per-kind rule) — any host works.
        await SeedSessionAsync("readonly", "ro-live", exerciseId, principalId: ephemeralId, role: "participant");

        await using var testHost = await SessionAuthenticationTestHost.StartAsync(_fixture.ConnectionString!);
        using var client = testHost.CreateClient("shared-view.example.com", "ro-live");

        var response = await client.GetAsync(new Uri("/api/session", UriKind.Relative));
        response.StatusCode.Should().Be(HttpStatusCode.OK);

        using var document = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        var keys = document.RootElement.EnumerateObject().Select(p => p.Name).ToList();
        keys.Should().NotContain("personaId", "a read-only session has no persona — the optional key is OMITTED, never null");
        keys.Should().BeEquivalentTo(
            ["exerciseId", "accountId", "role", "actingHumanId", "isReadOnly", "expiresAt"],
            "a read-only session with no persona serializes exactly the frozen six keys");
        document.RootElement.GetProperty("accountId").GetString().Should().Be(
            ephemeralId, "a read-only session's wire accountId is the ephemeral identity (COR-015 — no named account)");
        document.RootElement.GetProperty("isReadOnly").GetBoolean().Should().BeTrue();
    }

    [RequiresDockerFact]
    public async Task GetSession_ExpiredParticipantSession_Returns401()
    {
        var exerciseId = Guid.NewGuid();
        var host = $"host-{exerciseId:N}.example.com";
        await SeedExerciseAsync(exerciseId, host);
        await SeedSessionAsync("participant", "p-expired", exerciseId, principalId: Guid.NewGuid().ToString(),
            expiresAt: DateTimeOffset.UtcNow.AddMinutes(-1));

        await using var testHost = await SessionAuthenticationTestHost.StartAsync(_fixture.ConnectionString!);
        using var client = testHost.CreateClient(host, "p-expired");

        var response = await client.GetAsync(new Uri("/api/session", UriKind.Relative));

        response.StatusCode.Should().Be(HttpStatusCode.Unauthorized,
            "an expired session forces re-auth — GET /api/session returns 401, never a stale session");
    }

    private async Task SeedExerciseAsync(Guid exerciseId, string host)
    {
        await using var seed = _fixture.CreateContext();
        seed.Exercises.Add(new Exercise { Id = exerciseId, Name = "Ex", Hostname = host, TimeZone = "UTC", Status = "active" });
        await seed.SaveChangesAsync();
    }

    private async Task SeedSessionAsync(
        string kind,
        string rawToken,
        Guid exerciseId,
        string principalId,
        Guid? personaId = null,
        Guid? staffUserId = null,
        string role = "participant",
        DateTimeOffset? expiresAt = null)
    {
        await using var seed = _fixture.CreateContext();
        seed.Sessions.Add(new Session
        {
            Id = Guid.NewGuid(),
            TokenHash = SessionTokens.Hash(rawToken),
            Kind = kind,
            ExerciseId = exerciseId,
            PrincipalId = principalId,
            StaffUserId = staffUserId,
            PersonaId = personaId,
            Role = role,
            ActingHumanId = "human-1",
            IsReadOnly = kind == "readonly",
            IssuedAt = DateTimeOffset.UtcNow.AddMinutes(-5),
            ExpiresAt = expiresAt ?? DateTimeOffset.UtcNow.AddHours(1),
            RefreshExpiresAt = DateTimeOffset.UtcNow.AddHours(12),
        });
        await seed.SaveChangesAsync();
    }
}
