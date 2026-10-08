namespace Pulse.WebApi.Tests.Features.Injects;

using System;
using System.Linq;
using System.Net;
using System.Net.Http.Json;
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
/// The server-side pacer (story 06 AC "Bursts are paced on the server", "Pause tiers", "Exactly once") against real
/// SQL: one post per burst per tick on schedule; PAUSE INJECTS / FREEZE / hold suspend and resume at the original
/// spacing without dumping; ENGINE PAUSED has no effect; a restart resumes paced; an abandoned claim is reconciled,
/// never re-posted; reply parents; and each exercise's burst publishes only into that exercise. Ticks are driven
/// directly with a hand-advanced clock — no sleeping.
/// </summary>
[Collection(MsSqlCollection.Name)]
public sealed class InjectBurstRunnerTests
{
    // Jitter draws 10 and 30 → offsets 0, 3+10, 6+30 for a 3-post burst.
    private static readonly int[] Offsets = [0, 13, 36];

    private readonly MsSqlContainerFixture _fixture;

    public InjectBurstRunnerTests(MsSqlContainerFixture fixture)
    {
        _fixture = fixture;
    }

    [RequiresDockerFact]
    public async Task ARunningBurst_PublishesEachPostWhenDue_OnePerTick_ThenSettlesFired()
    {
        await using var host = await StartAsync();
        var (seeded, item, released) = await FireBurstAsync(host);

        await TickAtAsync(host, released, 12);
        (await FiredCountAsync(host, seeded, item)).Should().Be(1, "post 2 is not due until +13 s");

        await TickAtAsync(host, released, 13);
        (await FiredCountAsync(host, seeded, item)).Should().Be(2);

        await host.Runner.RunTickAsync();
        (await FiredCountAsync(host, seeded, item)).Should().Be(2, "one tick publishes at most one post, and post 3 is not due");

        await TickAtAsync(host, released, 36);
        var settled = await ItemAsync(host, seeded, item);
        settled.Status.Should().Be("fired", "every post fired");
        settled.FiredCount.Should().Be(3);
        (await PostCountAsync(host, seeded)).Should().Be(3);

        await TickAtAsync(host, released, 100);
        (await PostCountAsync(host, seeded)).Should().Be(3, "a settled item is never ticked again");
    }

    [RequiresDockerFact]
    public async Task OverduePosts_AreNeverDumpedTogether_TheLatenessShiftsTheRemainder()
    {
        await using var host = await StartAsync();
        var (seeded, item, released) = await FireBurstAsync(host);

        await TickAtAsync(host, released, 100);
        await host.Runner.RunTickAsync();
        (await FiredCountAsync(host, seeded, item)).Should().Be(2, "two posts are overdue but only one goes per tick");

        await TickAtAsync(host, released, 100 + 22);
        (await FiredCountAsync(host, seeded, item)).Should().Be(2, "post 3 keeps its 23 s spacing behind post 2");

        await TickAtAsync(host, released, 100 + 23);
        (await FiredCountAsync(host, seeded, item)).Should().Be(3);
    }

    [RequiresDockerFact]
    public async Task PauseInjects_SuspendsTheBurst_AndItResumesAtTheOriginalSpacing()
    {
        await using var host = await StartAsync();
        var (seeded, item, released) = await FireBurstAsync(host);

        await host.PauseTiers.SetTierAsync(seeded.ExerciseId, PauseTier.Injects, "controller-1");
        await TickAtAsync(host, released, 50);
        (await FiredCountAsync(host, seeded, item)).Should().Be(1, "PAUSE INJECTS publishes nothing");
        (await ItemAsync(host, seeded, item)).Status.Should().Be("firing", "the burst is suspended, not stopped");

        await host.PauseTiers.SetTierAsync(seeded.ExerciseId, PauseTier.Running, "controller-1");
        await TickAtAsync(host, released, 60);
        (await FiredCountAsync(host, seeded, item)).Should().Be(2, "it continues on resume");

        await TickAtAsync(host, released, 60 + 22);
        (await FiredCountAsync(host, seeded, item)).Should().Be(2);
        await TickAtAsync(host, released, 60 + 23);
        (await FiredCountAsync(host, seeded, item)).Should().Be(3, "the original 23 s spacing between posts 2 and 3 holds");
    }

