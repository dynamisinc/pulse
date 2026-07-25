namespace Pulse.WebApi.Tests.Features.Ops.EngineContentSeed;

using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.Json;
using System.Threading.Tasks;
using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Options;
using Pulse.Core.Core.Extensions;
using Pulse.WebApi.Data;
using Pulse.WebApi.Data.Entities;
using Pulse.WebApi.Data.Extensions;
using Pulse.WebApi.Features.EngineRuntime;
using Pulse.WebApi.Features.EngineRuntime.Clock;
using Pulse.WebApi.Features.Ops.Bootstrap;
using Pulse.WebApi.Features.Ops.EngineContentSeed;
using Pulse.WebApi.Features.Realtime;
using Pulse.WebApi.Features.Social;
using Pulse.WebApi.Tests.Data;
using Pulse.WebApi.Tests.Features.EngineRuntime;
using Pulse.WebApi.Tests.Features.EngineRuntime.Clock;
using Xunit;

/// <summary>
/// Story 03 service + end-to-end coverage against a REAL SQL Server (Testcontainers). It proves: an unknown
/// hostname 404s without creating an exercise (AC2); a resolved exercise seeds the six-persona cast + registers
/// the loop (AC3); the registration's autonomy is the SHARED <see cref="EngineAutonomyRegistry"/> instance, not
/// a detached one (AC3, the load-bearing correctness point); an idempotent re-run reuses personas and REPLACES
/// (never duplicates) the registration (AC4); COR-001 isolation — seeding A never touches B (AC6); exactly one
/// <c>engine.content_seeded</c> XC-004 event per successful seed (AC7); and — the feature's success criterion
/// (AC5) — the full offline path: seed → advance the clock past the response window → tick → a review item
/// enqueues → a controller approve publishes a <see cref="Post"/> into the feed, with NO live AI. Every test is
/// <see cref="RequiresDockerFactAttribute"/>.
/// </summary>
[Collection(MsSqlCollection.Name)]
public sealed class EngineContentSeedServiceTests
{
    private const string ConfiguredSecret = "s3cr3t-bootstrap-value";
    private static readonly DateTimeOffset ScenarioStart = new(2033, 6, 1, 9, 0, 0, TimeSpan.Zero);

    private readonly MsSqlContainerFixture _fixture;

    public EngineContentSeedServiceTests(MsSqlContainerFixture fixture)
    {
        _fixture = fixture;
    }

    private static string UniqueHostname() => $"seed-{Guid.NewGuid():N}.example.com";

    private async Task<Guid> InsertExerciseAsync(string hostname, string timeZone = "UTC")
    {
        var exerciseId = Guid.NewGuid();
        await using var seed = _fixture.CreateContext();
        seed.Exercises.Add(new Exercise
        {
            Id = exerciseId,
            Name = "Seed E2E",
            Hostname = hostname,
            TimeZone = timeZone,
            Status = "active",
        });
        await seed.SaveChangesAsync();
        return exerciseId;
    }

    private EngineContentSeedService BuildService(
        PulseDbContext db,
        IReactionLoopRegistry registry,
        EngineAutonomyRegistry autonomy,
        string configuredSecret = ConfiguredSecret,
        TimeProvider? timeProvider = null) =>
        new(
            db,
            Options.Create(new BootstrapOptions { Secret = configuredSecret }),
            new PersonaCastSeeder(db),
            registry,
            autonomy,
            timeProvider ?? TimeProvider.System);

    // ---- Resolve / seed / register --------------------------------------------------------------

    [RequiresDockerFact]
    public async Task Seed_UnknownHostname_Returns404_WithoutCreatingAnExercise()
    {
        var unknownHost = UniqueHostname();
        var registry = new ReactionLoopRegistry();

        await using var db = _fixture.CreateContext();
        var service = BuildService(db, registry, new EngineAutonomyRegistry());
        var result = await service.SeedAsync(new EngineContentSeedRequest { Hostname = unknownHost }, ConfiguredSecret);

        result.Outcome.Should().Be(EngineContentSeedOutcome.HostNotFound, "an unknown host must not resolve to any exercise");
        registry.Active.Should().BeEmpty("no loop is registered when the host resolves to nothing");

        await using var verify = _fixture.CreateContext();
        (await verify.Exercises.IgnoreQueryFilters().AnyAsync(e => e.Hostname == unknownHost)).Should().BeFalse(
            "this endpoint never creates an exercise — only bootstrap does (AC2)");
    }

