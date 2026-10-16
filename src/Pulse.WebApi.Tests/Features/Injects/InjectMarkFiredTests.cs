namespace Pulse.WebApi.Tests.Features.Injects;

using System;
using System.Collections.Generic;
using System.Linq;
using System.Net;
using System.Net.Http;
using System.Net.Http.Json;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Pulse.WebApi.Data.Entities;
using Pulse.WebApi.Features.EngineRuntime.Steering;
using Pulse.WebApi.Features.Injects;
using Pulse.WebApi.Features.Social;
using Pulse.WebApi.Tests.Data;
using Xunit;

/// <summary>
/// Demo-feedback story 23 (DF-36): <c>POST /api/injects/{itemId}/mark-fired</c> records a <c>pending</c>, <c>held</c>
/// or <c>failed</c> item as <c>fired</c> WITHOUT publishing — stamps, version token, children that never published →
/// <c>skipped</c>, nothing through the funnel (a spy proves it), allowed under FREEZE, controller only, exercise-scoped,
/// one <c>inject.marked_fired</c> event. Real SQL.
/// </summary>
[Collection(MsSqlCollection.Name)]
public sealed class InjectMarkFiredTests
{
    private readonly MsSqlContainerFixture _fixture;

    public InjectMarkFiredTests(MsSqlContainerFixture fixture)
    {
        _fixture = fixture;
    }

    // ---- AC 1: allowed from pending, held and failed — fired, stamped, nothing published -------------

    [RequiresDockerFact]
    public async Task MarkFired_APendingItem_IsFired_Stamped_AndPublishesNothing()
    {
        var spy = new SpyPublisher();
        await using var host = await StartAsync(spy);
        var seeded = await ActAsControllerAsync(host);
        var scenarioStart = new DateTimeOffset(2033, 5, 1, 9, 0, 0, TimeSpan.FromHours(-5));
        host.Clock.Start(seeded.ExerciseId, scenarioStart, TimeZoneInfo.Utc);
        var item = await host.CreateOkAsync(InjectTestHost.PostItem(seeded.PersonaIds[0]));

        var marked = await MarkFiredOkAsync(host, item.Guid, item.Version);

        marked.Status.Should().Be("fired");
        marked.Version.Should().Be(item.Version + 1, "every state change bumps the version token (IQ-9)");
        marked.FiredByHumanId.Should().Be(seeded.StaffUserId.ToString(), "the controller from the server-side session (COR-018)");
        var stamped = DateTimeOffset.Parse(marked.FiredScenarioTime!, System.Globalization.CultureInfo.InvariantCulture);
        stamped.Should().BeOnOrAfter(scenarioStart).And.BeBefore(scenarioStart.AddMinutes(5), "the exercise clock's scenario instant (COR-053)");
        marked.Posts.Should().ContainSingle().Which.Should().Match<WirePost>(post =>
            post.Status == "skipped" && post.FiredPostId == null, "the child never published");
        marked.FiredCount.Should().Be(0, "no child carries a post id: the console derives 'Marked fired' from that");

        spy.Calls.Should().Be(0, "mark-fired never calls the post funnel");
        (await CountPostsAsync(host, seeded.ExerciseId)).Should().Be(0);
        host.Observer.Calls.Should().BeEmpty("nothing reached participants");
        host.Broadcaster.Calls.Should().BeEmpty();
    }

    [RequiresDockerFact]
    public async Task MarkFired_AHeldItem_IsFired_AndPublishesNothing()
    {
        var spy = new SpyPublisher();
        await using var host = await StartAsync(spy);
        var seeded = await ActAsControllerAsync(host);
        var item = await host.CreateOkAsync(InjectTestHost.BurstItem(seeded.PersonaIds, count: 3));
        var held = await host.ActionOkAsync(item.Guid, "hold");

        var marked = await MarkFiredOkAsync(host, item.Guid, held.Version);

        marked.Status.Should().Be("fired");
        marked.Posts.Select(post => post.Status).Should().Equal("skipped", "skipped", "skipped");
        marked.FiredByHumanId.Should().Be(seeded.StaffUserId.ToString());
        marked.FiredScenarioTime.Should().NotBeNull();
        spy.Calls.Should().Be(0);
        (await CountPostsAsync(host, seeded.ExerciseId)).Should().Be(0);
    }

