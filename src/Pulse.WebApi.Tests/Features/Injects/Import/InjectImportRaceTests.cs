namespace Pulse.WebApi.Tests.Features.Injects.Import;

using System;
using System.Collections.Generic;
using System.Data.Common;
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
using Pulse.WebApi.Features.Injects.Import;
using Pulse.WebApi.Features.Social;
using Pulse.WebApi.Tests.Data;
using Pulse.WebApi.Tests.Features.EngineRuntime.Clock;
using Pulse.WebApi.Tests.Features.Identity.Staff;
using Pulse.WebApi.Tests.Features.Social;
using Xunit;

/// <summary>
/// demo-feedback/16 (DF-22, Gate-1 M-1) against REAL SQL Server, deterministically: a competing console write lands
/// INSIDE the import's window — between its reads and its one save — and the import must lose that save, be re-planned
/// against the run sheet as it is now, and leave a clean order (1..n, the competing write kept). Two writers on two
/// contexts, as <see cref="InjectExactlyOnceSqlTests"/>; the window is opened by an interceptor on the import's context.
/// </summary>
[Collection(MsSqlCollection.Name)]
public sealed class InjectImportRaceTests
{
    private readonly MsSqlContainerFixture _fixture;

    public InjectImportRaceTests(MsSqlContainerFixture fixture)
    {
        _fixture = fixture;
    }

    [RequiresDockerFact]
    public async Task AConsoleCreateInsideTheImportWindow_IsRetried_AndTheImportIsPlacedAgainstTheNewSet()
    {
        var world = await SeedAsync();
        await using (var author = Build(world, null))
        {
            await CreateAsync(author, world, "P10", 10);
            await CreateAsync(author, world, "P30", 30);
        }

        await using var racer = Build(world, null);
        var hook = new BeforeImportSave(async () => await CreateAsync(racer, world, "Console P20", 20));
        await using var importer = Build(world, hook);

        var result = await importer.Service.ImportAsync(Plan(world, ("1", "08:25")), dryRun: false);

        hook.Fired.Should().Be(1, "the competing create landed between the import's reads and its save");
        result.Outcome.Should().Be(InjectOutcome.Ok, result.Message);
        (await TitlesInOrderAsync(world)).Should().Equal(
            ["Unplanned", "P10", "Imported 1", "P30", "Console P20"],
            "the queue token failed the first save; the retry placed the import against a set that includes the console item");
        (await OrdersAsync(world)).Should().Equal(1, 2, 3, 4, 5);
    }

    [RequiresDockerFact]
    public async Task AConsoleReorderInsideTheImportWindow_IsRetried_AndTheReorderSurvives()
    {
        var world = await SeedAsync();
        Guid p10, p30;
        await using (var author = Build(world, null))
        {
            p10 = await CreateAsync(author, world, "P10", 10);
            p30 = await CreateAsync(author, world, "P30", 30);
        }

        await using var racer = Build(world, null);
        var hook = new BeforeImportSave(async () =>
            (await racer.Service.ReorderAsync(new InjectReorderRequest { Ids = [p30.ToString(), world.ItemId.ToString(), p10.ToString()] }))
                .Outcome.Should().Be(InjectOutcome.Ok));
        await using var importer = Build(world, hook);

        var result = await importer.Service.ImportAsync(Plan(world, ("1", "08:20")), dryRun: false);

        hook.Fired.Should().Be(1);
        result.Outcome.Should().Be(InjectOutcome.Ok, result.Message);
        (await TitlesInOrderAsync(world)).Should().Equal(
            ["Imported 1", "P30", "Unplanned", "P10"],
            "the controller's reorder is kept; the retry places T+20 before the first pending item planned later — now P30, at the top");
        (await OrdersAsync(world)).Should().Equal(1, 2, 3, 4);
    }

    [RequiresDockerFact]
    public async Task TheAnchorFiringInsideTheImportWindow_IsRetried_AndItNoLongerAnchors()
    {
        var world = await SeedAsync();
        Guid p30;
        await using (var author = Build(world, null))
        {
            await CreateAsync(author, world, "P10", 10);
            p30 = await CreateAsync(author, world, "P30", 30);
            await CreateAsync(author, world, "P40", 40);
        }

        await using var racer = Build(world, null);
        var hook = new BeforeImportSave(async () => (await racer.Service.FireAsync(p30)).Outcome.Should().Be(InjectOutcome.Ok));
        await using var importer = Build(world, hook);

        var result = await importer.Service.ImportAsync(Plan(world, ("1", "08:20")), dryRun: false);

        hook.Fired.Should().Be(1);
        result.Outcome.Should().Be(InjectOutcome.Ok, result.Message);
        (await TitlesInOrderAsync(world)).Should().Equal(
            ["Unplanned", "P10", "P30", "Imported 1", "P40"],
            "the shift wrote P30 under its version token, so its fire failed the first save; fired, it no longer anchors");
    }

