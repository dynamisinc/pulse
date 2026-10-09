namespace Pulse.WebApi.Tests.Features.Social.Threads;

using System;
using System.Threading;
using System.Threading.Tasks;
using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Pulse.WebApi.Data;
using Pulse.WebApi.Features.Social.Threads;
using Pulse.WebApi.Tests.Data;

/// <summary>
/// The resolver matrix for <see cref="ReplyParentResolver"/> (demo-polish B2, AC-1; DP-8, DP-16): <c>None</c> for a
/// null/empty id, <c>Resolved</c> only for a live post in the current exercise, and ONE indistinguishable
/// <c>NotFound</c> for unparseable, unknown, cross-exercise and soft-deleted ids. Real SQL Server, through the
/// central query filter.
/// </summary>
[Collection(MsSqlCollection.Name)]
public class ReplyParentResolverTests
{
    private readonly MsSqlContainerFixture _fixture;

    public ReplyParentResolverTests(MsSqlContainerFixture fixture)
    {
        _fixture = fixture;
    }

    [RequiresDockerFact]
    public async Task NullOrEmptyParentId_IsNone_WithNoParent()
    {
        await using var context = _fixture.CreateContext(new ExerciseContext { CurrentExerciseId = Guid.NewGuid() });
        var resolver = new ReplyParentResolver(context, new ExerciseContext { CurrentExerciseId = Guid.NewGuid() });

        var fromNull = await resolver.ResolveAsync(null, CancellationToken.None);
        var fromEmpty = await resolver.ResolveAsync(string.Empty, CancellationToken.None);

        fromNull.Should().Be(new ReplyParentResult(ReplyParentOutcome.None, null), "a null parentPostId means a top-level post");
        fromEmpty.Should().Be(new ReplyParentResult(ReplyParentOutcome.None, null), "an empty parentPostId means a top-level post");
    }

    [RequiresDockerFact]
    public async Task InScopeLiveParent_IsResolved_AndReturnsThatPost_Untracked()
    {
        var exerciseA = Guid.NewGuid();
        var parent = ThreadSeed.NewPost(exerciseA, "the parent", ThreadSeed.Anchor);
        await SeedAsync(parent);

        await using var context = ScopedContext(exerciseA);
        var resolver = new ReplyParentResolver(context, new ExerciseContext { CurrentExerciseId = exerciseA });

        var result = await resolver.ResolveAsync(parent.Id.ToString(), CancellationToken.None);

        result.Outcome.Should().Be(ReplyParentOutcome.Resolved);
        result.Parent.Should().NotBeNull();
        result.Parent!.Id.Should().Be(parent.Id);
        result.Parent.ExerciseId.Should().Be(exerciseA);
        context.ChangeTracker.Entries().Should().BeEmpty(
            "the parent is read AsNoTracking, so the caller's SaveChanges can never modify it");
    }

    [RequiresDockerFact]
    public async Task InScopeLiveParent_AcceptsAnyGuidFormat()
    {
        var exerciseA = Guid.NewGuid();
        var parent = ThreadSeed.NewPost(exerciseA, "the parent", ThreadSeed.Anchor);
        await SeedAsync(parent);

        await using var context = ScopedContext(exerciseA);
        var resolver = new ReplyParentResolver(context, new ExerciseContext { CurrentExerciseId = exerciseA });

        (await resolver.ResolveAsync(parent.Id.ToString("N"), CancellationToken.None)).Outcome.Should().Be(ReplyParentOutcome.Resolved);
        (await resolver.ResolveAsync(parent.Id.ToString("B").ToUpperInvariant(), CancellationToken.None)).Outcome.Should().Be(ReplyParentOutcome.Resolved);
    }

