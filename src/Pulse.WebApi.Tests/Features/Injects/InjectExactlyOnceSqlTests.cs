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
        await using (var firer = Build(world, barrier: null, controller: world.StaffUserId))
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

        return new World(exerciseId, staffUserId, itemId, time, new ExerciseClockService(time));
    }

    private Harness Build(World world, ClaimBarrier? barrier, Guid? controller)
    {
        var scope = new ExerciseContext { CurrentExerciseId = world.ExerciseId };
        var db = Context(world.ExerciseId, barrier);
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
            NullLogger<InjectQueueService>.Instance);

        return new Harness(db, service);
    }

    private PulseDbContext Context(Guid exerciseId, ClaimBarrier? barrier)
    {
        var builder = new DbContextOptionsBuilder<PulseDbContext>().UseSqlServer(_fixture.ConnectionString!);
        if (barrier is not null)
        {
            builder.AddInterceptors(barrier);
        }

        return new PulseDbContext(builder.Options, new ExerciseContext { CurrentExerciseId = exerciseId });
    }

    private async Task<int> PostCountAsync(World world)
    {
        await using var db = Context(world.ExerciseId, null);
        return await db.Posts.CountAsync();
    }

    private sealed record World(Guid ExerciseId, Guid StaffUserId, Guid ItemId, ManualTimeProvider Time, IExerciseClock Clock);

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
