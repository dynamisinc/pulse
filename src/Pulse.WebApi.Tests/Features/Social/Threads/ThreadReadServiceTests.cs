namespace Pulse.WebApi.Tests.Features.Social.Threads;

using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Pulse.WebApi.Data;
using Pulse.WebApi.Data.Entities;
using Pulse.WebApi.Features.Social;
using Pulse.WebApi.Features.Social.Follows;
using Pulse.WebApi.Features.Social.Threads;
using Pulse.WebApi.Tests.Data;

/// <summary>
/// <see cref="ThreadReadService"/> against real SQL Server (demo-polish B2, AC-2/AC-3/AC-4): ancestor order, the
/// depth cap and the cycle guard, reply order by scenario time, tombstones, and that the projector's output is
/// passed through unchanged. The projector is <see cref="RecordingPostProjector"/> so the service is isolated from
/// BP's real one; the real projector is exercised end to end by <c>ReplyFlowTests</c>. The projector is a required
/// dependency, so there is no no-projector fallback to cover (Gate-2 integration, B2 M-2).
/// </summary>
[Collection(MsSqlCollection.Name)]
public class ThreadReadServiceTests
{
    private readonly MsSqlContainerFixture _fixture;

    public ThreadReadServiceTests(MsSqlContainerFixture fixture)
    {
        _fixture = fixture;
    }

    [RequiresDockerFact]
    public async Task Thread_AncestorsRootToParent_Focused_RepliesOldestFirstByScenarioTime()
    {
        var exercise = Guid.NewGuid();
        var root = ThreadSeed.NewPost(exercise, "root", ThreadSeed.Anchor);
        var middle = ThreadSeed.NewPost(exercise, "middle", ThreadSeed.Anchor.AddMinutes(1), root.Id);
        var focused = ThreadSeed.NewPost(exercise, "focused", ThreadSeed.Anchor.AddMinutes(2), middle.Id);

        // Scenario order is late → early → middle by insertion, and the WALL clock runs the other way, so only a
        // scenario-time sort gives early, middle, late (COR-053).
        var late = ThreadSeed.NewPost(exercise, "late", ThreadSeed.Anchor.AddMinutes(30), focused.Id, wallClock: ThreadSeed.Anchor.AddHours(-3));
        var early = ThreadSeed.NewPost(exercise, "early", ThreadSeed.Anchor.AddMinutes(10), focused.Id, wallClock: ThreadSeed.Anchor.AddHours(-1));
        var mid = ThreadSeed.NewPost(exercise, "mid", ThreadSeed.Anchor.AddMinutes(20), focused.Id, wallClock: ThreadSeed.Anchor.AddHours(-2));
        await SeedAsync(root, middle, focused, late, early, mid);

        var thread = await ReadAsync(exercise, focused.Id.ToString());

        thread.Ancestors.Select(p => p.Id).Should().Equal(
            new[] { root.Id.ToString(), middle.Id.ToString() }, "ancestors run from the root down to the direct parent");
        thread.Focused!.Id.Should().Be(focused.Id.ToString());
        thread.Replies.Select(r => r.Text).Should().Equal(
            new[] { "early", "mid", "late" }, "replies are oldest first by SCENARIO time, never wall-clock");
        thread.Replies.Should().OnlyContain(r => r.ReplyToPersonaId == focused.AuthorPersonaId.ToString() && r.Status == "visible");
    }

