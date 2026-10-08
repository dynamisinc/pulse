namespace Pulse.WebApi.Tests.Features.Social.Moderation;

using System;
using System.Net;
using System.Net.Http;
using System.Threading.Tasks;
using FluentAssertions;
using Pulse.WebApi.Tests.Data;
using Pulse.WebApi.Tests.Features.ExerciseConfiguration.Lifecycle;
using Xunit;

/// <summary>
/// The authorization matrix for <c>DELETE /api/staff/posts/{postId}</c> (demo-polish B6, story 09 AC
/// "Authorization"; CTL-033, COR-005). Only a live staff session assigned to the resolved exercise as
/// <c>controller</c> may take a post down. No staff session (anonymous, participant, shared read-only, expired
/// staff) gets 401. Staff that is not a controller, or not assigned to the resolved exercise, gets 403. Every
/// refusal leaves the post live and broadcasts nothing. Real <c>Program</c> pipeline, real tokens, real SQL.
/// </summary>
[Collection(MsSqlCollection.Name)]
public sealed class TakedownAuthorizationTests
{
    private readonly ModerationSeeder _seed;

    public TakedownAuthorizationTests(MsSqlContainerFixture fixture) => _seed = new ModerationSeeder(fixture);

    [RequiresDockerFact]
    public async Task Anonymous_Returns401_AndThePostStaysLive()
    {
        var exercise = await _seed.SeedExerciseAsync();
        var postId = await _seed.SeedPostAsync(exercise.Id);

        await AssertRefusedAsync(exercise.Host, token: null, postId, HttpStatusCode.Unauthorized, "an anonymous caller has no session at all");
    }

    [RequiresDockerFact]
    public async Task ParticipantSession_OnItsOwnHost_Returns401_AndThePostStaysLive()
    {
        // The participant is on its own exercise's host with a live session, so the scope resolves to the post's
        // exercise. It is still refused: it is not a STAFF session.
        var exercise = await _seed.SeedExerciseAsync();
        var postId = await _seed.SeedPostAsync(exercise.Id);
        var persona = await _seed.SeedPersonaAsync(exercise.Id);
        var participant = await _seed.SeedParticipantSessionAsync(exercise.Id, persona);

        await AssertRefusedAsync(exercise.Host, participant, postId, HttpStatusCode.Unauthorized, "a participant session is not a staff session");
    }

    [RequiresDockerFact]
    public async Task SharedReadOnlySession_Returns401_AndThePostStaysLive()
    {
        var exercise = await _seed.SeedExerciseAsync();
        var postId = await _seed.SeedPostAsync(exercise.Id);
        var readOnly = await _seed.SeedReadOnlySessionAsync(exercise.Id);

        await AssertRefusedAsync(exercise.Host, readOnly, postId, HttpStatusCode.Unauthorized, "a shared read-only session is not a staff session");
    }

    [RequiresDockerFact]
    public async Task ExpiredControllerSession_Returns401_AndThePostStaysLive()
    {
        var exercise = await _seed.SeedExerciseAsync();
        var postId = await _seed.SeedPostAsync(exercise.Id);
        var expired = await _seed.SeedStaffSessionAsync(
            exercise.Id,
            [(exercise.Id, "controller")],
            session => session.ExpiresAt = DateTimeOffset.UtcNow.AddMinutes(-1));

        await AssertRefusedAsync(exercise.Host, expired, postId, HttpStatusCode.Unauthorized, "an expired session is no session");
    }

    [RequiresDockerTheory]
    [InlineData("evaluator")]
    [InlineData("planner")]
    public async Task AssignedNonControllerStaff_Returns403_AndThePostStaysLive(string role)
    {
        var exercise = await _seed.SeedExerciseAsync();
        var postId = await _seed.SeedPostAsync(exercise.Id);
        var staff = await _seed.SeedStaffSessionAsync(exercise.Id, [(exercise.Id, role)]);

        await AssertRefusedAsync(
            exercise.Host, staff, postId, HttpStatusCode.Forbidden, $"an assigned {role} may watch but only a controller takes content down");
    }

    [RequiresDockerFact]
    public async Task StaffNotAssignedToTheResolvedExercise_Returns403_AndThePostStaysLive()
    {
        // The session is active on the post's exercise but the staff user's only assignment is elsewhere.
        var exercise = await _seed.SeedExerciseAsync();
        var elsewhere = await _seed.SeedExerciseAsync();
        var postId = await _seed.SeedPostAsync(exercise.Id);
        var staff = await _seed.SeedStaffSessionAsync(exercise.Id, [(elsewhere.Id, "controller")]);

        await AssertRefusedAsync(
            exercise.Host, staff, postId, HttpStatusCode.Forbidden, "a controller of another exercise is not assigned to this one (COR-005)");
    }

    [RequiresDockerFact]
    public async Task AssignedController_Returns204_NotABlanketDeny()
    {
        // Positive control: without it, a route that refused everyone would pass every test above.
        var exercise = await _seed.SeedExerciseAsync();
        var postId = await _seed.SeedPostAsync(exercise.Id);
        var controller = await _seed.SeedControllerSessionAsync(exercise.Id);

        using var factory = new ModerationWebApplicationFactory(_seed.ConnectionString);
        using var client = factory.CreateClientFor(exercise.Host, controller);

        var response = await client.DeleteAsync(new Uri($"/api/staff/posts/{postId}", UriKind.Relative));

        response.StatusCode.Should().Be(HttpStatusCode.NoContent, "an assigned controller is exactly who may take a post down");
        (await _seed.ReadSurvivingPostAsync(postId)).DeletedAt.Should().NotBeNull();
    }

    [RequiresDockerFact]
    public async Task RefusedCaller_WithAnInvalidCategory_GetsTheAuthStatus_NotA400()
    {
        // The gates run before validation, so an unauthorized caller learns nothing about the endpoint's rules.
        var exercise = await _seed.SeedExerciseAsync();
        var postId = await _seed.SeedPostAsync(exercise.Id);
        var participant = await _seed.SeedParticipantSessionAsync(exercise.Id);

        using var factory = new ModerationWebApplicationFactory(_seed.ConnectionString);
        using var client = factory.CreateClientFor(exercise.Host, participant);

        var response = await client.DeleteAsync(new Uri($"/api/staff/posts/{postId}?category=spam", UriKind.Relative));

        response.StatusCode.Should().Be(HttpStatusCode.Unauthorized);
    }

    private async Task AssertRefusedAsync(
        string host, string? token, Guid postId, HttpStatusCode expected, string because)
    {
        using var factory = new ModerationWebApplicationFactory(_seed.ConnectionString);
        using HttpClient client = factory.CreateClientFor(host, token);

        var response = await client.DeleteAsync(new Uri($"/api/staff/posts/{postId}?category=other", UriKind.Relative));

        response.StatusCode.Should().Be(expected, because);
        (await _seed.ReadSurvivingPostAsync(postId)).DeletedAt.Should().BeNull("a refused caller never takes the post down");
        factory.Broadcaster.Removed.Should().BeEmpty("a refused caller never triggers PostRemoved");
    }
}