    [RequiresDockerFact]
    public async Task MarkFired_AFailedItem_IsFired_ClearsTheError_AndPublishesNothing()
    {
        var spy = new SpyPublisher { Refuse = true };
        await using var host = await StartAsync(spy);
        var seeded = await ActAsControllerAsync(host);
        var item = await host.CreateOkAsync(InjectTestHost.PostItem(seeded.PersonaIds[0]));
        var failed = await host.ActionOkAsync(item.Guid, "fire");
        failed.Status.Should().Be("failed");
        var callsBefore = spy.Calls;

        var marked = await MarkFiredOkAsync(host, item.Guid, failed.Version);

        marked.Status.Should().Be("fired");
        marked.Error.Should().BeNull("the item is no longer failed");
        marked.Posts.Single().Status.Should().Be("skipped", "the refused child never published");
        marked.Posts.Single().FiredPostId.Should().BeNull();
        spy.Calls.Should().Be(callsBefore, "mark-fired never calls the funnel, even for a failed item");
        (await CountPostsAsync(host, seeded.ExerciseId)).Should().Be(0);
    }

    [RequiresDockerFact]
    public async Task MarkFired_AStartedHeldBurst_KeepsWhatWentOut_AndSkipsOnlyTheRest()
    {
        var spy = new SpyPublisher();
        await using var host = await StartAsync(spy);
        var seeded = await ActAsControllerAsync(host);
        var item = await host.CreateOkAsync(InjectTestHost.BurstItem(seeded.PersonaIds, count: 3));
        await host.ActionOkAsync(item.Guid, "fire"); // the first post goes out now
        var held = await host.ActionOkAsync(item.Guid, "hold");
        var callsBefore = spy.Calls;

        var marked = await MarkFiredOkAsync(host, item.Guid, held.Version);

        marked.Status.Should().Be("fired");
        marked.Posts.Select(post => post.Status).Should().Equal("fired", "skipped", "skipped");
        marked.Posts[0].FiredPostId.Should().NotBeNull("a post that already went out keeps its record");
        spy.Calls.Should().Be(callsBefore);
        (await CountPostsAsync(host, seeded.ExerciseId)).Should().Be(1, "only the post the burst fired before the hold");
    }

    [RequiresDockerFact]
    public async Task MarkFired_AFailedBurst_WithOneFiredAndOneFailedChild_KeepsThePost_SkipsTheFailure_AndTheOriginalStamps()
    {
        var spy = new SpyPublisher();
        await using var host = await StartAsync(spy);
        var seeded = await ActAsControllerAsync(host);
        var item = await host.CreateOkAsync(InjectTestHost.BurstItem(seeded.PersonaIds, count: 2));
        var firing = await host.ActionOkAsync(item.Guid, "fire"); // post 1 goes out now
        spy.Refuse = true;
        host.Time.Advance(TimeSpan.FromMinutes(5));
        await host.Runner.RunTickAsync(); // post 2 is refused by the funnel
        var failed = (await host.GetQueueAsync()).Items.Single(i => i.Id == item.Id);
        failed.Status.Should().Be("failed");
        failed.Posts.Select(post => post.Status).Should().Equal("fired", "failed");
        var callsBefore = spy.Calls;
        var marker = await host.AddStaffAsync(seeded.ExerciseId, "controller", "Morgan Marker");
        host.ActAs(seeded.ExerciseId, marker);

        var marked = await MarkFiredOkAsync(host, item.Guid, failed.Version);

        marked.Status.Should().Be("fired");
        marked.Posts.Select(post => post.Status).Should().Equal("fired", "skipped");
        marked.Posts[0].FiredPostId.Should().Be(failed.Posts[0].FiredPostId, "the post that went out keeps its record");
        marked.Posts[1].FiredPostId.Should().BeNull();
        marked.FiredByHumanId.Should().Be(seeded.StaffUserId.ToString(), "a started item keeps who pressed Fire (L-2)");
        marked.FiredScenarioTime.Should().Be(firing.FiredScenarioTime, "and when it was fired");
        spy.Calls.Should().Be(callsBefore);
        (await CountPostsAsync(host, seeded.ExerciseId)).Should().Be(1);
        (await MarkedFiredEventsAsync(host, seeded.ExerciseId)).Should().ContainSingle()
            .Which.Actor.ActingHumanId.Should().Be(marker.ToString(), "the event records who marked it");
    }