    [RequiresDockerFact]
    public async Task Seed_ResolvesExistingExercise_SeedsNinePersonas_AndRegistersTheLoop()
    {
        var hostname = UniqueHostname();
        var exerciseId = await InsertExerciseAsync(hostname);
        var registry = new ReactionLoopRegistry();

        await using var db = _fixture.CreateContext();
        var service = BuildService(db, registry, new EngineAutonomyRegistry());
        var result = await service.SeedAsync(new EngineContentSeedRequest { Hostname = hostname }, ConfiguredSecret);

        result.Outcome.Should().Be(EngineContentSeedOutcome.Provisioned);
        result.ExerciseId.Should().Be(exerciseId, "the loop is registered for the resolved exercise (COR-001)");
        result.PersonasCreated.Should().Be(9);
        result.PersonasReused.Should().Be(0);

        registry.Active.Should().ContainSingle().Which.ExerciseId.Should().Be(exerciseId);

        await using var verify = _fixture.CreateContext();
        (await verify.Personas.IgnoreQueryFilters().CountAsync(p => p.ExerciseId == exerciseId)).Should().Be(
            9, "story 01's cast is seeded for the resolved exercise");
    }

    [RequiresDockerFact]
    public async Task Seed_EligibleCast_ExcludesTheNonCastablePersonas_TheEngineCannotVoiceTheImpersonator()
    {
        // profiles-social-graph/06: all nine personas are seeded as ROWS, but the SOC-052 lookalike and the
        // low-credibility outlet ship Castable = false, so the reaction loop's eligible cast (and the
        // storyline's participating personas) must contain neither — the engine literally cannot generate as
        // them until a scenario opts in. This is the real gate replacing an ordering-only mitigation.
        var hostname = UniqueHostname();
        var exerciseId = await InsertExerciseAsync(hostname);
        var registry = new ReactionLoopRegistry();

        await using var db = _fixture.CreateContext();
        var service = BuildService(db, registry, new EngineAutonomyRegistry());
        await service.SeedAsync(new EngineContentSeedRequest { Hostname = hostname }, ConfiguredSecret);

        var registration = registry.Active.Single(r => r.ExerciseId == exerciseId);

        registration.PersonasByHandle.Keys.Should().NotContain(
            ["FairhavenWaterUpd", "TheScoopHQ"],
            "a non-castable persona must never reach the engine's eligible cast");
        registration.PersonasByHandle.Should().HaveCount(
            7, "the seven castable personas remain available to the loop");
        registration.Storylines.Single().ParticipatingPersonas.Should().NotContain(
            ["FairhavenWaterUpd", "TheScoopHQ"],
            "the starter storyline is built from the castable handles only");

        await using var verify = _fixture.CreateContext();
        (await verify.Personas.IgnoreQueryFilters()
            .CountAsync(p => p.ExerciseId == exerciseId && !p.Castable)).Should().Be(
            2, "both accounts still EXIST as rows — participants must be able to browse the lookalike (SOC-052)");
    }

    [RequiresDockerFact]
    public async Task Seed_RegistrationAutonomy_IsTheSharedRegistryInstance_NotADetachedOne()
    {
        var hostname = UniqueHostname();
        var exerciseId = await InsertExerciseAsync(hostname);
        var registry = new ReactionLoopRegistry();
        var autonomyRegistry = new EngineAutonomyRegistry();

        await using var db = _fixture.CreateContext();
        var service = BuildService(db, registry, autonomyRegistry);
        await service.SeedAsync(new EngineContentSeedRequest { Hostname = hostname }, ConfiguredSecret);

        var registration = registry.Active.Single(r => r.ExerciseId == exerciseId);
        registration.Autonomy.Should().BeSameAs(
            autonomyRegistry.GetOrCreate(exerciseId),
            "the registration MUST route on the exact per-exercise EngineAutonomyState the cockpit's "
            + "kill-switch/swamped-mode/auto-HOLD read and mutate — never a fresh, detached instance (AC3, the "
            + "single most important correctness detail in this feature)");
    }

    [RequiresDockerFact]
    public async Task Seed_RunTwice_ReusesPersonas_AndReplacesRegistration_NeverDuplicates()
    {
        var hostname = UniqueHostname();
        var exerciseId = await InsertExerciseAsync(hostname);
        var registry = new ReactionLoopRegistry();
        var autonomyRegistry = new EngineAutonomyRegistry();

        await using (var db1 = _fixture.CreateContext())
        {
            var first = BuildService(db1, registry, autonomyRegistry);
            (await first.SeedAsync(new EngineContentSeedRequest { Hostname = hostname }, ConfiguredSecret))
                .PersonasCreated.Should().Be(9);
        }

        await using (var db2 = _fixture.CreateContext())
        {
            var second = BuildService(db2, registry, autonomyRegistry);
            var result = await second.SeedAsync(new EngineContentSeedRequest { Hostname = hostname }, ConfiguredSecret);
            result.PersonasReused.Should().Be(9, "the second seed reuses story 01's rows (idempotent)");
            result.PersonasCreated.Should().Be(0);
        }

        registry.Active.Where(r => r.ExerciseId == exerciseId).Should().ContainSingle(
            "IReactionLoopRegistry.Register overwrites by exerciseId — the registration is replaced, never duplicated (AC4)");

        await using var verify = _fixture.CreateContext();
        (await verify.Personas.IgnoreQueryFilters().CountAsync(p => p.ExerciseId == exerciseId)).Should().Be(
            9, "re-running the seed creates zero additional persona rows (AC4)");
    }

