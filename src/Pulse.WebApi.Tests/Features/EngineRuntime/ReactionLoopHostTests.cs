namespace Pulse.WebApi.Tests.Features.EngineRuntime;

using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Linq;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Pulse.Core.Core.Extensions;
using Pulse.Core.Features.Autonomy.Models;
using Pulse.Core.Features.Autonomy.Services;
using Pulse.Core.Features.Generation.Models;
using Pulse.Core.Features.ReactionLoop.Models;
using Pulse.Core.Features.Storylines.Models;
using Pulse.WebApi.Data;
using Pulse.WebApi.Data.Extensions;
using Pulse.WebApi.Features.EngineRuntime;
using Pulse.WebApi.Features.EngineRuntime.Addressing;
using Pulse.WebApi.Features.EngineRuntime.Clock;
using Pulse.WebApi.Features.EngineRuntime.Telemetry;
using Pulse.WebApi.Features.Realtime;
using Pulse.WebApi.Features.Social;
using Pulse.WebApi.Tests.Data;
using Pulse.WebApi.Tests.Features.EngineRuntime.Clock;
using Xunit;

/// <summary>
/// Story 01 end-to-end loop coverage against a REAL SQL Server (Testcontainers): the scenario-time tick
/// (observe → decide → generate → enqueue → measure), the guard-before-human gate, the one-review-item-per-
/// burst CTL-034 contract, freeze/jump behaviour, the per-exercise scope (COR-001, extending the standing
/// isolation suite), and the XC-004 stage telemetry. Every test is <see cref="RequiresDockerFactAttribute"/>
/// (skips on a Docker-less machine, runs in CI against <see cref="FakeGenerationProvider"/>).
/// </summary>
[Collection(MsSqlCollection.Name)]
public sealed class ReactionLoopHostTests
{
    private static readonly DateTimeOffset ScenarioStart = new(2033, 6, 1, 9, 0, 0, TimeSpan.Zero);

    private readonly MsSqlContainerFixture _fixture;

    public ReactionLoopHostTests(MsSqlContainerFixture fixture)
    {
        _fixture = fixture;
    }

    private static IExerciseContext ScopeFor(Guid exerciseId) =>
        new ExerciseContext { CurrentExerciseId = exerciseId };

    private ServiceProvider BuildHost(TimeProvider timeProvider, ReactionLoopHostOptions? options = null)
    {
        var services = new ServiceCollection();
        services.AddLogging();
        services.AddSingleton(timeProvider);
        if (options is not null)
        {
            services.AddSingleton(options);
        }

        services.AddScoped<IExerciseContext, ExerciseContext>();
        services.AddDbContext<PulseDbContext>(o => o.UseSqlServer(_fixture.ConnectionString));
        services.AddScoped<PostIngestService>();
        services.AddSingleton<IFeedBroadcaster, RecordingFeedBroadcaster>();

        // The on-enqueue review broadcaster (registered by story 02's AddEngineReview in production, wired
        // alongside AddReactionLoopHost in Program.cs). This harness only pulls in the loop-host slice, so
        // register a recording double here so the driver can resolve it per tick and a test can assert the push.
        var reviewBroadcaster = new RecordingReviewBroadcaster();
        services.AddSingleton(reviewBroadcaster);
        services.AddSingleton<IEngineReviewBroadcaster>(reviewBroadcaster);

        services.AddEngineGeneration(new ConfigurationBuilder().Build()); // Fake
        services.AddExerciseScoping();
        services.AddExerciseClock();
        services.AddEngineRuntimeSeams();
        services.AddReactionLoopHost();

        return services.BuildServiceProvider();
    }

    private static Dictionary<string, EnginePersona> Cast(params string[] handles) =>
        handles.ToDictionary(
            handle => handle,
            handle => new EnginePersona(
                Guid.NewGuid(),
                new PersonaDossier { Handle = handle, DisplayName = handle.TrimStart('@'), Type = PersonaType.Resident }),
            StringComparer.Ordinal);

    private static Storyline SeededStoryline(Guid exerciseId, string title, IReadOnlyList<string> personaHandles)
    {
        var storyline = Storyline.Create(
            exerciseId,
            title: title,
            expectation: "an official statement from the county",
            responseWindowMin: 20,
            participatingPersonas: personaHandles,
            hashtags: ["#WaterIssues"]);
        storyline.Seed(0);
        return storyline;
    }

    private static ReactionLoopRegistration Registration(
        Guid exerciseId,
        IReadOnlyList<Storyline> storylines,
        Dictionary<string, EnginePersona> cast,
        AutonomyLevel level = AutonomyLevel.Suggest) => new()
        {
            ExerciseId = exerciseId,
            ExerciseBrief = "A fictional water-utility incident in the town of Cedar Falls.",
            TimeZone = "America/Chicago",
            ScenarioStart = ScenarioStart,
            TimeZoneInfo = TimeZoneInfo.Utc,
            Storylines = storylines,
            PersonasByHandle = cast,
            Autonomy = EngineAutonomyState.Create(exerciseId, level),
            ControllerDeskId = Guid.NewGuid(),
        };