    [RequiresDockerFact]
    public async Task Thread_ProjectsEveryVisiblePostInOneBatch_AndPassesTheProjectionThrough()
    {
        var exercise = Guid.NewGuid();
        var root = ThreadSeed.NewPost(exercise, "root", ThreadSeed.Anchor);
        var focused = ThreadSeed.NewPost(exercise, "focused", ThreadSeed.Anchor.AddMinutes(1), root.Id);
        var reply = ThreadSeed.NewPost(exercise, "reply", ThreadSeed.Anchor.AddMinutes(2), focused.Id);
        var removed = ThreadSeed.NewPost(exercise, "removed", ThreadSeed.Anchor.AddMinutes(3), focused.Id, deletedAt: ThreadSeed.Anchor.AddMinutes(4));
        await SeedAsync(root, focused, reply, removed);

        var projector = new RecordingPostProjector();
        var thread = await ReadAsync(exercise, focused.Id.ToString(), projector);

        projector.Calls.Should().ContainSingle("ancestors, focused and replies are projected in ONE batch (no N+1)");
        projector.Calls[0].PostIds.Should().Equal(
            new[] { root.Id, focused.Id, reply.Id }, "the tombstone is never handed to the projector");
        projector.Calls[0].Options.Should().Be(new PostProjectionOptions(), "no session persona → no viewer state");

        thread.Focused!.Counts.Should().Be(RecordingPostProjector.ProjectedCounts, "counts come from the projector (baseline + real)");
        thread.Focused.Media.Should().ContainSingle().Which.Id.Should().Be($"media-{focused.Id:N}");
        thread.Focused.InReplyTo.Should().Be(new PostInReplyToDto(root.Id.ToString(), RecordingPostProjector.ParentHandle));
        thread.Ancestors.Single().Counts.Should().Be(RecordingPostProjector.ProjectedCounts);

        var visible = thread.Replies.Single(r => r.Id == reply.Id.ToString());
        visible.Counts.Should().Be(RecordingPostProjector.ProjectedCounts);
        visible.Media.Should().ContainSingle();
        visible.InReplyTo.Should().Be(new PostInReplyToDto(focused.Id.ToString(), RecordingPostProjector.ParentHandle));
    }

    [RequiresDockerFact]
    public async Task SoftDeletedReply_IsATombstone_InItsPlace_WithNoContent()
    {
        var exercise = Guid.NewGuid();
        var focused = ThreadSeed.NewPost(exercise, "focused", ThreadSeed.Anchor);
        var first = ThreadSeed.NewPost(exercise, "first", ThreadSeed.Anchor.AddMinutes(1), focused.Id);
        var removed = ThreadSeed.NewPost(exercise, "TAKEN-DOWN-BODY-MUST-NOT-LEAK", ThreadSeed.Anchor.AddMinutes(2), focused.Id, deletedAt: ThreadSeed.Anchor.AddMinutes(9));
        removed.BaselineLikeCount = 500;
        removed.BaselineReplyCount = 70;
        var last = ThreadSeed.NewPost(exercise, "last", ThreadSeed.Anchor.AddMinutes(3), focused.Id);
        await SeedAsync(focused, first, removed, last);

        var thread = await ReadAsync(exercise, focused.Id.ToString(), new RecordingPostProjector(), StubSessionPersonaAccessor.For(exercise, Guid.NewGuid()));

        thread.Replies.Select(r => r.Id).Should().Equal(
            new[] { first.Id.ToString(), removed.Id.ToString(), last.Id.ToString() }, "the tombstone keeps its scenario-time place");

        var tombstone = thread.Replies[1];
        tombstone.Status.Should().Be("taken-down");
        tombstone.Text.Should().BeEmpty("a taken-down reply's text never leaves the server (D1-009)");
        tombstone.Media.Should().BeNull("a tombstone carries no media");
        tombstone.Counts.Should().Be(new ParticipantPostCounts(0, 0, 0), "a tombstone shows zero counts");
        tombstone.InReplyTo.Should().BeNull();
        tombstone.Viewer.Should().BeNull("a tombstone cannot be reacted to");
        tombstone.AuthorPersonaId.Should().Be(removed.AuthorPersonaId.ToString(), "the client guard requires an author id");
        tombstone.ReplyToPersonaId.Should().Be(focused.AuthorPersonaId.ToString());
        DateTimeOffset.Parse(tombstone.ScenarioTime, System.Globalization.CultureInfo.InvariantCulture).Should().Be(removed.CreatedScenarioTime);

        var json = JsonSerializer.Serialize(thread);
        json.Should().NotContain("TAKEN-DOWN-BODY-MUST-NOT-LEAK");
        json.Should().NotContain($"media-{removed.Id:N}");
    }

