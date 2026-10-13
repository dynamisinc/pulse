namespace Pulse.WebApi.Tests.Features.Identity.Sessions;

using System;
using System.Net;
using System.Net.Http;
using System.Net.Http.Json;
using System.Text.Json;
using System.Threading.Tasks;
using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Pulse.WebApi.Data.Entities;
using Pulse.WebApi.Features.Identity.EasyLogin;
using Pulse.WebApi.Features.Identity.Sessions;
using Pulse.WebApi.Tests.Data;

/// <summary>
/// Easy-login story 06 (EL-10) through the REAL host-resolution → session-middleware → endpoint pipeline over real SQL:
/// a participant refresh after the exercise day has ended answers exactly the <c>401</c> a lapsed refresh token gets
/// (story 07 treats only 401/403 from <c>/auth/refresh</c> as "signed out"); a refresh inside the day returns the
/// day-capped session; and a revoked day-long session is refused on both refresh and its next authenticated request.
/// </summary>
[Collection(MsSqlCollection.Name)]
public sealed class ParticipantDayLongHttpTests
{
    private readonly MsSqlContainerFixture _fixture;

    public ParticipantDayLongHttpTests(MsSqlContainerFixture fixture) => _fixture = fixture;

    [RequiresDockerFact]
    public async Task Refresh_AfterTheExerciseDayEnded_Is401_ExactlyLikeALapsedRefreshToken()
    {
        var exerciseId = Guid.NewGuid();
        var host = $"day-{exerciseId:N}.example.com";
        await SeedExerciseAsync(exerciseId, host);
        var now = DateTimeOffset.UtcNow;

        // Yesterday's session whose stored window ended at yesterday's day end: the ordinary case after midnight.
        var endedToken = $"day-ended-{Guid.NewGuid():N}";
        await SeedParticipantSessionAsync(
            exerciseId, endedToken, issuedAt: now.AddDays(-1), refreshExpiresAt: ExerciseDay.EndOfDayUtc("UTC", now.AddDays(-1), 0));

        // Yesterday's session whose stored window is still open (stamped under the old sliding rule): its day has
        // ended all the same.
        var slidingToken = $"day-ended-sliding-{Guid.NewGuid():N}";
        await SeedParticipantSessionAsync(exerciseId, slidingToken, issuedAt: now.AddDays(-2), refreshExpiresAt: now.AddHours(1));

        // The pre-existing refusal it must look exactly like.
        var lapsedToken = $"lapsed-{Guid.NewGuid():N}";
        await SeedParticipantSessionAsync(exerciseId, lapsedToken, issuedAt: now.AddMinutes(-30), refreshExpiresAt: now.AddMinutes(-1));

        await using var testHost = await SessionAuthenticationTestHost.StartAsync(_fixture.ConnectionString!);
        using var client = testHost.CreateClient(host, bearerToken: null);

        var lapsed = await RefreshAsync(client, lapsedToken);
        var ended = await RefreshAsync(client, endedToken);
        var sliding = await RefreshAsync(client, slidingToken);

        lapsed.Status.Should().Be(HttpStatusCode.Unauthorized, "the baseline: a lapsed refresh window is 401");
        ended.Status.Should().Be(HttpStatusCode.Unauthorized, "a refresh after the day end is a full sign-in (401)");
        sliding.Status.Should().Be(HttpStatusCode.Unauthorized, "a session can never slide past its exercise day");
        ended.Body.Should().Be(lapsed.Body, "the day-ended refusal is the existing 401, not a new error shape");
        sliding.Body.Should().Be(lapsed.Body);

        await using var verify = _fixture.CreateContext();
        (await verify.TelemetryEvents.IgnoreQueryFilters()
            .CountAsync(e => e.ExerciseId == exerciseId && e.EventType == "session.refreshed"))
            .Should().Be(0, "a refused refresh emits no event");
    }