    private async Task<ReactionTickResult> RunOneTickAsync(
        ServiceProvider host,
        ReactionLoopRegistration registration)
    {
        var driver = host.GetRequiredService<ReactionLoopDriver>();
        using var scope = host.CreateScope();
        ((ExerciseContext)scope.ServiceProvider.GetRequiredService<IExerciseContext>()).CurrentExerciseId =
            registration.ExerciseId;
        return await driver.RunTickAsync(registration, scope.ServiceProvider);
    }

    [RequiresDockerFact]
    public async Task Tick_WhenSilenceWindowBlows_EnqueuesOneReviewItem_AndEmitsEachStageEventOnce()
    {
        var exerciseId = Guid.NewGuid();
        var manualTime = new ManualTimeProvider(ScenarioStart);

        await using var host = BuildHost(manualTime);
        var clock = host.GetRequiredService<IExerciseClock>();
        clock.Start(exerciseId, ScenarioStart, TimeZoneInfo.Utc);
        manualTime.Advance(TimeSpan.FromMinutes(25)); // 25 scenario minutes of silence → window (20) blows

        var cast = Cast("@rosa", "@marcus", "@lena");
        var storyline = SeededStoryline(exerciseId, "Water main contamination fears", cast.Keys.ToList());
        var registration = Registration(exerciseId, [storyline], cast);

        var result = await RunOneTickAsync(host, registration);

        result.ReviewItemsEnqueued.Should().Be(1, "one blown storyline yields exactly one burst = one review item (CTL-034)");

        await using var read = _fixture.CreateContext(ScopeFor(exerciseId));
        (await read.EngineReviewItems.CountAsync()).Should().Be(1);

        // Each loop stage emitted exactly one XC-004 event for this single-storyline tick.
        var byType = await read.TelemetryEvents
            .GroupBy(e => e.EventType)
            .Select(g => new { g.Key, Count = g.Count() })
            .ToListAsync();
        var counts = byType.ToDictionary(x => x.Key, x => x.Count, StringComparer.Ordinal);
        counts.GetValueOrDefault(EngineEventTypes.Observed).Should().Be(1, "one inaction trigger");
        counts.GetValueOrDefault(EngineEventTypes.Decided).Should().Be(1, "one intent");
        counts.GetValueOrDefault(EngineEventTypes.Generated).Should().Be(1, "one burst");
        counts.GetValueOrDefault(EngineEventTypes.Measured).Should().Be(1, "one storyline measured this tick");
        counts.GetValueOrDefault(EngineEventTypes.StorylineStateChanged).Should().Be(1, "the window-open transition");
    }

    [RequiresDockerFact]
    public async Task Tick_WhenAReviewItemIsEnqueued_BroadcastsItToItsExercise()
    {
        var exerciseId = Guid.NewGuid();
        var manualTime = new ManualTimeProvider(ScenarioStart);

        await using var host = BuildHost(manualTime);
        var clock = host.GetRequiredService<IExerciseClock>();
        clock.Start(exerciseId, ScenarioStart, TimeZoneInfo.Utc);
        manualTime.Advance(TimeSpan.FromMinutes(25)); // 25 scenario minutes of silence → window (20) blows

        var cast = Cast("@rosa", "@marcus", "@lena");
        var storyline = SeededStoryline(exerciseId, "Water main contamination fears", cast.Keys.ToList());

        var result = await RunOneTickAsync(host, Registration(exerciseId, [storyline], cast));
        result.ReviewItemsEnqueued.Should().Be(1);

        // The loop pushes the freshly enqueued inject to its exercise's cockpit — the controller queue updates
        // live with no manual refresh — AFTER the item is committed, and scoped to the tick's own exercise.
        var broadcaster = host.GetRequiredService<RecordingReviewBroadcaster>();
        broadcaster.Pushes.Should().ContainSingle(
            "a newly enqueued review item is broadcast on enqueue, not only on disposition change");
        var push = broadcaster.Pushes[0];
        push.ExerciseId.Should().Be(
            exerciseId, "the push is scoped to the tick's server-derived exercise (COR-001)");
        push.Item.ExerciseId.Should().Be(exerciseId.ToString(), "the pushed item is the tick's own review item");
    }

    [RequiresDockerFact]
    public async Task Tick_ReviewItem_IsScopedToItsExercise_AndNeverVisibleCrossExercise()
    {
        var exerciseA = Guid.NewGuid();
        var exerciseB = Guid.NewGuid();
        var manualTime = new ManualTimeProvider(ScenarioStart);

        await using var host = BuildHost(manualTime);
        var clock = host.GetRequiredService<IExerciseClock>();
        clock.Start(exerciseA, ScenarioStart, TimeZoneInfo.Utc);
        manualTime.Advance(TimeSpan.FromMinutes(25));

        var cast = Cast("@rosa", "@marcus");
        var storyline = SeededStoryline(exerciseA, "Water main contamination fears", cast.Keys.ToList());
        var result = await RunOneTickAsync(host, Registration(exerciseA, [storyline], cast));
        result.ReviewItemsEnqueued.Should().Be(1);

        // Exercise B sees none of exercise A's enqueued review items (fail closed).
        await using var readB = _fixture.CreateContext(ScopeFor(exerciseB));
        (await readB.EngineReviewItems.CountAsync()).Should().Be(
            0, "a tick for exercise A must never write into exercise B (COR-001)");

        // The rows exist under exercise A — the zero above is the filter, not a missing write.
        await using var unfiltered = _fixture.CreateContext();
        (await unfiltered.EngineReviewItems.IgnoreQueryFilters().CountAsync(i => i.ExerciseId == exerciseA))
            .Should().Be(1);
    }