    [RequiresDockerFact]
    public async Task SoftDeletedAncestor_IsOmitted_ButTheWalkContinuesToTheRoot()
    {
        var exercise = Guid.NewGuid();
        var root = ThreadSeed.NewPost(exercise, "root", ThreadSeed.Anchor);
        var removed = ThreadSeed.NewPost(exercise, "REMOVED-ANCESTOR", ThreadSeed.Anchor.AddMinutes(1), root.Id, deletedAt: ThreadSeed.Anchor.AddMinutes(5));
        var parent = ThreadSeed.NewPost(exercise, "parent", ThreadSeed.Anchor.AddMinutes(2), removed.Id);
        var focused = ThreadSeed.NewPost(exercise, "focused", ThreadSeed.Anchor.AddMinutes(3), parent.Id);
        await SeedAsync(root, removed, parent, focused);

        var thread = await ReadAsync(exercise, focused.Id.ToString());

        thread.Ancestors.Select(p => p.Id).Should().Equal(root.Id.ToString(), parent.Id.ToString());
        JsonSerializer.Serialize(thread).Should().NotContain("REMOVED-ANCESTOR");
    }

    [RequiresDockerFact]
    public async Task AncestorWalk_IsCappedAt50Hops_KeepingTheNearestAncestors()
    {
        var exercise = Guid.NewGuid();
        var chain = new List<Post>();
        Guid? parentId = null;
        for (var depth = 0; depth < 61; depth++)
        {
            var post = ThreadSeed.NewPost(exercise, $"depth-{depth}", ThreadSeed.Anchor.AddMinutes(depth), parentId);
            chain.Add(post);
            parentId = post.Id;
        }

        await SeedAsync(chain.ToArray());

        var focused = chain[^1];
        var thread = await ReadAsync(exercise, focused.Id.ToString());

        ThreadReadService.MaxAncestorDepth.Should().Be(50);
        thread.Ancestors.Should().HaveCount(50, "the ancestor walk is capped at depth 50");
        thread.Ancestors[^1].Id.Should().Be(chain[^2].Id.ToString(), "the direct parent is always last");
        thread.Ancestors[0].Id.Should().Be(chain[^51].Id.ToString(), "the cap keeps the 50 NEAREST ancestors, root side cut");
    }

    [RequiresDockerFact]
    public async Task MalformedCycle_TerminatesAndProjectsEachPostOnce()
    {
        // A cycle cannot be written through the API (a parent must exist first), but a malformed seed could
        // produce one. focused → parent → focused must neither loop nor 500.
        var exercise = Guid.NewGuid();
        var focused = ThreadSeed.NewPost(exercise, "focused", ThreadSeed.Anchor);
        var parent = ThreadSeed.NewPost(exercise, "parent", ThreadSeed.Anchor.AddMinutes(1));
        var selfLoop = ThreadSeed.NewPost(exercise, "self", ThreadSeed.Anchor.AddMinutes(2));
        await SeedAsync(focused, parent, selfLoop);
        await LinkAsync((focused.Id, parent.Id), (parent.Id, focused.Id), (selfLoop.Id, selfLoop.Id));

        var projector = new RecordingPostProjector();
        var thread = await ReadAsync(exercise, focused.Id.ToString(), projector);

        thread.Ancestors.Select(p => p.Id).Should().Equal(parent.Id.ToString());
        thread.Replies.Select(r => r.Id).Should().Equal(parent.Id.ToString());
        projector.Calls.Single().PostIds.Should().Equal(new[] { parent.Id, focused.Id }, "a post is projected once even when it is both ancestor and reply");

        var self = await ReadAsync(exercise, selfLoop.Id.ToString());
        self.Ancestors.Should().BeEmpty("a self-parent is in the visited set from the start");
        self.Focused!.Id.Should().Be(selfLoop.Id.ToString());
        self.Replies.Select(r => r.Id).Should().Equal(selfLoop.Id.ToString());
    }

