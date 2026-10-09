namespace Pulse.WebApi.Tests.Features.Social.Reactions;

using System;
using System.Net;
using System.Threading;
using System.Threading.Tasks;
using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Pulse.WebApi.Data.Entities;
using Pulse.WebApi.Features.Social.Engagement;
using Pulse.WebApi.Tests.Data;
using Pulse.WebApi.Tests.Features.ExerciseConfiguration.Lifecycle;
using static Pulse.WebApi.Tests.Features.Social.Reactions.ReactionTestSeed;

/// <summary>
/// The always-Critical isolation suite for reactions (COR-001 / XC-001, demo-polish B3, DP-16): extends the standing
/// isolation suite with a NEW file. Every test runs the real <c>Program</c> host or the real reader against REAL
/// SQL Server, and every "nothing leaked" claim is backed by an <c>IgnoreQueryFilters()</c> read that proves the
/// other exercise's rows really exist, so a zero is the filter closing the door rather than an empty table.
/// </summary>
/// <remarks>
/// DP-16: the single-column foreign keys do not stop a reaction in exercise A from naming exercise B's post, so
/// the service is the guard. These tests take B's REAL post id, send it under A's scope, and require the same 404 as
/// an unknown id with zero rows written anywhere.
/// </remarks>
[Collection(MsSqlCollection.Name)]
public class ReactionIsolationTests
{
    private readonly MsSqlContainerFixture _fixture;

    public ReactionIsolationTests(MsSqlContainerFixture fixture)
    {
        _fixture = fixture;
    }

    // ---------------------------------------------------------------------------------------------
    // Cross-exercise POST (DP-16): same 404 as an unknown id, zero rows, zero events
    // ---------------------------------------------------------------------------------------------

    [RequiresDockerTheory]
    [InlineData("like")]
    [InlineData("repost")]
    public async Task ReactingToAnotherExercisesRealPost_Returns404_IdenticalToUnknownId_AndWritesNothing(string kind)
    {
        var worldA = await SeedWorldAsync(_fixture);
        var worldB = await SeedWorldAsync(_fixture);
        await AssertPostExistsInAsync(worldB.Post, worldB.Exercise);

        await using var host = CreateHost(_fixture);
        using var client = host.CreateClientFor(worldA.Host, worldA.Token);

        var crossExercise = await client.PutAsync(ReactionUri(worldB.Post, kind), content: null);
        var unknown = await client.PutAsync(ReactionUri(Guid.NewGuid(), kind), content: null);

        crossExercise.StatusCode.Should().Be(
            HttpStatusCode.NotFound,
            "exercise B's REAL post id does not resolve under exercise A's scope (COR-001, DP-16)");
        unknown.StatusCode.Should().Be(HttpStatusCode.NotFound);
        (await crossExercise.Content.ReadAsStringAsync()).Should().Be(
            await unknown.Content.ReadAsStringAsync(),
            "the response must not confirm that a cross-exercise id exists: identical to an unknown id");

        (await ReadReactionsAsync(_fixture, worldB.Post)).Should().BeEmpty(
            "no reaction row may name B's post, in ANY exercise (read unfiltered)");
        (await ReadReactionsInExerciseAsync(_fixture, worldA.Exercise)).Should().BeEmpty(
            "and nothing was stamped into the caller's exercise either");
        (await ReadEventsAsync(_fixture, worldA.Exercise, "reaction", "repost")).Should().BeEmpty(
            "a rejected write emits no telemetry");
        (await ReadEventsAsync(_fixture, worldB.Exercise, "reaction", "repost")).Should().BeEmpty(
            "and certainly nothing lands in the TARGET exercise's telemetry");
    }