    [RequiresDockerFact]
    public async Task Tick_ReviewItem_IsStampedWithTheResolvedTickScope_NotTheStorylineField()
    {
        var exerciseId = Guid.NewGuid();
        var manualTime = new ManualTimeProvider(ScenarioStart);

        await using var host = BuildHost(manualTime);
        var clock = host.GetRequiredService<IExerciseClock>();
        clock.Start(exerciseId, ScenarioStart, TimeZoneInfo.Utc);
        manualTime.Advance(TimeSpan.FromMinutes(25));

        var cast = Cast("@rosa", "@marcus");
        var storyline = SeededStoryline(exerciseId, "Water main contamination fears", cast.Keys.ToList());
        var result = await RunOneTickAsync(host, Registration(exerciseId, [storyline], cast));
        result.ReviewItemsEnqueued.Should().Be(1);

        // The enqueued item carries the tick's resolved scope (WR-001) — the contract's stamping rule.
        // Scoped to this test's exerciseId: the fixture's DB is shared across the test class, so an
        // unscoped SingleAsync() would see sibling tests' rows too (COR-001 assertion, not just this test).
        await using var unfiltered = _fixture.CreateContext();
        var item = await unfiltered.EngineReviewItems.IgnoreQueryFilters()
            .SingleAsync(i => i.ExerciseId == exerciseId);
        item.ExerciseId.Should().Be(
            exerciseId, "the review item is stamped from the tick's resolved scope, not any client/entity-supplied field (COR-001)");
    }

    [RequiresDockerFact]
    public async Task Tick_WhenAStorylineScopeDisagreesWithTheRegistration_FailsLoud_AndEnqueuesNothing()
    {
        var exerciseId = Guid.NewGuid();
        var foreignExerciseId = Guid.NewGuid();
        var manualTime = new ManualTimeProvider(ScenarioStart);

        await using var host = BuildHost(manualTime);
        var clock = host.GetRequiredService<IExerciseClock>();
        clock.Start(exerciseId, ScenarioStart, TimeZoneInfo.Utc);
        manualTime.Advance(TimeSpan.FromMinutes(25));

        // A corrupt registration: the storyline carries a DIFFERENT exercise than the tick's resolved scope.
        var cast = Cast("@rosa", "@marcus");
        var foreignStoryline = SeededStoryline(foreignExerciseId, "Water main contamination fears", cast.Keys.ToList());
        var registration = Registration(exerciseId, [foreignStoryline], cast);

        var tick = async () => await RunOneTickAsync(host, registration);

        await tick.Should().ThrowAsync<InvalidOperationException>(
            "a storyline whose scope disagrees with the tick must fail loud, never enqueue exercise A's draft under exercise B (COR-001, WR-001)");

        // Nothing leaked into either exercise's queue — the guard threw before any enqueue.
        // Scoped to this test's two exercise ids: the fixture's DB is shared across the test class, so an
        // unscoped CountAsync() would also count sibling tests' rows.
        await using var unfiltered = _fixture.CreateContext();
        (await unfiltered.EngineReviewItems.IgnoreQueryFilters()
            .CountAsync(i => i.ExerciseId == exerciseId || i.ExerciseId == foreignExerciseId)).Should().Be(
            0, "the mismatch is caught before the review item is persisted");
    }

    [RequiresDockerFact]
    public async Task Tick_WhileClockFrozenBelowTheWindow_AccruesNoSilence_AndSurfacesNothing()
    {
        var exerciseId = Guid.NewGuid();
        var manualTime = new ManualTimeProvider(ScenarioStart);

        await using var host = BuildHost(manualTime);
        var clock = host.GetRequiredService<IExerciseClock>();
        clock.Start(exerciseId, ScenarioStart, TimeZoneInfo.Utc);
        manualTime.Advance(TimeSpan.FromMinutes(5)); // below the 20-minute window
        clock.Freeze(exerciseId);                    // freeze holds the minute at 5

        var cast = Cast("@rosa", "@marcus");
        var storyline = SeededStoryline(exerciseId, "Water main contamination fears", cast.Keys.ToList());
        var registration = Registration(exerciseId, [storyline], cast);

        // Advancing wall time changes nothing while frozen: two ticks accrue no scenario time.
        await RunOneTickAsync(host, registration);
        manualTime.Advance(TimeSpan.FromMinutes(60));
        var second = await RunOneTickAsync(host, registration);

        second.ReviewItemsEnqueued.Should().Be(0, "a frozen clock accrues no silence, so no window blows (COR-052)");
        storyline.Phase.Should().Be(StorylinePhase.Seeded, "the storyline never left Seeded while frozen");

        await using var read = _fixture.CreateContext(ScopeFor(exerciseId));
        (await read.EngineReviewItems.CountAsync()).Should().Be(0);
    }