    [RequiresDockerFact]
    public async Task TheAnchorFiringInsideTheImportWindow_IsCaught_EvenWhenADeleteLeftItsOrderNumberUnchanged()
    {
        var world = await SeedAsync();
        Guid p30;
        await using (var author = Build(world, null))
        {
            await CreateAsync(author, world, "P10", 10);
            var p20 = await CreateAsync(author, world, "P20", 20);
            p30 = await CreateAsync(author, world, "P30", 30);
            await CreateAsync(author, world, "P40", 40);
            (await author.Service.DeleteAsync(p20, version: 1)).Outcome.Should().Be(InjectOutcome.Deleted);
        }

        // Orders are now 1, 2, 4, 5: inserting before P30 renumbers it 4 → 4, so only the version-token write of every
        // shifted item (not a changed number) can see P30 fire.
        await using var racer = Build(world, null);
        var hook = new BeforeImportSave(async () => (await racer.Service.FireAsync(p30)).Outcome.Should().Be(InjectOutcome.Ok));
        await using var importer = Build(world, hook);

        var result = await importer.Service.ImportAsync(Plan(world, ("1", "08:25")), dryRun: false);

        hook.Fired.Should().Be(1);
        result.Outcome.Should().Be(InjectOutcome.Ok, result.Message);
        (await TitlesInOrderAsync(world)).Should().Equal(["Unplanned", "P10", "P30", "Imported 1", "P40"]);
        (await OrdersAsync(world)).Should().Equal(1, 2, 3, 4, 5);
    }

    [RequiresDockerFact]
    public async Task ACreateRightAfterThePlacementRead_FailsTheSave_BecauseTheTokenWasReadBeforeTheMembership()
    {
        var world = await SeedAsync();
        await using (var author = Build(world, null))
        {
            await CreateAsync(author, world, "P10", 10);
            await CreateAsync(author, world, "P30", 30);
        }

        // ReorderAsync's rule: the token is read BEFORE the membership. A create that commits after the placement's
        // queue read must therefore fail the import's save. Read the token after the membership instead and this save
        // succeeds over a set it never saw: the console item and an imported item share an Order number.
        await using var racer = Build(world, null);
        var hook = new AfterPlacementRead(async () => await CreateAsync(racer, world, "Console P20", 20));
        await using var importer = Build(world, hook);

        var result = await importer.Service.ImportAsync(Plan(world, ("1", "08:25")), dryRun: false);

        hook.Fired.Should().Be(1, "the create landed right after the import read the queue it places into");
        result.Outcome.Should().Be(InjectOutcome.Ok, result.Message);
        (await OrdersAsync(world)).Should().Equal(1, 2, 3, 4, 5);
        (await TitlesInOrderAsync(world)).Should().Equal("Unplanned", "P10", "Imported 1", "P30", "Console P20");
    }

    // ---- harness (as InjectExactlyOnceSqlTests) ----

    private static MselImportPlan Plan(World world, params (string Ref, string Time)[] rows)
    {
        var table = new MselTable(
            ["Inject #", "Title", "Delivery Method", "From / Source", "Description", "Scenario Day", "Scenario Time"],
            [
                new MselRow(2, ["0", "StartEx", "Verbal", "Director", "start", "1", "08:00"]),
                .. rows.Select((row, index) => new MselRow(
                    index + 3,
                    [row.Ref, "Imported " + row.Ref, "Social Media", world.Handle, "text " + row.Ref, "1", row.Time])),
            ]);
        var plan = MselImportPlanner.Plan(table, new MselImportFacts([new ImportPersona(world.PersonaId, world.Handle, "Resident")], [], []));
        plan.Error.Should().BeNull();
        return plan;
    }

    private async Task<List<string>> TitlesInOrderAsync(World world)
    {
        await using var db = Context(world.ExerciseId, null);
        return await db.InjectItems.Where(item => item.DeletedAt == null)
            .OrderBy(item => item.Order).ThenBy(item => item.CreatedAt).Select(item => item.Title).ToListAsync();
    }

    private async Task<List<int>> OrdersAsync(World world)
    {
        await using var db = Context(world.ExerciseId, null);
        return await db.InjectItems.Where(item => item.DeletedAt == null).OrderBy(item => item.Order).Select(item => item.Order).ToListAsync();
    }

    private static async Task<Guid> CreateAsync(Harness harness, World world, string title, int minute)
    {
        var result = await harness.Service.CreateAsync(new InjectItemWriteRequest
        {
            Kind = InjectKinds.Post,
            Title = title,
            PlannedMinute = minute,
            Posts = [new InjectPostWriteRequest { PersonaId = world.PersonaId.ToString(), Text = title }],
        });
        result.Outcome.Should().Be(InjectOutcome.Created, result.Message);
        return Guid.Parse(result.Value!.Id);
    }