    [RequiresDockerFact]
    public async Task Refresh_InsideTheExerciseDay_ReturnsTheDayCappedSession()
    {
        var exerciseId = Guid.NewGuid();
        var host = $"day-{exerciseId:N}.example.com";
        await SeedExerciseAsync(exerciseId, host);
        var now = DateTimeOffset.UtcNow;
        var token = $"in-day-{Guid.NewGuid():N}";
        var sessionId = await SeedParticipantSessionAsync(
            exerciseId, token, issuedAt: now, refreshExpiresAt: ExerciseDay.EndOfDayUtc("UTC", now, 0));

        await using var testHost = await SessionAuthenticationTestHost.StartAsync(_fixture.ConnectionString!);
        using var client = testHost.CreateClient(host, bearerToken: null);

        var response = await client.PostAsJsonAsync(new Uri("/api/auth/refresh", UriKind.Relative), new { refreshToken = token });
        response.StatusCode.Should().Be(HttpStatusCode.OK);

        await using var verify = _fixture.CreateContext();
        var renewed = await verify.Sessions.SingleAsync(s => s.Id == sessionId && s.ExerciseId == exerciseId);
        var dayEnd = ExerciseDay.EndOfDayUtc("UTC", renewed.IssuedAt, 0);
        renewed.RefreshExpiresAt.Should().Be(dayEnd, "the refresh window is the end of the current exercise day");
        renewed.ExpiresAt.Should().BeOnOrBefore(dayEnd, "the access token never outlives the day");

        using var document = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        DateTimeOffset.Parse(
                document.RootElement.GetProperty("session").GetProperty("expiresAt").GetString()!,
                System.Globalization.CultureInfo.InvariantCulture)
            .Should().Be(renewed.ExpiresAt, "the wire expiresAt is the capped access expiry");
    }

    [RequiresDockerFact]
    public async Task ARevokedDayLongSession_Is401OnRefresh_AndOnItsNextAuthenticatedRequest()
    {
        var exerciseId = Guid.NewGuid();
        var host = $"day-{exerciseId:N}.example.com";
        await SeedExerciseAsync(exerciseId, host);
        var now = DateTimeOffset.UtcNow;
        var accessToken = $"revoked-access-{Guid.NewGuid():N}";
        var refreshToken = $"revoked-refresh-{Guid.NewGuid():N}";
        await SeedParticipantSessionAsync(
            exerciseId,
            refreshToken,
            issuedAt: now,
            refreshExpiresAt: ExerciseDay.EndOfDayUtc("UTC", now, 0),
            accessToken: accessToken,
            revokedAt: now);

        await using var testHost = await SessionAuthenticationTestHost.StartAsync(_fixture.ConnectionString!);

        using (var anonymous = testHost.CreateClient(host, bearerToken: null))
        {
            (await RefreshAsync(anonymous, refreshToken)).Status.Should().Be(
                HttpStatusCode.Unauthorized, "staff revoke / reissue / disable / logout end the day-long session");
        }

        using var bearer = testHost.CreateClient(host, accessToken);
        (await bearer.GetAsync(new Uri("/api/session", UriKind.Relative))).StatusCode.Should().Be(
            HttpStatusCode.Unauthorized, "the next authenticated request with the revoked access token is 401");
    }

    private static async Task<(HttpStatusCode Status, string Body)> RefreshAsync(HttpClient client, string refreshToken)
    {
        var response = await client.PostAsJsonAsync(new Uri("/api/auth/refresh", UriKind.Relative), new { refreshToken });
        return (response.StatusCode, await response.Content.ReadAsStringAsync());
    }

    private async Task SeedExerciseAsync(Guid exerciseId, string host)
    {
        await using var seed = _fixture.CreateContext();
        seed.Exercises.Add(new Exercise
        {
            OrganizationId = Organization.DefaultOrganizationId,
            Id = exerciseId,
            Name = "Day-long",
            Hostname = host,
            TimeZone = "UTC",
            Status = "live",
        });
        await seed.SaveChangesAsync();
    }

    private async Task<Guid> SeedParticipantSessionAsync(
        Guid exerciseId,
        string rawRefreshToken,
        DateTimeOffset issuedAt,
        DateTimeOffset refreshExpiresAt,
        string? accessToken = null,
        DateTimeOffset? revokedAt = null)
    {
        var sessionId = Guid.NewGuid();
        await using var seed = _fixture.CreateContext();
        seed.Sessions.Add(new Session
        {
            Id = sessionId,
            TokenHash = SessionTokens.Hash(accessToken ?? $"access-{Guid.NewGuid():N}"),
            RefreshTokenHash = SessionTokens.Hash(rawRefreshToken),
            Kind = "participant",
            ExerciseId = exerciseId,
            PrincipalId = Guid.NewGuid().ToString(),
            Role = "participant",
            ActingHumanId = "human-1",
            IsReadOnly = false,
            IssuedAt = issuedAt,
            ExpiresAt = issuedAt.AddHours(1),
            RefreshExpiresAt = refreshExpiresAt,
            RevokedAt = revokedAt,
        });
        await seed.SaveChangesAsync();
        return sessionId;
    }
}