    [RequiresDockerFact]
    public async Task Seed_EmitsExactlyOneContentSeededEvent_InTheSameUnitOfWork()
    {
        var hostname = UniqueHostname();
        var exerciseId = await InsertExerciseAsync(hostname);
        var registry = new ReactionLoopRegistry();

        await using var db = _fixture.CreateContext();
        var service = BuildService(db, registry, new EngineAutonomyRegistry());
        await service.SeedAsync(new EngineContentSeedRequest { Hostname = hostname }, ConfiguredSecret);

        await using var verify = _fixture.CreateContext();
        var events = await verify.TelemetryEvents
            .IgnoreQueryFilters()
            .Where(e => e.ExerciseId == exerciseId && e.EventType == "engine.content_seeded")
            .ToListAsync();

        events.Should().ContainSingle("exactly one engine.content_seeded audit event per successful seed (AC7)");
        var evt = events[0];
        evt.Actor.Kind.Should().Be("system");
        evt.Actor.ActingHumanId.Should().Be("engine-content-seed");
        evt.Target!.EntityId.Should().Be(exerciseId.ToString());

        using var payload = JsonDocument.Parse(evt.Payload!);
        payload.RootElement.GetProperty("personasCreated").GetInt32().Should().Be(9);
        payload.RootElement.GetProperty("storylineTitle").GetString().Should().Be("Water main contamination fears");
    }

    [RequiresDockerFact]
    public async Task Seed_ForExerciseA_NeverWritesOrRegistersExerciseB()
    {
        var hostA = UniqueHostname();
        var hostB = UniqueHostname();
        var exerciseA = await InsertExerciseAsync(hostA);
        var exerciseB = await InsertExerciseAsync(hostB);
        var registry = new ReactionLoopRegistry();

        await using var db = _fixture.CreateContext();
        var service = BuildService(db, registry, new EngineAutonomyRegistry());
        await service.SeedAsync(new EngineContentSeedRequest { Hostname = hostA }, ConfiguredSecret);

        registry.Active.Select(r => r.ExerciseId).Should().Equal(
            new[] { exerciseA }, "seeding A activates exactly one exercise's loop — never B's (COR-001, AC6)");

        await using var verify = _fixture.CreateContext();
        (await verify.Personas.IgnoreQueryFilters().CountAsync(p => p.ExerciseId == exerciseB)).Should().Be(
            0, "seeding A must never write a persona into B (COR-001)");
        (await verify.TelemetryEvents.IgnoreQueryFilters().CountAsync(e => e.ExerciseId == exerciseB)).Should().Be(
            0, "seeding A must never write telemetry into B (COR-001)");
    }

    [RequiresDockerFact]
    public async Task Seed_UnconfiguredSecret_Rejected_WritesNothing()
    {
        var hostname = UniqueHostname();
        var exerciseId = await InsertExerciseAsync(hostname);
        var registry = new ReactionLoopRegistry();

        await using var db = _fixture.CreateContext();
        // Empty configured secret disables the endpoint entirely — fail closed regardless of the presented value.
        var service = BuildService(db, registry, new EngineAutonomyRegistry(), configuredSecret: string.Empty);
        var result = await service.SeedAsync(new EngineContentSeedRequest { Hostname = hostname }, "any-value");

        result.Outcome.Should().Be(EngineContentSeedOutcome.Rejected);
        registry.Active.Should().BeEmpty();

        await using var verify = _fixture.CreateContext();
        (await verify.Personas.IgnoreQueryFilters().CountAsync(p => p.ExerciseId == exerciseId)).Should().Be(
            0, "an unauthorized call must write nothing (fail closed before any seed)");
    }

    // ---- End-to-end: the feature's success criterion (AC5) --------------------------------------