    /// <summary>An exercise with one unplanned pending item at <c>Order</c> 1 and a persona the plans post as.</summary>
    private async Task<World> SeedAsync()
    {
        _fixture.ConnectionString.Should().NotBeNull();
        var exerciseId = Guid.NewGuid();
        var staffUserId = Guid.NewGuid();
        var personaId = Guid.NewGuid();
        var itemId = Guid.NewGuid();
        var handle = $"r_{personaId:N}";
        var time = new ManualTimeProvider(DateTimeOffset.UtcNow);

        await using (var db = Context(exerciseId, null))
        {
            db.Exercises.Add(new Exercise
            {
                OrganizationId = Organization.DefaultOrganizationId,
                Id = exerciseId,
                Name = "Import race",
                TimeZone = "UTC",
                Status = "live",
            });
            db.Personas.Add(new Persona { Id = personaId, ExerciseId = exerciseId, DisplayName = "Resident", Handle = handle, Kind = "citizen" });
            var item = new InjectItem
            {
                Id = itemId,
                ExerciseId = exerciseId,
                Kind = InjectKinds.Post,
                Title = "Unplanned",
                Status = InjectStatuses.Pending,
                Order = 1,
                Version = 1,
                CreatedByHumanId = staffUserId,
                CreatedAt = time.GetUtcNow(),
                UpdatedAt = time.GetUtcNow(),
            };
            item.Posts.Add(new InjectItemPost
            {
                Id = Guid.NewGuid(),
                ExerciseId = exerciseId,
                InjectItemId = itemId,
                Sequence = 1,
                PersonaId = personaId,
                Text = "Unplanned",
                Status = InjectPostStatuses.Pending,
            });
            db.InjectItems.Add(item);
            await db.SaveChangesAsync();
        }

        return new World(exerciseId, staffUserId, personaId, handle, itemId, time, new ExerciseClockService(time));
    }

    private Harness Build(World world, IInterceptor? interceptor)
    {
        var scope = new ExerciseContext { CurrentExerciseId = world.ExerciseId };
        var db = Context(world.ExerciseId, interceptor);
        var ingest = new PostIngestService(db, scope, new FakeFeedBroadcaster());
        var registry = new PauseTierRegistry(world.Clock, new NullPauseOverlayPublisher(), NullLogger<PauseTierRegistry>.Instance);
        var staff = new StubCurrentStaffSessionAccessor(new CurrentStaffSession { SessionId = Guid.NewGuid(), StaffUserId = world.StaffUserId });
        var service = new InjectQueueService(
            db,
            scope,
            staff,
            TestScenarioNow.Over(db, world.Clock, world.Time),
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

    /// <summary>Runs a competing write once, just before the import's one save (the save that adds imported items).</summary>
    private sealed class BeforeImportSave : SaveChangesInterceptor
    {
        private readonly Func<Task> _competingWrite;
        private int _fired;

        public BeforeImportSave(Func<Task> competingWrite)
        {
            _competingWrite = competingWrite;
        }

        public int Fired => _fired;

        public override async ValueTask<InterceptionResult<int>> SavingChangesAsync(
            DbContextEventData eventData,
            InterceptionResult<int> result,
            CancellationToken cancellationToken = default)
        {
            var importSave = eventData.Context!.ChangeTracker.Entries<InjectItem>()
                .Any(entry => entry.State == EntityState.Added && entry.Entity.ExternalRef != null);
            if (_fired == 0 && importSave)
            {
                _fired++;
                await _competingWrite();
            }

            return result;
        }
    }

    /// <summary>
    /// Runs a competing write once, the moment the import has finished reading the queue it places into — the only
    /// <c>InjectItems</c> read on the import's path ordered by <c>Order</c> (the hook counts, so a drifted match fails
    /// loudly). The reader is fully consumed by then, so the competing write never waits on it.
    /// </summary>
    private sealed class AfterPlacementRead : DbCommandInterceptor
    {
        private readonly Func<Task> _competingWrite;
        private int _fired;

        public AfterPlacementRead(Func<Task> competingWrite)
        {
            _competingWrite = competingWrite;
        }

        public int Fired => _fired;

        public override async ValueTask<InterceptionResult> DataReaderClosingAsync(
            DbCommand command,
            DataReaderClosingEventData eventData,
            InterceptionResult result)
        {
            var text = command.CommandText;
            if (_fired == 0
                && text.Contains("FROM [InjectItems]", StringComparison.Ordinal)
                && text.Contains("ORDER BY", StringComparison.Ordinal)
                && text.Contains(".[Order]", StringComparison.Ordinal))
            {
                _fired++;
                await _competingWrite();
            }

            return result;
        }
    }

    private sealed record World(Guid ExerciseId, Guid StaffUserId, Guid PersonaId, string Handle, Guid ItemId, ManualTimeProvider Time, IExerciseClock Clock);

    private sealed record Harness(PulseDbContext Db, InjectQueueService Service) : IAsyncDisposable
    {
        public ValueTask DisposeAsync() => Db.DisposeAsync();
    }
}
