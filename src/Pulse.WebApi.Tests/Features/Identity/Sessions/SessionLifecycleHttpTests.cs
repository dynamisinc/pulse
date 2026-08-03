namespace Pulse.WebApi.Tests.Features.Identity.Sessions;

using System;
using System.Net;
using System.Net.Http;
using System.Net.Http.Json;
using System.Text.Json;
using System.Threading.Tasks;
using FluentAssertions;
using Pulse.WebApi.Data.Entities;
using Pulse.WebApi.Features.Identity.Sessions;
using Pulse.WebApi.Tests.Data;

/// <summary>
/// Story 03 — end-to-end HTTP proof of the refresh/logout round trip through the REAL host-resolution →
/// session-middleware → endpoint pipeline over REAL SQL Server (Testcontainers). <see cref="SessionServiceTests"/>
/// proves the service-level rotation/revocation logic in isolation; <see cref="SessionEndpointContractTests"/>
/// locks the <c>GET /api/session</c> wire shape. These prove the full round trip a real client performs: a
/// refresh rotates both tokens such that the OLD access token is rejected on its very next use and the NEW one
/// authenticates; a logout server-side-revokes such that the SAME token is rejected on the very next request — a
/// stolen reference cannot be replayed either way, through the actual HTTP surface (not just the service call).
/// </summary>
[Collection(MsSqlCollection.Name)]
public sealed class SessionLifecycleHttpTests
{
    private readonly MsSqlContainerFixture _fixture;

    public SessionLifecycleHttpTests(MsSqlContainerFixture fixture) => _fixture = fixture;

    [RequiresDockerFact]
    public async Task Refresh_ThroughRealPipeline_RotatesTokens_OldAccessRejected_NewAccessWorks()
    {
        var exerciseId = Guid.NewGuid();
        var host = $"host-{exerciseId:N}.example.com";
        await SeedExerciseAsync(exerciseId, host);
        await SeedSessionAsync("participant", "http-access-1", "http-refresh-1", exerciseId, Guid.NewGuid().ToString());

        await using var testHost = await SessionAuthenticationTestHost.StartAsync(_fixture.ConnectionString!);

        using (var beforeClient = testHost.CreateClient(host, "http-access-1"))
        {
            var beforeResponse = await beforeClient.GetAsync(new Uri("/api/session", UriKind.Relative));
            beforeResponse.StatusCode.Should().Be(HttpStatusCode.OK, "the original access token is live before refresh");
        }

        using var refreshClient = testHost.CreateClient(host, bearerToken: null);
        var refreshResponse = await refreshClient.PostAsJsonAsync(
            new Uri("/api/auth/refresh", UriKind.Relative), new { refreshToken = "http-refresh-1" });
        refreshResponse.StatusCode.Should().Be(HttpStatusCode.OK);

        using var refreshDocument = JsonDocument.Parse(await refreshResponse.Content.ReadAsStringAsync());
        var newAccessToken = refreshDocument.RootElement.GetProperty("token").GetString();
        newAccessToken.Should().NotBeNullOrEmpty();
        newAccessToken.Should().NotBe("http-access-1", "the access token must be rotated by a refresh");

        using (var oldClient = testHost.CreateClient(host, "http-access-1"))
        {
            var oldResponse = await oldClient.GetAsync(new Uri("/api/session", UriKind.Relative));
            oldResponse.StatusCode.Should().Be(HttpStatusCode.Unauthorized,
                "the OLD access token must be rejected after rotation — a replayed reference fails");
        }

        using var newClient = testHost.CreateClient(host, newAccessToken);
        var newResponse = await newClient.GetAsync(new Uri("/api/session", UriKind.Relative));
        newResponse.StatusCode.Should().Be(HttpStatusCode.OK, "the NEW rotated access token must authenticate");
    }

    [RequiresDockerFact]
    public async Task Logout_ThroughRealPipeline_RevokesServerSide_TokenRejectedOnNextRequest()
    {
        var exerciseId = Guid.NewGuid();
        var host = $"host-{exerciseId:N}.example.com";
        await SeedExerciseAsync(exerciseId, host);
        await SeedSessionAsync("participant", "logout-http-token", "logout-http-refresh", exerciseId, Guid.NewGuid().ToString());

        await using var testHost = await SessionAuthenticationTestHost.StartAsync(_fixture.ConnectionString!);

        using (var client = testHost.CreateClient(host, "logout-http-token"))
        {
            var beforeResponse = await client.GetAsync(new Uri("/api/session", UriKind.Relative));
            beforeResponse.StatusCode.Should().Be(HttpStatusCode.OK, "the session is live before logout");

            var logoutResponse = await client.PostAsync(new Uri("/api/auth/logout", UriKind.Relative), content: null);
            logoutResponse.StatusCode.Should().Be(HttpStatusCode.NoContent);
        }

        using var afterLogoutClient = testHost.CreateClient(host, "logout-http-token");
        var afterResponse = await afterLogoutClient.GetAsync(new Uri("/api/session", UriKind.Relative));
        afterResponse.StatusCode.Should().Be(HttpStatusCode.Unauthorized,
            "a stolen/replayed reference to a logged-out session must be rejected on the very next request");
    }

    private async Task SeedExerciseAsync(Guid exerciseId, string host)
    {
        await using var seed = _fixture.CreateContext();
        seed.Exercises.Add(new Exercise { OrganizationId = Organization.DefaultOrganizationId, Id = exerciseId, Name = "Ex", Hostname = host, TimeZone = "UTC", Status = "active" });
        await seed.SaveChangesAsync();
    }

    private async Task SeedSessionAsync(
        string kind, string rawToken, string rawRefreshToken, Guid exerciseId, string principalId)
    {
        await using var seed = _fixture.CreateContext();
        seed.Sessions.Add(new Session
        {
            Id = Guid.NewGuid(),
            TokenHash = SessionTokens.Hash(rawToken),
            RefreshTokenHash = SessionTokens.Hash(rawRefreshToken),
            Kind = kind,
            ExerciseId = exerciseId,
            PrincipalId = principalId,
            Role = "participant",
            ActingHumanId = "human-1",
            IsReadOnly = kind == "readonly",
            IssuedAt = DateTimeOffset.UtcNow.AddMinutes(-5),
            ExpiresAt = DateTimeOffset.UtcNow.AddHours(1),
            RefreshExpiresAt = DateTimeOffset.UtcNow.AddHours(12),
        });
        await seed.SaveChangesAsync();
    }
}