    [RequiresDockerFact]
    public async Task UnReactingOnAnotherExercisesRealPost_Returns404_AndLeavesItsActiveReactionUntouched()
    {
        var worldA = await SeedWorldAsync(_fixture);
        var worldB = await SeedWorldAsync(_fixture);

        // A real, ACTIVE like in exercise B, by B's persona, on B's post. A scope-blind DELETE would soft-delete it.
        await using (var seed = _fixture.CreateContext())
        {
            seed.PostReactions.Add(NewReaction(worldB.Exercise, worldB.Post, worldB.Persona, ReactionKinds.Like));
            await seed.SaveChangesAsync();
        }

        await using var host = CreateHost(_fixture);
        using var client = host.CreateClientFor(worldA.Host, worldA.Token);

        var response = await client.DeleteAsync(ReactionUri(worldB.Post, "like"));

        response.StatusCode.Should().Be(
            HttpStatusCode.NotFound, "an un-like on another exercise's post is rejected, not a quiet 200 no-op");

        var rows = await ReadReactionsAsync(_fixture, worldB.Post);
        rows.Should().ContainSingle("B's reaction still exists and no new row was added")
            .Which.DeletedAt.Should().BeNull("exercise A's request must never soft-delete exercise B's reaction");
        (await ReadEventsAsync(_fixture, worldA.Exercise, "reaction")).Should().BeEmpty();
    }

    // ---------------------------------------------------------------------------------------------
    // Cross-exercise PERSONA: a session bound to another exercise's persona cannot react
    // ---------------------------------------------------------------------------------------------

    [RequiresDockerFact]
    public async Task ASessionBoundToAnotherExercisesPersona_CannotReact_403_AndWritesNothing()
    {
        var worldA = await SeedWorldAsync(_fixture);
        var worldB = await SeedWorldAsync(_fixture);

        // A participant session on exercise A's host whose persona binding names exercise B's persona.
        var token = await SeedSessionAsync(_fixture, worldA.Exercise, worldB.Persona);

        await using var host = CreateHost(_fixture);
        using var client = host.CreateClientFor(worldA.Host, token);

        (await client.PutAsync(ReactionUri(worldA.Post, "like"), content: null)).StatusCode.Should().Be(
            HttpStatusCode.Forbidden,
            "the reacting persona must resolve in the caller's exercise; another exercise's persona does not");
        (await client.DeleteAsync(ReactionUri(worldA.Post, "repost"))).StatusCode.Should().Be(HttpStatusCode.Forbidden);

        (await ReadReactionsAsync(_fixture, worldA.Post)).Should().BeEmpty();
        (await ReadEventsAsync(_fixture, worldA.Exercise, "reaction", "repost")).Should().BeEmpty();
        (await ReadEventsAsync(_fixture, worldB.Exercise, "reaction", "repost")).Should().BeEmpty();
    }

    // ---------------------------------------------------------------------------------------------
    // Unresolved scope: fail closed
    // ---------------------------------------------------------------------------------------------

    [RequiresDockerFact]
    public async Task UnresolvedScope_Returns401_AndWritesNothing()
    {
        var world = await SeedWorldAsync(_fixture);

        await using var host = CreateHost(_fixture);

        // An unprovisioned host resolves to NO exercise, and no token is presented: the scope stays unset.
        using var client = host.CreateClientFor($"unknown-{Guid.NewGuid():N}.example.com", bearerToken: null);

        (await client.PutAsync(ReactionUri(world.Post, "like"), content: null)).StatusCode.Should().Be(
            HttpStatusCode.Unauthorized, "an unresolved exercise scope fails closed with 401, never an empty 200");
        (await client.DeleteAsync(ReactionUri(world.Post, "like"))).StatusCode.Should().Be(HttpStatusCode.Unauthorized);

        (await ReadReactionsAsync(_fixture, world.Post)).Should().BeEmpty();
    }

    // ---------------------------------------------------------------------------------------------
    // Reader scoping: never another exercise's rows
    // ---------------------------------------------------------------------------------------------

