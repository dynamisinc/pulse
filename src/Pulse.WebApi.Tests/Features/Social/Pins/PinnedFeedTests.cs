namespace Pulse.WebApi.Tests.Features.Social.Pins;

using System;
using System.Linq;
using System.Net;
using System.Threading.Tasks;
using FluentAssertions;
using Pulse.WebApi.Data.Entities;
using Pulse.WebApi.Features.Social.Pins;
using Pulse.WebApi.Tests.Data;
using Xunit;

/// <summary>
/// <c>GET /api/feed/pinned</c> (demo-feedback story 04, ACs "Pinned feed" and "Takedown"; DF-5) through the REAL
/// <c>Program</c> pipeline and real SQL: order, de-duplication and reason precedence, replies, takedown exclusion, the
/// 200 cap, the staff and read-only views, and the fail-closed 401.
/// </summary>
[Collection(MsSqlCollection.Name)]
public sealed class PinnedFeedTests
{
    private static readonly DateTimeOffset T = PinsSeeder.PostCreatedAt;

    private readonly PinsSeeder _seed;

    public PinnedFeedTests(MsSqlContainerFixture fixture) => _seed = new PinsSeeder(fixture);

    [RequiresDockerFact]
    public async Task Participant_GetsExercisePinsFirst_ThenOwnPinsAndLikesNewestFirst_EachPostOnce()
    {
        var exercise = await _seed.Sessions.SeedExerciseAsync();
        var viewer = await _seed.Sessions.SeedPersonaAsync(exercise.Id);
        var other = await _seed.Sessions.SeedPersonaAsync(exercise.Id);

        // Exercise pins, pinned at +1, +3, +5 minutes. EP is also pinned AND liked by the viewer (later than any other).
        var e1 = await _seed.SeedPostAsync(exercise.Id, other, pinnedForAllAt: T.AddMinutes(1));
        var ep = await _seed.SeedPostAsync(exercise.Id, other, pinnedForAllAt: T.AddMinutes(3));
        var e2 = await _seed.SeedPostAsync(exercise.Id, other, pinnedForAllAt: T.AddMinutes(5));
        await _seed.SeedReactionAsync(exercise.Id, ep, viewer, ReactionKinds.Pin, T.AddMinutes(30));
        await _seed.SeedReactionAsync(exercise.Id, ep, viewer, ReactionKinds.Like, T.AddMinutes(31));

        // Personal: L1 liked at +1; P1 pinned at +3; a reply R liked at +4; PL pinned at +2 and liked at +6.
        var l1 = await _seed.SeedPostAsync(exercise.Id, other);
        var p1 = await _seed.SeedPostAsync(exercise.Id, other);
        var reply = await _seed.SeedPostAsync(exercise.Id, other, parentPostId: l1);
        var pl = await _seed.SeedPostAsync(exercise.Id, other);
        await _seed.SeedReactionAsync(exercise.Id, l1, viewer, ReactionKinds.Like, T.AddMinutes(1));
        await _seed.SeedReactionAsync(exercise.Id, p1, viewer, ReactionKinds.Pin, T.AddMinutes(3));
        await _seed.SeedReactionAsync(exercise.Id, reply, viewer, ReactionKinds.Like, T.AddMinutes(4));
        await _seed.SeedReactionAsync(exercise.Id, pl, viewer, ReactionKinds.Pin, T.AddMinutes(2));
        await _seed.SeedReactionAsync(exercise.Id, pl, viewer, ReactionKinds.Like, T.AddMinutes(6));

        // Never on the tab: a taken-down post (pinned for all AND liked), an un-liked post, a repost, another's like.
        var down = await _seed.SeedPostAsync(exercise.Id, other, deletedAt: T.AddMinutes(9), pinnedForAllAt: T.AddMinutes(8));
        await _seed.SeedReactionAsync(exercise.Id, down, viewer, ReactionKinds.Like, T.AddMinutes(9));
        var unliked = await _seed.SeedPostAsync(exercise.Id, other);
        await _seed.SeedReactionAsync(exercise.Id, unliked, viewer, ReactionKinds.Like, T.AddMinutes(10), deletedAt: T.AddMinutes(11));
        var reposted = await _seed.SeedPostAsync(exercise.Id, other);
        await _seed.SeedReactionAsync(exercise.Id, reposted, viewer, ReactionKinds.Repost, T.AddMinutes(12));
        var othersLike = await _seed.SeedPostAsync(exercise.Id, other);
        await _seed.SeedReactionAsync(exercise.Id, othersLike, other, ReactionKinds.Like, T.AddMinutes(13));

        var token = await _seed.SeedParticipantAsync(exercise.Id, viewer);
        using var factory = _seed.CreateHost();
        using var client = factory.CreateClientFor(exercise.Host, token);

        var response = await client.GetAsync(PinsSeeder.PinnedFeedUri);

        response.StatusCode.Should().Be(HttpStatusCode.OK);
        var body = await PinsSeeder.ReadJsonAsync(response);
        PinsSeeder.Items(body).Should().Equal(
            new[]
            {
                (PinnedFeedReasons.Exercise, e2),
                (PinnedFeedReasons.Exercise, ep),
                (PinnedFeedReasons.Exercise, e1),
                (PinnedFeedReasons.Pin, pl),
                (PinnedFeedReasons.Like, reply),
                (PinnedFeedReasons.Pin, p1),
                (PinnedFeedReasons.Like, l1),
            },
            "DF-5: exercise pins newest pin first; then own pins and likes merged newest reaction first; each post once "
            + "with exercise > pin > like; replies included; taken-down, un-liked, reposted and other people's posts excluded");

        var items = body.GetProperty("items").EnumerateArray().ToArray();
        items[0].GetProperty("post").GetProperty("pinnedForAll").GetBoolean().Should().BeTrue();
        items[1].GetProperty("post").GetProperty("viewer").GetProperty("pinned").GetBoolean().Should().BeTrue();
        items[1].GetProperty("post").GetProperty("viewer").GetProperty("liked").GetBoolean().Should().BeTrue();
        items[3].GetProperty("post").TryGetProperty("pinnedForAll", out _).Should().BeFalse("omitted when not pinned for everyone");
        items[4].GetProperty("post").GetProperty("inReplyTo").GetProperty("postId").GetString().Should().Be(l1.ToString());
    }