    [RequiresDockerFact]
    public async Task Freeze_SuspendsTheBurst_AndEnginePausedDoesNot()
    {
        await using var host = await StartAsync();
        var (seeded, item, released) = await FireBurstAsync(host);

        await host.PauseTiers.SetTierAsync(seeded.ExerciseId, PauseTier.Engine, "controller-1");
        await TickAtAsync(host, released, 13);
        (await FiredCountAsync(host, seeded, item)).Should().Be(2, "ENGINE PAUSED has no effect on the queue");

        (await host.PauseTiers.SetTierAsync(
            seeded.ExerciseId, PauseTier.Freeze, "controller-1", new PauseClockStart(DateTimeOffset.UtcNow, TimeZoneInfo.Utc)))
            .Outcome.Should().Be(PauseTierOutcome.Applied);
        await TickAtAsync(host, released, 80);
        (await FiredCountAsync(host, seeded, item)).Should().Be(2, "FREEZE suspends bursts");
    }

    [RequiresDockerFact]
    public async Task Hold_SuspendsTheRemainingPosts_AndReleaseResumesThemPaced()
    {
        await using var host = await StartAsync();
        var (seeded, item, released) = await FireBurstAsync(host);

        (await host.ActionOkAsync(item, "hold")).Status.Should().Be("held");
        await TickAtAsync(host, released, 40);
        (await FiredCountAsync(host, seeded, item)).Should().Be(1, "a held burst publishes nothing");

        host.Time.Advance(TimeSpan.FromSeconds(10)); // +50
        var resumed = await host.ActionOkAsync(item, "release");
        resumed.Status.Should().Be("firing", "a started burst resumes rather than resetting to pending");

        await host.Runner.RunTickAsync();
        (await FiredCountAsync(host, seeded, item)).Should().Be(2);
        await TickAtAsync(host, released, 50 + 22);
        (await FiredCountAsync(host, seeded, item)).Should().Be(2);
        await TickAtAsync(host, released, 50 + 23);
        (await FiredCountAsync(host, seeded, item)).Should().Be(3);
    }

    [RequiresDockerFact]
    public async Task FiringAHeldStartedBurst_PublishesItsNextPostNow_AndTheRestKeepTheirSpacing()
    {
        await using var host = await StartAsync();
        var (seeded, item, released) = await FireBurstAsync(host);
        await host.ActionOkAsync(item, "hold");

        host.Time.Advance(TimeSpan.FromSeconds(5));
        var fired = await host.ActionOkAsync(item, "fire");

        fired.Status.Should().Be("firing");
        fired.FiredCount.Should().Be(2, "Fire on a held burst is release + go now");
        await TickAtAsync(host, released, 5 + 22);
        (await FiredCountAsync(host, seeded, item)).Should().Be(2);
        await TickAtAsync(host, released, 5 + 23);
        (await FiredCountAsync(host, seeded, item)).Should().Be(3);
    }

    [RequiresDockerFact]
    public async Task ABackendRestart_ResumesTheBurstPaced_OnAFreshRunner()
    {
        Guid itemId;
        SeededExercise seeded;
        await using (var first = await StartAsync())
        {
            var fired = await FireBurstAsync(first);
            (seeded, itemId) = (fired.Seeded, fired.ItemId);
        }

        // A new process: fresh runner, fresh in-memory pause tiers (RUNNING), and three minutes of downtime.
        await using var second = await StartAsync();
        second.ActAs(seeded.ExerciseId, seeded.StaffUserId);
        second.Time.Advance(TimeSpan.FromMinutes(3));

        await second.Runner.RunTickAsync();
        await second.Runner.RunTickAsync();
        (await FiredCountAsync(second, seeded, itemId)).Should().Be(2, "the downtime is lateness: one post, never a dump");

        second.Time.Advance(TimeSpan.FromSeconds(23));
        await second.Runner.RunTickAsync();
        (await FiredCountAsync(second, seeded, itemId)).Should().Be(3);
    }

