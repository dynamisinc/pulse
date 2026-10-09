namespace Pulse.WebApi.Tests.Features.Social.Moderation;

using System;
using System.Net;
using System.Threading.Tasks;
using FluentAssertions;
using Pulse.WebApi.Tests.Data;
using Xunit;

/// <summary>
/// The always-Critical isolation suite for controller takedown (demo-polish B6, story 09 AC "Isolation"; COR-001,
/// DP-16). Runs the REAL <c>Program</c> pipeline over real SQL with real session tokens. It proves that a
/// controller of exercise A cannot take down exercise B's post, even with B's real id and even when assigned
/// to B as well. The response is the same 404 an unknown id gets, B's row is physically untouched, and nothing
/// is broadcast.
/// </summary>
[Collection(MsSqlCollection.Name)]
public sealed class TakedownIsolationTests
{
    private readonly ModerationSeeder _seed;

    public TakedownIsolationTests(MsSqlContainerFixture fixture) => _seed = new ModerationSeeder(fixture);

    [RequiresDockerFact]
    public async Task ControllerOfA_TakingDownExerciseBsRealPostId_Gets404_AndBsPostIsUntouched()
    {
        // DP-16: exercise B's REAL post id, presented under scope A, gets the same 4xx as an unknown id.
        var exerciseA = await _seed.SeedExerciseAsync();
        var exerciseB = await _seed.SeedExerciseAsync();
        var postB = await _seed.SeedPostAsync(exerciseB.Id, withMedia: true);
        var controllerA = await _seed.SeedControllerSessionAsync(exerciseA.Id);

        using var factory = new ModerationWebApplicationFactory(_seed.ConnectionString);
        using var client = factory.CreateClientFor(exerciseA.Host, controllerA);

        var response = await client.DeleteAsync(new Uri($"/api/staff/posts/{postB}", UriKind.Relative));

        response.StatusCode.Should().Be(
            HttpStatusCode.NotFound,
            "another exercise's post must not resolve under scope A (COR-001); it is indistinguishable from an unknown id");

        var row = await _seed.ReadPostAsync(postB);
        row.Should().NotBeNull("the row exists physically, so the 404 is the scope filter refusing it, not an empty table");
        row!.DeletedAt.Should().BeNull("a controller of exercise A must never take down exercise B's post");
        (await _seed.CountMediaAsync(postB)).Should().Be((1, 1), "B's media is untouched as well");
        factory.Broadcaster.Removed.Should().BeEmpty("a refused cross-exercise takedown broadcasts nothing to anyone");
    }

    [RequiresDockerFact]
    public async Task UnknownId_AndAnotherExercisesId_GetTheIdenticalResponse()
    {
        // The response must not reveal that a cross-exercise id exists: same status, same headers that matter,
        // byte-identical body.
        var exerciseA = await _seed.SeedExerciseAsync();
        var exerciseB = await _seed.SeedExerciseAsync();
        var postB = await _seed.SeedPostAsync(exerciseB.Id);
        var controllerA = await _seed.SeedControllerSessionAsync(exerciseA.Id);

        using var factory = new ModerationWebApplicationFactory(_seed.ConnectionString);
        using var client = factory.CreateClientFor(exerciseA.Host, controllerA);

        var crossExercise = await client.DeleteAsync(new Uri($"/api/staff/posts/{postB}", UriKind.Relative));
        var unknown = await client.DeleteAsync(new Uri($"/api/staff/posts/{Guid.NewGuid()}", UriKind.Relative));

        crossExercise.StatusCode.Should().Be(HttpStatusCode.NotFound);
        unknown.StatusCode.Should().Be(crossExercise.StatusCode, "an unknown id and a cross-exercise id are the same answer");
        (await unknown.Content.ReadAsByteArrayAsync()).Should().Equal(
            await crossExercise.Content.ReadAsByteArrayAsync(),
            "the bodies are byte-identical, so nothing distinguishes 'exists elsewhere' from 'does not exist'");
        unknown.Content.Headers.ContentType?.MediaType.Should().Be(crossExercise.Content.Headers.ContentType?.MediaType);
        (await _seed.ReadSurvivingPostAsync(postB)).DeletedAt.Should().BeNull();
    }

    [RequiresDockerFact]
    public async Task ControllerAssignedToBothExercises_ActiveOnA_CannotTakeDownBsPost()
    {
        // The scope is the session's ACTIVE exercise, never "any exercise the caller is assigned to". A controller
        // of both A and B who is working in A must switch to B before acting there.
        var exerciseA = await _seed.SeedExerciseAsync();
        var exerciseB = await _seed.SeedExerciseAsync();
        var postB = await _seed.SeedPostAsync(exerciseB.Id);
        var controllerOfBoth = await _seed.SeedStaffSessionAsync(
            activeExerciseId: exerciseA.Id,
            assignments: [(exerciseA.Id, "controller"), (exerciseB.Id, "controller")]);

        using var factory = new ModerationWebApplicationFactory(_seed.ConnectionString);
        using var client = factory.CreateClientFor(exerciseB.Host, controllerOfBoth);

        var response = await client.DeleteAsync(new Uri($"/api/staff/posts/{postB}", UriKind.Relative));

        response.StatusCode.Should().Be(
            HttpStatusCode.NotFound,
            "the request host and the assignment set do not widen the scope: it is the session's active exercise (A)");
        (await _seed.ReadSurvivingPostAsync(postB)).DeletedAt.Should().BeNull();
        factory.Broadcaster.Removed.Should().BeEmpty();
    }

    [RequiresDockerFact]
    public async Task TakingDownAsPost_BroadcastsToAOnly_AndLeavesBsPostsAlone()
    {
        // Positive control for the refusals above, plus the broadcast's exercise targeting.
        var exerciseA = await _seed.SeedExerciseAsync();
        var exerciseB = await _seed.SeedExerciseAsync();
        var postA = await _seed.SeedPostAsync(exerciseA.Id);
        var postB = await _seed.SeedPostAsync(exerciseB.Id);
        var controllerA = await _seed.SeedControllerSessionAsync(exerciseA.Id);

        using var factory = new ModerationWebApplicationFactory(_seed.ConnectionString);
        using var client = factory.CreateClientFor(exerciseA.Host, controllerA);

        var response = await client.DeleteAsync(new Uri($"/api/staff/posts/{postA}", UriKind.Relative));

        response.StatusCode.Should().Be(HttpStatusCode.NoContent);
        (await _seed.ReadSurvivingPostAsync(postA)).DeletedAt.Should().NotBeNull();
        (await _seed.ReadSurvivingPostAsync(postB)).DeletedAt.Should().BeNull("a takedown in A never touches B");
        factory.Broadcaster.Removed.Should().ContainSingle().Which.Should().Be(
            (exerciseA.Id, postA),
            "PostRemoved targets the resolved exercise (A) and names only A's post");
    }
}