    [RequiresDockerFact]
    public async Task Tick_AfterATimeJump_SurfacesTheStorylineThatBlewItsWindowDuringTheSkip()
    {
        var exerciseId = Guid.NewGuid();
        var manualTime = new ManualTimeProvider(ScenarioStart);

        await using var host = BuildHost(manualTime);
        var clock = host.GetRequiredService<IExerciseClock>();
        clock.Start(exerciseId, ScenarioStart, TimeZoneInfo.Utc);

        var cast = Cast("@rosa", "@marcus");
        var storyline = SeededStoryline(exerciseId, "Water main contamination fears", cast.Keys.ToList());
        var registration = Registration(exerciseId, [storyline], cast);

        // A discrete time-jump (COR-051) leaps past the response window; the next tick surfaces the storyline.
        clock.Jump(exerciseId, 30);
        var result = await RunOneTickAsync(host, registration);

        result.ReviewItemsEnqueued.Should().Be(1, "the jump advanced the timers so the blown window surfaces on the next tick");
        storyline.Phase.Should().Be(StorylinePhase.Escalating);
    }

    [RequiresDockerFact]
    public async Task Tick_WithManyBlownStorylines_CapsReviewDecisionsAtTheCtl034Budget()
    {
        var exerciseId = Guid.NewGuid();
        var manualTime = new ManualTimeProvider(ScenarioStart);

        await using var host = BuildHost(manualTime);
        var clock = host.GetRequiredService<IExerciseClock>();
        clock.Start(exerciseId, ScenarioStart, TimeZoneInfo.Utc);
        manualTime.Advance(TimeSpan.FromMinutes(30));

        var cast = Cast("@rosa", "@marcus");
        var storylines = Enumerable.Range(0, 8)
            .Select(i => SeededStoryline(exerciseId, $"Concern {i}", cast.Keys.ToList()))
            .ToList<Storyline>();

        var result = await RunOneTickAsync(host, Registration(exerciseId, storylines, cast));

        result.ReviewItemsEnqueued.Should().Be(
            WorkloadDemandMeter.BudgetPerMinute,
            "the loop must not demand more than ~6 review decisions per scenario minute (CTL-034) even with 8 blown storylines");
    }

    [RequiresDockerFact]
    public async Task HostedService_DrivesTheLoop_AndAFrozenExerciseIsSkipped()
    {
        var running = Guid.NewGuid();
        var frozen = Guid.NewGuid();

        // Real time source + a short heartbeat, so the BackgroundService actually ticks in this test.
        await using var host = BuildHost(TimeProvider.System, new ReactionLoopHostOptions
        {
            TickInterval = TimeSpan.FromMilliseconds(100),
        });

        var clock = host.GetRequiredService<IExerciseClock>();
        // Pre-start + jump both clocks past the window so the host does not have to wait 20 real minutes;
        // EnsureClockStarted will not restart an already-running/frozen clock.
        clock.Start(running, ScenarioStart, TimeZoneInfo.Utc);
        clock.Start(frozen, ScenarioStart, TimeZoneInfo.Utc);
        clock.Jump(running, 30);
        clock.Jump(frozen, 30);
        clock.Freeze(frozen);

        var castRunning = Cast("@rosa", "@marcus");
        var castFrozen = Cast("@rosa", "@marcus");
        var registry = host.GetRequiredService<IReactionLoopRegistry>();
        registry.Register(Registration(running, [SeededStoryline(running, "Running concern", castRunning.Keys.ToList())], castRunning));
        registry.Register(Registration(frozen, [SeededStoryline(frozen, "Frozen concern", castFrozen.Keys.ToList())], castFrozen));

        var loop = host.GetServices<Microsoft.Extensions.Hosting.IHostedService>().OfType<ReactionLoopHost>().Single();
        await loop.StartAsync(CancellationToken.None);
        try
        {
            await WaitUntilAsync(async () =>
            {
                await using var read = _fixture.CreateContext(ScopeFor(running));
                return await read.EngineReviewItems.CountAsync() > 0;
            });
        }
        finally
        {
            await loop.StopAsync(CancellationToken.None);
        }

        await using var readRunning = _fixture.CreateContext(ScopeFor(running));
        (await readRunning.EngineReviewItems.CountAsync()).Should().BeGreaterThan(
            0, "the hosted BackgroundService drives the loop for a running exercise");

        await using var readFrozen = _fixture.CreateContext(ScopeFor(frozen));
        (await readFrozen.EngineReviewItems.CountAsync()).Should().Be(
            0, "a freeze halts ticking, so the frozen exercise generated nothing (COR-052)");
    }

