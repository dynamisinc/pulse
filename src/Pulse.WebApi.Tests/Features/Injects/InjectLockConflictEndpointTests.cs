namespace Pulse.WebApi.Tests.Features.Injects;

using System;
using System.Linq;
using System.Net;
using System.Threading.Tasks;
using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Pulse.WebApi.Data;
using Pulse.WebApi.Features.Injects;
using Pulse.WebApi.Tests.Data;
using Xunit;

/// <summary>
/// SQL Server lock contention is a lost race, never a 500 (#458, CI run 37922671324: a parallel fire's read was chosen
/// as a deadlock victim and the losing controller got an unhandled 500). Each test makes a specific command a real
/// error-1205 victim through an EF command interceptor — exactly where SQL Server would raise it — and drives the real
/// endpoint over HTTP on real SQL: fire answers the documented 409 with the item as it is now, hold reloads and
/// re-applies once, an edit is a 409 that changes nothing, and a runner step skips its tick.
/// </summary>
[Collection(MsSqlCollection.Name)]
public sealed class InjectLockConflictEndpointTests
{
    private readonly MsSqlContainerFixture _fixture;

    public InjectLockConflictEndpointTests(MsSqlContainerFixture fixture)
    {
        _fixture = fixture;
    }

    [RequiresDockerFact]
    public async Task Fire_WhoseItemReadIsTheDeadlockVictim_Is409WithTheCurrentItem_NotA500_AndPublishesNothing()
    {
        var deadlocks = new DeadlockInjector();
        await using var host = await StartAsync(deadlocks);
        var seeded = await ActAsControllerAsync(host);
        var item = await host.CreateOkAsync(InjectTestHost.PostItem(seeded.PersonaIds[0]));

        deadlocks.Arm(DeadlockInjector.ItemRead);
        var fire = await host.ActionAsync(item.Guid, "fire");

        deadlocks.Thrown.Should().Be(1, "the item load really was chosen as the deadlock victim");
        fire.StatusCode.Should().Be(HttpStatusCode.Conflict, "a deadlock victim lost a race — the documented 409, never a 500");
        var problem = await InjectTestHost.ReadProblemAsync(fire);
        problem.Detail.Should().Be(InjectQueueService.StaleVersionMessage, "nobody else fired it; it is the plain lost-race message");
        problem.Item!.Status.Should().Be("pending", "the 409 carries the item as it is now");
        (await CountPostsAsync(host, seeded.ExerciseId)).Should().Be(0, "the victim's fire never reached the funnel");
        (await ActionsAsync(host, seeded.ExerciseId, item.Guid)).Should().Equal(["create"], "a refused fire emits no inject_action");

        (await host.ActionOkAsync(item.Guid, "fire")).Status.Should().Be("fired", "pressing Fire again simply works");
        (await CountPostsAsync(host, seeded.ExerciseId)).Should().Be(1);
    }

    [RequiresDockerFact]
    public async Task Fire_WhoseClaimSaveIsTheDeadlockVictim_Is409_AndNothingWasClaimedOrPublished()
    {
        var deadlocks = new DeadlockInjector();
        await using var host = await StartAsync(deadlocks);
        var seeded = await ActAsControllerAsync(host);
        var item = await host.CreateOkAsync(InjectTestHost.PostItem(seeded.PersonaIds[0]));

        deadlocks.Arm(DeadlockInjector.ItemSave);
        var fire = await host.ActionAsync(item.Guid, "fire");

        deadlocks.Thrown.Should().Be(1);
        fire.StatusCode.Should().Be(HttpStatusCode.Conflict);
        var problem = await InjectTestHost.ReadProblemAsync(fire);
        problem.Item!.Status.Should().Be("pending", "the claim rolled back with the deadlock");
        problem.Item.Version.Should().Be(item.Version, "nothing about the item changed");
        (await CountPostsAsync(host, seeded.ExerciseId)).Should().Be(0, "the claim is saved BEFORE the funnel is called, so no post");
        (await ActionsAsync(host, seeded.ExerciseId, item.Guid)).Should().Equal(["create"], "the rolled-back claim emitted nothing");
    }

    [RequiresDockerFact]
    public async Task Hold_WhoseLoadIsTheDeadlockVictim_ReloadsAndReappliesOnce_AndSucceeds()
    {
        var deadlocks = new DeadlockInjector();
        await using var host = await StartAsync(deadlocks);
        var seeded = await ActAsControllerAsync(host);
        var item = await host.CreateOkAsync(InjectTestHost.PostItem(seeded.PersonaIds[0]));

        deadlocks.Arm(DeadlockInjector.ItemRead);
        var held = await host.ActionOkAsync(item.Guid, "hold");

        deadlocks.Thrown.Should().Be(1);
        held.Status.Should().Be("held", "a lost race on hold re-applies once against fresh state");
        (await ActionsAsync(host, seeded.ExerciseId, item.Guid)).Should().Equal(
            ["create", "hold"], "exactly one inject_action for the one hold that committed");
    }

