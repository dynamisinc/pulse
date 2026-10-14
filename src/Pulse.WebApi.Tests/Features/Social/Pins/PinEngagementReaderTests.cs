namespace Pulse.WebApi.Tests.Features.Social.Pins;

using System;
using System.Threading;
using System.Threading.Tasks;
using FluentAssertions;
using Pulse.WebApi.Data;
using Pulse.WebApi.Data.Entities;
using Pulse.WebApi.Features.Social.Engagement;
using Pulse.WebApi.Tests.Data;
using Pulse.WebApi.Tests.Features.Social.Reactions;
using Xunit;

/// <summary>
/// <see cref="PostEngagementReader"/> with personal pins (demo-feedback story 04, AC "Viewer state", gotcha "Pins
/// never change counts"): pins are reported only as the viewer's own <c>ViewerPinned</c>, never counted.
/// </summary>
[Collection(MsSqlCollection.Name)]
public sealed class PinEngagementReaderTests
{
    private static readonly DateTimeOffset T = PinsSeeder.PostCreatedAt;

    private readonly MsSqlContainerFixture _fixture;
    private readonly PinsSeeder _seed;

    public PinEngagementReaderTests(MsSqlContainerFixture fixture)
    {
        _fixture = fixture;
        _seed = new PinsSeeder(fixture);
    }

    [RequiresDockerFact]
    public async Task Pins_AreNeverCounted_AndOnlyTheViewersOwnPinIsReported()
    {
        var exercise = await _seed.Sessions.SeedExerciseAsync();
        var liker = await _seed.Sessions.SeedPersonaAsync(exercise.Id);
        var pinner = await _seed.Sessions.SeedPersonaAsync(exercise.Id);
        var postId = await _seed.SeedPostAsync(exercise.Id, liker);
        await _seed.SeedReactionAsync(exercise.Id, postId, liker, ReactionKinds.Like, T);
        await _seed.SeedReactionAsync(exercise.Id, postId, liker, ReactionKinds.Pin, T);
        await _seed.SeedReactionAsync(exercise.Id, postId, pinner, ReactionKinds.Pin, T);
        await _seed.SeedReactionAsync(exercise.Id, postId, pinner, ReactionKinds.Repost, T);

        await using var context = ReactionTestSeed.CreateScopedContext(_fixture, exercise.Id);
        var reader = new PostEngagementReader(context, new ExerciseContext { CurrentExerciseId = exercise.Id });

        var asPinner = await reader.GetAsync([postId], pinner, CancellationToken.None);
        var asLiker = await reader.GetAsync([postId], liker, CancellationToken.None);
        var anonymous = await reader.GetAsync([postId], null, CancellationToken.None);

        asPinner[postId].Should().Be(
            new PostEngagement(RealLike: 1, RealRepost: 1, RealReply: 0, ViewerLiked: false, ViewerReposted: true, ViewerPinned: true),
            "two pins on the post count for nothing; only like and repost are counted");
        asLiker[postId].Should().Be(new PostEngagement(1, 1, 0, ViewerLiked: true, ViewerReposted: false, ViewerPinned: true));
        anonymous[postId].ViewerPinned.Should().BeFalse("no viewer, no viewer state");
    }

    [RequiresDockerFact]
    public async Task AnUnpinnedRow_IsNotReportedAsPinned()
    {
        var exercise = await _seed.Sessions.SeedExerciseAsync();
        var viewer = await _seed.Sessions.SeedPersonaAsync(exercise.Id);
        var postId = await _seed.SeedPostAsync(exercise.Id, viewer);
        await _seed.SeedReactionAsync(exercise.Id, postId, viewer, ReactionKinds.Pin, T, deletedAt: T.AddMinutes(1));

        await using var context = ReactionTestSeed.CreateScopedContext(_fixture, exercise.Id);
        var reader = new PostEngagementReader(context, new ExerciseContext { CurrentExerciseId = exercise.Id });

        (await reader.GetAsync([postId], viewer, CancellationToken.None))[postId].ViewerPinned.Should().BeFalse();
    }
}