    [RequiresDockerFact]
    public async Task MarkFired_AnItemThatNeverStarted_IsStampedByTheMarker()
    {
        await using var host = await StartAsync(new SpyPublisher());
        var seeded = await ActAsControllerAsync(host);
        var item = await host.CreateOkAsync(InjectTestHost.BurstItem(seeded.PersonaIds, count: 2));
        var held = await host.ActionOkAsync(item.Guid, "hold");
        var marker = await host.AddStaffAsync(seeded.ExerciseId, "controller", "Morgan Marker");
        host.ActAs(seeded.ExerciseId, marker);

        var marked = await MarkFiredOkAsync(host, item.Guid, held.Version);

        marked.FiredByHumanId.Should().Be(marker.ToString(), "nobody pressed Fire, so the marker is recorded (L-2)");
        marked.FiredScenarioTime.Should().NotBeNull();
    }

    [RequiresDockerFact]
    public async Task MarkFired_WhileAPostOfTheItemIsInFlight_Is409InFlight_VersionUnchanged_NoEvent()
    {
        var spy = new SpyPublisher();
        await using var host = await StartAsync(spy);
        var seeded = await ActAsControllerAsync(host);
        var item = await host.CreateOkAsync(InjectTestHost.BurstItem(seeded.PersonaIds, count: 3));
        await host.ActionOkAsync(item.Guid, "fire");
        var held = await host.ActionOkAsync(item.Guid, "hold");
        await using (var db = host.Db(seeded.ExerciseId))
        {
            var second = await db.InjectItemPosts.SingleAsync(post => post.InjectItemId == item.Guid && post.Sequence == 2);
            second.ClaimedAt = host.Time.GetUtcNow(); // a runner step mid-publish
            await db.SaveChangesAsync();
        }

        var refused = await MarkFiredAsync(host, item.Guid, held.Version);

        refused.StatusCode.Should().Be(HttpStatusCode.Conflict);
        var problem = await InjectTestHost.ReadProblemAsync(refused);
        problem.Detail.Should().Be(InjectTransitions.InFlightMessage);
        problem.Item!.Status.Should().Be("held");
        problem.Item.Version.Should().Be(held.Version, "a refusal changes nothing");
        (await MarkedFiredEventsAsync(host, seeded.ExerciseId)).Should().BeEmpty();
    }

    // ---- M-1: a reply to a post that was marked fired is not a dead end -------------------------------

    [RequiresDockerFact]
    public async Task Fire_AReplyWhoseScriptedParentWasMarkedFired_Is409_WithTheMarkedFiredMessage()
    {
        var spy = new SpyPublisher();
        await using var host = await StartAsync(spy);
        var seeded = await ActAsControllerAsync(host);
        var parent = await host.CreateOkAsync(InjectTestHost.PostItem(seeded.PersonaIds[0]));
        var reply = await host.CreateOkAsync(InjectTestHost.PostItem(
            seeded.PersonaIds[1], "replying", new { injectPostId = parent.Posts[0].Id }));
        await MarkFiredOkAsync(host, parent.Guid, parent.Version);

        var refused = await host.ActionAsync(reply.Guid, "fire");

        refused.StatusCode.Should().Be(HttpStatusCode.Conflict);
        var problem = await InjectTestHost.ReadProblemAsync(refused);
        problem.Detail.Should().Be(InjectBurstPlanner.ParentMarkedFiredMessage);
        problem.Detail.Should().Be(
            "The post this replies to was marked fired, not posted. Edit this item to reply to the real post.");
        problem.Item!.Status.Should().Be("pending", "a refused fire changes nothing");
        spy.Calls.Should().Be(0);
    }

    [RequiresDockerFact]
    public async Task ABurstChildReplyingToAMarkedFiredPost_FailsWithTheMarkedFiredMessage()
    {
        await using var host = await StartAsync(new SpyPublisher());
        var seeded = await ActAsControllerAsync(host);
        var parent = await host.CreateOkAsync(InjectTestHost.PostItem(seeded.PersonaIds[0]));
        var burst = await host.CreateOkAsync(new
        {
            kind = "burst",
            title = "Replies",
            burstWindowSeconds = 90,
            posts = new object[]
            {
                new { personaId = seeded.PersonaIds[1].ToString(), text = "first #WaterIssues" },
                new
                {
                    personaId = seeded.PersonaIds[2].ToString(),
                    text = "replying #WaterIssues",
                    replyTo = new { injectPostId = parent.Posts[0].Id },
                },
            },
        });
        await MarkFiredOkAsync(host, parent.Guid, parent.Version);

        await host.ActionOkAsync(burst.Guid, "fire"); // post 1 goes out now
        host.Time.Advance(TimeSpan.FromMinutes(5));
        await host.Runner.RunTickAsync();

        var settled = (await host.GetQueueAsync()).Items.Single(i => i.Id == burst.Id);
        settled.Status.Should().Be("failed");
        settled.Posts[1].Status.Should().Be("failed");
        settled.Posts[1].Error.Should().Be(InjectBurstPlanner.ParentMarkedFiredMessage);
    }