    // ---- engine-runtime/06: official responses reach the live loop -----------------------------------------

    private const string AnsweringPost = "County update on #WaterIssues: do not drink tap water until further notice.";
    private const string UnrelatedPost = "Reminder: the Elm Street farmers market opens Saturday at 8am.";

    private static AddressingObservation OfficialPost(string text) =>
        new(AddressingSource.OfficialPost, Guid.NewGuid().ToString(), text);

    /// <summary>Starts an exercise clock 25 scenario minutes in: past the test storyline's 20-minute silence window.</summary>
    private static (Storyline Storyline, ReactionLoopRegistration Registration) SilentExercise(
        ServiceProvider host, ManualTimeProvider manualTime, Guid exerciseId)
    {
        host.GetRequiredService<IExerciseClock>().Start(exerciseId, ScenarioStart, TimeZoneInfo.Utc);
        var cast = Cast("@rosa", "@marcus", "@lena");
        var storyline = SeededStoryline(exerciseId, "Water main contamination fears", cast.Keys.ToList());
        return (storyline, Registration(exerciseId, [storyline], cast));
    }

    private async Task<List<(string EventType, JsonElement Payload)>> EventsAsync(Guid exerciseId)
    {
        await using var read = _fixture.CreateContext(ScopeFor(exerciseId));
        var rows = await read.TelemetryEvents.Select(e => new { e.EventType, e.Payload }).ToListAsync();
        return rows.Select(r => (r.EventType, JsonDocument.Parse(r.Payload ?? "{}").RootElement.Clone())).ToList();
    }

    private async Task<int> DecidedCountAsync(Guid exerciseId) =>
        (await EventsAsync(exerciseId))
            .Where(e => e.EventType == EngineEventTypes.Decided)
            .Select(e => e.Payload.GetProperty("count").GetInt32())
            .Single();

    [RequiresDockerFact]
    public async Task Tick_WhenAParticipantPostAnswersTheStoryline_AddressesIt_AndVoicesAResponseNotMoreSilence()
    {
        var exerciseId = Guid.NewGuid();
        var manualTime = new ManualTimeProvider(ScenarioStart);
        await using var host = BuildHost(manualTime);
        var (storyline, registration) = SilentExercise(host, manualTime, exerciseId);
        manualTime.Advance(TimeSpan.FromMinutes(25)); // the silence window (20) has blown: this tick would escalate
        registration.ResponseMatching.EnableAutoConfirm(); // the operator's opt-in

        host.GetRequiredService<IAddressingInbox>().Enqueue(exerciseId, OfficialPost(AnsweringPost));

        var result = await RunOneTickAsync(host, registration);

        storyline.Phase.Should().Be(StorylinePhase.Addressed, "a confirmed match addresses the storyline (ADP-002)");
        storyline.MinutesSinceLastOfficialResponse.Should().Be(0, "the response resets the silence clock");
        result.ReviewItemsEnqueued.Should().Be(
            1, "one burst — the response reaction — and NOT an escalation burst for the silence it just answered");

        var events = await EventsAsync(exerciseId);
        events.Should().Contain(
            e => e.EventType == EngineEventTypes.Observed && e.Payload.GetProperty("trigger").GetString() == "action-seen",
            "the official post is observed with the taxonomy's action-seen trigger");
        events.Should().Contain(
            e => e.EventType == EngineEventTypes.StorylineStateChanged
                && e.Payload.GetProperty("cause").GetString() == "matched-response"
                && e.Payload.GetProperty("toPhase").GetString() == nameof(StorylinePhase.Addressed),
            "the match is recorded as a storyline transition to Addressed, caused by the matched response");
        var decided = events.Where(e => e.EventType == EngineEventTypes.Decided).Should().ContainSingle().Subject;
        decided.Payload.GetProperty("toneMix").GetString().Should().StartWith(
            "gratitude", "the matched-response reaction leans to gratitude + calm + one skeptic (response-reaction/01)");
        decided.Payload.GetProperty("count").GetInt32().Should().Be(
            3, "a response is a burst that can carry the mix — all three of this storyline's voices, not one reply");
    }

    [RequiresDockerFact]
    public async Task Tick_WhenAPlausibleMatchAwaitsConfirmation_TheStorylineStaysSilent_AndItsEscalationIsSlowed()
    {
        // Two identical silent exercises in one host; only one receives the (unconfirmed) official post.
        var withPost = Guid.NewGuid();
        var baseline = Guid.NewGuid();
        var manualTime = new ManualTimeProvider(ScenarioStart);
        await using var host = BuildHost(manualTime);
        var (storyline, registration) = SilentExercise(host, manualTime, withPost);
        var (_, baselineRegistration) = SilentExercise(host, manualTime, baseline);
        manualTime.Advance(TimeSpan.FromMinutes(25));

        // Auto-confirm is OFF (the default): a plausible match needs the controller's Y/N.
        host.GetRequiredService<IAddressingInbox>().Enqueue(withPost, OfficialPost(AnsweringPost));

        await RunOneTickAsync(host, registration);
        await RunOneTickAsync(host, baselineRegistration);

        storyline.Phase.Should().Be(StorylinePhase.Escalating, "an unconfirmed suggestion never addresses a storyline (miss-safe)");
        storyline.MinutesSinceLastOfficialResponse.Should().Be(25, "and never resets the silence clock");

        var baselineCount = await DecidedCountAsync(baseline);
        baselineCount.Should().BeGreaterThan(1, "precondition: an unslowed burst has more than one voice, so a slow is visible");
        (await DecidedCountAsync(withPost)).Should().Be(
            Math.Max(1, baselineCount / 2),
            "a pending official post SLOWS the escalation burst (ADP-002a) — fewer voices, never zero");
    }

