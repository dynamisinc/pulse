namespace Pulse.WebApi.Tests.Features.Injects;

using System;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using Microsoft.Extensions.Logging.Abstractions;
using Pulse.WebApi.Data;
using Pulse.WebApi.Data.Entities;
using Pulse.WebApi.Features.EngineRuntime.Clock;
using Pulse.WebApi.Features.EngineRuntime.Steering;
using Pulse.WebApi.Features.Identity.Staff;
using Pulse.WebApi.Features.Injects;
using Pulse.WebApi.Features.Social;
using Pulse.WebApi.Tests.Data;
using Pulse.WebApi.Tests.Features.EngineRuntime.Clock;
using Pulse.WebApi.Tests.Features.Identity.Staff;
using Pulse.WebApi.Tests.Features.Social;
using Xunit;

/// <summary>
/// IQ-9 against REAL SQL Server, deterministically: two writers (two controllers, or two runner instances) both read
/// the same item version, and a barrier holds each one's CLAIM save until both have reached it — the exact
/// interleaving only the <c>Version</c> concurrency token can resolve. Exactly one post must result. (Remove
/// <c>IsConcurrencyToken()</c> and both claims save, both publish, and these tests fail — verified.)
/// </summary>
[Collection(MsSqlCollection.Name)]
public sealed class InjectExactlyOnceSqlTests
{
    private readonly MsSqlContainerFixture _fixture;

    public InjectExactlyOnceSqlTests(MsSqlContainerFixture fixture)
    {
        _fixture = fixture;
    }

    [RequiresDockerFact]
    public async Task TwoControllersFiringAtTheSameInstant_PublishExactlyOnePost()
    {
        var world = await SeedAsync(InjectKinds.Post);
        var barrier = new ClaimBarrier(parties: 2);

        await using var first = Build(world, barrier, controller: world.StaffUserId);
        await using var second = Build(world, barrier, controller: Guid.NewGuid());

        var results = await Task.WhenAll(
            first.Service.FireAsync(world.ItemId),
            second.Service.FireAsync(world.ItemId));

        barrier.Arrived.Should().Be(2, "both writers read the same version and reached their claim before either saved");
        results.Count(r => r.Outcome == InjectOutcome.Ok).Should().Be(1);
        var loser = results.Single(r => r.Outcome == InjectOutcome.Conflict);
        loser.CurrentItem.Should().NotBeNull("the loser gets the item's current state");
        (await PostCountAsync(world)).Should().Be(1, "exactly one post, published by the claim winner");
    }

    [RequiresDockerFact]
    public async Task TwoRunnerInstancesTickingTheSameBurst_PublishTheDuePostExactlyOnce()
    {
        var world = await SeedAsync(InjectKinds.Burst);
        await using (var firer = Build(world, interceptor: null, controller: world.StaffUserId))
        {
            (await firer.Service.FireAsync(world.ItemId)).Outcome.Should().Be(InjectOutcome.Ok);
        }

        world.Time.Advance(TimeSpan.FromSeconds(30)); // the second post (offset 3) is due
        var barrier = new ClaimBarrier(parties: 2);
        await using var instanceA = Build(world, barrier, controller: null);
        await using var instanceB = Build(world, barrier, controller: null);

        await Task.WhenAll(instanceA.Service.AdvanceAsync(world.ItemId), instanceB.Service.AdvanceAsync(world.ItemId));

        barrier.Arrived.Should().Be(2);
        (await PostCountAsync(world)).Should().Be(2, "the first post from Fire, plus the due post exactly once");
        await using var db = Context(world.ExerciseId, null);
        (await db.InjectItemPosts.CountAsync(p => p.InjectItemId == world.ItemId && p.Status == InjectPostStatuses.Fired))
            .Should().Be(2);
    }

    // ---- L1: Hold must win against a runner tick ------------------------------------------------------