    // ---- AC 1: any other status is 409 with the existing refusal shape ---------------------------------

    [RequiresDockerFact]
    public async Task MarkFired_AFiredASkippedOrAFiringItem_Is409_WithTheItem_AndChangesNothing()
    {
        var spy = new SpyPublisher();
        await using var host = await StartAsync(spy);
        var seeded = await ActAsControllerAsync(host);
        var fired = await host.ActionOkAsync((await host.CreateOkAsync(InjectTestHost.PostItem(seeded.PersonaIds[0]))).Guid, "fire");
        var skipped = await host.ActionOkAsync((await host.CreateOkAsync(InjectTestHost.PostItem(seeded.PersonaIds[1]))).Guid, "skip");
        var firing = await host.ActionOkAsync((await host.CreateOkAsync(InjectTestHost.BurstItem(seeded.PersonaIds, count: 3))).Guid, "fire");
        firing.Status.Should().Be("firing");
        var callsBefore = spy.Calls;

        foreach (var current in new[] { fired, skipped, firing })
        {
            var refused = await MarkFiredAsync(host, current.Guid, current.Version);

            refused.StatusCode.Should().Be(HttpStatusCode.Conflict, current.Status);
            var problem = await InjectTestHost.ReadProblemAsync(refused);
            problem.Detail.Should().Be($"This item is {current.Status} and cannot be marked fired.");
            problem.Item!.Status.Should().Be(current.Status, "the 409 carries the item as it is (body.item)");
            problem.Item.Version.Should().Be(current.Version, "a refusal changes nothing");
        }

        spy.Calls.Should().Be(callsBefore);
        (await MarkedFiredEventsAsync(host, seeded.ExerciseId)).Should().BeEmpty("a refusal emits nothing");
    }

    // ---- AC 1: the version token ----------------------------------------------------------------------

    [RequiresDockerFact]
    public async Task MarkFired_AStaleVersion_Is409_AndAMissingOneIs400()
    {
        await using var host = await StartAsync(new SpyPublisher());
        var seeded = await ActAsControllerAsync(host);
        var item = await host.CreateOkAsync(InjectTestHost.PostItem(seeded.PersonaIds[0]));
        var held = await host.ActionOkAsync(item.Guid, "hold"); // version moved on

        var stale = await MarkFiredAsync(host, item.Guid, item.Version);

        stale.StatusCode.Should().Be(HttpStatusCode.Conflict);
        var problem = await InjectTestHost.ReadProblemAsync(stale);
        problem.Detail.Should().Be(InjectQueueService.StaleVersionMessage);
        problem.Item!.Status.Should().Be("held");
        problem.Item.Version.Should().Be(held.Version);

        host.Time.Advance(host.StepPerRequest);
        var missing = await host.Client.PostAsJsonAsync(new Uri($"/api/injects/{item.Id}/mark-fired", UriKind.Relative), new { });
        missing.StatusCode.Should().Be(HttpStatusCode.BadRequest);
        (await InjectTestHost.ReadProblemAsync(missing)).Detail.Should().Be("expectedVersion is required.");

        (await host.GetQueueAsync()).Items.Single().Status.Should().Be("held", "neither refusal changed the item");
    }

    // ---- AC 2: allowed under FREEZE and PAUSE INJECTS; one inject.marked_fired event -------------------