    [RequiresDockerFact]
    public async Task Tick_WhenAnOfficialPostMatchesNothing_ItIsNeitherSilenceNorAnAnswer_AndEscalationSlows()
    {
        var withPost = Guid.NewGuid();
        var baseline = Guid.NewGuid();
        var manualTime = new ManualTimeProvider(ScenarioStart);
        await using var host = BuildHost(manualTime);
        var (storyline, registration) = SilentExercise(host, manualTime, withPost);
        var (_, baselineRegistration) = SilentExercise(host, manualTime, baseline);
        manualTime.Advance(TimeSpan.FromMinutes(25));

        // Even with auto-confirm ON, an irrelevant post cannot game the engine into calming down.
        registration.ResponseMatching.EnableAutoConfirm();
        host.GetRequiredService<IAddressingInbox>().Enqueue(withPost, OfficialPost(UnrelatedPost));

        await RunOneTickAsync(host, registration);
        await RunOneTickAsync(host, baselineRegistration);

        storyline.Phase.Should().Be(StorylinePhase.Escalating, "an unmatched post never addresses the storyline");
        storyline.MinutesSinceLastOfficialResponse.Should().Be(25, "and is never treated as an answer to the silence");

        var baselineCount = await DecidedCountAsync(baseline);
        baselineCount.Should().BeGreaterThan(1, "precondition: an unslowed burst has more than one voice, so a slow is visible");
        (await DecidedCountAsync(withPost)).Should().Be(
            Math.Max(1, baselineCount / 2),
            "but it is never treated as silence either: the escalation slows (miss-safe, ADP-002a)");

        (await EventsAsync(withPost)).Should().NotContain(
            e => e.EventType == EngineEventTypes.Observed && e.Payload.GetProperty("trigger").GetString() == "action-seen",
            "a post that relates to no storyline is not recorded as an answer to one (E10's response metrics read these)");
    }

    [RequiresDockerFact]
    public async Task Tick_ResolvesEachOfficialPostExactlyOnce()
    {
        var exerciseId = Guid.NewGuid();
        var manualTime = new ManualTimeProvider(ScenarioStart);
        await using var host = BuildHost(manualTime);
        var (_, registration) = SilentExercise(host, manualTime, exerciseId);
        manualTime.Advance(TimeSpan.FromMinutes(25));
        registration.ResponseMatching.EnableAutoConfirm();
        host.GetRequiredService<IAddressingInbox>().Enqueue(exerciseId, OfficialPost(AnsweringPost));

        await RunOneTickAsync(host, registration);
        manualTime.Advance(TimeSpan.FromMinutes(1));
        await RunOneTickAsync(host, registration);

        (await EventsAsync(exerciseId))
            .Count(e => e.EventType == EngineEventTypes.Observed && e.Payload.GetProperty("trigger").GetString() == "action-seen")
            .Should().Be(1, "the tick drains the inbox, so a post is resolved once and never re-answers the storyline");
    }

    [RequiresDockerFact]
    public async Task Tick_WhenAnUnconfirmedAnswerLandsBetweenBursts_TheNextEscalationBurstIsStillSlowed()
    {
        // The common case: the loop ticks every few seconds, but the reaction cadence lets a silent storyline
        // re-fire only every few scenario minutes, so nearly every post lands on a tick with no burst due. The
        // slow must wait for the storyline's next burst, not die with the tick that drained the post.
        var withPost = Guid.NewGuid();
        var baseline = Guid.NewGuid();
        var manualTime = new ManualTimeProvider(ScenarioStart);
        await using var host = BuildHost(manualTime);
        var (storyline, registration) = SilentExercise(host, manualTime, withPost);
        var (_, baselineRegistration) = SilentExercise(host, manualTime, baseline);

        async Task TickBothAsync()
        {
            await RunOneTickAsync(host, registration);
            await RunOneTickAsync(host, baselineRegistration);
        }

        manualTime.Advance(TimeSpan.FromMinutes(25));
        await TickBothAsync(); // both escalate

        manualTime.Advance(TimeSpan.FromMinutes(1));
        host.GetRequiredService<IAddressingInbox>().Enqueue(withPost, OfficialPost(AnsweringPost)); // auto-confirm off
        var quiet = await RunOneTickAsync(host, registration);
        await RunOneTickAsync(host, baselineRegistration);
        quiet.InactionTriggers.Should().Be(0, "precondition: the post lands on a tick with no burst due");

        manualTime.Advance(TimeSpan.FromMinutes(2)); // minute 28: the 3-minute cadence has elapsed
        await TickBothAsync();
        manualTime.Advance(TimeSpan.FromMinutes(3)); // minute 31
        await TickBothAsync();

        storyline.Phase.Should().NotBe(StorylinePhase.Addressed, "an unconfirmed suggestion never addresses the storyline");
        var baselineCounts = await DecidedCountsInOrderAsync(baseline);
        baselineCounts.Should().HaveCount(3, "precondition: three escalation bursts in each exercise");
        baselineCounts[1].Should().BeGreaterThan(1, "precondition: an unslowed burst has more than one voice, so a slow is visible");
        (await DecidedCountsInOrderAsync(withPost)).Should().Equal(
            [baselineCounts[0], Math.Max(1, baselineCounts[1] / 2), baselineCounts[2]],
            "the slow waits for the storyline's next burst (ADP-002a) and is spent by it: one slowed burst per answer");
    }

