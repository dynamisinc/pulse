namespace Pulse.WebApi.Tests.Features.Social.Reactions;

using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using FluentAssertions;
using Pulse.WebApi.Data;
using Pulse.WebApi.Data.Entities;
using Pulse.WebApi.Features.Social.Engagement;
using Pulse.WebApi.Tests.Data;
using static Pulse.WebApi.Tests.Features.Social.Reactions.ReactionTestSeed;

/// <summary>
/// <see cref="PostEngagementReader"/> (demo-polish B3) against REAL SQL Server: real like/repost counts from ACTIVE
/// rows, non-deleted DIRECT reply counts, the viewer's own flags, out-of-scope ids absent, and a batched read whose
/// round-trip count does not grow with the number of posts (no N+1).
/// </summary>
[Collection(MsSqlCollection.Name)]
public class PostEngagementReaderTests
{
    private readonly MsSqlContainerFixture _fixture;

    public PostEngagementReaderTests(MsSqlContainerFixture fixture)
    {
        _fixture = fixture;
    }

    [RequiresDockerFact]
    public async Task Counts_AreActiveReactionsAndNonDeletedDirectReplies_Only()
    {
        var world = await SeedWorldAsync(_fixture, baselineReply: 50, baselineRepost: 50, baselineLike: 50);
        var reply = Guid.NewGuid();

        await using (var seed = _fixture.CreateContext())
        {
            // Likes: three active, one soft-deleted (history; not counted).
            for (var i = 0; i < 3; i++)
            {
                seed.PostReactions.Add(NewReaction(world.Exercise, world.Post, Guid.NewGuid(), ReactionKinds.Like));
            }

            seed.PostReactions.Add(NewReaction(
                world.Exercise, world.Post, Guid.NewGuid(), ReactionKinds.Like, deletedAt: world.ScenarioTime));

            // Reposts: two active.
            seed.PostReactions.Add(NewReaction(world.Exercise, world.Post, Guid.NewGuid(), ReactionKinds.Repost));
            seed.PostReactions.Add(NewReaction(world.Exercise, world.Post, Guid.NewGuid(), ReactionKinds.Repost));

            // Replies: two live direct replies, one taken-down direct reply, and one reply-to-a-reply.
            seed.Posts.Add(NewPost(reply, world.Exercise, world.OtherPersona, parentPostId: world.Post));
            seed.Posts.Add(NewPost(Guid.NewGuid(), world.Exercise, world.OtherPersona, parentPostId: world.Post));
            seed.Posts.Add(NewPost(
                Guid.NewGuid(), world.Exercise, world.OtherPersona, parentPostId: world.Post, deletedAt: world.ScenarioTime));
            seed.Posts.Add(NewPost(Guid.NewGuid(), world.Exercise, world.OtherPersona, parentPostId: reply));
            await seed.SaveChangesAsync();
        }

        var result = await ReadAsync(world.Exercise, [world.Post, reply], viewer: null);

        result[world.Post].Should().Be(
            new PostEngagement(RealLike: 3, RealRepost: 2, RealReply: 2, ViewerLiked: false, ViewerReposted: false),
            "REAL counts only (the baseline of 50 is the projector's job); soft-deleted likes, taken-down replies and "
            + "replies-to-replies are excluded");
        result[reply].RealReply.Should().Be(1, "a reply-to-a-reply counts for its own parent only");
    }

    [RequiresDockerFact]
    public async Task ViewerFlags_ReadTheViewersActiveRowsOnly_AndAreFalseWithNoViewer()
    {
        var world = await SeedWorldAsync(_fixture);

        await using (var seed = _fixture.CreateContext())
        {
            seed.PostReactions.Add(NewReaction(world.Exercise, world.Post, world.Persona, ReactionKinds.Like));

            // The viewer reposted and then undid it: history only.
            seed.PostReactions.Add(NewReaction(
                world.Exercise, world.Post, world.Persona, ReactionKinds.Repost, deletedAt: world.ScenarioTime));

            // Someone ELSE reposted: counts, but is not the viewer's state.
            seed.PostReactions.Add(NewReaction(world.Exercise, world.Post, world.OtherPersona, ReactionKinds.Repost));
            await seed.SaveChangesAsync();
        }

        var asViewer = await ReadAsync(world.Exercise, [world.Post], world.Persona);
        asViewer[world.Post].Should().Be(new PostEngagement(1, 1, 0, ViewerLiked: true, ViewerReposted: false));

        var asOther = await ReadAsync(world.Exercise, [world.Post], world.OtherPersona);
        asOther[world.Post].ViewerLiked.Should().BeFalse();
        asOther[world.Post].ViewerReposted.Should().BeTrue();

        var noViewer = await ReadAsync(world.Exercise, [world.Post], viewer: null);
        noViewer[world.Post].ViewerLiked.Should().BeFalse("viewer flags are false when viewerPersonaId is null");
        noViewer[world.Post].ViewerReposted.Should().BeFalse();
    }