    [RequiresDockerFact]
    public async Task Hold_ThatKeepsBeingTheDeadlockVictim_Is409WithTheStaleVersionMessage_NeverA500()
    {
        var deadlocks = new DeadlockInjector();
        await using var host = await StartAsync(deadlocks);
        var seeded = await ActAsControllerAsync(host);
        var item = await host.CreateOkAsync(InjectTestHost.PostItem(seeded.PersonaIds[0]));

        deadlocks.Arm(DeadlockInjector.ItemRead, times: 10);
        var hold = await host.ActionAsync(item.Guid, "hold");
        deadlocks.Disarm();

        deadlocks.Thrown.Should().BeGreaterThanOrEqualTo(2, "the first attempt and its one re-apply both lost");
        hold.StatusCode.Should().Be(HttpStatusCode.Conflict);
        (await InjectTestHost.ReadProblemAsync(hold)).Detail.Should().Be(InjectQueueService.StaleVersionMessage);
        (await host.GetQueueAsync()).Items.Single().Status.Should().Be("pending", "no hold committed");
        (await ActionsAsync(host, seeded.ExerciseId, item.Guid)).Should().Equal(["create"], "no hold event without a hold");
    }

    [RequiresDockerFact]
    public async Task Edit_WhoseSaveIsTheDeadlockVictim_Is409WithTheCurrentItem_AndChangesNothing()
    {
        var deadlocks = new DeadlockInjector();
        await using var host = await StartAsync(deadlocks);
        var seeded = await ActAsControllerAsync(host);
        var item = await host.CreateOkAsync(InjectTestHost.PostItem(seeded.PersonaIds[0]));

        deadlocks.Arm(DeadlockInjector.ItemSave);
        var edit = await host.PutAsync(item.Id, new
        {
            kind = "post",
            title = "Renamed while contended",
            version = item.Version,
            posts = new[] { new { personaId = seeded.PersonaIds[0].ToString(), text = "The water from my tap is BROWN #WaterIssues" } },
        });

        deadlocks.Thrown.Should().Be(1);
        edit.StatusCode.Should().Be(HttpStatusCode.Conflict);
        var problem = await InjectTestHost.ReadProblemAsync(edit);
        problem.Detail.Should().Be(InjectQueueService.StaleVersionMessage);
        problem.Item!.Title.Should().Be(item.Title, "the edit rolled back with the deadlock");
        (await host.GetQueueAsync()).Items.Single().Title.Should().Be(item.Title);
    }

    [RequiresDockerFact]
    public async Task ARunnerStepThatIsTheDeadlockVictim_SkipsItsTick_AndTheNextTickPublishes()
    {
        var deadlocks = new DeadlockInjector();
        await using var host = await StartAsync(deadlocks);
        var seeded = await ActAsControllerAsync(host);
        var item = await host.CreateOkAsync(InjectTestHost.BurstItem(seeded.PersonaIds, count: 2)); // offsets 0, 3
        await host.ActionOkAsync(item.Guid, "fire"); // post 1 inline
        host.Time.Advance(TimeSpan.FromSeconds(10)); // post 2 is due

        // The step itself treats the victim as a skipped tick — it does not throw for the runner to log as an item fault.
        deadlocks.Arm(DeadlockInjector.ItemRead);
        await using (var scope = host.Services.CreateAsyncScope())
        {
            var queue = scope.ServiceProvider.GetRequiredService<InjectQueueService>();
            var step = () => queue.AdvanceAsync(item.Guid);
            await step.Should().NotThrowAsync("a deadlock victim is a lost race the step absorbs, not a fault");
        }

        deadlocks.Thrown.Should().Be(1, "the step's item load really was the victim");
        (await CountPostsAsync(host, seeded.ExerciseId)).Should().Be(1, "the victim step published nothing");

        // And through the runner's own tick: a victim tick publishes nothing, the next one publishes the due post.
        deadlocks.Arm(DeadlockInjector.ItemRead);
        var tick = () => host.Runner.RunTickAsync();
        await tick.Should().NotThrowAsync();
        deadlocks.Thrown.Should().Be(2);
        (await CountPostsAsync(host, seeded.ExerciseId)).Should().Be(1, "the victim tick published nothing");

        await host.Runner.RunTickAsync();
        (await CountPostsAsync(host, seeded.ExerciseId)).Should().Be(2, "the next tick publishes the due post");
    }

    // ---- helpers ----

    private async Task<InjectTestHost> StartAsync(DeadlockInjector deadlocks)
    {
        _fixture.ConnectionString.Should().NotBeNull();
        return await InjectTestHost.StartAsync(
            _fixture.ConnectionString!,
            configureServices: services => services.ConfigureDbContext<PulseDbContext>(options => options.AddInterceptors(deadlocks)));
    }

    private static async Task<SeededExercise> ActAsControllerAsync(InjectTestHost host)
    {
        var seeded = await host.SeedExerciseAsync();
        host.ActAs(seeded.ExerciseId, seeded.StaffUserId);
        return seeded;
    }

    private static async Task<int> CountPostsAsync(InjectTestHost host, Guid exerciseId)
    {
        await using var db = host.Db(exerciseId);
        return await db.Posts.CountAsync();
    }

    /// <summary>The <c>action</c> of every inject_action event for the item, oldest first.</summary>
    private static async Task<System.Collections.Generic.List<string>> ActionsAsync(InjectTestHost host, Guid exerciseId, Guid itemId)
    {
        await using var db = host.Db(exerciseId);
        var injectId = itemId.ToString();
        var payloads = await db.TelemetryEvents
            .Where(e => e.EventType == "inject_action" && e.InjectId == injectId)
            .OrderBy(e => e.EmittedAt)
            .Select(e => e.Payload!)
            .ToListAsync();
        return payloads
            .Select(payload =>
            {
                using var json = System.Text.Json.JsonDocument.Parse(payload);
                return json.RootElement.GetProperty("action").GetString()!;
            })
            .ToList();
    }
}