    [RequiresDockerFact]
    public async Task Tick_WhenAnUnconfirmedAnswerSuggestsOneStoryline_OnlyThatStorylineSlows()
    {
        var withPost = Guid.NewGuid();
        var baseline = Guid.NewGuid();
        var manualTime = new ManualTimeProvider(ScenarioStart);
        await using var host = BuildHost(manualTime);
        var (water, power, registration) = WaterAndPowerExercise(host, withPost);
        var (baselineWater, baselinePower, baselineRegistration) = WaterAndPowerExercise(host, baseline);
        manualTime.Advance(TimeSpan.FromMinutes(25));

        // #WaterIssues names the water storyline; auto-confirm is off, so it awaits the controller's Y/N.
        host.GetRequiredService<IAddressingInbox>().Enqueue(withPost, OfficialPost(AnsweringPost));
        await RunOneTickAsync(host, registration);
        await RunOneTickAsync(host, baselineRegistration);

        var baselineWaterCount = await DecidedCountAsync(baseline, baselineWater.Id);
        baselineWaterCount.Should().BeGreaterThan(1, "precondition: an unslowed burst has more than one voice, so a slow is visible");
        (await DecidedCountAsync(withPost, water.Id)).Should().Be(
            Math.Max(1, baselineWaterCount / 2), "the storyline the answer plausibly addresses is slowed");
        (await DecidedCountAsync(withPost, power.Id)).Should().Be(
            await DecidedCountAsync(baseline, baselinePower.Id),
            "a storyline the answer does not touch keeps its full pressure: only an UNMATCHED post slows everything");
    }

    [RequiresDockerFact]
    public async Task Tick_WhenTheStorylineIsAlreadyAddressed_AFollowUpAnswerResetsTheClock_ButDrawsNoSecondBurst()
    {
        var exerciseId = Guid.NewGuid();
        var manualTime = new ManualTimeProvider(ScenarioStart);
        await using var host = BuildHost(manualTime);
        var (storyline, registration) = SilentExercise(host, manualTime, exerciseId);
        manualTime.Advance(TimeSpan.FromMinutes(25));
        registration.ResponseMatching.EnableAutoConfirm();
        var inbox = host.GetRequiredService<IAddressingInbox>();

        inbox.Enqueue(exerciseId, OfficialPost(AnsweringPost));
        (await RunOneTickAsync(host, registration)).ReviewItemsEnqueued.Should().Be(
            1, "the answer that addresses the storyline draws the response burst");

        manualTime.Advance(TimeSpan.FromMinutes(2));
        inbox.Enqueue(exerciseId, OfficialPost("Follow-up on #WaterIssues: crews are flushing the mains tonight."));
        var followUp = await RunOneTickAsync(host, registration);

        followUp.ReviewItemsEnqueued.Should().Be(
            0, "a follow-up to an answered storyline must not become another gratitude wave and review decision (CTL-034)");
        storyline.MinutesSinceLastOfficialResponse.Should().Be(0, "but it is still an official response: the silence clock resets");
    }