    [RequiresDockerFact]
    public async Task Unparseable_Unknown_CrossExercise_AndSoftDeleted_AreTheSameNotFound()
    {
        // AC-1 + DP-16: the four failure reasons return the SAME value, so a caller (and BP's 400) cannot tell
        // them apart. Exercise B's REAL post id is the always-Critical case: it exists, but not in scope A.
        var exerciseA = Guid.NewGuid();
        var exerciseB = Guid.NewGuid();
        var postInB = ThreadSeed.NewPost(exerciseB, "SECRET-B-PARENT", ThreadSeed.Anchor);
        var deletedInA = ThreadSeed.NewPost(exerciseA, "taken down", ThreadSeed.Anchor, deletedAt: ThreadSeed.Anchor.AddMinutes(5));
        await SeedAsync(postInB, deletedInA);

        await using var context = ScopedContext(exerciseA);
        var resolver = new ReplyParentResolver(context, new ExerciseContext { CurrentExerciseId = exerciseA });

        var notFound = new ReplyParentResult(ReplyParentOutcome.NotFound, null);

        var unparseable = await resolver.ResolveAsync("not-a-guid", CancellationToken.None);
        var unknown = await resolver.ResolveAsync(Guid.NewGuid().ToString(), CancellationToken.None);
        var crossExercise = await resolver.ResolveAsync(postInB.Id.ToString(), CancellationToken.None);
        var softDeleted = await resolver.ResolveAsync(deletedInA.Id.ToString(), CancellationToken.None);

        unparseable.Should().Be(notFound, "an unparseable id can name no post");
        unknown.Should().Be(notFound, "an unknown id names no post");
        crossExercise.Should().Be(notFound, "exercise B's real post must be indistinguishable from an unknown id under scope A (DP-16)");
        softDeleted.Should().Be(notFound, "a taken-down post cannot be replied to, and says so the same way");

        context.ChangeTracker.Entries().Should().BeEmpty("the resolver writes and tracks nothing");

        // The NotFound for B's id is the filter closing the door, not a missing row.
        await using var unfiltered = _fixture.CreateContext();
        (await unfiltered.Posts.IgnoreQueryFilters().AnyAsync(p => p.Id == postInB.Id)).Should().BeTrue(
            "exercise B's post does exist, so NotFound here is the scope filter, not an empty table");
    }

    [RequiresDockerFact]
    public async Task WhitespaceAndEmptyGuid_AreNotFound_NeverTopLevel()
    {
        await using var context = ScopedContext(Guid.NewGuid());
        var resolver = new ReplyParentResolver(context, new ExerciseContext { CurrentExerciseId = Guid.NewGuid() });

        (await resolver.ResolveAsync("   ", CancellationToken.None)).Outcome.Should().Be(
            ReplyParentOutcome.NotFound, "a malformed parent must be rejected, not silently posted top-level");
        (await resolver.ResolveAsync(Guid.Empty.ToString(), CancellationToken.None)).Outcome.Should().Be(
            ReplyParentOutcome.NotFound, "Guid.Empty is the unset sentinel no row carries");
    }

    [RequiresDockerFact]
    public async Task UnresolvedScope_FailsClosed_EvenForARealPost()
    {
        var exerciseA = Guid.NewGuid();
        var parent = ThreadSeed.NewPost(exerciseA, "real but unreachable", ThreadSeed.Anchor);
        await SeedAsync(parent);

        foreach (var unresolved in new Guid?[] { null, Guid.Empty })
        {
            await using var context = _fixture.CreateContext(new ExerciseContext { CurrentExerciseId = unresolved });
            var resolver = new ReplyParentResolver(context, new ExerciseContext { CurrentExerciseId = unresolved });

            (await resolver.ResolveAsync(parent.Id.ToString(), CancellationToken.None)).Should().Be(
                new ReplyParentResult(ReplyParentOutcome.NotFound, null),
                "with no resolved scope nothing can be a parent (fail closed), scope = {0}",
                unresolved?.ToString() ?? "null");
        }
    }

    [RequiresDockerFact]
    public async Task ScopeBTriesToReplyToExerciseAPost_IsNotFound()
    {
        // AC-5, the mirror direction: exercise B's session cannot reply to A's post.
        var exerciseA = Guid.NewGuid();
        var exerciseB = Guid.NewGuid();
        var postInA = ThreadSeed.NewPost(exerciseA, "SECRET-A-PARENT", ThreadSeed.Anchor);
        await SeedAsync(postInA);

        await using var context = ScopedContext(exerciseB);
        var resolver = new ReplyParentResolver(context, new ExerciseContext { CurrentExerciseId = exerciseB });

        var result = await resolver.ResolveAsync(postInA.Id.ToString(), CancellationToken.None);

        result.Should().Be(new ReplyParentResult(ReplyParentOutcome.NotFound, null));
    }

    private PulseDbContext ScopedContext(Guid exerciseId)
        => _fixture.CreateContext(new ExerciseContext { CurrentExerciseId = exerciseId });

    private async Task SeedAsync(params Pulse.WebApi.Data.Entities.Post[] posts)
    {
        await using var seed = _fixture.CreateContext();
        seed.Posts.AddRange(posts);
        await seed.SaveChangesAsync();
    }
}