    [RequiresDockerFact]
    public async Task AnAbandonedClaim_WhosePostWentOut_IsReconciled_NeverRepublished()
    {
        await using var host = await StartAsync();
        var (seeded, item, released) = await FireBurstAsync(host);

        // Simulate a crash between the funnel's commit and the record: post 2 is claimed and its post exists.
        var orphanPostId = Guid.NewGuid();
        await using (var db = host.Db(seeded.ExerciseId))
        {
            var child = await db.InjectItemPosts.SingleAsync(p => p.InjectItemId == item && p.Sequence == 2);
            child.ClaimedAt = host.Time.GetUtcNow();
            var row = await db.InjectItems.SingleAsync(i => i.Id == item);
            row.Version++;
            db.Posts.Add(new Post
            {
                Id = orphanPostId,
                ExerciseId = seeded.ExerciseId,
                AuthorPersonaId = child.PersonaId,
                Body = child.Text,
                CreatedScenarioTime = DateTimeOffset.UtcNow,
                CreatedWallClock = DateTimeOffset.UtcNow,
                Origin = "inject",
                ActingHumanId = seeded.StaffUserId.ToString(),
                InjectId = item.ToString(),
            });
            await db.SaveChangesAsync();
        }

        await TickAtAsync(host, released, 30);
        (await FiredCountAsync(host, seeded, item)).Should().Be(1, "a claim inside its lease is in flight elsewhere — wait");

        host.Time.Advance(InjectBurstPlanner.ClaimLease);
        await host.Runner.RunTickAsync();

        var reconciled = await ItemAsync(host, seeded, item);
        reconciled.Posts[1].Status.Should().Be("fired");
        reconciled.Posts[1].FiredPostId.Should().Be(orphanPostId.ToString(), "the post the funnel already created is recorded");
        (await PostCountAsync(host, seeded)).Should().Be(2, "and nothing was published twice");
    }

    [RequiresDockerFact]
    public async Task AnAbandonedClaim_WhosePostNeverWentOut_IsReleased_AndPublishedOnce()
    {
        await using var host = await StartAsync();
        var (seeded, item, released) = await FireBurstAsync(host);

        await using (var db = host.Db(seeded.ExerciseId))
        {
            var child = await db.InjectItemPosts.SingleAsync(p => p.InjectItemId == item && p.Sequence == 2);
            child.ClaimedAt = host.Time.GetUtcNow();
            (await db.InjectItems.SingleAsync(i => i.Id == item)).Version++;
            await db.SaveChangesAsync();
        }

        host.Time.Advance(InjectBurstPlanner.ClaimLease + TimeSpan.FromSeconds(1));
        await host.Runner.RunTickAsync();
        (await FiredCountAsync(host, seeded, item)).Should().Be(1, "reconciling only drops the stale claim");
        await host.Runner.RunTickAsync();
        (await FiredCountAsync(host, seeded, item)).Should().Be(2, "then the post goes out exactly once");
        (await PostCountAsync(host, seeded)).Should().Be(2);
    }