    [RequiresDockerFact]
    public async Task Tick_WhenAMatchNamesAStorylineThatNoLongerExists_ItAddressesNothing_AndEscalationSlows()
    {
        var withPost = Guid.NewGuid();
        var baseline = Guid.NewGuid();
        var manualTime = new ManualTimeProvider(ScenarioStart);
        await using var host = BuildHost(manualTime);
        var (storyline, registration) = SilentExercise(host, manualTime, withPost);
        var (_, baselineRegistration) = SilentExercise(host, manualTime, baseline);
        manualTime.Advance(TimeSpan.FromMinutes(25));

        // An off-platform marker hinting at a storyline from an earlier seed: the resolver calls it a match, but
        // to a storyline this registration does not hold. Its target is unknown, so it must act as unmatched.
        host.GetRequiredService<IAddressingInbox>().Enqueue(
            withPost,
            new AddressingObservation(
                AddressingSource.OffPlatformMarker, Guid.NewGuid().ToString(), "Press briefing held", StorylineHintId: Guid.NewGuid()));
        await RunOneTickAsync(host, registration);
        await RunOneTickAsync(host, baselineRegistration);

        storyline.Phase.Should().Be(StorylinePhase.Escalating, "nothing this exercise holds was answered");
        storyline.MinutesSinceLastOfficialResponse.Should().Be(25, "so no silence clock resets");
        var baselineCount = await DecidedCountAsync(baseline);
        baselineCount.Should().BeGreaterThan(1, "precondition: an unslowed burst has more than one voice, so a slow is visible");
        (await DecidedCountAsync(withPost)).Should().Be(
            Math.Max(1, baselineCount / 2), "an answer whose target is unknown slows every storyline (miss-safe, ADP-002a)");
        (await EventsAsync(withPost)).Should().NotContain(
            e => e.EventType == EngineEventTypes.Observed && e.Payload.GetProperty("trigger").GetString() == "action-seen",
            "and is never recorded against a storyline that does not exist");
    }

    private static (Storyline Water, Storyline Power, ReactionLoopRegistration Registration) WaterAndPowerExercise(
        ServiceProvider host, Guid exerciseId)
    {
        host.GetRequiredService<IExerciseClock>().Start(exerciseId, ScenarioStart, TimeZoneInfo.Utc);
        var cast = Cast("@rosa", "@marcus", "@lena");
        var water = SeededStoryline(exerciseId, "Water main contamination fears", cast.Keys.ToList());
        var power = Storyline.Create(
            exerciseId,
            title: "Substation fire outage",
            expectation: "a restoration estimate from the electric cooperative",
            responseWindowMin: 20,
            participatingPersonas: cast.Keys.ToList(),
            hashtags: ["#PowerOut"]);
        power.Seed(0);
        return (water, power, Registration(exerciseId, [water, power], cast));
    }

    private async Task<int> DecidedCountAsync(Guid exerciseId, Guid storylineId) =>
        (await EventsAsync(exerciseId))
            .Where(e => e.EventType == EngineEventTypes.Decided
                && e.Payload.GetProperty("storyline").GetString() == storylineId.ToString())
            .Select(e => e.Payload.GetProperty("count").GetInt32())
            .Single();

    private async Task<List<int>> DecidedCountsInOrderAsync(Guid exerciseId)
    {
        await using var read = _fixture.CreateContext(ScopeFor(exerciseId));
        var payloads = await read.TelemetryEvents
            .Where(e => e.EventType == EngineEventTypes.Decided)
            .OrderBy(e => e.WallClockTime)
            .Select(e => e.Payload)
            .ToListAsync();
        return payloads.Select(CountOf).ToList();

        static int CountOf(string? payload)
        {
            using var document = JsonDocument.Parse(payload ?? "{}");
            return document.RootElement.GetProperty("count").GetInt32();
        }
    }

    [RequiresDockerFact]
    public async Task ParticipantPost_ThroughTheRealIngestFunnel_AddressesTheStorylineOnTheNextTick()
    {
        // The supply-nothing test: no test double feeds the inbox. A participant post goes through the same
        // PostIngestService the HTTP endpoint uses, and only the composition (observer → inbox → driver) can
        // carry it to the loop. Before engine-runtime/06 every link of this chain was missing.
        var exerciseId = Guid.NewGuid();
        var manualTime = new ManualTimeProvider(ScenarioStart);
        await using var host = BuildHost(manualTime);
        var (storyline, registration) = SilentExercise(host, manualTime, exerciseId);
        manualTime.Advance(TimeSpan.FromMinutes(25));
        registration.ResponseMatching.EnableAutoConfirm();

        using (var scope = host.CreateScope())
        {
            ((ExerciseContext)scope.ServiceProvider.GetRequiredService<IExerciseContext>()).CurrentExerciseId = exerciseId;
            var ingest = scope.ServiceProvider.GetRequiredService<PostIngestService>();
            var posted = await ingest.IngestAsync(
                new CreatePostRequest
                {
                    Text = AnsweringPost,
                    ScenarioTime = "2033-06-01T09:25:00Z",
                    TimeZone = "UTC",
                },
                new PostAttribution
                {
                    AuthorPersonaId = Guid.NewGuid(),
                    Origin = "participant",
                    ActingHumanId = "participant-pio-1",
                });
            posted.Outcome.Should().Be(PostIngestOutcome.Created);
        }

        await RunOneTickAsync(host, registration);

        storyline.Phase.Should().Be(
            StorylinePhase.Addressed, "a participant's post reaches the loop through the real write path and answers the storyline");
    }

    private static async Task WaitUntilAsync(Func<Task<bool>> condition)
    {
        var deadline = Stopwatch.StartNew();
        while (deadline.Elapsed < TimeSpan.FromSeconds(20))
        {
            if (await condition())
            {
                return;
            }

            await Task.Delay(100);
        }

        throw new TimeoutException("The reaction loop did not produce a review item within the timeout.");
    }
}