    [RequiresDockerFact]
    public async Task StaffAndReadOnly_GetTheExercisePinsOnly_WithNoViewerState()
    {
        var exercise = await _seed.Sessions.SeedExerciseAsync();
        var persona = await _seed.Sessions.SeedPersonaAsync(exercise.Id);
        var pinned = await _seed.SeedPostAsync(exercise.Id, persona, pinnedForAllAt: T.AddMinutes(1));
        var liked = await _seed.SeedPostAsync(exercise.Id, persona);
        await _seed.SeedReactionAsync(exercise.Id, liked, persona, ReactionKinds.Like, T.AddMinutes(2));

        var staffWithPersona = await _seed.SeedSessionAsync(exercise.Id, persona, kind: "staff");
        var controller = await _seed.Sessions.SeedControllerSessionAsync(exercise.Id);
        var readOnly = await _seed.Sessions.SeedReadOnlySessionAsync(exercise.Id);

        using var factory = _seed.CreateHost();
        foreach (var token in new[] { controller, staffWithPersona, readOnly })
        {
            using var client = factory.CreateClientFor(exercise.Host, token);
            var response = await client.GetAsync(PinsSeeder.PinnedFeedUri);

            response.StatusCode.Should().Be(HttpStatusCode.OK);
            var body = await PinsSeeder.ReadJsonAsync(response);
            PinsSeeder.Items(body).Should().Equal(
                new[] { (PinnedFeedReasons.Exercise, pinned) }, "a non-participant session sees exercise pins only");
            body.GetProperty("items")[0].GetProperty("post").TryGetProperty("viewer", out _).Should().BeFalse();
        }
    }

    [RequiresDockerFact]
    public async Task ATakenDownPost_LeavesTheTabImmediately()
    {
        var exercise = await _seed.Sessions.SeedExerciseAsync();
        var viewer = await _seed.Sessions.SeedPersonaAsync(exercise.Id);
        var postId = await _seed.SeedPostAsync(exercise.Id, viewer, pinnedForAllAt: T.AddMinutes(1));
        await _seed.SeedReactionAsync(exercise.Id, postId, viewer, ReactionKinds.Pin, T.AddMinutes(2));
        var participant = await _seed.SeedParticipantAsync(exercise.Id, viewer);
        var controller = await _seed.Sessions.SeedControllerSessionAsync(exercise.Id);

        using var factory = _seed.CreateHost();
        using var participantClient = factory.CreateClientFor(exercise.Host, participant);
        using var controllerClient = factory.CreateClientFor(exercise.Host, controller);

        PinsSeeder.Items(await PinsSeeder.ReadJsonAsync(await participantClient.GetAsync(PinsSeeder.PinnedFeedUri)))
            .Should().ContainSingle();

        (await controllerClient.DeleteAsync(new Uri($"/api/staff/posts/{postId}", UriKind.Relative)))
            .StatusCode.Should().Be(HttpStatusCode.NoContent);

        PinsSeeder.Items(await PinsSeeder.ReadJsonAsync(await participantClient.GetAsync(PinsSeeder.PinnedFeedUri)))
            .Should().BeEmpty("a taken-down post is excluded even while it is still pinned for everyone and by me");
    }

    [RequiresDockerFact]
    public async Task TheTab_IsCappedAt200_KeepingTheNewest()
    {
        var exercise = await _seed.Sessions.SeedExerciseAsync();
        var viewer = await _seed.Sessions.SeedPersonaAsync(exercise.Id);
        var liked = await _seed.SeedLikedPostsAsync(exercise.Id, viewer, viewer, PinnedFeedService.MaxItems + 5);
        var token = await _seed.SeedParticipantAsync(exercise.Id, viewer);

        using var factory = _seed.CreateHost();
        using var client = factory.CreateClientFor(exercise.Host, token);

        var items = PinsSeeder.Items(await PinsSeeder.ReadJsonAsync(await client.GetAsync(PinsSeeder.PinnedFeedUri)));

        items.Should().HaveCount(PinnedFeedService.MaxItems);
        items.Select(item => item.PostId).Should().Equal(
            liked.Reverse().Take(PinnedFeedService.MaxItems), "newest like first, and the five oldest fall off");
    }

    [RequiresDockerFact]
    public async Task Anonymous_Gets401_NeverAnEmpty200()
    {
        var exercise = await _seed.Sessions.SeedExerciseAsync();
        await _seed.SeedPostAsync(exercise.Id, Guid.NewGuid(), pinnedForAllAt: T);

        using var factory = _seed.CreateHost();
        using var client = factory.CreateClientFor(exercise.Host, bearerToken: null);

        (await client.GetAsync(PinsSeeder.PinnedFeedUri)).StatusCode.Should().Be(HttpStatusCode.Unauthorized);
    }
}