    [RequiresDockerFact]
    public async Task AFailedPost_DoesNotStopTheBurst_TheItemEndsFailed_AndRetryRepublishesIt()
    {
        var toggle = new PublisherToggle();
        await using var host = await StartAsync(sp => new ToggleablePublisher(toggle, sp.GetRequiredService<PostIngestService>()));
        var (seeded, item, released) = await FireBurstAsync(host);

        toggle.Refuse = true;
        await TickAtAsync(host, released, 13);
        toggle.Refuse = false;
        await TickAtAsync(host, released, 36);

        var failed = await ItemAsync(host, seeded, item);
        failed.Status.Should().Be("failed", "any failed post makes the item failed once nothing is pending");
        failed.Error.Should().Be(RefusingPublisher.Reason);
        failed.Posts.Select(p => p.Status).Should().Equal("fired", "failed", "fired");

        var retried = await host.ActionOkAsync(item, "retry");
        retried.Status.Should().Be("firing");
        await host.Runner.RunTickAsync();

        var settled = await ItemAsync(host, seeded, item);
        settled.Status.Should().Be("fired");
        settled.Posts.Select(p => p.Status).Should().OnlyContain(s => s == "fired");
        (await PostCountAsync(host, seeded)).Should().Be(3);
    }

    [RequiresDockerFact]
    public async Task AReplyToAnotherUnfiredItem_FailsWithFireTheParentFirst_AndCanBeRetried()
    {
        await using var host = await StartAsync();
        var seeded = await host.SeedExerciseAsync();
        host.ActAs(seeded.ExerciseId, seeded.StaffUserId);
        host.StepPerRequest = TimeSpan.Zero;
        var parent = await host.CreateOkAsync(InjectTestHost.PostItem(seeded.PersonaIds[0]));
        var burst = await host.CreateOkAsync(new
        {
            kind = "burst",
            title = "Replies",
            posts = new object[]
            {
                new { personaId = seeded.PersonaIds[1].ToString(), text = "first" },
                new { personaId = seeded.PersonaIds[2].ToString(), text = "@resident yes!", replyTo = new { injectPostId = parent.Posts[0].Id } },
            },
        });

        await host.ActionOkAsync(burst.Guid, "fire");
        host.Time.Advance(TimeSpan.FromSeconds(13));
        await host.Runner.RunTickAsync();

        var failed = await ItemAsync(host, seeded, burst.Guid);
        failed.Status.Should().Be("failed");
        failed.Posts[1].Error.Should().StartWith("Fire the parent first");

        await host.ActionOkAsync(parent.Guid, "fire");
        await host.ActionOkAsync(burst.Guid, "retry");
        await host.Runner.RunTickAsync();
        (await ItemAsync(host, seeded, burst.Guid)).Status.Should().Be("fired", "once the parent is out the reply publishes");
    }

    [RequiresDockerFact]
    public async Task AReplyToAnEarlierPostInTheSameBurst_PublishesAfterIt()
    {
        await using var host = await StartAsync();
        var (seeded, item, released) = await FireBurstAsync(host, beforeFire: async (h, created) =>
        {
            // Sibling ids exist only after create, so the reply is wired by an edit (children keep ids by position).
            var response = await h.PutAsync(created.Id, new
            {
                kind = "burst",
                title = "Pile-on",
                burstWindowSeconds = 90,
                version = created.Version,
                posts = new object[]
                {
                    new { personaId = created.Posts[0].PersonaId, text = "the photo" },
                    new { personaId = created.Posts[1].PersonaId, text = "replying", replyTo = new { injectPostId = created.Posts[0].Id } },
                    new { personaId = created.Posts[2].PersonaId, text = "standalone" },
                },
            });
            response.StatusCode.Should().Be(HttpStatusCode.OK);
        });

        await TickAtAsync(host, released, 13);

        var progressed = await ItemAsync(host, seeded, item);
        progressed.Posts.Select(p => p.Status).Should().Equal("fired", "fired", "pending");
    }