    [RequiresDockerFact]
    public async Task ViewerState_IsRequestedOnlyForAnInScopeParticipantSession()
    {
        var exercise = Guid.NewGuid();
        var focused = ThreadSeed.NewPost(exercise, "focused", ThreadSeed.Anchor);
        await SeedAsync(focused);
        var persona = Guid.NewGuid();

        var participant = new RecordingPostProjector();
        var participantThread = await ReadAsync(exercise, focused.Id.ToString(), participant, StubSessionPersonaAccessor.For(exercise, persona));
        participant.Calls.Single().Options.Should().Be(new PostProjectionOptions(persona, IncludeViewerState: true));
        participantThread.Focused!.Viewer.Should().Be(new PostViewerStateDto(true, false));

        var staff = new RecordingPostProjector();
        var staffThread = await ReadAsync(exercise, focused.Id.ToString(), staff, StubSessionPersonaAccessor.For(exercise, persona, kind: "staff"));
        staff.Calls.Single().Options.Should().Be(new PostProjectionOptions(), "staff sessions never get viewer state, even with a persona binding");
        staffThread.Focused!.Viewer.Should().BeNull();

        var foreign = new RecordingPostProjector();
        await ReadAsync(exercise, focused.Id.ToString(), foreign, StubSessionPersonaAccessor.For(Guid.NewGuid(), persona));
        foreign.Calls.Single().Options.Should().Be(new PostProjectionOptions(), "a session bound to another exercise gets no viewer state");

        var anonymous = new RecordingPostProjector();
        await ReadAsync(exercise, focused.Id.ToString(), anonymous, new StubSessionPersonaAccessor());
        anonymous.Calls.Single().Options.Should().Be(new PostProjectionOptions());
    }

    [RequiresDockerFact]
    public async Task ProjectorThatBreaksItsContract_FailsLoudly_NeverMisattributesContent()
    {
        var exercise = Guid.NewGuid();
        var focused = ThreadSeed.NewPost(exercise, "focused", ThreadSeed.Anchor);
        var reply = ThreadSeed.NewPost(exercise, "reply", ThreadSeed.Anchor.AddMinutes(1), focused.Id);
        await SeedAsync(focused, reply);

        var dropping = () => ReadAsync(exercise, focused.Id.ToString(), new RecordingPostProjector { DropLast = true });
        var reordering = () => ReadAsync(exercise, focused.Id.ToString(), new RecordingPostProjector { Reverse = true });

        await dropping.Should().ThrowAsync<InvalidOperationException>();
        await reordering.Should().ThrowAsync<InvalidOperationException>();
    }

    [RequiresDockerFact]
    public async Task NotFoundFocus_ReturnsTheSharedNotFoundInstance_ForEveryReason()
    {
        var exerciseA = Guid.NewGuid();
        var exerciseB = Guid.NewGuid();
        var inB = ThreadSeed.NewPost(exerciseB, "SECRET-B", ThreadSeed.Anchor);
        var deleted = ThreadSeed.NewPost(exerciseA, "deleted", ThreadSeed.Anchor, deletedAt: ThreadSeed.Anchor.AddMinutes(1));
        await SeedAsync(inB, deleted);

        foreach (var id in new[] { "not-a-guid", Guid.Empty.ToString(), Guid.NewGuid().ToString(), inB.Id.ToString(), deleted.Id.ToString() })
        {
            var projector = new RecordingPostProjector();
            var thread = await ReadAsync(exerciseA, id, projector);

            thread.Should().BeSameAs(ThreadResponseDto.NotFound, "every not-found focused id ({0}) takes the one shared not-found value", id);
            projector.Calls.Should().BeEmpty("nothing is projected for a not-found thread");
        }

        await using var context = _fixture.CreateContext(new ExerciseContext { CurrentExerciseId = null });
        var unscoped = new ThreadReadService(context, new ExerciseContext { CurrentExerciseId = null }, new StubSessionPersonaAccessor(), new RecordingPostProjector());
        (await unscoped.GetThreadAsync(deleted.Id.ToString(), CancellationToken.None)).Should().BeSameAs(ThreadResponseDto.NotFound);
    }