    [RequiresDockerFact]
    public async Task UnknownAndEmptyIds_AreAbsent_AndDuplicatesCollapse()
    {
        var world = await SeedWorldAsync(_fixture);
        var unknown = Guid.NewGuid();

        var result = await ReadAsync(world.Exercise, [world.Post, world.Post, unknown, Guid.Empty], world.Persona);

        result.Keys.Should().BeEquivalentTo([world.Post], "an id that does not resolve in scope is simply absent");
        result[world.Post].Should().Be(new PostEngagement(0, 0, 0, false, false), "an in-scope post with no engagement reads zeros");
    }

    [RequiresDockerFact]
    public async Task ABatch_IsReadInAFixedNumberOfRoundTrips_RegardlessOfSize_NoNPlusOne()
    {
        var world = await SeedWorldAsync(_fixture);
        var posts = Enumerable.Range(0, 20).Select(_ => Guid.NewGuid()).ToArray();

        await using (var seed = _fixture.CreateContext())
        {
            foreach (var post in posts)
            {
                seed.Posts.Add(NewPost(post, world.Exercise, world.OtherPersona));
                seed.PostReactions.Add(NewReaction(world.Exercise, post, world.Persona, ReactionKinds.Like));
                seed.PostReactions.Add(NewReaction(world.Exercise, post, world.OtherPersona, ReactionKinds.Repost));
                seed.Posts.Add(NewPost(Guid.NewGuid(), world.Exercise, world.OtherPersona, parentPostId: post));
            }

            await seed.SaveChangesAsync();
        }

        var small = await CountRoundTripsAsync(world.Exercise, posts.Take(2).ToArray(), world.Persona);
        var large = await CountRoundTripsAsync(world.Exercise, posts, world.Persona);

        large.Result.Should().HaveCount(20);
        large.Result.Values.Should().OnlyContain(
            engagement => engagement == new PostEngagement(1, 1, 1, true, false), "every post was read correctly");

        large.RoundTrips.Should().Be(
            small.RoundTrips, "the number of queries must not grow with the number of posts (no N+1)");
        large.RoundTrips.Should().BeLessThanOrEqualTo(
            4, "one read for the in-scope posts, one per aggregate (reactions, replies) and one for the viewer");

        var withoutViewer = await CountRoundTripsAsync(world.Exercise, posts, viewer: null);
        withoutViewer.RoundTrips.Should().Be(large.RoundTrips - 1, "the viewer read is skipped when there is no viewer");
    }

    [RequiresDockerFact]
    public async Task AnEmptyRequest_ReadsNothing_AndIssuesNoQuery()
    {
        var world = await SeedWorldAsync(_fixture);

        var outcome = await CountRoundTripsAsync(world.Exercise, [], world.Persona);

        outcome.Result.Should().BeEmpty();
        outcome.RoundTrips.Should().Be(0);
    }

    private async Task<IReadOnlyDictionary<Guid, PostEngagement>> ReadAsync(
        Guid exerciseId, Guid[] postIds, Guid? viewer)
    {
        await using var context = CreateScopedContext(_fixture, exerciseId);
        var reader = new PostEngagementReader(context, new ExerciseContext { CurrentExerciseId = exerciseId });
        return await reader.GetAsync(postIds, viewer, CancellationToken.None);
    }

    private async Task<(IReadOnlyDictionary<Guid, PostEngagement> Result, int RoundTrips)> CountRoundTripsAsync(
        Guid exerciseId, Guid[] postIds, Guid? viewer)
    {
        var counter = new CommandCountingInterceptor();
        await using var context = CreateScopedContext(_fixture, exerciseId, counter);
        var reader = new PostEngagementReader(context, new ExerciseContext { CurrentExerciseId = exerciseId });

        var result = await reader.GetAsync(postIds, viewer, CancellationToken.None);
        return (result, counter.Count);
    }
}