    [RequiresDockerFact]
    public async Task Hold_ThatLosesARaceToARunnerTick_ReappliesOnFreshState_AndStopsThePileOn()
    {
        var world = await SeedAsync(InjectKinds.Burst);
        await using (var firer = Build(world, interceptor: null, controller: world.StaffUserId))
        {
            (await firer.Service.FireAsync(world.ItemId)).Outcome.Should().Be(InjectOutcome.Ok);
        }

        world.Time.Advance(TimeSpan.FromSeconds(30)); // post 2 is due
        await using var runner = Build(world, interceptor: null, controller: null);

        // The runner publishes post 2 in the window between Hold reading the item and Hold saving it.
        var race = new BeforeSaveHook(
            context => context.ChangeTracker.Entries<InjectItem>().Any(e => e.Entity.Status == InjectStatuses.Held),
            () => runner.Service.AdvanceAsync(world.ItemId),
            times: 1);
        await using var holder = Build(world, race, controller: world.StaffUserId);

        var held = await holder.Service.HoldAsync(world.ItemId);

        race.Fired.Should().Be(1, "the runner tick really did land between Hold's read and its save");
        held.Outcome.Should().Be(InjectOutcome.Ok, "Hold re-applies once on fresh state instead of losing to the tick");
        held.Value!.Status.Should().Be("held");
        held.Value.FiredCount.Should().Be(2, "the post the tick published is recorded, not lost");

        world.Time.Advance(TimeSpan.FromMinutes(5));
        await runner.Service.AdvanceAsync(world.ItemId);
        (await PostCountAsync(world)).Should().Be(2, "the pile-on is stopped: post 3 waits for a release");
    }

    [RequiresDockerFact]
    public async Task Hold_ThatKeepsLosing_Gets409WithTheStaleVersionMessage_NeverAlreadyFiring()
    {
        var world = await SeedAsync(InjectKinds.Burst);
        await using (var firer = Build(world, interceptor: null, controller: world.StaffUserId))
        {
            await firer.Service.FireAsync(world.ItemId);
        }

        var race = new BeforeSaveHook(
            context => context.ChangeTracker.Entries<InjectItem>().Any(e => e.Entity.Status == InjectStatuses.Held),
            () => BumpVersionAsync(world),
            times: 2);
        await using var holder = Build(world, race, controller: world.StaffUserId);

        var result = await holder.Service.HoldAsync(world.ItemId);

        race.Fired.Should().Be(2, "both the first attempt and the one re-apply lost");
        result.Outcome.Should().Be(InjectOutcome.Conflict);
        result.Message.Should().Be(InjectQueueService.StaleVersionMessage, "\"already firing\" only ever answers a fire/retry");
        result.CurrentItem!.Status.Should().Be("firing");
    }

    // ---- L2: a controller's fire event survives a record that gives up -------------------------------

    [RequiresDockerFact]
    public async Task ARecordThatGivesUp_StillEmitsExactlyOneFireEvent_AndTheLaterReconcileDoesNotDuplicateIt()
    {
        var world = await SeedAsync(InjectKinds.Post);

        // Every record attempt loses to a concurrent writer, so RecordAsync exhausts its retries and gives up.
        var hostile = new BeforeSaveHook(
            context => context.ChangeTracker.Entries<InjectItemPost>().Any(e =>
                e.State == EntityState.Modified
                && e.Property(post => post.ClaimedAt).IsModified
                && e.Property(post => post.ClaimedAt).OriginalValue is not null
                && e.Entity.ClaimedAt is null),
            () => BumpVersionAsync(world),
            times: int.MaxValue);
        await using (var firer = Build(world, hostile, controller: world.StaffUserId))
        {
            var fired = await firer.Service.FireAsync(world.ItemId);

            fired.Outcome.Should().Be(InjectOutcome.Ok, "the fire went through; only its record is pending");
            fired.Value!.Status.Should().Be("firing");
        }

        hostile.Fired.Should().Be(5, "RecordAsync tried exactly MaxRecordAttempts times");
        (await PostCountAsync(world)).Should().Be(1);
        var afterGiveUp = await FireEventsAsync(world);
        afterGiveUp.Should().ContainSingle("the give-up emits the controller's fire event on its own (XC-004 has no gap)");

        // Later, the runner reconciles the abandoned claim against the posts table.
        world.Time.Advance(InjectBurstPlanner.ClaimLease + TimeSpan.FromSeconds(1));
        await using (var runner = Build(world, interceptor: null, controller: null))
        {
            await runner.Service.AdvanceAsync(world.ItemId);
        }

        await using var db = Context(world.ExerciseId, null);
        var item = await db.InjectItems.Include(i => i.Posts).SingleAsync(i => i.Id == world.ItemId);
        item.Status.Should().Be(InjectStatuses.Fired, "the reconcile recorded the post the funnel created");
        item.Posts.Single().FiredPostId.Should().NotBeNull();
        (await PostCountAsync(world)).Should().Be(1, "and never published it twice");
        (await FireEventsAsync(world)).Select(e => e.EventId).Should().Equal(
            afterGiveUp.Select(e => e.EventId), "exactly one fire event: the reconcile saw it was already emitted");
    }

    // ---- the queue token: reorder is atomic against create and delete (Copilot review, #458) --------