    [RequiresDockerFact]
    public async Task ReplyCount_EqualsVisibleReplies_AndATakedownDecrementsIt()
    {
        // AC-4, B2's side of the contract. The projector here counts replies the way the frozen
        // IPostEngagementReader defines RealReply (non-deleted direct replies) plus the baseline. With a zero
        // baseline, counts.reply on the focused post must equal the number of visible replies the thread lists, and
        // a takedown must take one away from both. The real reader + projector are proven end to end at Gate 2
        // (ReplyFlowTests).
        var exercise = Guid.NewGuid();
        var focused = ThreadSeed.NewPost(exercise, "focused", ThreadSeed.Anchor);
        var replies = Enumerable.Range(1, 3)
            .Select(i => ThreadSeed.NewPost(exercise, $"reply-{i}", ThreadSeed.Anchor.AddMinutes(i), focused.Id))
            .ToArray();
        var foreignReply = ThreadSeed.NewPost(Guid.NewGuid(), "B-REPLY-TO-A", ThreadSeed.Anchor.AddMinutes(9), focused.Id);
        await SeedAsync(new[] { focused }.Concat(replies).Append(foreignReply).ToArray());

        var before = await ReadWithContractCountsAsync(exercise, focused.Id);
        before.Focused!.Counts.Reply.Should().Be(3);
        before.Replies.Count(r => r.Status == "visible").Should().Be(before.Focused.Counts.Reply);

        await using (var takedown = _fixture.CreateContext())
        {
            var target = await takedown.Posts.IgnoreQueryFilters().SingleAsync(p => p.Id == replies[1].Id);
            target.DeletedAt = ThreadSeed.Anchor.AddMinutes(20);
            await takedown.SaveChangesAsync();
        }

        var after = await ReadWithContractCountsAsync(exercise, focused.Id);
        after.Focused!.Counts.Reply.Should().Be(2, "a takedown decrements the reply count");
        after.Replies.Count(r => r.Status == "visible").Should().Be(after.Focused.Counts.Reply);
        after.Replies.Should().HaveCount(3, "the taken-down reply stays in the thread as a tombstone");
    }

    private async Task<ThreadResponseDto> ReadWithContractCountsAsync(Guid exerciseId, Guid focusedId)
    {
        await using var context = Scoped(exerciseId);
        var projector = new ContractCountingProjector(context);
        var service = new ThreadReadService(context, new ExerciseContext { CurrentExerciseId = exerciseId }, new StubSessionPersonaAccessor(), projector);
        return await service.GetThreadAsync(focusedId.ToString(), CancellationToken.None);
    }

    private async Task<ThreadResponseDto> ReadAsync(
        Guid exerciseId,
        string postId,
        IParticipantPostProjector? projector = null,
        ICurrentSessionPersonaAccessor? accessor = null)
    {
        await using var context = Scoped(exerciseId);
        var service = new ThreadReadService(
            context,
            new ExerciseContext { CurrentExerciseId = exerciseId },
            accessor ?? new StubSessionPersonaAccessor(),
            projector ?? new RecordingPostProjector());
        return await service.GetThreadAsync(postId, CancellationToken.None);
    }

    private PulseDbContext Scoped(Guid exerciseId) => _fixture.CreateContext(new ExerciseContext { CurrentExerciseId = exerciseId });

    private async Task SeedAsync(params Post[] posts)
    {
        await using var seed = _fixture.CreateContext();
        seed.Posts.AddRange(posts);
        await seed.SaveChangesAsync();
    }

    private async Task LinkAsync(params (Guid Child, Guid Parent)[] links)
    {
        await using var context = _fixture.CreateContext();
        foreach (var (child, parent) in links)
        {
            var post = await context.Posts.IgnoreQueryFilters().SingleAsync(p => p.Id == child);
            post.ParentPostId = parent;
        }

        await context.SaveChangesAsync();
    }

    /// <summary>
    /// A reference projector for the count contract only: <c>counts.reply</c> = baseline + non-deleted direct
    /// replies in scope (the frozen <c>IPostEngagementReader.RealReply</c> definition).
    /// </summary>
    private sealed class ContractCountingProjector : IParticipantPostProjector
    {
        private readonly PulseDbContext _context;

        public ContractCountingProjector(PulseDbContext context) => _context = context;

        public async Task<IReadOnlyList<ParticipantPostDto>> ProjectAsync(
            IReadOnlyCollection<Post> posts, PostProjectionOptions options, CancellationToken cancellationToken)
        {
            var result = new List<ParticipantPostDto>();
            foreach (var post in posts)
            {
                var realReplies = await _context.Posts.CountAsync(p => p.ParentPostId == post.Id && p.DeletedAt == null, cancellationToken);
                var dto = ParticipantPostDto.FromPost(post);
                result.Add(new ParticipantPostDto
                {
                    Id = dto.Id,
                    AuthorPersonaId = dto.AuthorPersonaId,
                    Text = dto.Text,
                    ScenarioTime = dto.ScenarioTime,
                    Counts = new ParticipantPostCounts(post.BaselineReplyCount + realReplies, 0, 0),
                });
            }

            return result;
        }
    }
}