    [RequiresDockerFact]
    public async Task MarkFired_UnderFreeze_AndUnderPauseInjects_IsAllowed_AndPublishesNothing()
    {
        var spy = new SpyPublisher();
        await using var host = await StartAsync(spy);
        var seeded = await ActAsControllerAsync(host);
        var first = await host.CreateOkAsync(InjectTestHost.PostItem(seeded.PersonaIds[0]));
        var second = await host.CreateOkAsync(InjectTestHost.PostItem(seeded.PersonaIds[1]));

        var frozen = await host.PauseTiers.SetTierAsync(
            seeded.ExerciseId, PauseTier.Freeze, "controller-1", new PauseClockStart(DateTimeOffset.UtcNow, TimeZoneInfo.Utc));
        frozen.Outcome.Should().Be(PauseTierOutcome.Applied);
        (await MarkFiredOkAsync(host, first.Guid, first.Version)).Status.Should().Be("fired", "nothing reaches participants");

        await host.PauseTiers.SetTierAsync(seeded.ExerciseId, PauseTier.Injects, "controller-1");
        (await MarkFiredOkAsync(host, second.Guid, second.Version)).Status.Should().Be("fired");

        spy.Calls.Should().Be(0);
        (await CountPostsAsync(host, seeded.ExerciseId)).Should().Be(0);
    }

    [RequiresDockerFact]
    public async Task MarkFired_EmitsExactlyOneMarkedFiredEvent_AndNoInjectActionEvent()
    {
        await using var host = await StartAsync(new SpyPublisher());
        var seeded = await ActAsControllerAsync(host);
        var item = await host.CreateOkAsync(InjectTestHost.PostItem(seeded.PersonaIds[0]));

        await MarkFiredOkAsync(host, item.Guid, item.Version);

        var events = await MarkedFiredEventsAsync(host, seeded.ExerciseId);
        events.Should().ContainSingle();
        var evt = events[0];
        evt.SchemaVersion.Should().Be("v0");
        evt.InjectId.Should().Be(item.Id);
        evt.Target!.EntityType.Should().Be("inject");
        evt.Target.EntityId.Should().Be(item.Id);
        evt.Actor.Kind.Should().Be("system");
        evt.Actor.ActingHumanId.Should().Be(seeded.StaffUserId.ToString());
        evt.TimeZone.Should().Be("America/Chicago");
        using (var json = JsonDocument.Parse(evt.Payload!))
        {
            json.RootElement.GetProperty("action").GetString().Should().Be("mark_fired");
            json.RootElement.GetProperty("kind").GetString().Should().Be("post");
            json.RootElement.GetProperty("status").GetString().Should().Be("fired");
            json.RootElement.EnumerateObject().Select(p => p.Name).Should().BeEquivalentTo(
                new[] { "action", "kind", "status" }, "counts and literals only — no text, no names");
        }

        await using var db = host.Db(seeded.ExerciseId);
        var actionEvents = await db.TelemetryEvents
            .Where(e => e.EventType == "inject_action" && e.InjectId == item.Id)
            .ToListAsync();
        actionEvents.Should().ContainSingle("only the create; the mark is its own event type, never double-counted");
    }

    // ---- controller only, exercise-scoped ----------------------------------------------------------------

    [RequiresDockerFact]
    public async Task MarkFired_ByAnEvaluator_Is403_AndChangesNothing()
    {
        await using var host = await StartAsync(new SpyPublisher());
        var seeded = await ActAsControllerAsync(host);
        var item = await host.CreateOkAsync(InjectTestHost.PostItem(seeded.PersonaIds[0]));
        var evaluator = await host.AddStaffAsync(seeded.ExerciseId, "evaluator", "Eve Evaluator");
        host.ActAs(seeded.ExerciseId, evaluator);

        (await MarkFiredAsync(host, item.Guid, item.Version)).StatusCode.Should().Be(HttpStatusCode.Forbidden);

        host.ActAs(seeded.ExerciseId, seeded.StaffUserId);
        (await host.GetQueueAsync()).Items.Single().Status.Should().Be("pending");
    }

    [RequiresDockerFact]
    public async Task MarkFired_WithNoStaffSession_Is401()
    {
        await using var host = await StartAsync(new SpyPublisher());
        var seeded = await host.SeedExerciseAsync();
        host.ActAs(seeded.ExerciseId, staffUserId: null);

        (await MarkFiredAsync(host, Guid.NewGuid(), 1)).StatusCode.Should().Be(HttpStatusCode.Unauthorized);
    }