    [RequiresDockerFact]
    public async Task AReorder_ThatACreateLandsInsideOf_Is409_AndWritesNoOrder()
    {
        var world = await SeedAsync(InjectKinds.Post); // live: X
        Guid a, b;
        await using (var author = Build(world, interceptor: null, controller: world.StaffUserId))
        {
            a = await CreatePostAsync(author, world, "A");
            b = await CreatePostAsync(author, world, "B");
        }

        var before = await OrdersAsync(world);
        await using var racer = Build(world, interceptor: null, controller: world.StaffUserId);
        var race = new BeforeSaveHook(
            context => context.ChangeTracker.Entries<InjectItem>().Any(e => e.State == EntityState.Modified && e.Property(i => i.Order).IsModified),
            async () => await CreatePostAsync(racer, world, "C"),
            times: 1);
        await using var reorderer = Build(world, race, controller: world.StaffUserId);

        var result = await reorderer.Service.ReorderAsync(Ids(b, a, world.ItemId));

        race.Fired.Should().Be(1, "the create really landed between the reorder's read and its save");
        result.Outcome.Should().Be(InjectOutcome.Conflict, "the ids no longer list the live set");
        result.Message.Should().Be("The queue changed while you were reordering. Refresh and try again.");
        result.CurrentItem.Should().BeNull("a queue-level 409 carries no item");
        var after = await OrdersAsync(world);
        after.Should().HaveCount(4, "the racing create landed");
        after.Where(entry => before.ContainsKey(entry.Key)).Should().BeEquivalentTo(before, "the stale reorder wrote nothing");
    }

    [RequiresDockerFact]
    public async Task AReorder_ThatADeleteOfAnUnmovedItemLandsInsideOf_Is409()
    {
        var world = await SeedAsync(InjectKinds.Post); // live: X (order 1)
        Guid a, b;
        await using (var author = Build(world, interceptor: null, controller: world.StaffUserId))
        {
            a = await CreatePostAsync(author, world, "A"); // order 2
            b = await CreatePostAsync(author, world, "B"); // order 3 — keeps order 3 in the reorder below
        }

        await using var racer = Build(world, interceptor: null, controller: world.StaffUserId);
        var race = new BeforeSaveHook(
            context => context.ChangeTracker.Entries<InjectItem>().Any(e => e.State == EntityState.Modified && e.Property(i => i.Order).IsModified),
            async () => (await racer.Service.DeleteAsync(b, 1)).Outcome.Should().Be(InjectOutcome.Deleted),
            times: 1);
        await using var reorderer = Build(world, race, controller: world.StaffUserId);

        // B's own row is untouched by this reorder, so only the queue token can see that it was deleted meanwhile.
        var result = await reorderer.Service.ReorderAsync(Ids(a, world.ItemId, b));

        race.Fired.Should().Be(1);
        result.Outcome.Should().Be(InjectOutcome.Conflict);
        result.CurrentItem.Should().BeNull();
        (await OrdersAsync(world)).Should().BeEquivalentTo(
            new System.Collections.Generic.Dictionary<Guid, int> { [world.ItemId] = 1, [a] = 2 }, "B is gone and nothing was reordered");
    }

    [RequiresDockerFact]
    public async Task ACreate_ThatLosesTheQueueTokenToAReorder_RetriesOnAFreshSlot_AndLands()
    {
        var world = await SeedAsync(InjectKinds.Post); // live: X
        Guid a;
        await using (var author = Build(world, interceptor: null, controller: world.StaffUserId))
        {
            a = await CreatePostAsync(author, world, "A");
        }

        await using var reorderer = Build(world, interceptor: null, controller: world.StaffUserId);
        var race = new BeforeSaveHook(
            context => context.ChangeTracker.Entries<InjectItem>().Any(e => e.State == EntityState.Added),
            async () => (await reorderer.Service.ReorderAsync(Ids(a, world.ItemId))).Outcome.Should().Be(InjectOutcome.Ok),
            times: 1);
        await using var creator = Build(world, race, controller: world.StaffUserId);

        var created = await CreatePostAsync(creator, world, "C");

        race.Fired.Should().Be(1);
        (await OrdersAsync(world)).Should().BeEquivalentTo(
            new System.Collections.Generic.Dictionary<Guid, int> { [a] = 1, [world.ItemId] = 2, [created] = 3 },
            "nothing the creator sent was stale, so it retried and took the next slot after the reorder");
    }