    [RequiresDockerFact]
    public async Task Seed_ThenTickPastWindow_EnqueuesReviewItem_ThenApprove_LandsPostInFeed()
    {
        var hostname = UniqueHostname();
        var exerciseId = await InsertExerciseAsync(hostname);
        var manualTime = new ManualTimeProvider(ScenarioStart);

        await using var host = BuildFullHost(manualTime, ConfiguredSecret);

        // 1. Seed engine content through the real service (resolves the exercise, seeds cast, registers loop).
        await using (var seedScope = host.CreateAsyncScope())
        {
            var seedService = seedScope.ServiceProvider.GetRequiredService<EngineContentSeedService>();
            var seedResult = await seedService.SeedAsync(
                new EngineContentSeedRequest { Hostname = hostname }, ConfiguredSecret);
            seedResult.Outcome.Should().Be(EngineContentSeedOutcome.Provisioned);
            seedResult.ResponseWindowMinutes.Should().Be(3, "the demo-tuned default silence window");
        }

        var registry = host.GetRequiredService<IReactionLoopRegistry>();
        var registration = registry.Active.Single(r => r.ExerciseId == exerciseId);

        // 2. Start the clock at the registration's scenario start, then advance past the 3-minute window.
        var clock = host.GetRequiredService<IExerciseClock>();
        clock.Start(exerciseId, registration.ScenarioStart, registration.TimeZoneInfo);
        manualTime.Advance(TimeSpan.FromMinutes(4));

        // 3. One tick surfaces the blown storyline as a review item (the unmodified loop + Fake provider).
        var tick = await RunOneTickAsync(host, registration);
        tick.ReviewItemsEnqueued.Should().BeGreaterThan(
            0, "the default 3-minute silence window blew, so the offline Fake provider produced a burst → one review item");

        // 4. A controller approves the queued burst through the unmodified review cockpit service.
        await using (var approveScope = host.CreateAsyncScope())
        {
            ((ExerciseContext)approveScope.ServiceProvider.GetRequiredService<IExerciseContext>())
                .CurrentExerciseId = exerciseId;
            var reviewService = approveScope.ServiceProvider.GetRequiredService<EngineReviewService>();

            var queue = await reviewService.GetQueueAsync();
            queue.Outcome.Should().Be(EngineReviewOutcome.Ok);
            queue.Items.Should().NotBeEmpty("the tick enqueued at least one review item");

            var draftId = Guid.Parse(queue.Items[0].DraftId);
            var approve = await reviewService.ApproveAsync(draftId, new EngineReviewActionInput("controller-e2e", "UTC"));
            approve.Outcome.Should().Be(
                EngineReviewOutcome.Ok,
                "approve resolves the seeded persona handles and publishes the burst end-to-end — no live AI touched (AC5)");
        }

        // 5. The approved burst's posts landed in the participant feed.
        await using var read = _fixture.CreateContext(new ExerciseContext { CurrentExerciseId = exerciseId });
        (await read.Posts.CountAsync()).Should().BeGreaterThan(
            0, "the offline Fake-provider path flowed all the way to GET /api/feed (the feature's success criterion, AC5)");
    }

    private static async Task<ReactionTickResult> RunOneTickAsync(ServiceProvider host, ReactionLoopRegistration registration)
    {
        var driver = host.GetRequiredService<ReactionLoopDriver>();
        using var scope = host.CreateScope();
        ((ExerciseContext)scope.ServiceProvider.GetRequiredService<IExerciseContext>()).CurrentExerciseId =
            registration.ExerciseId;
        return await driver.RunTickAsync(registration, scope.ServiceProvider);
    }

    /// <summary>
    /// Builds a full engine host DI graph (mirroring <c>ReactionLoopHostTests.BuildHost</c>) plus the review
    /// cockpit (<c>AddEngineReview</c>, so approve can publish), SignalR (the review broadcaster's hub context),
    /// and this feature's own <c>AddEngineContentSeed</c> — all against the shared real SQL Server. The
    /// generation provider is the offline <see cref="Pulse.Core.Features.Generation.Services.FakeGenerationProvider"/>
    /// (config-default), so no live AI endpoint is reached.
    /// </summary>
    private ServiceProvider BuildFullHost(TimeProvider timeProvider, string configuredSecret)
    {
        var seedConfig = new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?>
            {
                [$"{BootstrapOptions.SectionName}:Secret"] = configuredSecret,
            })
            .Build();

        var services = new ServiceCollection();
        services.AddLogging();
        services.AddSignalR(); // the review broadcaster resolves IHubContext<ExerciseRealtimeHub>
        services.AddSingleton(timeProvider);
        services.AddScoped<IExerciseContext, ExerciseContext>();
        services.AddDbContext<PulseDbContext>(o => o.UseSqlServer(_fixture.ConnectionString));
        services.AddScoped<PostIngestService>();
        services.AddSingleton<IFeedBroadcaster, RecordingFeedBroadcaster>();
        services.AddEngineGeneration(new ConfigurationBuilder().Build()); // Fake (config default)
        services.AddExerciseScoping();
        services.AddExerciseClock();
        services.AddEngineRuntimeSeams();
        services.AddReactionLoopHost();
        services.AddEngineReview();
        services.AddEngineContentSeed(seedConfig);

        return services.BuildServiceProvider();
    }
}