    [RequiresDockerFact]
    public async Task MarkFired_AnItemFromAnotherExercise_Is404_LikeAnUnknownId_AndLeavesItUntouched()
    {
        await using var host = await StartAsync(new SpyPublisher());
        var a = await host.SeedExerciseAsync();
        var b = await host.SeedExerciseAsync();
        host.ActAs(b.ExerciseId, b.StaffUserId);
        var theirs = await host.CreateOkAsync(InjectTestHost.PostItem(b.PersonaIds[0]));
        host.ActAs(a.ExerciseId, a.StaffUserId);

        var crossExercise = await MarkFiredAsync(host, theirs.Guid, theirs.Version);
        var unknown = await MarkFiredAsync(host, Guid.NewGuid(), 1);

        crossExercise.StatusCode.Should().Be(HttpStatusCode.NotFound, "another exercise's item reads as missing (COR-001)");
        unknown.StatusCode.Should().Be(HttpStatusCode.NotFound);
        (await InjectTestHost.ReadProblemAsync(crossExercise)).Detail
            .Should().Be((await InjectTestHost.ReadProblemAsync(unknown)).Detail, "indistinguishable from an unknown id");

        await using var bDb = host.Db(b.ExerciseId);
        (await bDb.InjectItems.SingleAsync(i => i.Id == theirs.Guid)).Status.Should().Be("pending", "B's item is untouched");
        (await MarkedFiredEventsAsync(host, a.ExerciseId)).Should().BeEmpty();
        (await MarkedFiredEventsAsync(host, b.ExerciseId)).Should().BeEmpty();
    }

    // ---- helpers --------------------------------------------------------------------------------------

    private async Task<InjectTestHost> StartAsync(SpyPublisher spy)
    {
        _fixture.ConnectionString.Should().NotBeNull();
        return await InjectTestHost.StartAsync(
            _fixture.ConnectionString!,
            publisher: sp => new SpyingPublisher(spy, sp.GetRequiredService<PostIngestService>()));
    }

    private static async Task<SeededExercise> ActAsControllerAsync(InjectTestHost host)
    {
        var seeded = await host.SeedExerciseAsync();
        host.ActAs(seeded.ExerciseId, seeded.StaffUserId);
        return seeded;
    }

    private static Task<HttpResponseMessage> MarkFiredAsync(InjectTestHost host, Guid itemId, int expectedVersion)
    {
        host.Time.Advance(host.StepPerRequest);
        return host.Client.PostAsJsonAsync(
            new Uri($"/api/injects/{itemId}/mark-fired", UriKind.Relative),
            new { expectedVersion });
    }

    private static async Task<WireItem> MarkFiredOkAsync(InjectTestHost host, Guid itemId, int expectedVersion)
    {
        var response = await MarkFiredAsync(host, itemId, expectedVersion);
        response.StatusCode.Should().Be(HttpStatusCode.OK, await response.Content.ReadAsStringAsync());
        return (await InjectTestHost.ReadItemAsync(response))!;
    }

    private static async Task<int> CountPostsAsync(InjectTestHost host, Guid exerciseId)
    {
        await using var db = host.Db(exerciseId);
        return await db.Posts.CountAsync();
    }

    private static async Task<List<TelemetryEvent>> MarkedFiredEventsAsync(InjectTestHost host, Guid exerciseId)
    {
        await using var db = host.Db(exerciseId);
        return await db.TelemetryEvents
            .Where(e => e.EventType == InjectTelemetry.MarkedFiredEventType)
            .ToListAsync();
    }

    /// <summary>Counts every call into the funnel seam; can be told to refuse (to make an item <c>failed</c>).</summary>
    private sealed class SpyPublisher
    {
        private int _calls;

        public bool Refuse { get; set; }

        public int Calls => Volatile.Read(ref _calls);

        public void Record() => Interlocked.Increment(ref _calls);
    }

    /// <summary>The real funnel publisher behind a spy: every publish attempt is counted before it is made.</summary>
    private sealed class SpyingPublisher : IInjectPostPublisher
    {
        private readonly SpyPublisher _spy;
        private readonly FunnelInjectPostPublisher _funnel;

        public SpyingPublisher(SpyPublisher spy, PostIngestService ingest)
        {
            _spy = spy;
            _funnel = new FunnelInjectPostPublisher(ingest);
        }

        public Task<PostIngestResult> PublishAsync(
            CreatePostRequest request,
            PostAttribution attribution,
            CancellationToken cancellationToken = default)
        {
            _spy.Record();
            return _spy.Refuse
                ? Task.FromResult(PostIngestResult.Invalid(RefusingPublisher.Reason))
                : _funnel.PublishAsync(request, attribution, cancellationToken);
        }
    }
}