    [RequiresDockerFact]
    public async Task ADelete_ThatLosesTheQueueTokenToACreate_RechecksOnce_AndLands()
    {
        var world = await SeedAsync(InjectKinds.Post);
        Guid a;
        await using (var author = Build(world, interceptor: null, controller: world.StaffUserId))
        {
            a = await CreatePostAsync(author, world, "A");
        }

        await using var racer = Build(world, interceptor: null, controller: world.StaffUserId);
        var race = new BeforeSaveHook(
            context => context.ChangeTracker.Entries<InjectItem>().Any(e => e.Property(i => i.DeletedAt).IsModified && e.Entity.DeletedAt != null),
            async () => await CreatePostAsync(racer, world, "C"),
            times: 1);
        await using var deleter = Build(world, race, controller: world.StaffUserId);

        var result = await deleter.Service.DeleteAsync(a, 1);

        race.Fired.Should().Be(1);
        result.Outcome.Should().Be(InjectOutcome.Deleted, "the race was on the queue token only; item A had not changed");
        (await OrdersAsync(world)).Keys.Should().NotContain(a).And.HaveCount(2);
    }

    // ---- harness ----

    private async Task<World> SeedAsync(string kind)
    {
        _fixture.ConnectionString.Should().NotBeNull();
        var exerciseId = Guid.NewGuid();
        var staffUserId = Guid.NewGuid();
        var personaId = Guid.NewGuid();
        var itemId = Guid.NewGuid();
        var time = new ManualTimeProvider(DateTimeOffset.UtcNow);

        await using (var db = Context(exerciseId, null))
        {
            db.Exercises.Add(new Exercise
            {
                OrganizationId = Organization.DefaultOrganizationId,
                Id = exerciseId,
                Name = "Exactly once",
                TimeZone = "UTC",
                Status = "live",
            });
            db.Personas.Add(new Persona
            {
                Id = personaId,
                ExerciseId = exerciseId,
                DisplayName = "Resident",
                Handle = $"@r_{personaId:N}",
                Kind = "citizen",
            });

            var item = new InjectItem
            {
                Id = itemId,
                ExerciseId = exerciseId,
                Kind = kind,
                Title = "race",
                Status = InjectStatuses.Pending,
                Order = 1,
                Version = 1,
                CreatedByHumanId = staffUserId,
                CreatedAt = time.GetUtcNow(),
                UpdatedAt = time.GetUtcNow(),
                BurstWindowSeconds = kind == InjectKinds.Burst ? 90 : null,
            };
            var count = kind == InjectKinds.Burst ? 3 : 1;
            for (var sequence = 1; sequence <= count; sequence++)
            {
                item.Posts.Add(new InjectItemPost
                {
                    Id = Guid.NewGuid(),
                    ExerciseId = exerciseId,
                    InjectItemId = itemId,
                    Sequence = sequence,
                    PersonaId = personaId,
                    Text = $"race {sequence}",
                    Status = InjectPostStatuses.Pending,
                });
            }

            db.InjectItems.Add(item);
            await db.SaveChangesAsync();
        }

        return new World(exerciseId, staffUserId, personaId, itemId, time, new ExerciseClockService(time));
    }

    private Harness Build(World world, IInterceptor? interceptor, Guid? controller)
    {
        var scope = new ExerciseContext { CurrentExerciseId = world.ExerciseId };
        var db = Context(world.ExerciseId, interceptor);
        var ingest = new PostIngestService(db, scope, new FakeFeedBroadcaster());
        var registry = new PauseTierRegistry(world.Clock, new NullPauseOverlayPublisher(), NullLogger<PauseTierRegistry>.Instance);
        var staff = new StubCurrentStaffSessionAccessor(
            controller is { } id ? new CurrentStaffSession { SessionId = Guid.NewGuid(), StaffUserId = id } : null);

        var service = new InjectQueueService(
            db,
            scope,
            staff,
            world.Clock,
            registry,
            new FunnelInjectPostPublisher(ingest),
            new FixedJitterSource(),
            world.Time,
            new InjectRunnerSignal(),
            NullLogger<InjectQueueService>.Instance);

        return new Harness(db, service);
    }

    private PulseDbContext Context(Guid exerciseId, IInterceptor? interceptor)
    {
        var builder = new DbContextOptionsBuilder<PulseDbContext>().UseSqlServer(_fixture.ConnectionString!);
        if (interceptor is not null)
        {
            builder.AddInterceptors(interceptor);
        }

        return new PulseDbContext(builder.Options, new ExerciseContext { CurrentExerciseId = exerciseId });
    }

