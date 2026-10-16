namespace Pulse.WebApi.Tests.Features.Identity.RoleMatrix;

using System;
using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using System.Threading.Tasks;
using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Pulse.WebApi.Data.Entities;
using Pulse.WebApi.Features.Identity.Sessions;
using Pulse.WebApi.Tests.Data;
using Pulse.WebApi.Tests.Features.ExerciseConfiguration.Lifecycle;

/// <summary>
/// identity-auth-roles/17 Copilot review 6 fold (ADMIN-IDENTITY-MODEL §8.2): the self-service session rows. An evaluator
/// refreshes, reads its session, logs out and switches between two of its OWN evaluator enrollments; a participant
/// session (link-minted or day-word-minted — both persist as a <c>participant</c>-kind session) is refused on both staff
/// operations even though the same person is staff elsewhere. Evaluator reads of the exercise stay open.
/// </summary>
[Collection(MsSqlCollection.Name)]
public sealed class SelfServiceSessionTests
{
    private readonly MsSqlContainerFixture _fixture;

    public SelfServiceSessionTests(MsSqlContainerFixture fixture) => _fixture = fixture;

    [RequiresDockerFact]
    public async Task AnEvaluator_Refreshes_ReadsItsSession_SwitchesBetweenItsOwnEnrollments_AndLogsOut()
    {
        var world = await RoleMatrixWorld.SeedAsync(_fixture);
        var second = await RoleMatrixWorld.SeedAsync(_fixture, organizationId: world.OrganizationId);
        var evaluator = world.PersonOf(MatrixRole.Evaluator);
        await using (var seed = _fixture.CreateContext())
        {
            seed.Enrollments.Add(new Enrollment
            {
                Id = Guid.NewGuid(),
                ExerciseId = second.ExerciseId,
                PersonId = evaluator,
                Role = EnrollmentRoles.Evaluator,
                CreatedAt = DateTimeOffset.UtcNow,
            });
            await seed.SaveChangesAsync();
        }

        using var host = new RoleMatrixHost(_fixture.ConnectionString!);
        var (_, token) = await world.StaffTokenAsync(evaluator, world.ExerciseId, EnrollmentRoles.Evaluator);

        using var refreshClient = world.Client(host, token: null);
        using var refreshed = await refreshClient.PostAsJsonAsync("/api/auth/refresh", new { refreshToken = token + "-refresh" });
        refreshed.StatusCode.Should().Be(HttpStatusCode.OK, "an evaluator refreshes its own session");
        using var refreshedJson = JsonDocument.Parse(await refreshed.Content.ReadAsStringAsync());
        var accessToken = refreshedJson.RootElement.GetProperty("token").GetString();
        accessToken.Should().NotBeNullOrEmpty();

        using var client = world.Client(host, accessToken);
        using (var session = await client.GetAsync("/api/session"))
        {
            session.StatusCode.Should().Be(HttpStatusCode.OK);
        }

        using (var list = await client.GetAsync("/api/staff/assignments"))
        {
            list.StatusCode.Should().Be(HttpStatusCode.OK, "an evaluator lists its own enrollments");
        }

        using (var switched = await client.PostAsJsonAsync("/api/staff/active-exercise", new { exerciseId = second.ExerciseId.ToString() }))
        {
            switched.StatusCode.Should().Be(HttpStatusCode.OK, "an evaluator switches to another of its own evaluator enrollments");
        }

        using (var back = await client.PostAsJsonAsync("/api/staff/active-exercise", new { exerciseId = world.ExerciseId.ToString() }))
        {
            back.StatusCode.Should().Be(HttpStatusCode.OK);
        }

        using (var loggedOut = await client.PostAsync("/api/auth/logout", content: null))
        {
            loggedOut.StatusCode.Should().Be(HttpStatusCode.NoContent);
        }

        using var afterLogout = await client.GetAsync("/api/session");
        afterLogout.StatusCode.Should().Be(HttpStatusCode.Unauthorized, "logout ends the session");
    }

    [RequiresDockerTheory]
    [InlineData("link")]
    [InlineData("day-word")]
    public async Task AParticipantSession_IsRefusedOnBothStaffOperations_EvenWhenThePersonIsStaffElsewhere(string mintedBy)
    {
        var world = await RoleMatrixWorld.SeedAsync(_fixture);
        var elsewhere = await RoleMatrixWorld.SeedAsync(_fixture, organizationId: world.OrganizationId);
        var person = elsewhere.PersonOf(MatrixRole.Controller);

        var token = $"participant-{mintedBy}-{Guid.NewGuid():N}";
        await using (var seed = _fixture.CreateContext())
        {
            seed.Sessions.Add(new Session
            {
                Id = Guid.NewGuid(),
                TokenHash = SessionTokens.Hash(token),
                Kind = "participant",
                ExerciseId = world.ExerciseId,
                PersonId = person,
                PrincipalId = Guid.NewGuid().ToString(),
                Role = "participant",
                PersonaId = world.PersonaId,
                ActingHumanId = person.ToString(),
                IssuedAt = DateTimeOffset.UtcNow.AddMinutes(-1),
                ExpiresAt = DateTimeOffset.UtcNow.AddHours(12),
            });
            await seed.SaveChangesAsync();
        }

        using var host = new RoleMatrixHost(_fixture.ConnectionString!);
        using var client = world.Client(host, token);

        using var list = await client.GetAsync("/api/staff/assignments");
        using var enter = await client.PostAsJsonAsync("/api/staff/active-exercise", new { exerciseId = elsewhere.ExerciseId.ToString() });

        list.StatusCode.Should().BeOneOf([HttpStatusCode.Unauthorized, HttpStatusCode.Forbidden]);
        enter.StatusCode.Should().BeOneOf([HttpStatusCode.Unauthorized, HttpStatusCode.Forbidden],
            "a participant session must never switch into staff privileges");

        await using var read = _fixture.CreateContext();
        (await read.Sessions.AnyAsync(s => s.TokenHash == SessionTokens.Hash(token) && s.ExerciseId == elsewhere.ExerciseId))
            .Should().BeFalse("nothing was switched");
    }

    [RequiresDockerTheory]
    [InlineData("/api/staff/exercise-lifecycle")]
    [InlineData("/api/staff/exports/report")]
    [InlineData("/api/engine/review-queue")]
    [InlineData("/api/engine/settings")]
    [InlineData("/api/feed")]
    public async Task AnEvaluator_ReadsTheExercise(string route)
    {
        var world = await RoleMatrixWorld.SeedAsync(_fixture);
        using var host = new RoleMatrixHost(_fixture.ConnectionString!);
        using var client = world.Client(host, await world.TokenForAsync(MatrixRole.Evaluator));

        using var response = await client.GetAsync(route);

        response.StatusCode.Should().Be(HttpStatusCode.OK, "an evaluator reads everything in the exercise (§8.2)");
    }
}