    [RequiresDockerFact]
    public async Task EachExercisesBurst_PublishesOnlyIntoThatExercise_AttributedToItsController()
    {
        await using var host = await StartAsync();
        var a = await FireBurstAsync(host);
        var b = await FireBurstAsync(host);

        b.ReleasedAt.Should().Be(a.ReleasedAt, "both bursts were released on the same tick");
        await TickAtAsync(host, a.ReleasedAt, 13);
        await TickAtAsync(host, a.ReleasedAt, 36);

        foreach (var (seeded, item) in new[] { (a.Seeded, a.ItemId), (b.Seeded, b.ItemId) })
        {
            await using var db = host.Db(seeded.ExerciseId);
            var posts = await db.Posts.Where(p => p.InjectId == item.ToString()).ToListAsync();
            posts.Should().HaveCount(3);
            posts.Should().OnlyContain(p => seeded.PersonaIds.Contains(p.AuthorPersonaId), "authors are this exercise's personas");
            posts.Should().OnlyContain(p => p.ActingHumanId == seeded.StaffUserId.ToString(), "runner posts are the firing controller's (COR-018)");
            posts.Should().OnlyContain(p => p.Origin == "inject");
        }

        await using var aDb = host.Db(a.Seeded.ExerciseId);
        (await aDb.Posts.CountAsync(p => p.InjectId == b.ItemId.ToString())).Should().Be(0, "B's posts are invisible in A's scope");
        (await aDb.Posts.IgnoreQueryFilters().CountAsync(p => p.InjectId == b.ItemId.ToString()))
            .Should().Be(3, "they exist — the zero is the filter closing the door");
    }

    // ---- helpers --------------------------------------------------------------------------------------

    private async Task<InjectTestHost> StartAsync(Func<IServiceProvider, IInjectPostPublisher>? publisher = null)
    {
        _fixture.ConnectionString.Should().NotBeNull();
        var host = await InjectTestHost.StartAsync(_fixture.ConnectionString!, new FixedJitterSource(10, 30), publisher);
        host.StepPerRequest = TimeSpan.Zero;
        return host;
    }

    private static async Task<(SeededExercise Seeded, Guid ItemId, DateTimeOffset ReleasedAt)> FireBurstAsync(
        InjectTestHost host,
        Func<InjectTestHost, WireItem, Task>? beforeFire = null)
    {
        var seeded = await host.SeedExerciseAsync();
        host.ActAs(seeded.ExerciseId, seeded.StaffUserId);
        var created = await host.CreateOkAsync(InjectTestHost.BurstItem(seeded.PersonaIds, count: 3, window: 90));
        if (beforeFire is not null)
        {
            await beforeFire(host, created);
        }

        var releasedAt = host.Time.GetUtcNow();
        var fired = await host.ActionOkAsync(created.Guid, "fire");
        fired.Posts.Select(p => p.DueOffsetSeconds).Should().Equal(Offsets.Cast<int?>());
        fired.FiredCount.Should().Be(1);
        return (seeded, created.Guid, releasedAt);
    }

    private static async Task TickAtAsync(InjectTestHost host, DateTimeOffset releasedAt, int secondsAfterRelease)
    {
        var target = releasedAt.AddSeconds(secondsAfterRelease);
        var now = host.Time.GetUtcNow();
        if (target > now)
        {
            host.Time.Advance(target - now);
        }

        await host.Runner.RunTickAsync();
    }

    private static async Task<WireItem> ItemAsync(InjectTestHost host, SeededExercise seeded, Guid itemId)
    {
        host.ActAs(seeded.ExerciseId, seeded.StaffUserId);
        var queue = await host.GetQueueAsync();
        return queue.Items.Single(i => i.Guid == itemId);
    }

    private static async Task<int> FiredCountAsync(InjectTestHost host, SeededExercise seeded, Guid itemId) =>
        (await ItemAsync(host, seeded, itemId)).FiredCount;

    private static async Task<int> PostCountAsync(InjectTestHost host, SeededExercise seeded)
    {
        await using var db = host.Db(seeded.ExerciseId);
        return await db.Posts.CountAsync();
    }
}