    private static async Task<Guid> CreatePostAsync(Harness harness, World world, string title)
    {
        var result = await harness.Service.CreateAsync(new InjectItemWriteRequest
        {
            Kind = InjectKinds.Post,
            Title = title,
            Posts = [new InjectPostWriteRequest { PersonaId = world.PersonaId.ToString(), Text = title }],
        });
        result.Outcome.Should().Be(InjectOutcome.Created, result.Message);
        return Guid.Parse(result.Value!.Id);
    }

    private static InjectReorderRequest Ids(params Guid[] ids) => new() { Ids = ids.Select(id => (string?)id.ToString()).ToList() };

    /// <summary>The live items' stored order, by id.</summary>
    private async Task<System.Collections.Generic.Dictionary<Guid, int>> OrdersAsync(World world)
    {
        await using var db = Context(world.ExerciseId, null);
        return await db.InjectItems.Where(i => i.DeletedAt == null).ToDictionaryAsync(i => i.Id, i => i.Order);
    }

    private async Task<int> PostCountAsync(World world)
    {
        await using var db = Context(world.ExerciseId, null);
        return await db.Posts.CountAsync();
    }

    private async Task<System.Collections.Generic.List<TelemetryEvent>> FireEventsAsync(World world)
    {
        await using var db = Context(world.ExerciseId, null);
        var injectId = world.ItemId.ToString();
        return await db.TelemetryEvents
            .Where(e => e.EventType == "inject_action" && e.InjectId == injectId && e.Payload!.Contains("\"fire\""))
            .ToListAsync();
    }

    /// <summary>A concurrent writer: bumps the item's version behind the service's back (another controller's save).</summary>
    private async Task BumpVersionAsync(World world)
    {
        await using var db = Context(world.ExerciseId, null);
        await db.Database.ExecuteSqlAsync($"UPDATE InjectItems SET Version = Version + 1 WHERE Id = {world.ItemId}");
    }

    /// <summary>
    /// Runs a competing action just before a matching save — the deterministic way to land another writer in the
    /// window between a read and its save. Runs at most <c>times</c> times.
    /// </summary>
    private sealed class BeforeSaveHook : SaveChangesInterceptor
    {
        private readonly Func<DbContext, bool> _matches;
        private readonly Func<Task> _competingWrite;
        private readonly int _times;
        private int _fired;

        public BeforeSaveHook(Func<DbContext, bool> matches, Func<Task> competingWrite, int times)
        {
            _matches = matches;
            _competingWrite = competingWrite;
            _times = times;
        }

        public int Fired => _fired;

        public override async ValueTask<InterceptionResult<int>> SavingChangesAsync(
            DbContextEventData eventData,
            InterceptionResult<int> result,
            CancellationToken cancellationToken = default)
        {
            if (_fired < _times && _matches(eventData.Context!))
            {
                _fired++;
                await _competingWrite();
            }

            return result;
        }
    }

    private sealed record World(Guid ExerciseId, Guid StaffUserId, Guid PersonaId, Guid ItemId, ManualTimeProvider Time, IExerciseClock Clock);

    private sealed record Harness(PulseDbContext Db, InjectQueueService Service) : IAsyncDisposable
    {
        public ValueTask DisposeAsync() => Db.DisposeAsync();
    }

    /// <summary>
    /// Holds every CLAIM save (a child whose <c>ClaimedAt</c> is being set) until <c>parties</c> writers have reached
    /// it, then releases them together — so both provably read the same version before either wrote. Times out
    /// rather than deadlocking if only one writer ever arrives (the assertions then fail on <see cref="Arrived"/>).
    /// </summary>
    private sealed class ClaimBarrier : SaveChangesInterceptor
    {
        private readonly int _parties;
        private readonly TaskCompletionSource _released = new(TaskCreationOptions.RunContinuationsAsynchronously);
        private int _arrived;

        public ClaimBarrier(int parties) => _parties = parties;

        public int Arrived => Volatile.Read(ref _arrived);

        public override async ValueTask<InterceptionResult<int>> SavingChangesAsync(
            DbContextEventData eventData,
            InterceptionResult<int> result,
            CancellationToken cancellationToken = default)
        {
            var isClaim = eventData.Context!.ChangeTracker.Entries<InjectItemPost>()
                .Any(entry => entry.State == EntityState.Modified
                    && entry.Entity.ClaimedAt is not null
                    && entry.Property(post => post.ClaimedAt).IsModified);

            if (isClaim)
            {
                if (Interlocked.Increment(ref _arrived) >= _parties)
                {
                    _released.TrySetResult();
                }

                await Task.WhenAny(_released.Task, Task.Delay(TimeSpan.FromSeconds(10), cancellationToken));
            }

            return result;
        }
    }
}