    [RequiresDockerFact]
    public async Task Reader_UnderScopeA_OmitsBsPost_AndNeverCountsBsRows_EvenRowsThatNameAsPost()
    {
        var worldA = await SeedWorldAsync(_fixture);
        var worldB = await SeedWorldAsync(_fixture);

        await using (var seed = _fixture.CreateContext())
        {
            // B's own engagement on B's post.
            seed.PostReactions.Add(NewReaction(worldB.Exercise, worldB.Post, worldB.Persona, ReactionKinds.Like));
            seed.PostReactions.Add(NewReaction(worldB.Exercise, worldB.Post, worldB.Persona, ReactionKinds.Repost));

            // The DP-16 hazard: rows stamped with exercise B that NAME exercise A's post (the single-column FKs allow
            // it). A scope-blind count would add them to A's post.
            seed.PostReactions.Add(NewReaction(worldB.Exercise, worldA.Post, worldB.Persona, ReactionKinds.Like));
            seed.PostReactions.Add(NewReaction(worldB.Exercise, worldA.Post, worldB.OtherPersona, ReactionKinds.Repost));
            seed.Posts.Add(NewPost(Guid.NewGuid(), worldB.Exercise, worldB.Persona, parentPostId: worldA.Post));
            await seed.SaveChangesAsync();
        }

        // The rows really exist (so the zeros below are the filter, not an empty table).
        (await ReadReactionsAsync(_fixture, worldA.Post)).Should().HaveCount(2);
        (await ReadReactionsAsync(_fixture, worldB.Post)).Should().HaveCount(2);

        await using var context = CreateScopedContext(_fixture, worldA.Exercise);
        var reader = new PostEngagementReader(context, new Pulse.WebApi.Data.ExerciseContext { CurrentExerciseId = worldA.Exercise });

        var result = await reader.GetAsync([worldA.Post, worldB.Post], worldB.Persona, CancellationToken.None);

        result.Keys.Should().BeEquivalentTo(
            [worldA.Post], "an id outside the current exercise is simply ABSENT, not present with zeros");
        result[worldA.Post].Should().Be(
            new PostEngagement(0, 0, 0, ViewerLiked: false, ViewerReposted: false),
            "rows stamped with exercise B never reach exercise A's counts or viewer flags, even when they name A's post");
    }

    [RequiresDockerFact]
    public async Task Reader_WithAnUnresolvedOrEmptyScope_ReadsNothing()
    {
        var world = await SeedWorldAsync(_fixture);

        await using (var seed = _fixture.CreateContext())
        {
            seed.PostReactions.Add(NewReaction(world.Exercise, world.Post, world.Persona, ReactionKinds.Like));
            await seed.SaveChangesAsync();
        }

        foreach (var scope in new Guid?[] { null, Guid.Empty })
        {
            await using var context = CreateScopedContext(_fixture, scope);
            var reader = new PostEngagementReader(context, new Pulse.WebApi.Data.ExerciseContext { CurrentExerciseId = scope });

            var result = await reader.GetAsync([world.Post], world.Persona, CancellationToken.None);

            result.Should().BeEmpty("an unresolved scope fails closed to ZERO posts, never every exercise's (scope {0})", scope);
        }

        (await ReadReactionsAsync(_fixture, world.Post)).Should().ContainSingle("the row exists; the empty read is the fail-closed door");
    }

    [RequiresDockerFact]
    public async Task ReactionResponseCounts_UnderScopeA_NeverIncludeBsRowsThatNameAsPost()
    {
        var worldA = await SeedWorldAsync(_fixture, baselineLike: 10, baselineRepost: 5);
        var worldB = await SeedWorldAsync(_fixture);

        await using (var seed = _fixture.CreateContext())
        {
            for (var i = 0; i < 3; i++)
            {
                seed.PostReactions.Add(NewReaction(worldB.Exercise, worldA.Post, Guid.NewGuid(), ReactionKinds.Like));
                seed.PostReactions.Add(NewReaction(worldB.Exercise, worldA.Post, Guid.NewGuid(), ReactionKinds.Repost));
            }

            await seed.SaveChangesAsync();
        }

        await using var host = CreateHost(_fixture);
        using var client = host.CreateClientFor(worldA.Host, worldA.Token);

        var response = await client.PutAsync(ReactionUri(worldA.Post, "like"), content: null);
        response.StatusCode.Should().Be(HttpStatusCode.OK);

        var counts = (await ReadJsonAsync(response)).GetProperty("counts");
        counts.GetProperty("like").GetInt32().Should().Be(
            11, "baseline 10 + the caller's one real like; B's three stray likes on this post id are not counted");
        counts.GetProperty("repost").GetInt32().Should().Be(5, "B's stray reposts are not counted either");
    }

    private async Task AssertPostExistsInAsync(Guid postId, Guid exerciseId)
    {
        await using var verify = _fixture.CreateContext();
        var post = await verify.Posts.IgnoreQueryFilters().SingleOrDefaultAsync(candidate => candidate.Id == postId);
        post.Should().NotBeNull("the target post must really exist, so a 404 cannot be a false pass on an unseeded id");
        post!.ExerciseId.Should().Be(exerciseId);
    }
}
